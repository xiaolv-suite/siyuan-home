/**
 * 历史台账发现、重名检测、智能接管与列自愈中枢（解耦自 provisioner.ts）
 * 包含：重名台账文档排查、绑定已有文档为台账、智能探针自动发现接管历史台账、幽灵列自愈与映射校准。
 */

import type { HomeSettings, DbRef, SchemaColumnIssue } from "@/types";
import type { ModuleSchema } from "./schema";
import {
    sql,
    getHPathByID,
    createAndBindAttributeView,
    openNotebook,
    setCell,
    type RequestOptions,
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
    findAvBlockRefInDoc,
    verifyAvRefBound,
    ensureColumns,
    stableAvSeed,
    isCompatibleLiveColumnType,
    formatTypeDriftGuidance,
} from "./provision-common";

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

    let avRef = await findAvBlockRefInDoc(docId);
    let provisional = false;
    let provisionError: string | undefined;

    if (!avRef) {
        try {
            const bound = await createAndBindAttributeView(docId, stableAvSeed(moduleId, docId), {
                idempotencyKey: `bind:av:${moduleId}:${docId}`,
                schema: "home-ledger-v2",
            });
            avRef = { avId: bound.avId, avBlockId: bound.avBlockId, fromLiveDom: true };
        } catch (e) {
            provisional = true;
            provisionError = errText(e);
        }
    }

    const avId = avRef?.avId;
    const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
    const { columns, error, schemaIssues } = await ensureColumns(avId, schema, undefined, moduleId, opts, memberAvId);
    const dbRef: DbRef = {
        docId,
        avId: avId ?? undefined,
        avBlockId: avRef?.avBlockId,
        schema: "home-ledger-v2",
        schemaVersion: 2,
        notebook: notebookId,
        provisional,
        columns,
        provisionError: provisionError ?? error,
        schemaIssues: schemaIssues?.length ? schemaIssues : undefined,
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
    resolveModuleTitle?: (moduleId: string) => string,
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
                    await verifyAvRefBound(existing);
                    const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
                    const { columns, error, schemaIssues } = await ensureColumns(existing.avId, schema, existing.columns, moduleId, { resolveName }, memberAvId);
                    existing.columns = columns;
                    existing.schemaIssues = schemaIssues?.length ? schemaIssues : undefined;
                    if (error) existing.provisionError = error;
                    report.alreadyReadyCount++;
                    continue;
                }
            } catch { /* doc missing or binding torn */ }
        }

        // 尝试自动找回
        const resolvedByKey = resolveName(`module.${moduleId}`);
        const titleI18n = resolveModuleTitle
            ? resolveModuleTitle(moduleId)
            : (resolvedByKey && !resolvedByKey.startsWith("field.") && resolvedByKey !== `module.${moduleId}`
                ? resolvedByKey
                : moduleId);
        const hpath = ledgerHPath(titleI18n);
        const found = await findLedgerDoc(existing?.notebook || defaultNbId, hpath, moduleId);

        if (found) {
            const actualNb = found.box || existing?.notebook || defaultNbId;
            try {
                await openNotebook(actualNb, { retries: 1 });
            } catch { /* ignore */ }

            let avRef = await findAvBlockRefInDoc(found.id);
            if (!avRef) {
                try {
                    const bound = await createAndBindAttributeView(found.id, stableAvSeed(moduleId, found.id), {
                        idempotencyKey: `adopt:av:${moduleId}:${found.id}`,
                        schema: "home-ledger-v2",
                    });
                    avRef = { avId: bound.avId, avBlockId: bound.avBlockId, fromLiveDom: true };
                } catch {
                    // provisional
                }
            }
            const avId = avRef?.avId;
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error, schemaIssues } = await ensureColumns(avId, schema, existing?.columns, moduleId, { resolveName }, memberAvId);
            settings.dbRefs[moduleId] = {
                ...existing,
                docId: found.id,
                avId: avId ?? undefined,
                avBlockId: avRef?.avBlockId ?? existing?.avBlockId,
                schema: "home-ledger-v2",
                schemaVersion: 2,
                notebook: actualNb,
                columns,
                provisional: !avId,
                provisionError: error,
                schemaIssues: schemaIssues?.length ? schemaIssues : undefined,
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

function recordSchemaIssue(ref: DbRef, issue: SchemaColumnIssue): void {
    const existing = Array.isArray(ref.schemaIssues) ? ref.schemaIssues : [];
    const filtered = existing.filter((item) => !(item.moduleId === issue.moduleId && item.colKey === issue.colKey));
    ref.schemaIssues = [...filtered, issue];
}

function clearSchemaIssue(ref: DbRef, moduleId: string, colKey: string): void {
    if (!Array.isArray(ref.schemaIssues)) return;
    const filtered = ref.schemaIssues.filter((item) => !(item.moduleId === moduleId && item.colKey === colKey));
    ref.schemaIssues = filtered.length > 0 ? filtered : undefined;
}

/**
 * 实时自愈指定的列 ID 映射（解决写入时思源报错 key not found 的根本自愈通道）
 * 1) 读取思源属性视图真实列清单；
 * 2) 校验真实列类型：若发现类型漂移，严禁覆盖/删除原列，精准记入 schemaIssues 并返回 undefined；
 * 3) 通过别名匹配真实存在的兼容列 ID，校准并持久化；
 * 4) 若思源中该列已被删除，自动补建列（含 select 选项同步）并更新 ID 映射。
 */
export async function healColumnMapping(
    plugin: any,
    moduleId: string,
    colKey: string,
): Promise<string | undefined> {
    const ref: DbRef | undefined = plugin?.settings?.dbRefs?.[moduleId];
    if (!ref?.avId) return undefined;

    try {
        const { renderLedger, addAttributeViewColumn } = await import("./siyuan");
        const av = await renderLedger(ref.avId);
        const knownColumns: any[] = av?.columns ?? [];
        const { SCHEMA_CATALOG } = await import("./schema-catalog");
        const schemaCol = (plugin.schemaCatalog?.[moduleId] ?? SCHEMA_CATALOG[moduleId])?.columns?.find((c: any) => c.key === colKey);
        const i18nKey = `field.${colKey}`;
        const fromI18n = plugin.i18n?.[i18nKey] ?? (typeof plugin.i18nText === "function" ? plugin.i18nText(i18nKey) : undefined);
        const colName = (fromI18n && fromI18n !== i18nKey ? fromI18n : undefined)
            ?? COMMON_COLUMN_ALIASES[colKey]?.[0]
            ?? schemaCol?.name
            ?? colKey;
        const colAliases = new Set([colName, colKey, ...(COMMON_COLUMN_ALIASES[colKey] ?? [])]);
        const expectedType = schemaCol?.type ?? "text";

        // 0. 若当前映射的列 ID 仍在真实列中存在，先校验其类型是否已发生漂移（绝不覆盖用户原列）
        const currentMappedId = ref.columns?.[colKey];
        const currentMappedCol = currentMappedId
            ? knownColumns.find((c: any) => String(c?.id) === currentMappedId)
            : undefined;
        if (currentMappedCol?.id) {
            const actualType = currentMappedCol.type ? String(currentMappedCol.type) : undefined;
            if (actualType && !isCompatibleLiveColumnType(colKey, expectedType, actualType)) {
                recordSchemaIssue(ref, {
                    moduleId,
                    colKey,
                    expectedType,
                    actualType,
                    liveColumnId: String(currentMappedCol.id),
                    liveColumnName: currentMappedCol.name ?? currentMappedCol.keyName,
                    guidance: formatTypeDriftGuidance(moduleId, colKey, colName, expectedType, actualType),
                });
                try {
                    if (typeof plugin.saveData === "function") {
                        const { saveSettings } = await import("./settings");
                        await saveSettings(plugin, plugin.settings);
                    }
                } catch { /* soft */ }
                return undefined;
            }
        }

        // 1. 尝试在思源当前真实列中通过别名匹配已有列（优先匹配类型兼容的列）
        const aliasCandidates = knownColumns.filter((c: any) =>
            colAliases.has(c?.name) || colAliases.has(c?.keyName) || (colKey === "name" && c?.type === "block"),
        );
        const matched = aliasCandidates.find((c: any) => isCompatibleLiveColumnType(colKey, expectedType, c?.type))
            ?? aliasCandidates[0];
        if (matched?.id) {
            const actualType = matched.type ? String(matched.type) : undefined;
            if (actualType && !isCompatibleLiveColumnType(colKey, expectedType, actualType)) {
                recordSchemaIssue(ref, {
                    moduleId,
                    colKey,
                    expectedType,
                    actualType,
                    liveColumnId: String(matched.id),
                    liveColumnName: matched.name ?? matched.keyName,
                    guidance: formatTypeDriftGuidance(moduleId, colKey, colName, expectedType, actualType),
                });
                try {
                    if (typeof plugin.saveData === "function") {
                        const { saveSettings } = await import("./settings");
                        await saveSettings(plugin, plugin.settings);
                    }
                } catch { /* soft */ }
                return undefined;
            }
            const realId = String(matched.id);
            ref.columns = { ...(ref.columns ?? {}), [colKey]: realId };
            clearSchemaIssue(ref, moduleId, colKey);
            try {
                if (typeof plugin.saveData === "function") {
                    const { saveSettings } = await import("./settings");
                    await saveSettings(plugin, plugin.settings);
                }
            } catch { /* soft */ }
            return realId;
        }

        // 2. 若思源中连同名列都没有（被删除），则自动在思源属性视图中补建该列
        const memberAvId = moduleId === "members" ? undefined : plugin.settings?.dbRefs?.members?.avId;
        if (expectedType === "relation" && !memberAvId) {
            return undefined;
        }
        const newKeyID = await addAttributeViewColumn(ref.avId, {
            name: colName,
            type: expectedType,
            options: schemaCol?.options,
            relationTargetAvID: expectedType === "relation" ? memberAvId : undefined,
        }, { idempotencyKey: `heal:${ref.avId}:${colKey}:${Date.now().toString(36)}`, retries: 1 });

        ref.columns = { ...(ref.columns ?? {}), [colKey]: newKeyID };
        clearSchemaIssue(ref, moduleId, colKey);
        try {
            if (typeof plugin.saveData === "function") {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
            }
        } catch { /* soft */ }
        return newKeyID;
    } catch (e) {
        console.warn(`[LvHome] healColumnMapping for ${moduleId}.${colKey} failed:`, e);
        return undefined;
    }
}

export interface SetCellResilientOptions {
    avID: string;
    keyID?: string;
    itemID: string;
    value: unknown;
    plugin?: any;
    moduleId?: string;
    colKey?: string;
    ref?: DbRef;
    schemaCol?: { key: string; type: string; name?: string; options?: string[]; default?: string };
    memberAvId?: string;
    resolveName?: (colKey: string) => string;
    requestOptions?: RequestOptions;
    setCellFn?: (avID: string, keyID: string, itemID: string, value: unknown, options?: RequestOptions) => Promise<unknown>;
}

export interface SetCellResilientResult {
    keyID: string;
    healed: boolean;
}

export function isColumnKeyNotFoundError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    if (/(key not found|key not exist|key\s+\S+\s+not found|column not found|列不存在|字段不存在)/i.test(msg)) {
        return true;
    }
    return !/\b(row|item|block|av|doc|document)\b/i.test(msg) && /(not found|not exist|不存在)/i.test(msg);
}

