/**
 * 台账安全回收站管理与一键恢复引擎
 */
import { addDetachedRow, newSiYuanId, setCell, RowIdentityPendingError } from "./siyuan";
import { saveRuntime, type HubRuntime } from "./hub/runtime";

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

    try {
        const title = item.title && item.title !== "—" ? item.title : "已恢复记录";
        const newRowId = await addDetachedRow(dbRef.avId, title, {
            idempotencyKey: `trash:restore:${item.id}:${Date.now()}`,
            // 恢复同样注入行身份：未知结果不认领同名单行，先提示核对。
            rowIdentity: { avID: dbRef.avId, desiredItemID: newSiYuanId(), before: [], submitted: false },
        });

        // 将原单元格数据逐一写回新行
        const originalCells = item.rowSnapshot?.cells ?? {};
        for (const [colId, cellVal] of Object.entries(originalCells)) {
            if (!cellVal) continue;
            try {
                await setCell(dbRef.avId, colId, newRowId, cellVal as any);
            } catch {
                // 部分单列写入失败不中断整行还原
            }
        }

        // 从回收站列表中移除该条目并持久化
        list.splice(itemIndex, 1);
        plugin.runtime.trash = list;
        await saveRuntime(plugin as any, plugin.runtime);
        try { await plugin.refreshHub?.([item.moduleId], true); } catch { /* ignore */ }

        return { success: true, restoredRowId: newRowId };
    } catch (e) {
        if (e instanceof RowIdentityPendingError) {
            return { success: false, error: "记录可能已恢复，但系统暂时无法确认行身份；请先核对台账，再决定是否重试。" };
        }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}
