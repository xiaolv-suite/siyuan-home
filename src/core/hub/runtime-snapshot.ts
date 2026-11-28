/**
 * 运行态与缓存快照解耦中枢 (RuntimeSnapshot)
 *
 * 核心契约：
 * 1. 统一 initScanFromCache、notifyHubChanged 与 refreshHub 的快照创建、恢复与派生序列化口径；
 * 2. 避免内存 scan 结构与 runtime.cache 字段分歧风险；
 * 3. 封装 deriveVisible 重算与状态栏计数逻辑，纯函数无副作用。
 */

import type { Reminder, HomeSettings } from "@/types";
import type { HubRuntime } from "./runtime";
import { deriveVisible, type ScanResult } from "./scanner";

export interface HubRuntimeCache {
    reminders: Reminder[];
    counts: { overdue: number; soon: number; lead: number };
    errors: { moduleId: string; message: string }[];
    derived: Reminder[];
    byModule: Record<string, {
        reminders: Reminder[];
        at: string;
        rowCount?: number;
        memberCounts?: Record<string, number>;
    }>;
}

/**
 * 从扫描结果标准化构造 runtime.cache 快照对象
 */
export function createRuntimeCacheSnapshot(scan: {
    reminders?: Reminder[];
    counts?: { overdue: number; soon: number; lead: number };
    errors?: { moduleId: string; message: string }[];
    derived?: Reminder[];
    byModule?: Record<string, any>;
}): HubRuntimeCache {
    return {
        reminders: scan.reminders ?? [],
        counts: scan.counts ?? { overdue: 0, soon: 0, lead: 0 },
        errors: scan.errors ?? [],
        derived: scan.derived ?? scan.reminders ?? [],
        byModule: scan.byModule ?? {},
    };
}

/**
 * 启动时从缓存恢复内存扫描对象 (initScanFromCache 核心逻辑)
 */
export function restoreScanFromCache(
    cache: HubRuntimeCache | undefined,
    settings: HomeSettings,
    runtime: HubRuntime,
    now: Date = new Date(),
): { scan: ScanResult; todayDueCount: number } {
    if (!cache) {
        return {
            scan: {
                reminders: [],
                counts: { overdue: 0, soon: 0, lead: 0 },
                scannedAt: now.toISOString(),
                errors: [],
                stale: false,
                derived: [],
                byModule: {},
            },
            todayDueCount: 0,
        };
    }

    const rawDerived = cache.derived ?? cache.reminders ?? [];
    const { reminders, counts } = deriveVisible(rawDerived, settings, runtime, now);
    const todayDueCount = reminders.filter((r) => r.daysLeft <= 0).length;

    return {
        scan: {
            reminders,
            counts,
            scannedAt: runtime.scannedAt ?? now.toISOString(),
            errors: cache.errors ?? [],
            stale: false,
            derived: rawDerived,
            byModule: cache.byModule ?? {},
        },
        todayDueCount,
    };
}

/**
 * 动作完成后重新计算可见集合并同步快照 (notifyHubChanged 核心逻辑)
 */
export function applyRuntimeActionToSnapshot(
    cache: HubRuntimeCache | undefined,
    settings: HomeSettings,
    runtime: HubRuntime,
    previousScan?: ScanResult,
    now: Date = new Date(),
): { scan: ScanResult; nextCache: HubRuntimeCache; todayDueCount: number } {
    const rawDerived = cache?.derived ?? cache?.reminders ?? [];
    const { reminders, counts } = deriveVisible(rawDerived, settings, runtime, now);
    const todayDueCount = reminders.filter((r) => r.daysLeft <= 0).length;

    const nextCache: HubRuntimeCache = {
        reminders,
        counts,
        errors: cache?.errors ?? [],
        derived: rawDerived,
        byModule: cache?.byModule ?? {},
    };

    const baseScan = previousScan ?? {
        reminders,
        counts,
        scannedAt: runtime.scannedAt ?? now.toISOString(),
        errors: [],
        stale: false,
        derived: rawDerived,
        byModule: cache?.byModule ?? {},
    };

    const scan: ScanResult = {
        ...baseScan,
        reminders,
        counts,
        derived: rawDerived,
    };

    return {
        scan,
        nextCache,
        todayDueCount,
    };
}
