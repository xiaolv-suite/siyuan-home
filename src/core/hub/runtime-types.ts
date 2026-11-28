/**
 * 提醒中枢运行态核心类型契约 (RuntimeTypes)
 * 下沉纯类型定义，解耦 runtime.ts、runtime-store.ts 与 runtime-views.ts 之间的循环依赖。
 */

import type { Reminder } from "@/types";

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
