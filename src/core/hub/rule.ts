/**
 * 提醒规则引擎（docs/design/03 + docs/design/09 决策记录）。
 * 纯逻辑 + 农历懒加载（lunar-lazy，bundle 整改 🔴），无思源依赖，可单测。
 *
 * 决策定案（2026-10-01，docs/design/09）：
 * - 公历 2/29 生日：平年在 2/28 提醒；
 * - 农历闰月生日：平年过平月同日；生日当日不存在（如腊月三十遇小月）时向前取最近存在日（腊月廿九）；
 * - recurring 的 due 永远滚动到今天及以后（不产生 overdue）；cycle 未声明时按 oneoff 降级；
 * - recurring 滚动用月数差 O(1) 计算，月末由 addMonths 收敛到月末（不跨月漂移）；
 * - 日期序列化一律用本地时区（localDateKey），禁止 toISOString（UTC 偏移会偏一天）。
 */
// 300波架构瘦身：以原生无依赖日期纯函数替换外部重型 date-fns，消除冗余依赖并守护 220KB 硬预算
export function addDays(d: Date, amount: number): Date {
    const res = new Date(d.getTime());
    res.setDate(res.getDate() + amount);
    return res;
}

export function addMonths(d: Date, amount: number): Date {
    const res = new Date(d.getTime());
    const desiredMonth = res.getMonth() + amount;
    const date = res.getDate();
    res.setMonth(desiredMonth, 1);
    const daysInTarget = new Date(res.getFullYear(), res.getMonth() + 1, 0).getDate();
    res.setDate(Math.min(date, daysInTarget));
    return res;
}

export function addYears(d: Date, amount: number): Date {
    return addMonths(d, amount * 12);
}

export function differenceInCalendarDays(d1: Date, d2: Date): number {
    const u1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
    const u2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
    return Math.round((u1 - u2) / (24 * 3600 * 1000));
}

export function parseISO(str: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const p = str.split("-").map(Number);
        return new Date(p[0], p[1] - 1, p[2]);
    }
    return new Date(str);
}

export function isValid(d: unknown): d is Date {
    return d instanceof Date && !isNaN(d.getTime());
}

import type { Reminder, ReminderRuleSpec, ReminderLevel } from "@/types";
import { nextLunarAnniversary } from "./lunar-lazy";

export interface LedgerRowDates {
    /** 行块 ID */
    rowId: string;
    memberId?: string;
    title: string;
    /** 规则 field 对应的日期（ISO 或 yyyy-MM-dd） */
    fieldValue?: string;
    /** recurring 的周期值 */
    cycle?: string;
    /** anniversary 的农历标记 */
    lunar?: boolean;
    /** 自动续约条款标记（合同：升级为续约决策提醒） */
    autoRenew?: boolean;
    /** 周期循环基准（Tasks.org 规格）：due=按计划到期日；completion=按实际完成日 */
    recurrenceAnchor?: "due" | "completion";
    /** 实际完成日（YYYY-MM-DD，用于 completion 基准） */
    completedDate?: string;
}

const CYCLE_MONTHS: Record<string, number> = {
    day: 0, week: 0, month: 1, quarter: 3, year: 12,
};

export function parseDate(v?: string | number): Date | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number") {
        const d = new Date(v);
        return isValid(d) ? d : undefined;
    }
    const raw = String(v).trim();
    // 1. 纯数字毫秒时间戳字符串（如 "1761350400000"）
    const num = Number(raw);
    if (!isNaN(num) && num > 100000000) {
        const d = new Date(num);
        if (isValid(d)) return d;
    }
    // 2. 常见日期分隔符归一化（将斜杠 / 点号 / 中文年月日替换为 -）
    const normalized = raw
        .replace(/年|\/|\./g, "-")
        .replace(/月/g, "-")
        .replace(/日/g, "")
        .trim();
    // 3. yyyy-M-d 格式正则匹配并构建本地日期
    const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        const d = new Date(year, month - 1, day);
        return isValid(d) ? d : undefined;
    }
    // 4. 标准 ISO 或 RFC 日期解析回退
    const d = normalized.length === 10 ? parseISO(`${normalized}T00:00:00`) : parseISO(normalized);
    return isValid(d) ? d : undefined;
}

