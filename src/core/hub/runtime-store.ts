/**
 * 提醒中枢运行态持久化与序列化中枢（runtime-store）：
 * 负责 HubRuntime 数据规范化、业务语义指纹计算、基于 WeakMap 的实例写锁与去重持久化。
 */
import type { Plugin } from "siyuan";
import type { Reminder } from "@/types";
import type { HubRuntime, AdhocMemo, ReminderNamedView } from "./runtime";

export const RUNTIME_NAME = "hub-runtime.json";

export function defaultRuntime(): HubRuntime {
    return {
        schemaVersion: 1,
        snoozed: {},
        muted: {},
        handledYear: {},
        handledUntil: {},
        handled: {},
        renewHistory: {},
        memos: [],
        namedViews: [],
        planDates: {},
    };
}

export function isPlainObject(value: unknown): value is Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function stringRecord(value: unknown): Record<string, string> {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function booleanRecord(value: unknown): Record<string, boolean> {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

export function numberRecord(value: unknown): Record<string, number> {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

export function normalizeReminder(value: unknown): Reminder | undefined {
    if (!isPlainObject(value)) return undefined;
    if ([value.id, value.moduleId, value.ruleKey, value.rowId, value.title, value.dueDate].some((field) => typeof field !== "string")) return undefined;
    if (typeof value.daysLeft !== "number" || !Number.isFinite(value.daysLeft)) return undefined;
    if (!["overdue", "soon", "lead", "later"].includes(value.level)) return undefined;
    const reminder: Reminder = {
        id: value.id,
        moduleId: value.moduleId,
        ruleKey: value.ruleKey,
        rowId: value.rowId,
        title: value.title,
        dueDate: value.dueDate,
        daysLeft: value.daysLeft,
        level: value.level,
    };
    if (typeof value.memberId === "string") reminder.memberId = value.memberId;
    if (["oneoff", "recurring", "anniversary", "after"].includes(value.kind)) reminder.kind = value.kind;
    if (typeof value.lunar === "boolean") reminder.lunar = value.lunar;
    if (typeof value.autoRenew === "boolean") reminder.autoRenew = value.autoRenew;
    return reminder;
}

export function normalizeReminders(value: unknown): Reminder[] {
    return Array.isArray(value) ? value.map(normalizeReminder).filter((r): r is Reminder => !!r) : [];
}

export function normalizeMemo(value: unknown): AdhocMemo | undefined {
    if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.dueDate !== "string" || typeof value.createdAt !== "string") return undefined;
    return {
        id: value.id,
        title: value.title,
        dueDate: value.dueDate,
        createdAt: value.createdAt,
        ...(typeof value.doneAt === "string" ? { doneAt: value.doneAt } : {}),
    };
}

export function normalizeNamedView(value: unknown): ReminderNamedView | undefined {
    if (!isPlainObject(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim()) return undefined;
    return {
        id: value.id.trim(),
        name: value.name.trim(),
        ...(typeof value.filter === "string" ? { filter: value.filter } : {}),
        ...(typeof value.memberId === "string" ? { memberId: value.memberId } : {}),
        ...(typeof value.moduleId === "string" ? { moduleId: value.moduleId } : {}),
        ...(typeof value.dueWithin === "string" ? { dueWithin: value.dueWithin } : {}),
    };
}

export function normalizeCache(value: unknown): HubRuntime["cache"] {
    if (!isPlainObject(value)) return undefined;
    const reminders = normalizeReminders(value.reminders);
    const derived = normalizeReminders(value.derived ?? value.reminders);
    const counts = isPlainObject(value.counts) && ["overdue", "soon", "lead"].every((key) => typeof value.counts[key] === "number" && Number.isFinite(value.counts[key]) && value.counts[key] >= 0)
        ? { overdue: value.counts.overdue, soon: value.counts.soon, lead: value.counts.lead }
        : { overdue: reminders.filter((r) => r.level === "overdue").length, soon: reminders.filter((r) => r.level === "soon").length, lead: reminders.filter((r) => r.level === "lead").length };
    const errors = Array.isArray(value.errors)
        ? value.errors.filter((e) => isPlainObject(e) && typeof e.moduleId === "string" && typeof e.message === "string").map((e) => ({ moduleId: e.moduleId as string, message: e.message as string }))
        : [];
    const byModule: NonNullable<HubRuntime["cache"]>["byModule"] = {};
    if (isPlainObject(value.byModule)) {
        for (const [id, raw] of Object.entries(value.byModule)) {
            if (isPlainObject(raw) && typeof raw.at === "string" && Array.isArray(raw.reminders)) {
                // 264 波：行数口径随快照归一（缺/坏值回退 undefined=无口径，界面回退旧呈现）
                const rowCount = typeof raw.rowCount === "number" && Number.isFinite(raw.rowCount) && raw.rowCount >= 0
                    ? raw.rowCount
                    : undefined;
                byModule[id] = {
                    reminders: normalizeReminders(raw.reminders),
                    at: raw.at,
                    ...(rowCount !== undefined ? { rowCount } : {}),
                    ...(isPlainObject(raw.memberCounts) && Object.keys(numberRecord(raw.memberCounts)).length > 0
                        ? { memberCounts: numberRecord(raw.memberCounts) }
                        : {}),
                };
            }
        }
    }
    return { reminders, counts, errors, derived, byModule };
}

export function normalizeRenewHistory(value: unknown): HubRuntime["renewHistory"] {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([id, entries]) => [id, Array.isArray(entries)
        ? entries.filter((e) => isPlainObject(e) && typeof e.from === "string" && typeof e.to === "string" && typeof e.at === "string").map((e) => ({ from: e.from as string, to: e.to as string, at: e.at as string }))
        : []]));
}

export function normalizeHandled(value: unknown): HubRuntime["handled"] {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => {
        const record = entry[1];
        return isPlainObject(record) && [record.title, record.moduleId, record.ruleKey, record.dueDate, record.at].every((field) => typeof field === "string");
    }).map(([id, record]) => [id, {
        title: record.title,
        moduleId: record.moduleId,
        ruleKey: record.ruleKey,
        dueDate: record.dueDate,
        at: record.at,
    }]));
}

