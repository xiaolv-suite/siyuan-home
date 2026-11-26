/**
 * 建库器（provisioner）：模块启用 → 幂等创建台账文档与数据库。
 * 落点：专用笔记本（默认 "🏠 小驴管家"，可配）。幂等：已启用再启用 = 跳过；
 * 版本升级补列不删不改。文档/av ID 记入 settings.dbRefs（01 ADR-3/5/7）。
 *
 * Spike 定案后走真实建库路径（siyuan.ts）：div 插入 → createIfNotExist → 加列。
 * members 库是 relation 列（member 列）的目标，先建 members 再建其他模块。
 *
 * D07/D08（2026-10-02）：
 * - 笔记本登记值兼容 ID 与历史名称；ID 查不到不把 ID 当名称建新笔记本；
 *   笔记本被关闭 → openNotebook 恢复而非新建。
 * - dbRef 文档检查区分瞬态错误（网络/响应异常 → 记录后原样返回，不重建）
 *   与内核明确报错（文档不存在 → 重建路径）。
 * - 复用原库时补列续跑（缺列只增不改），成功后清除旧 provisionError；
 *   补登记路径尝试按 root_id 找回 av 块，找回即复用原库。
 */
import type { HomeSettings, DbRef } from "@/types";
import type { ModuleSchema } from "./schema";
import { errText } from "./settings";
import {
    listNotebooks, openNotebook, createDocWithMd, getHPathByID, sql,
    createAndBindAttributeView, AvBindingMismatchError, KernelError,
} from "./siyuan";
import {
    ensureNotebook,
    ledgerHPath,
    stableAvSeed,
    findLedgerDoc,
    findAvBlockRefInDoc,
    verifyAvRefBound,
    reconcileTornAvRef,
    type FoundLedgerDoc,
    type ProvisionResult,
    type ProvisionOptions,
    ensureColumns,
    isXiaoLvHubNotebookName,
    DEFAULT_HUB_ROOT_PATH,
} from "./provision-common";
import { invalidateSQLCache } from "./sql-coalescer";

export * from "./provision-common";
export * from "./provision-adoption";

/**
 * D07 错误分类（保守方向：宁可不重建，不误重建）：
 * - 网络层异常 / malformed envelope（TypeError、code=-1 且非"找不到"消息）→ 瞬态，不重建；
 * - 内核非 -1 错误码，或内核明确返回 "not found/不存在" → 文档缺失，走重建。
 */
export function isDocMissingError(e: unknown): boolean {
    if (!(e instanceof KernelError)) return false;
    if (e.code !== -1) return true;
    return /not found|不存在/i.test(e.kernelMsg);
}

export interface ProvisioningReport {
    issues: { moduleId: string; message: string }[];
}

export function getProvisioningReport(settings: Pick<HomeSettings, "enabledModules" | "dbRefs">): ProvisioningReport {
    const issues: ProvisioningReport["issues"] = [];
    for (const moduleId of settings.enabledModules) {
        const ref = settings.dbRefs[moduleId];
        const message = ref?.provisionError ?? (!ref?.avId ? "Attribute view unavailable" : "");
        if (message) issues.push({ moduleId, message });
    }
    return { issues };
}

async function syncVehicleDiarySqlIfNeeded(settings: HomeSettings, moduleId: string, dbRef: DbRef): Promise<void> {
    if (moduleId !== "vehicles" || !dbRef.docId || !dbRef.avId || dbRef.provisional) return;
    try {
        const { syncModuleDocSection } = await import("./doc-sync");
        await syncModuleDocSection({ settings }, "vehicles", {});
    } catch {
        /* 方案 C 动态 SQL 聚合块同步失败不阻断建库事务 */
    }
}

/**
 * 为模块创建台账文档 + 数据库 + 全部列。幂等：
 * ① dbRefs 有效且非 provisional → 校验文档在（瞬态错误不重建）→ 补列续跑 → 清除旧错误；
 * ② 文档已存在但未登记（重装/手删设置）→ 找回 av 块复用原库 + 补列；
 * ③ 全新 → 建文档 → 建库 → 建列。单模块失败记 provisionError，不中断其他模块。
 */
