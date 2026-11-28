/**
 * 台账安全回收站管理与一键恢复引擎
 */
import { addDetachedRow, buildPrimaryBlockCell, newSiYuanId, setCellResilient, RowIdentityPendingError } from "./siyuan";
import { saveRuntime, type HubRuntime } from "./hub/runtime";
import { withRuntime } from "./hub/actions";

export interface TrashItem {
    id: string;
    moduleId: string;
    title: string;
    deletedAt: string;
    rowSnapshot: {
        itemID?: string;
        cells?: Record<string, any>;
    };
}

export interface RestoreTrashResult {
    success: boolean;
    restoredRowId?: string;
    error?: string;
}

const inFlightTrashRestores = new WeakMap<object, Set<string>>();

/**
 * 将回收站中的某条快照行一键恢复到思源对应模块台账
 */
export async function restoreTrashItem(
    plugin: {
        settings: {
            dbRefs?: Record<string, { avId?: string; columns?: Record<string, string> }>;
        };
        runtime: HubRuntime;
        refreshHub?: (only?: string | string[], force?: boolean) => Promise<unknown>;
    },
    trashId: string,
): Promise<RestoreTrashResult> {
    if (plugin.runtime?.guestModeActive) {
        return { success: false, error: "当前处于访客只读模式，已拦截此写操作" };
    }
    const activeSet = inFlightTrashRestores.get(plugin) ?? new Set<string>();
    if (activeSet.has(trashId)) {
        return { success: false, error: "该记录正在恢复中，请勿重复操作" };
    }
    activeSet.add(trashId);
    inFlightTrashRestores.set(plugin, activeSet);

    try {
        const list = plugin.runtime.trash ?? [];
        const itemIndex = list.findIndex((x) => x.id === trashId);
        if (itemIndex === -1) {
            return { success: false, error: "回收站中未找到该记录" };
        }
        const item = list[itemIndex];
        const dbRef = plugin.settings.dbRefs?.[item.moduleId];
        if (!dbRef?.avId || !dbRef.columns) {
            return { success: false, error: `对应模块【${item.moduleId}】尚未初始化或已关闭` };
        }

        const title = item.title && item.title !== "—" ? item.title : "已恢复记录";
        const opNonce = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const newRowId = await addDetachedRow(dbRef.avId, title, {
            idempotencyKey: `trash:restore:${item.id}:${opNonce}`,
            // 恢复同样注入行身份：未知结果不认领同名单行，先提示核对。
            rowIdentity: { avID: dbRef.avId, desiredItemID: newSiYuanId(), before: [], submitted: false },
        });

        // 将原单元格数据逐一写回新行（主列重建 block payload，避免回写旧 block.id）
        const originalCells = item.rowSnapshot?.cells ?? {};
        for (const [colId, cellVal] of Object.entries(originalCells)) {
            if (!cellVal) continue;
            const colKey = Object.entries(dbRef.columns ?? {}).find(([, id]) => id === colId)?.[0];
            const isPrimaryBlock = colKey === "name" || (cellVal as any)?.type === "block";
            const payloadValue = isPrimaryBlock
                ? buildPrimaryBlockCell({
                    keyID: colId,
                    itemID: newRowId,
                    content: String((cellVal as any)?.block?.content ?? (cellVal as any)?.text?.content ?? title),
                    includeRichNull: true,
                })
                : cellVal;
            try {
                await setCellResilient({
                    avID: dbRef.avId,
                    keyID: colId,
                    itemID: newRowId,
                    value: payloadValue as any,
                    plugin,
                    moduleId: item.moduleId,
                    colKey,
                    ref: dbRef,
                });
            } catch {
                // 部分单列写入失败不中断整行还原
            }
        }

        // 从回收站列表中移除该条目并经串行队列持久化
        if (typeof (plugin as any).loadData === "function" && typeof (plugin as any).saveData === "function") {
            await withRuntime(plugin as any, (rt) => {
                rt.trash = (rt.trash ?? []).filter((x) => x.id !== trashId);
            });
        } else {
            list.splice(itemIndex, 1);
            plugin.runtime.trash = list;
            await saveRuntime(plugin as any, plugin.runtime);
        }
        try { await plugin.refreshHub?.([item.moduleId], true); } catch { /* ignore */ }

        return { success: true, restoredRowId: newRowId };
    } catch (e) {
        if (e instanceof RowIdentityPendingError) {
            return { success: false, error: "记录可能已恢复，但系统暂时无法确认行身份；请先核对台账，再决定是否重试。" };
        }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
        activeSet.delete(trashId);
    }
}
