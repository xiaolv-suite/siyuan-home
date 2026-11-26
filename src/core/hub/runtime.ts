/**
 * 提醒中枢运行态（docs/design/03 §5、09 D1）：
 * HubState 缓存 + snooze/mute/已办缓存 + 快速备忘（adhoc，D1 定案：允许，运行态不入台账）。
 * 持久化：loadData（随思源同步）；业务数据仍在思源侧，本文件只存运行态（ADR-7）。
 *
 * 语义定案（H03/H05/H06/H07，2026-10-02）：
 * - applyRuntime 为纯派生函数，不改运行态；清理只经 purgeHandled 显式执行并落盘。
 * - 未处理备忘永不按到期自动删除；完成（doneAt）的备忘保留 30 天可恢复，之后才清除。
 * - 完成 = 完成那一期/那一次：anniversary 记当年、recurring 记本期（dueDate ≤ 已办期隐藏），
 *   oneoff 记已办条目；恢复后重现。完成不等于永久 mute。
 * - 延后过期的提醒按延后日距今分级（过期即 overdue），不再沿用原级别。
 */
import type { Reminder, ReminderKind, ReminderLevel } from "@/types";
import { localDateKey } from "./rule";
import type { HubRuntime } from "./runtime-types";
export * from "./runtime-types";

export * from "./runtime-store";

/** 已完成运行态记录的保留期（天）：过期后才可被 purgeHandled 清除 */
export const HANDLED_KEEP_DAYS = 30;

/**
 * 显式清理（H03）：只清"已完成"的运行态记录——done 备忘超保留期、oneoff 已办超保留期、
 * 已失效的 recurring 已办期。未处理项（备忘/延后/忽略/未到期已办）永不按到期自动删除。
 * 调用方负责随后落盘（refreshHub）。
 */

/**
 * 行删除后清理孤儿运行态数据（15 组/30 组/EC15）：
 * 清理四个提醒运行态 map（handled/handledYear/handledUntil/snoozed）中
 * 以 `${rowId}::` 为前缀的条目，以及按 rowId 键控的 renewHistory 和 favorSyncs。
 * 返回是否有变更（调用方据此决定是否 saveRuntime）。
 */
export function cleanupRowRuntimeData(rt: HubRuntime, rowId: string): boolean {
    let dirty = false;
    const prefix = `${rowId}::`;
    for (const map of [rt.handled, rt.handledYear, rt.handledUntil, rt.snoozed, rt.muted, rt.snoozeCounts ?? {}, rt.planDates ?? {}]) {
        for (const key of Object.keys(map)) {
            if (key.startsWith(prefix)) { delete map[key]; dirty = true; }
        }
    }
    if (rt.renewHistory?.[rowId]) { delete rt.renewHistory[rowId]; dirty = true; }
    if (rt.favorSyncs?.[rowId]) { delete rt.favorSyncs[rowId]; dirty = true; }
    if (rt.pinnedReminderIds) {
        const prevLen = rt.pinnedReminderIds.length;
        rt.pinnedReminderIds = rt.pinnedReminderIds.filter((id) => !id.startsWith(prefix) && !id.includes(`::${rowId}::`));
        if (rt.pinnedReminderIds.length < prevLen) dirty = true;
    }
    return dirty;
}

/** 266 波模块趋势条滚动窗口（天）：与 HANDLED_KEEP_DAYS 分开，控制 moduleHistory 体积 */
export const MODULE_HISTORY_KEEP_DAYS = 14;

/**
 * 266 波（模块卡趋势条数据源）：全量扫描后记录当日各模块待办计数（同日覆盖），
 * 并裁剪滚动窗口外的旧键。纯函数——写回由调用方经 saveRuntime 落盘。
 */
export function recordModuleHistory(rt: HubRuntime, reminders: Reminder[], today: Date, keepDays = MODULE_HISTORY_KEEP_DAYS): void {
    const todayKey = localDateKey(today);
    const counts: Record<string, number> = {};
    for (const r of reminders) counts[r.moduleId] = (counts[r.moduleId] ?? 0) + 1;
    rt.moduleHistory = { ...(rt.moduleHistory ?? {}), [todayKey]: counts };
    const cutoff = localDateKey(new Date(today.getTime() - keepDays * 86400000));
    for (const key of Object.keys(rt.moduleHistory)) {
        if (key < cutoff) delete rt.moduleHistory[key];
    }
}

