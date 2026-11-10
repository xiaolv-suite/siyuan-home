/**
 * 历史台账发现、重名检测、智能接管与列自愈中枢（解耦自 provisioner.ts）
 * 包含：重名台账文档排查、绑定已有文档为台账、智能探针自动发现接管历史台账、幽灵列自愈与映射校准。
 */

import type { HomeSettings, DbRef } from "@/types";
import type { ModuleSchema } from "./schema";
import {
    sql,
    getHPathByID,
    createAttributeView,
    openNotebook,
} from "./siyuan";
import { errText } from "./settings";
import {
    DOC_TITLE_PREFIX,
    COMMON_COLUMN_ALIASES,
    type ProvisionOptions,
    type ProvisionResult,
    ensureNotebook,
    ledgerHPath,
    findLedgerDoc,
    findAvBlockInDoc,
    ensureColumns,
    stableAvSeed,
} from "./provisioner";

export interface DuplicateFinding {
    hpath: string;
    docIds: string[];
}

/** 33.2 重复检测：同一笔记本内同名台账文档（hpath 相同出现 >1 次） */
export async function findDuplicateLedgers(settings: HomeSettings): Promise<DuplicateFinding[]> {
    const notebookId = settings.dbRefs.members?.notebook ?? settings.dbRefs.certs?.notebook;
    if (!notebookId) return [];
    const escapedBox = notebookId.replace(/'/g, "''");
    const escapedPrefix = DOC_TITLE_PREFIX.replace(/'/g, "''");
    const rows = await sql<{ hpath: string; cnt: number }>(
        `SELECT hpath, COUNT(id) AS cnt FROM blocks
         WHERE type='d' AND box='${escapedBox}' AND (hpath LIKE '%/${escapedPrefix}%' OR hpath LIKE '/${escapedPrefix}%')
         GROUP BY hpath HAVING cnt > 1`,
    );
    const out: DuplicateFinding[] = [];
    for (const r of rows) {
        const ids = await sql<{ id: string }>(
            `SELECT id FROM blocks WHERE type='d' AND box='${escapedBox}' AND hpath='${r.hpath.replace(/'/g, "''")}'`,
        );
        out.push({ hpath: r.hpath, docIds: ids.map((x) => x.id) });
    }
    return out;
}

/**
 * 绑定已有文档为台账（D07）：
 * 1. 校验 docId 在思源中存在；
 * 2. 探查文档中已有 av 块（没有则建一个）；
 * 3. 补齐列（只增不改）；
 * 4. 写入 settings.dbRefs[moduleId]；
 * 5. 返回更新后的 DbRef。
 */
export async function bindExistingDoc(
    settings: HomeSettings,
    moduleId: string,
    rawDocInput: string,
    schema: ModuleSchema,
    opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
    const raw = (rawDocInput ?? "").trim();
    const mBlock = raw.match(/\b\d{14}-[a-z0-9]{7}\b/i);
    const docId = mBlock ? mBlock[0] : raw;
    if (!docId) throw new Error("invalid document ID or link");

    let hpath = "";
    try {
        hpath = await getHPathByID(docId);
    } catch (e) {
        throw new Error(`document not found in SiYuan: ${errText(e)}`);
    }
    if (!hpath) throw new Error("document not found in SiYuan");

    const notebookRows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${docId.replace(/'/g, "''")}' LIMIT 1`);
    const notebookId = notebookRows[0]?.box;

    let avId = await findAvBlockInDoc(docId);
    let provisional = false;
    let provisionError: string | undefined;

    if (!avId) {
        try {
            avId = await createAttributeView(docId, stableAvSeed(moduleId, docId), { idempotencyKey: `bind:av:${moduleId}:${docId}` });
        } catch (e) {
            provisional = true;
            provisionError = errText(e);
        }
    }

    const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
    const { columns, error } = await ensureColumns(avId, schema, undefined, moduleId, opts, memberAvId);
    const dbRef: DbRef = {
        docId,
        avId: avId ?? undefined,
        notebook: notebookId,
        provisional,
        columns,
        provisionError: provisionError ?? error,
    };
    settings.dbRefs[moduleId] = dbRef;
    return { dbRef, created: false };
}

export interface AdoptionReport {
    adoptedCount: number;
    adoptedModules: string[];
    alreadyReadyCount: number;
    issues: { moduleId: string; message: string }[];
}

/**
 * 智能扫描并找回思源中已有的全部历史台账（老版本平滑升级匹配与成果保障机制）：
 * 1. 遍历当前启用的所有模块；
 * 2. 检查当前是否已绑定有效 docId，若已绑定且思源文档在则计入已就绪；
 * 3. 若未绑定、provisional 或失效，启动全局智能探针（按标题、多版本别名、专属 AV 块特征）在思源全部笔记本中找回；
 * 4. 找回后自动更新设置映射并补齐缺失列；
 * 5. 返回详细的找回与升级报告。
 */
export async function discoverAndAdoptAllLedgers(
    settings: HomeSettings,
    schemaCatalog: Record<string, ModuleSchema>,
    resolveName: (k: string) => string = (k) => k,
): Promise<AdoptionReport> {
    const report: AdoptionReport = {
        adoptedCount: 0,
        adoptedModules: [],
        alreadyReadyCount: 0,
        issues: [],
    };
    const defaultNbId = await ensureNotebook(undefined, settings.targetNotebookId);

    for (const moduleId of settings.enabledModules) {
        const schema = schemaCatalog[moduleId];
        if (!schema) continue;
        const existing = settings.dbRefs[moduleId];
        if (existing?.docId && !existing.provisional) {
            try {
                const hp = await getHPathByID(existing.docId);
                if (hp) {
                    const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
                    const { columns, error } = await ensureColumns(existing.avId, schema, existing.columns, moduleId, { resolveName }, memberAvId);
                    existing.columns = columns;
                    if (error) existing.provisionError = error;
                    report.alreadyReadyCount++;
                    continue;
                }
            } catch { /* doc missing or invalid */ }
        }

        // 尝试自动找回
        const titleI18n = resolveName(`module.${moduleId}`);
        const hpath = ledgerHPath(titleI18n);
        const found = await findLedgerDoc(existing?.notebook || defaultNbId, hpath, moduleId);

        if (found) {
            const actualNb = found.box || existing?.notebook || defaultNbId;
            try {
                await openNotebook(actualNb, { retries: 1 });
            } catch { /* ignore */ }

            let avId = await findAvBlockInDoc(found.id);
            if (!avId) {
                try {
                    avId = await createAttributeView(found.id, stableAvSeed(moduleId, found.id), {
                        idempotencyKey: `adopt:av:${moduleId}:${found.id}`,
                    });
                } catch {
                    // provisional
                }
            }
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error } = await ensureColumns(avId, schema, existing?.columns, moduleId, { resolveName }, memberAvId);
            settings.dbRefs[moduleId] = {
                ...existing,
                docId: found.id,
                avId: avId ?? undefined,
                notebook: actualNb,
                columns,
                provisional: !avId,
                provisionError: error,
            };
            report.adoptedCount++;
            report.adoptedModules.push(titleI18n);
        } else {
            if (existing?.provisionError) {
                report.issues.push({ moduleId, message: existing.provisionError });
            }
        }
    }

    return report;
}

/**
 * 实时自愈指定的列 ID 映射（解决写入时思源报错 key not found 的根本自愈通道）
 * 1) 读取思源属性视图真实列清单；
 * 2) 通过别名匹配真实存在的列 ID，校准并持久化；
 * 3) 若思源中该列已被删除，自动补建列并更新 ID 映射。
 */
export async function healColumnMapping(
    plugin: any,
    moduleId: string,
    colKey: string,
): Promise<string | undefined> {
    const ref = plugin?.settings?.dbRefs?.[moduleId];
    if (!ref?.avId) return undefined;

    try {
        const { renderLedger, addAttributeViewColumn } = await import("./siyuan");
        const av = await renderLedger(ref.avId);
        const knownColumns: any[] = av?.columns ?? [];
        const schemaCol = plugin.schemaCatalog?.[moduleId]?.columns?.find((c: any) => c.key === colKey);
        const colName = (plugin.i18n?.[`field.${colKey}`] ?? schemaCol?.name ?? colKey) as string;
        const colAliases = new Set([colName, colKey, ...(COMMON_COLUMN_ALIASES[colKey] ?? [])]);

        // 1. 尝试在思源当前真实列中通过别名匹配已有列
        const matched = knownColumns.find((c: any) => colAliases.has(c?.name) || colAliases.has(c?.keyName));
        if (matched?.id) {
            const realId = String(matched.id);
            ref.columns = { ...(ref.columns ?? {}), [colKey]: realId };
            try {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
            } catch { /* soft */ }
            return realId;
        }

        // 2. 若思源中连同名列都没有（被删除），则自动在思源属性视图中补建该列
        const colType = schemaCol?.type ?? "text";
        const memberAvId = moduleId === "members" ? undefined : plugin.settings?.dbRefs?.members?.avId;
        const newKeyID = await addAttributeViewColumn(ref.avId, {
            name: colName,
            type: colType,
            relationTargetAvID: colType === "relation" ? memberAvId : undefined,
        }, { idempotencyKey: `heal:${ref.avId}:${colKey}:${Date.now().toString(36)}`, retries: 1 });

        ref.columns = { ...(ref.columns ?? {}), [colKey]: newKeyID };
        try {
            const { saveSettings } = await import("./settings");
            await saveSettings(plugin, plugin.settings);
        } catch { /* soft */ }
        return newKeyID;
    } catch (e) {
        console.warn(`[LvHome] healColumnMapping for ${moduleId}.${colKey} failed:`, e);
        return undefined;
    }
}
