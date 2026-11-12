/**
 * 台账数据集异步加载与活动目标匹配引擎（解耦抽取自 ledger.svelte）
 */

import { renderLedgerAll } from "@/core/siyuan";
import type { ActivityTarget } from "@/core/activity";

export interface FetchLedgerDatasetOptions {
    avId?: string;
    moduleId: string;
    signal?: AbortSignal;
    pendingTarget?: ActivityTarget;
    t: (k: string) => string;
    onTargetResolved?: (targetRow: any | undefined, target: ActivityTarget) => void;
    onNavigationError?: () => void;
}

export interface FetchLedgerDatasetResult {
    rows: any[];
    columns: any[];
    error?: string;
    complete: boolean;
}

/**
 * 加载指定属性视图中的全部行数据，并处理活动目标行定位
 */
export async function fetchLedgerDataset(options: FetchLedgerDatasetOptions): Promise<FetchLedgerDatasetResult> {
    const {
        avId,
        moduleId,
        signal,
        pendingTarget,
        t,
        onTargetResolved,
        onNavigationError,
    } = options;

    if (!avId) {
        if (pendingTarget?.moduleId === moduleId && onNavigationError) {
            onNavigationError();
        }
        return {
            rows: [],
            columns: [],
            complete: true,
        };
    }

    const res = await renderLedgerAll(avId, 200, {
        signal,
        latestKey: `ledger:${moduleId}`,
    });

    if (!res.complete) {
        return {
            rows: res.rows ?? [],
            columns: res.columns ?? [],
            complete: false,
            error: t("ledger.loadIncomplete"),
        };
    }

    const rows = res.rows ?? [];
    const columns = res.columns ?? [];

    if (pendingTarget && pendingTarget.moduleId === moduleId && onTargetResolved) {
        const targetRow = rows.find((r) => r.itemID === pendingTarget.rowId);
        requestAnimationFrame(() => {
            onTargetResolved(targetRow, pendingTarget);
        });
    }

    return {
        rows,
        columns,
        complete: true,
    };
}