export async function provisionModule(
    settings: HomeSettings,
    moduleId: string,
    schema: ModuleSchema,
    titleI18n: string,
    opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
    const existing = settings.dbRefs[moduleId];
    if (existing?.docId && !existing.provisional) {
        let docMissing = false;
        try {
            await getHPathByID(existing.docId);
        } catch (e) {
            if (!isDocMissingError(e)) {
                // D07：网络/瞬态错误 → 记录后原样返回，不重建（防误删/重复建库）
                existing.provisionError = `doc check: ${errText(e)}`;
                return { dbRef: existing, created: false };
            }
            docMissing = true; // 内核明确报错 → 文档已被删除，落到下方重建流程
        }
        if (!docMissing) {
            // 自愈追踪：核对文档当前最新的真实笔记本所属（防止用户在思源中移动了文档导致错位）
            let actualNotebook = existing.notebook;
            try {
                const boxRows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${existing.docId.replace(/'/g, "''")}' LIMIT 1`);
                if (boxRows[0]?.box) {
                    actualNotebook = boxRows[0].box;
                    await openNotebook(actualNotebook, { retries: 1 });
                }
            } catch { /* soft heal */ }

            // 强校验 dbRefs[mod].avId === 文档内真实 data-av-id；若发现撕裂则走恢复/合并路径，绝不盲写
            try {
                await verifyAvRefBound(existing);
            } catch (bindErr) {
                if (bindErr instanceof AvBindingMismatchError) {
                    if (opts.reconcileGhostColumns) {
                        await reconcileTornAvRef(existing).catch(() => null);
                    } else {
                        const dbRef: DbRef = {
                            ...existing,
                            notebook: actualNotebook,
                            provisionError: errText(bindErr),
                        };
                        settings.dbRefs[moduleId] = dbRef;
                        return { dbRef, created: false };
                    }
                }
            }

            // D08：复用原库 + 补列续跑（成功后清除旧 provisionError）
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error } = await ensureColumns(existing.avId, schema, existing.columns, moduleId, opts, memberAvId);
            const dbRef: DbRef = {
                ...existing,
                notebook: actualNotebook,
                schema: existing.schema ?? "home-ledger-v2",
                schemaVersion: existing.schemaVersion ?? 2,
                columns,
                provisionError: error,
            };
            settings.dbRefs[moduleId] = dbRef;
            await syncVehicleDiarySqlIfNeeded(settings, moduleId, dbRef);
            return { dbRef, created: false };
        }
    }
    try {
        const notebookId = await ensureNotebook(existing?.notebook, settings.targetNotebookId);
        let effectiveRootPath = settings.rootPath?.trim() || "";
        if (!effectiveRootPath) {
            try {
                const nbs = await listNotebooks();
                const nb = nbs.find((n) => n.id === notebookId);
                if (nb && isXiaoLvHubNotebookName(nb.name)) {
                    effectiveRootPath = DEFAULT_HUB_ROOT_PATH;
                }
            } catch { /* ignore */ }
        }
        const hpath = ledgerHPath(titleI18n, effectiveRootPath ? { rootPath: effectiveRootPath, moduleId } : undefined);
        const found = await findLedgerDoc(notebookId, hpath, moduleId);
        if (found) {
            const actualNotebookId = found.box || notebookId;
            try {
                await openNotebook(actualNotebookId, { retries: 1 });
            } catch { /* ignore */ }
            // 补登记：优先找回文档内既有 av 块真实 data-av-id（D08），找不回才走 dom 建新库
            let avRef = await findAvBlockRefInDoc(found.id);
            if (!avRef) {
                try {
                    const bound = await createAndBindAttributeView(found.id, stableAvSeed(moduleId, found.id), {
                        idempotencyKey: `provision:av:${moduleId}:${found.id}`,
                        schema: "home-ledger-v2",
                    });
                    avRef = { avId: bound.avId, avBlockId: bound.avBlockId, fromLiveDom: true };
                } catch {
                    avRef = null; // av 创建失败 → provisional 落库，诊断可见
                }
            }
            const avId = avRef?.avId;
            const avBlockId = avRef?.avBlockId;
            if (found.id) invalidateSQLCache(found.id);
            if (avId) invalidateSQLCache(avId);
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error } = await ensureColumns(avId, schema, existing?.columns, moduleId, opts, memberAvId);
            const dbRef: DbRef = {
                ...existing,
                docId: found.id,
                avId: avId ?? undefined,
                avBlockId: avBlockId ?? existing?.avBlockId,
                schema: "home-ledger-v2",
                schemaVersion: 2,
                notebook: actualNotebookId,
                provisional: !avId,
                columns,
                provisionError: error,
            };
            settings.dbRefs[moduleId] = dbRef;
            await syncVehicleDiarySqlIfNeeded(settings, moduleId, dbRef);
            return { dbRef, created: false };
        }
        let docId: string;
        const docHeaderMarkdown = `# ${titleI18n}\n\n> 🏠 **小驴管家 · ${titleI18n}台账**\n> 💡 快捷直达：按 \`Ctrl+Alt+H\` 可在任意界面随时呼出管家面板；下方为思源原生属性视图数据库（AttributeView），支持直接编辑、增减行与双向同步。\n\n`;
        try {
            docId = await createDocWithMd(notebookId, hpath, docHeaderMarkdown, {
                idempotencyKey: `provision:doc:${moduleId}:${notebookId}:${hpath}`,
                retries: 0,
            });
        } catch (error) {
            let recovered: FoundLedgerDoc | null = null;
            for (let attempt = 0; attempt < 6 && !recovered; attempt++) {
                if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
                recovered = await findLedgerDoc(notebookId, hpath, moduleId);
            }
            if (recovered) {
                docId = recovered.id;
            } else {
                // 自愈降级：若创建文档报冲突或已存在异常，生成带自愈后缀的新路径，保障建库流程绝不卡死
                const errStr = String(error);
                if (errStr.includes("409") || errStr.includes("exist") || errStr.includes("conflict")) {
                    const fallbackHPath = `${hpath}_${Date.now().toString(36)}`;
                    docId = await createDocWithMd(notebookId, fallbackHPath, docHeaderMarkdown, { retries: 1 });
                } else {
                    throw error;
                }
            }
        }
        if (docId) invalidateSQLCache(docId);
        const avIdSeed = stableAvSeed(moduleId, docId);
        let avId: string | undefined;
        let avBlockId: string | undefined;
        let provisional = false;
        let provisionError: string | undefined;
        try {
            const bound = await createAndBindAttributeView(docId, avIdSeed, {
                idempotencyKey: `provision:av:${moduleId}:${docId}`,
                schema: "home-ledger-v2",
            });
            avId = bound.avId;
            avBlockId = bound.avBlockId;
            if (avId) invalidateSQLCache(avId);
        } catch (e) {
            provisional = true;
            provisionError = errText(e);
            console.warn(`[LvHome] module "${moduleId}" provisioned provisionally:`, provisionError);
        }
        const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
        const { columns, error } = await ensureColumns(avId, schema, undefined, moduleId, opts, memberAvId);
        const dbRef: DbRef = {
            docId,
            avId,
            avBlockId,
            schema: "home-ledger-v2",
            schemaVersion: 2,
            notebook: notebookId,
            provisional,
            columns,
            provisionError: provisionError ?? error,
        };
        settings.dbRefs[moduleId] = dbRef;
        await syncVehicleDiarySqlIfNeeded(settings, moduleId, dbRef);
        return { dbRef, created: true };
    } catch (e) {
        // D07：笔记本/文档创建失败（含瞬态）→ 记录，不向上抛（不中断其他模块建库）
        const msg = errText(e);
        console.warn(`[LvHome] provision "${moduleId}" failed:`, msg);
        const dbRef: DbRef = { ...existing, provisionError: msg };
        settings.dbRefs[moduleId] = dbRef;
        return { dbRef, created: false };
    }
}