export function normalizeNestedCounts(value: unknown): Record<string, Record<string, number>> {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => isPlainObject(entry[1])).map(([date, counts]) => [date, numberRecord(counts)]));
}

/** 旧缓存迁移（33.3）：缺字段补默认值；byModule/derived 为 H02/H04 新增。坏文件容错同 settings（15 组） */
export async function loadRuntime(plugin: Plugin): Promise<HubRuntime> {
    const { data } = await import("../settings").then((m) => m.loadDataSafe(plugin, RUNTIME_NAME));
    if (!isPlainObject(data)) return defaultRuntime();
    const base = defaultRuntime();
    const optionalString = (key: string): string | undefined => typeof data[key] === "string" ? data[key] : undefined;
    const merged: HubRuntime = {
        ...base,
        ...data,
        schemaVersion: 1,
        scannedAt: optionalString("scannedAt"),
        filterMemberId: optionalString("filterMemberId"),
        hubFilter: optionalString("hubFilter"),
        hubMemberId: optionalString("hubMemberId"),
        hubModuleId: optionalString("hubModuleId"),
        hubDueWithin: optionalString("hubDueWithin"),
        // 263 波：视图偏好（枚举归一，坏值回退 undefined=默认视图）
        hubViewMode: data.hubViewMode === "calendar" || data.hubViewMode === "list" ? data.hubViewMode : undefined,
        hubCalMode: data.hubCalMode === "month" || data.hubCalMode === "week" ? data.hubCalMode : undefined,
        // 267 波：快速记录上次模块（坏值回退 undefined=首个启用模块）
        hubQuickModule: optionalString("hubQuickModule"),
        ledgerSortKey: optionalString("ledgerSortKey"),
        ledgerSortAsc: typeof data.ledgerSortAsc === "boolean" ? data.ledgerSortAsc : undefined,
        cache: normalizeCache(data.cache),
        snoozed: stringRecord(data.snoozed),
        planDates: stringRecord(data.planDates),
        muted: booleanRecord(data.muted),
        handledYear: numberRecord(data.handledYear),
        handledUntil: stringRecord(data.handledUntil),
        handled: normalizeHandled(data.handled),
        renewHistory: normalizeRenewHistory(data.renewHistory),
        memos: Array.isArray(data.memos) ? data.memos.map(normalizeMemo).filter((m): m is AdhocMemo => !!m) : [],
        pinnedMemoIds: Array.isArray(data.pinnedMemoIds) ? data.pinnedMemoIds.filter((id: unknown): id is string => typeof id === "string") : undefined,
        pinnedReminderIds: Array.isArray(data.pinnedReminderIds) ? data.pinnedReminderIds.filter((id: unknown): id is string => typeof id === "string") : undefined,
        digestHistory:
            data.digestHistory && typeof data.digestHistory === "object" && typeof data.digestHistory.overdue === "number" && typeof data.digestHistory.at === "string"
                ? { overdue: data.digestHistory.overdue, at: data.digestHistory.at }
                : undefined,
        namedViews: Array.isArray(data.namedViews) ? data.namedViews.map(normalizeNamedView).filter((v): v is ReminderNamedView => !!v) : [],
        activeNamedViewId: optionalString("activeNamedViewId"),
        lastNotifiedDate: optionalString("lastNotifiedDate"),
        lastOverdueAlertDate: optionalString("lastOverdueAlertDate"),
        lastWeeklyDigest: optionalString("lastWeeklyDigest"),
        todaySilent: optionalString("todaySilent"),
        favorSyncs: isPlainObject(data.favorSyncs) ? Object.fromEntries(Object.entries(data.favorSyncs).filter((entry) => isPlainObject(entry[1]) && typeof entry[1].docId === "string" && typeof entry[1].at === "string").map(([id, sync]) => [id, { docId: sync.docId, at: sync.at }])) : undefined,
        monthlyCompletions: numberRecord(data.monthlyCompletions),
        monthlyDueTotals: numberRecord(data.monthlyDueTotals),
        moduleHistory: normalizeNestedCounts(data.moduleHistory),
        guestModeActive: typeof data.guestModeActive === "boolean" ? data.guestModeActive : undefined,
    };
    if (isPlainObject(data.lastExamStats)
        && [data.lastExamStats.streak, data.lastExamStats.accuracy, data.lastExamStats.attempts, data.lastExamStats.generatedAt].every((n) => typeof n === "number" && Number.isFinite(n))) {
        merged.lastExamStats = {
            streak: data.lastExamStats.streak,
            accuracy: data.lastExamStats.accuracy,
            attempts: data.lastExamStats.attempts,
            generatedAt: data.lastExamStats.generatedAt,
        };
    } else merged.lastExamStats = undefined;
    if (isPlainObject(data.lastCheckinSummary)
        && typeof data.lastCheckinSummary.windowDays === "number" && Number.isFinite(data.lastCheckinSummary.windowDays)
        && typeof data.lastCheckinSummary.pulledAt === "number" && Number.isFinite(data.lastCheckinSummary.pulledAt)) {
        const items = Array.isArray(data.lastCheckinSummary.items) ? data.lastCheckinSummary.items.filter((item) => isPlainObject(item)
            && typeof item.itemId === "string" && typeof item.name === "string" && typeof item.score === "number" && Number.isFinite(item.score))
            .map((item) => ({ itemId: item.itemId as string, name: item.name as string, score: item.score as number })) : [];
        merged.lastCheckinSummary = { items, windowDays: data.lastCheckinSummary.windowDays, pulledAt: data.lastCheckinSummary.pulledAt };
    } else merged.lastCheckinSummary = undefined;
    lastSerializedByPlugin.set(plugin, semanticRuntimeFingerprint(merged));
    return merged;
}