/** 本地时区 yyyy-MM-dd（决策 33.3：禁止 toISOString） */
export function localDateKey(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function daysInMonth(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
}

/** 下次发生日（含今天）。 */
export async function nextOccurrence(rule: ReminderRuleSpec, row: LedgerRowDates, today: Date): Promise<Date | undefined> {
    const base = parseDate(row.fieldValue);
    if (!base) return undefined;
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (rule.kind === "oneoff") return base;

    // after（16 组/190 波：favors 回礼类——事件后 N 天一次性）：base + offsetDays；无周期滚动
    if (rule.kind === "after") {
        const offset = Math.max(0, Math.min(rule.offsetDays ?? 0, 3650));
        return addDays(base, offset);
    }

    if (rule.kind === "anniversary") {
        if (row.lunar) return nextLunarAnniversary(base, today0);
        // 公历周年：2/29 平年取 2/28（决策 09）
        const day = Math.min(base.getDate(), daysInMonth(today0.getFullYear(), base.getMonth()));
        const cand = new Date(today0.getFullYear(), base.getMonth(), day);
        if (cand < today0) return addYears(cand, 1);
        return cand;
    }

    // recurring：按周期与基准锚点滚动（Tasks.org 双基准循环规则）
    if (rule.kind === "recurring" && row.cycle) {
        const anchor = row.recurrenceAnchor ?? rule.recurrenceAnchor ?? "due";
        const completionDate = row.completedDate ? parseDate(row.completedDate) : undefined;
        return calculateNextRecurrenceDate(base, row.cycle, { today: today0, anchor, completionDate });
    }
    // 未声明周期 → 一次性降级（决策 09）
    return base;
}

/**
 * 计算周期提醒的下一次发生日（Tasks.org 标杆规格：双基准循环规则）
 *
 * @param base 计划日期（若 anchor="due" 则作为滚动原点）
 * @param cycle 周期描述（day / week / month / quarter / year / 14d / 14天 / 2周 等）
 * @param options 可选参数：anchor (due | completion), completionDate (实际完成日), today (今天)
 */
export function calculateNextRecurrenceDate(
    base: Date,
    cycle: string,
    options: {
        today?: Date;
        anchor?: "due" | "completion";
        completionDate?: Date;
    } = {},
): Date {
    const today0 = options.today ? new Date(options.today.getFullYear(), options.today.getMonth(), options.today.getDate()) : new Date();
    const anchor = options.anchor ?? "due";

    // 当指定 completion 且提供实际完成日时，自实际完成日起跳（Tasks.org 核心：家务/护理等避免堆积）
    const startPoint = (anchor === "completion" && options.completionDate)
        ? new Date(options.completionDate.getFullYear(), options.completionDate.getMonth(), options.completionDate.getDate())
        : new Date(base.getFullYear(), base.getMonth(), base.getDate());

    const c = cycle.trim().toLowerCase();
    const dayMatch = c.match(/^(\d+)\s*(?:d|天|day|days)?$/);
    const weekMatch = c.match(/^(\d+)\s*(?:w|周|星期|礼拜|week|weeks)$/);
    const monthMatch = c.match(/^(\d+)\s*(?:m|月|month|months)$/);

    if (anchor === "completion" && options.completionDate) {
        if (c === "day") return addDays(startPoint, 1);
        if (c === "week") return addDays(startPoint, 7);
        if (c === "month") return addMonths(startPoint, 1);
        if (c === "quarter") return addMonths(startPoint, 3);
        if (c === "year") return addYears(startPoint, 1);
        if (dayMatch) return addDays(startPoint, parseInt(dayMatch[1], 10));
        if (weekMatch) return addDays(startPoint, parseInt(weekMatch[1], 10) * 7);
        if (monthMatch) return addMonths(startPoint, parseInt(monthMatch[1], 10));
        return addDays(startPoint, 1);
    }

    // anchor === "due"：按日历固定周期滚动到今天及以后（O(1) 月数差；day/week 用差值跳步）
    if (c === "day") {
        const diff = differenceInCalendarDays(today0, startPoint);
        if (diff <= 0) return startPoint;
        return addDays(startPoint, diff);
    }
    if (c === "week") {
        const diff = differenceInCalendarDays(today0, startPoint);
        if (diff <= 0) return startPoint;
        return addDays(startPoint, Math.ceil(diff / 7) * 7);
    }
    const months = CYCLE_MONTHS[c] ?? (monthMatch ? parseInt(monthMatch[1], 10) : 0);
    if (months > 0) {
        const diff = (today0.getFullYear() - startPoint.getFullYear()) * 12 + (today0.getMonth() - startPoint.getMonth());
        if (diff <= 0 && startPoint >= today0) return startPoint;
        const k = Math.max(1, Math.ceil(diff / months));
        const next = addMonths(startPoint, k * months);
        return next < today0 ? addMonths(next, months) : next;
    }
    if (dayMatch) {
        const step = parseInt(dayMatch[1], 10);
        if (step > 0) {
            const diff = differenceInCalendarDays(today0, startPoint);
            if (diff <= 0) return startPoint;
            return addDays(startPoint, Math.ceil(diff / step) * step);
        }
    }
    if (weekMatch) {
        const step = parseInt(weekMatch[1], 10) * 7;
        if (step > 0) {
            const diff = differenceInCalendarDays(today0, startPoint);
            if (diff <= 0) return startPoint;
            return addDays(startPoint, Math.ceil(diff / step) * step);
        }
    }
    return startPoint;
}

/** 紧急分级（03 §4）：🔴 已逾期 / 🟠 7 天内 / 🟡 提前量内 / ⚪ 更远 */
export function levelOf(daysLeft: number, leadDays: number): ReminderLevel {
    if (daysLeft < 0) return "overdue";
    if (daysLeft <= 7) return "soon";
    if (daysLeft <= Math.max(leadDays, 8)) return "lead";
    return "later";
}

/**
 * 规则 + 台账行 → 运行态提醒。
 * leadOverride 合并顺序（33.3）：行级 remind_before > 用户 leadOverrides > schema 默认；
 * 行级与用户级的合并在 DataProvider 层完成，这里只收最终值。
 */
export async function buildReminder(
    rule: ReminderRuleSpec,
    moduleId: string,
    row: LedgerRowDates,
    opts: { today: Date; leadOverride?: number },
): Promise<Reminder | null> {
    const due = await nextOccurrence(rule, row, opts.today);
    if (!due) return null;
    const leadDays = Math.max(0, Math.min(opts.leadOverride ?? rule.leadDays, 3650));
    const daysLeft = differenceInCalendarDays(due, opts.today);
    const level = levelOf(daysLeft, leadDays);
    // 降噪：提前量之外（later）不进列表；overdue 始终保留
    if (level === "later") return null;
    const anchor = row.recurrenceAnchor ?? rule.recurrenceAnchor;
    return {
        id: `${row.rowId}::${moduleId}.${rule.key}`,
        moduleId,
        ruleKey: rule.key,
        rowId: row.rowId,
        memberId: row.memberId,
        title: row.title,
        dueDate: localDateKey(due),
        daysLeft,
        level,
        kind: rule.kind,
        ...(row.lunar ? { lunar: true } : {}),
        ...(row.autoRenew ? { autoRenew: true } : {}),
        ...(anchor ? { recurrenceAnchor: anchor } : {}),
    };
}

/** 相对到期表述（17 组：时间文案本地化，186 波）。复用 overview 既有 days.* 键族（+补 days.tomorrow）；
 * ≥7 天返回 null（调用方沿用 ISO 日期——信息密度优于"23 天后"）；完整日期恒由调用方挂 title 悬浮。 */
export type RelativeDue = { key: "days.overdue" | "days.today" | "days.tomorrow" | "days.after"; n?: number };
export function relativeDue(daysLeft: number): RelativeDue | null {
    if (!Number.isFinite(daysLeft)) return null;
    const d = Math.floor(daysLeft);
    if (d < 0) return { key: "days.overdue", n: -d };
    if (d === 0) return { key: "days.today" };
    if (d === 1) return { key: "days.tomorrow" };
    if (d <= 6) return { key: "days.after", n: d };
    return null;
}

/** 周几键（17 组/205 波：「N 天后 · 周六」——排期语境星期比天数直观）。非法日期返回 null。 */
export function weekdayKey(dueDate: string): "week.sun" | "week.mon" | "week.tue" | "week.wed" | "week.thu" | "week.fri" | "week.sat" | null {
    const d = parseDate(dueDate);
    if (!d || Number.isNaN(d.getDay())) return null;
    return (["week.sun", "week.mon", "week.tue", "week.wed", "week.thu", "week.fri", "week.sat"] as const)[d.getDay()];
}