/**
 * 全仓统一弹性写格（setCellResilient）：
 * 1) 若 keyID 缺失，先走 healColumnMapping 自动找回或 addAttributeViewKey 补列；
 * 2) 调用底层 setCell（或注入的 setCellFn）写入；
 * 3) 若内核报 key not found / 列不存在，自动 healColumnMapping + 一次安全重试；
 * 4) 若检测到列类型漂移，不覆盖用户原列，原样上报错误并保留 schemaIssues。
 */
export async function setCellResilient(opts: SetCellResilientOptions): Promise<SetCellResilientResult> {
    const modId = opts.moduleId ?? "ledger";
    const pluginRef: DbRef | undefined = opts.plugin?.settings?.dbRefs?.[modId];
    const activeColumns = opts.ref?.columns ?? pluginRef?.columns ?? {};

    let colKey = opts.colKey;
    if (!colKey && opts.keyID) {
        colKey = Object.entries(activeColumns).find(([, id]) => id === opts.keyID)?.[0];
    }

    const syncMappedKey = (resolvedKeyID: string) => {
        if (!colKey) return;
        if (opts.ref) {
            opts.ref.columns = { ...(opts.ref.columns ?? {}), [colKey]: resolvedKeyID };
        }
        if (pluginRef && pluginRef !== opts.ref) {
            pluginRef.columns = { ...(pluginRef.columns ?? {}), [colKey]: resolvedKeyID };
        }
    };

    const runHeal = async (): Promise<string | undefined> => {
        if (!colKey) return undefined;
        if (opts.plugin && opts.moduleId) {
            const healed = await healColumnMapping(opts.plugin, opts.moduleId, colKey);
            if (healed) syncMappedKey(healed);
            return healed;
        }
        const syntheticRef: DbRef = opts.ref ?? { avId: opts.avID, columns: { ...activeColumns } };
        if (!syntheticRef.avId) syntheticRef.avId = opts.avID;
        const syntheticPlugin: any = {
            settings: {
                dbRefs: {
                    [modId]: syntheticRef,
                    ...(opts.memberAvId ? { members: { avId: opts.memberAvId } } : {}),
                },
            },
            ...(opts.schemaCol ? { schemaCatalog: { [modId]: { columns: [opts.schemaCol] } } } : {}),
            ...(opts.resolveName ? { i18nText: (k: string) => (k.startsWith("field.") ? opts.resolveName!(k.slice(6)) : k) } : {}),
        };
        const healed = await healColumnMapping(syntheticPlugin, modId, colKey);
        if (healed) syncMappedKey(healed);
        return healed;
    };

    let healed = false;
    let currentKeyID = opts.keyID || (colKey ? activeColumns[colKey] : undefined);
    if (!currentKeyID) {
        currentKeyID = await runHeal();
        if (currentKeyID) healed = true;
    }
    if (!currentKeyID) {
        throw new Error(`missing column mapping for ${modId}.${colKey ?? "unknown"}`);
    }

    const writeFn = opts.setCellFn ?? setCell;
    try {
        await writeFn(opts.avID, currentKeyID, opts.itemID, opts.value, opts.requestOptions);
        return { keyID: currentKeyID, healed };
    } catch (err) {
        if (colKey && isColumnKeyNotFoundError(err)) {
            const healedKey = await runHeal();
            if (healedKey && healedKey !== currentKeyID) {
                const retryOpts: RequestOptions | undefined = opts.requestOptions
                    ? {
                        ...opts.requestOptions,
                        ...(opts.requestOptions.idempotencyKey
                            ? { idempotencyKey: `${opts.requestOptions.idempotencyKey}:healed` }
                            : {}),
                    }
                    : undefined;
                await writeFn(opts.avID, healedKey, opts.itemID, opts.value, retryOpts);
                return { keyID: healedKey, healed: true };
            }
        }
        throw err;
    }
}