/**
 * 提取 HubRuntime 的业务实质指纹（PF09）：
 * 剥离纯易变时间戳（scannedAt、byModule[m].at、pulledAt、generatedAt 等），
 * 确保在台账数据与用户操作无实质变动时指纹严格一致，杜绝后台扫描引起频繁写盘及内核重载抖动。
 */
export function semanticRuntimeFingerprint(rt: HubRuntime): string {
    const byModuleFiltered = rt.cache?.byModule
        ? Object.fromEntries(
            Object.entries(rt.cache.byModule).map(([k, v]) => [
                k,
                { reminders: v.reminders, rowCount: v.rowCount, memberCounts: v.memberCounts },
            ]),
        )
        : undefined;

    return JSON.stringify({
        schemaVersion: rt.schemaVersion,
        filterMemberId: rt.filterMemberId,
        hubFilter: rt.hubFilter,
        hubMemberId: rt.hubMemberId,
        hubModuleId: rt.hubModuleId,
        hubDueWithin: rt.hubDueWithin,
        hubViewMode: rt.hubViewMode,
        hubCalMode: rt.hubCalMode,
        hubQuickModule: rt.hubQuickModule,
        ledgerSortKey: rt.ledgerSortKey,
        ledgerSortAsc: rt.ledgerSortAsc,
        namedViews: rt.namedViews,
        activeNamedViewId: rt.activeNamedViewId,
        cache: rt.cache ? {
            reminders: rt.cache.reminders,
            counts: rt.cache.counts,
            errors: rt.cache.errors,
            derived: rt.cache.derived,
            byModule: byModuleFiltered,
        } : undefined,
        snoozed: rt.snoozed,
        planDates: rt.planDates,
        muted: rt.muted,
        handledYear: rt.handledYear,
        handledUntil: rt.handledUntil,
        handled: rt.handled,
        renewHistory: rt.renewHistory,
        memos: rt.memos,
        pinnedMemoIds: rt.pinnedMemoIds,
        pinnedReminderIds: rt.pinnedReminderIds,
        digestHistory: rt.digestHistory,
        lastNotifiedDate: rt.lastNotifiedDate,
        lastOverdueAlertDate: rt.lastOverdueAlertDate,
        lastWeeklyDigest: rt.lastWeeklyDigest,
        todaySilent: rt.todaySilent,
        lastExamStats: rt.lastExamStats ? {
            streak: rt.lastExamStats.streak,
            accuracy: rt.lastExamStats.accuracy,
            attempts: rt.lastExamStats.attempts,
        } : undefined,
        lastCheckinSummary: rt.lastCheckinSummary ? {
            items: rt.lastCheckinSummary.items,
            windowDays: rt.lastCheckinSummary.windowDays,
        } : undefined,
        favorSyncs: rt.favorSyncs,
        monthlyCompletions: rt.monthlyCompletions,
        monthlyDueTotals: rt.monthlyDueTotals,
        moduleHistory: rt.moduleHistory,
        guestModeActive: rt.guestModeActive,
    });
}