export function purgeHandled(rt: HubRuntime, today: Date, keepDays = HANDLED_KEEP_DAYS): void {    const cutoff = today.getTime() - keepDays * 86400000;
    rt.memos = (rt.memos ?? []).filter((m) => !m.doneAt || new Date(m.doneAt).getTime() >= cutoff);
    for (const [id, rec] of Object.entries(rt.handled)) {
        if (new Date(rec.at).getTime() < cutoff) delete rt.handled[id];
    }
    const todayKey = localDateKey(today);
    for (const [id, until] of Object.entries(rt.handledUntil)) {
        // 已办期已翻篇（下一期 due 晚于该期），条目不再起隐藏作用，可安全清除
        if (until < todayKey) delete rt.handledUntil[id];
    }
    // handledYear 旧年份清理（当年已办跨年后条目不再起隐藏作用）
    const currentYear = today.getFullYear();
    for (const [id, year] of Object.entries(rt.handledYear)) {
        if (typeof year === "number" && year < currentYear) delete rt.handledYear[id];
    }
    // monthlyCompletions 保留最近 24 个月（29 组：跨两年前的月度计数归档/丢弃）
    if (rt.monthlyCompletions) {
        const cutoff = new Date(today.getFullYear(), today.getMonth() - 24, 1);
        const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
        for (const key of Object.keys(rt.monthlyCompletions)) {
            if (key < cutoffKey) delete rt.monthlyCompletions[key];
        }
    }
}

/** 规则类型分派（H05）：旧缓存无 kind 时按 ruleKey 推断（birthday=周年，其余 oneoff） */
export function reminderKind(r: Pick<Reminder, "kind" | "ruleKey" | "moduleId">): ReminderKind {
    if (r.kind) return r.kind;
    return r.ruleKey === "birthday" ? "anniversary" : "oneoff";
}

/** 运行态合并后的可见列表是否包含该提醒（供恢复/已办判断复用） */
export function isHiddenByHandled(rt: HubRuntime, r: Reminder, today: Date): boolean {
    const year = today.getFullYear();
    if (rt.muted[r.id]) return true;
    if (rt.handled[r.id]) return true;
    if (rt.handledYear[r.id] === year && r.dueDate.startsWith(String(year))) return true;
    const until = rt.handledUntil[r.id];
    return !!until && r.dueDate <= until;
}

