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

/** 快速备忘（adhoc）：独立于台账的一次性提醒（09 D1） */
export interface AdhocMemo {
    id: string;
    title: string;
    dueDate: string; // yyyy-MM-dd
    createdAt: string;
    /** 完成时间（ISO）：有值则不进活跃列表，可在"已处理"恢复（H03/H07） */
    doneAt?: string;
    /** 优先级 */
    priority?: "high" | "medium" | "low";
    /** 分类标签（如家庭、工作） */
    category?: string;
    /** 周期循环基准：due=计划日；completion=完成日 */
    recurrenceAnchor?: "due" | "completion";
    /** 周期（如 day/week/month 等） */
    cycle?: string;
    /** 累计推迟次数 */
    snoozeCount?: number;
}

/** 命名视图配置（§17：筛选组合一键切换与跨会话持久化） */
export interface ReminderNamedView {
    id: string;
    name: string;
    filter?: string;
    memberId?: string;
    moduleId?: string;
    dueWithin?: string;
}

/** 已处理记录（H07）：oneoff 完成动作的真实留痕，可恢复 */
export interface HandledRecord {
    title: string;
    moduleId: string;
    ruleKey: string;
    dueDate: string;
    at: string; // ISO
}

export interface HubRuntime {
    /** 运行态版本（33.3：协议版本化） */
    schemaVersion: 1;
    /** 上次全量扫描时间（ISO） */
    scannedAt?: string;
    /** 总览成员过滤（C2e：持久化） */
    filterMemberId?: string;
    /** 提醒中枢筛选（C3d：持久化） */
    hubFilter?: string;
    /** 提醒中枢成员筛选（C3a/H16：成员删除时复位） */
    hubMemberId?: string;
    /** 提醒中枢模块筛选（C3a） */
    hubModuleId?: string;
    /** 提醒中枢时间窗筛选（C3a，天）：all=不限 / 0=今天 / 7 / 30（含逾期） */
    hubDueWithin?: string;
    /** 263 波：提醒中枢视图偏好（列表/日历）与会历模式（月/周），跨会话记忆 */
    hubViewMode?: "list" | "calendar";
    hubCalMode?: "month" | "week";
    /** 267 波：快速记录弹层记住上次模块（启用模块 id；失效回退首个） */
    hubQuickModule?: string;
    /** 首次运行欢迎提示是否已展示（防重复弹窗） */
    firstRunWelcomed?: boolean;
    /** 台账页排序偏好（17 组：列 key + 方向，跨会话记忆） */
    ledgerSortKey?: string;
    ledgerSortAsc?: boolean;
    /** 命名视图列表（§17 命名视图切换，跨会话持久化） */
    namedViews?: ReminderNamedView[];
    /** 当前激活的命名视图 ID（可选） */
    activeNamedViewId?: string;
    /** 上次扫描摘要缓存（通知与总览首屏直读，扫描失败时保留 stale 数据） */
    cache?: {
        reminders: Reminder[];
        counts: { overdue: number; soon: number; lead: number };
        /** 单模块扫描失败记录（不得全局显示"暂无事项"，33.3） */
        errors: { moduleId: string; message: string }[];
        /** 运行态合并前的派生列表（H02：动作后免重扫即时重算可见集合） */
        derived: Reminder[];
        /** 各模块上次成功快照与数据时间（H04：失败模块保留旧数据）；264 波：行数口径随快照 */
        byModule: Record<string, { reminders: Reminder[]; at: string; rowCount?: number; memberCounts?: Record<string, number> }>;
    };
    /** 延后：提醒 id → 新到期日 */
    snoozed: Record<string, string>;
    /** 累计推迟次数：提醒 id → 次数（>=3 次触发微步骤拆解提示） */
    snoozeCounts?: Record<string, number>;
    /** 顽固事项微步骤拆解记录：提醒 id → 拆解信息 */
    decomposedReminders?: Record<string, { at: string; steps?: string[] }>;
    /** 计划处理日（§17/284波 双日期）：提醒 id → 计划处理日 (yyyy-MM-dd)；与客观 deadline 分离 */
    planDates: Record<string, string>;
    /** 忽略：提醒 id → true（可在提醒页恢复） */
    muted: Record<string, boolean>;
    /** 周年类"今年已办"：提醒 id → 年份（当年隐藏，次年重现） */
    handledYear: Record<string, number>;
    /** recurring 本期已办：提醒 id → 已办那期的 dueDate（下一期自动重现） */
    handledUntil: Record<string, string>;
    /** oneoff 已办记录（可在已处理视图恢复） */
    handled: Record<string, HandledRecord>;
    /** 续期历史（H10）：台账行 rowId → 续期流水（from→to）；换证历史链视图见 16 组 */
    renewHistory: Record<string, { from: string; to: string; at: string }[]>;
    /** 快速备忘 */
    memos: AdhocMemo[];
    /** 置顶备忘 id 清单（246 波收件箱深化）：列表组内置顶排序 */
    pinnedMemoIds?: string[];
    /** 置顶提醒 id 清单（304 波支持任意重要到期项置顶，如证件/合同/台账/备忘） */
    pinnedReminderIds?: string[];
    /** 上期提醒摘要快照（306 波）：供周报生成逾期数量对比 */
    digestHistory?: { overdue: number; at: string };
    /** 每日摘要去重：最后通知日期 */
    lastNotifiedDate?: string;
    /** 逾期即时提醒去重：最后提示日期（B3b） */
    lastOverdueAlertDate?: string;
    /** 每周预告摘要去重：ISO 周键（29 组，如 2026-W40） */
    lastWeeklyDigest?: string;
    /** 29 组：今日免打扰快捷开关（值为今日 localDateKey，跨天自动失效） */
    todaySilent?: string;
    /** EC21：最近一次 lv-exam:stats 聚合缓存（只存子集，latest-only；不读题目内容） */
    lastExamStats?: { streak: number; accuracy: number; attempts: number; generatedAt: number };
    /** EC09/EC10：打卡强度摘要缓存（top 5 项目；latest-only） */
    lastCheckinSummary?: { items: { itemId: string; name: string; score: number }[]; windowDays: number; pulledAt: number };
    /** EC15：人情往来已同步到人脉的行（favor 行 itemID → {docId, at}） */
    favorSyncs?: Record<string, { docId: string; at: string }>;
    /** 29 组月度完成率：月键 "YYYY-MM" → 当月完成计数（跨月自动归零由读取方处理） */
    monthlyCompletions?: Record<string, number>;
    /** 29 组月度应到基数：月键 → 当月去重后到期提醒总数（全量扫描时更新） */
    monthlyDueTotals?: Record<string, number>;
    /** 266 波模块卡趋势条：日期键（localDateKey）→ { 模块 id → 当日待办计数 }；滚动窗口由写入方裁剪 */
    moduleHistory?: Record<string, Record<string, number>>;
    /** 297 波：多设备家庭协作的只读访客模式激活状态（会话级/本地运行态） */
    guestModeActive?: boolean;
    /** 台账软删除回收站（安全容灾）：保留被删除行的快照与所属模块，支持 30 天内恢复 */
    trash?: Array<{
        id: string;
        moduleId: string;
        title: string;
        deletedAt: string;
        rowSnapshot: Record<string, any>;
    }>;
}

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