// A plugin instance owns a single storage namespace. Sharing this cache globally can
// skip the first write by a newly created instance when its data happens to match.
export const lastSerializedByPlugin = new WeakMap<object, string>();

/**
 * serialize runtime writes per plugin instance. Several panels can persist a
 * preference at the same time (for example a filter change while a reminder
 * action is completing). Calling saveData directly from both handlers lets
 * the slower write win and silently drops the other change. Keep a small
 * per-instance queue here; the snapshot is captured before queueing so a
 * later mutation cannot alter an earlier write in flight.
 */
export const runtimeSaveChains = new WeakMap<object, Promise<unknown>>();

/** Shared per-plugin serialization boundary for all runtime read/modify/write
 * actions and direct preference snapshots. */
export function withRuntimeSaveLock<T>(plugin: Plugin, operation: () => Promise<T>): Promise<T> {
    const previous = runtimeSaveChains.get(plugin) ?? Promise.resolve();
    const run = previous.then(operation);
    runtimeSaveChains.set(plugin, run.catch(() => undefined));
    return run;
}

export function cloneRuntime(rt: HubRuntime): HubRuntime {
    return JSON.parse(JSON.stringify(rt)) as HubRuntime;
}

export async function saveRuntime(plugin: Plugin, rt: HubRuntime): Promise<void> {
    // PF09：业务语义指纹比对，无实质变化不落盘（筛选/动作/后台扫描避免无意义全量写入）
    const snapshot = cloneRuntime(rt);
    const fingerprint = semanticRuntimeFingerprint(snapshot);
    return withRuntimeSaveLock(plugin, async () => persistRuntimeSnapshot(plugin, snapshot, fingerprint));
}

/** Persist while the caller already holds withRuntimeSaveLock. */
export async function persistRuntimeUnderLock(plugin: Plugin, rt: HubRuntime): Promise<void> {
    const snapshot = cloneRuntime(rt);
    await persistRuntimeSnapshot(plugin, snapshot, semanticRuntimeFingerprint(snapshot));
}

export async function persistRuntimeSnapshot(plugin: Plugin, snapshot: HubRuntime, fingerprint: string): Promise<void> {
    // Re-check after an earlier queued write: it may already have stored
    // this exact semantic state while this call was waiting.
    if (lastSerializedByPlugin.get(plugin) === fingerprint) return;
    await plugin.saveData(RUNTIME_NAME, snapshot);
    lastSerializedByPlugin.set(plugin, fingerprint);
}