function parseLocal(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

/**
 * 派生提醒 → 呈现列表（纯函数，不改 rt）：
 * 合并 mute/已办隐藏/延后改期，追加未完成 adhoc 备忘。
 */
export function applyRuntime(
    derived: Reminder[],
    rt: HubRuntime,
    today: Date,
): Reminder[] {
    const out: Reminder[] = [];
    const todayKey = localDateKey(today);
    // 归一化为本地当天 00:00:00 时间戳，避免因当前时分秒导致当日事项在午后被判定为 daysLeft = -1
    const todayZero = parseLocal(todayKey);
    for (const r of derived) {
        if (isHiddenByHandled(rt, r, today)) continue;
        const count = rt.snoozeCounts?.[r.id] ?? r.postponeCount ?? r.snoozeCount;
        const isDecomposed = Boolean(rt.decomposedReminders?.[r.id]);
        const snoozeDate = rt.snoozed[r.id];
        if (snoozeDate) {
            // snooze 未到 → 隐藏；已到 → 显示为"延后日"事项，按延后日距今分级（H06）
            if (todayKey < snoozeDate) continue;
            const daysLeft = Math.round((parseLocal(snoozeDate) - todayZero) / 86400000);
            const level: ReminderLevel = daysLeft < 0 ? "overdue" : "soon";
            out.push({
                ...r,
                dueDate: snoozeDate,
                daysLeft,
                level,
                ...(count !== undefined ? { snoozeCount: count, postponeCount: count } : {}),
                ...(isDecomposed ? { decomposed: true } : {}),
            });
            continue;
        }
        out.push({
            ...r,
            ...(count !== undefined ? { snoozeCount: count, postponeCount: count } : {}),
            ...(isDecomposed ? { decomposed: true } : {}),
        });
    }
    for (const m of rt.memos ?? []) {
        if (m.doneAt) continue; // 已办备忘不进活跃列表（已处理视图可见可恢复）
        const memoReminderId = `adhoc::${m.id}`;
        if (rt.muted[memoReminderId]) continue; // 忽略的备忘隐藏（可在已处理视图恢复）
        const memoSnoozeCount = rt.snoozeCounts?.[memoReminderId] ?? (m as any).postponeCount ?? m.snoozeCount;
        const isMemoDecomposed = Boolean(rt.decomposedReminders?.[memoReminderId] || (m as any).decomposed);
        const snoozeDate = rt.snoozed[memoReminderId];
        if (snoozeDate && todayKey < snoozeDate) continue; // 延后未到期 → 隐藏
        const effectiveDue = snoozeDate || m.dueDate;
        const daysLeft = Math.round((parseLocal(effectiveDue) - todayZero) / 86400000);
        const level: ReminderLevel = daysLeft < 0 ? "overdue" : (snoozeDate || daysLeft <= 7) ? "soon" : "lead";
        out.push({
            id: memoReminderId,
            moduleId: "adhoc",
            ruleKey: "memo",
            rowId: m.id,
            title: m.title,
            dueDate: effectiveDue,
            daysLeft,
            level,
            kind: m.cycle ? "recurring" : "oneoff",
            ...(m.priority ? { priority: m.priority } : {}),
            ...(m.category ? { tag: m.category } : {}),
            ...(m.recurrenceAnchor ? { recurrenceAnchor: m.recurrenceAnchor } : {}),
            ...(memoSnoozeCount !== undefined ? { snoozeCount: memoSnoozeCount, postponeCount: memoSnoozeCount } : {}),
            ...(isMemoDecomposed ? { decomposed: true } : {}),
        });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft || a.dueDate.localeCompare(b.dueDate));
}

/** 已处理视图条目（H07）：完成/忽略/备忘的真实记录，含恢复所需 id */
export interface HandledEntry {
    id: string;
    title: string;
    moduleId: string;
    dueDate?: string;
    at?: string;
    kind: "done" | "muted" | "year" | "period" | "memo";
}

/**
 * 运行态的 muted/handledYear/handledUntil 旧格式只保存提醒 ID。
 * 提醒 ID 由 rule.ts 生成 `${rowId}::${moduleId}.${ruleKey}`，缓存不可用时
 * 从这个稳定部分回推模块，避免模块筛选把历史条目当成无归属数据隐藏。
 */
function moduleIdFromReminderId(id: string): string {
    if (id.startsWith("adhoc::")) return "adhoc";
    const marker = id.indexOf("::");
    if (marker < 0) return "";
    const moduleAndRule = id.slice(marker + 2);
    const dot = moduleAndRule.indexOf(".");
    return dot > 0 ? moduleAndRule.slice(0, dot) : "";
}

/**
 * 已处理列表（提醒页"已处理"筛选的真实数据源）：
 * oneoff 已办 + 忽略中 + 周年当年已办 + recurring 本期已办 + 已完成备忘。
 * title 尽量从派生列表回查；不在扫描结果时给出可读的降级说明。
 */
export function listHandled(rt: HubRuntime, derived: Reminder[]): HandledEntry[] {
    const byId = new Map(derived.map((r) => [r.id, r]));
    const memoById = new Map((rt.memos ?? []).map((m) => [`adhoc::${m.id}`, m]));
    const out: HandledEntry[] = [];
    for (const [id, rec] of Object.entries(rt.handled)) {
        out.push({ id, title: rec.title, moduleId: rec.moduleId, dueDate: rec.dueDate, at: rec.at, kind: "done" });
    }
    for (const id of Object.keys(rt.muted)) {
        const r = byId.get(id);
        const m = memoById.get(id);
        out.push({
            id,
            title: r?.title ?? m?.title ?? "",
            moduleId: r?.moduleId ?? (m ? "adhoc" : moduleIdFromReminderId(id)),
            dueDate: r?.dueDate ?? m?.dueDate,
            kind: "muted",
        });
    }
    for (const [id, year] of Object.entries(rt.handledYear)) {
        const r = byId.get(id);
        out.push({ id, title: r?.title ?? "", moduleId: r?.moduleId ?? moduleIdFromReminderId(id), dueDate: r?.dueDate, at: String(year), kind: "year" });
    }
    for (const [id, until] of Object.entries(rt.handledUntil)) {
        const r = byId.get(id);
        out.push({ id, title: r?.title ?? "", moduleId: r?.moduleId ?? moduleIdFromReminderId(id), dueDate: until, kind: "period" });
    }
    for (const m of rt.memos ?? []) {
        if (!m.doneAt) continue;
        out.push({ id: `adhoc::${m.id}`, title: m.title, moduleId: "adhoc", dueDate: m.dueDate, at: m.doneAt, kind: "memo" });
    }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export * from "./runtime-views";



