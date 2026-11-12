/**
 * 快速备忘 Quick Add Magic 自然语言标记解析器（借鉴 Vikunja / Todoist / Super Productivity 规格）。
 *
 * 语法支持：
 * 1. 日期标记：
 *    - 相对词：@今天、@明天、@后天、@大后天
 *    - 相对天数：@+3d、@+7d、@+14天、@+30d
 *    - 星期：@下周一 ~ @下周日、@周一 ~ @周日
 *    - 具体日期：@YYYY-MM-DD、@M月D日
 * 2. 优先级标记：
 *    - 高：!高、!p1、!1、!high、!h
 *    - 中：!中、!p2、!2、!med、!medium、!m
 *    - 低：!低、!p3、!3、!low、!l
 * 3. 分类/标签标记：
 *    - #分类名（如 #家庭、#工作、#健康、#财务）
 *
 * 容错回退：若未包含 @ 日期标记，自动尝试传统中文自然日期解析（parseNaturalDate），确保无缝向下兼容。
 */

import { parseNaturalDate } from "./dateparse";
import { localDateKey, addDays } from "./hub/rule";

export type QuickAddPriority = "high" | "medium" | "low";

export interface QuickAddResult {
    /** 剥离语法标记后的纯净标题 */
    cleanTitle: string;
    /** 用户原始输入 */
    raw: string;
    /** 解析出的截止日期 (yyyy-MM-dd) */
    dueDate?: string;
    /** 命中的日期原始 Token（如 "@明天" 或 "@+3d"） */
    dateToken?: string;
    /** 解析出的优先级 */
    priority?: QuickAddPriority;
    /** 命中的优先级原始 Token（如 "!高" 或 "!p1"） */
    priorityToken?: string;
    /** 解析出的分类标签 */
    category?: string;
    /** 命中的分类原始 Token（如 "#家庭"） */
    categoryToken?: string;
    /** 解析出的循环周期（如 "day" | "week" | "month" | "quarter" | "year" | "14d" 等） */
    cycle?: string;
    /** 命中的周期原始 Token（如 "*每月" 或 "*!14天"） */
    cycleToken?: string;
    /** 解析出的循环基准：due=按计划日固定循环；completion=按完成日顺延 */
    recurrenceAnchor?: "due" | "completion";
    /** 解析出的金额（元） */
    amount?: number;
    /** 命中的金额原始 Token（如 "¥45" 或 "28元" 或 "45"） */
    amountToken?: string;
}

const WEEKDAY_MAP: Record<string, number> = {
    日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

function parseAtDateToken(token: string, today: Date): string | undefined {
    const raw = token.slice(1).trim(); // strip leading '@'
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // 1. 简要相对词
    if (raw === "今天") return localDateKey(today0);
    if (raw === "明天") return localDateKey(addDays(today0, 1));
    if (raw === "后天") return localDateKey(addDays(today0, 2));
    if (raw === "大后天") return localDateKey(addDays(today0, 3));

    // 2. 相对天数：+3d, +7d, +14天, 3d, 7d
    const plusDaysMatch = raw.match(/^\+?(\d{1,3})\s*(?:d|day|days|天)?$/i);
    if (plusDaysMatch) {
        const n = parseInt(plusDaysMatch[1], 10);
        if (Number.isFinite(n) && n >= 0 && n <= 999) {
            return localDateKey(addDays(today0, n));
        }
    }

    // 3. 下周X / 下星期X / 下礼拜X
    const nextWeekMatch = raw.match(/^下(?:周|星期|礼拜)([一二三四五六日天])/);
    if (nextWeekMatch) {
        const targetWeekday = WEEKDAY_MAP[nextWeekMatch[1]];
        if (targetWeekday !== undefined) {
            const monIdx = (targetWeekday + 6) % 7;
            const monday = addDays(today0, -((today0.getDay() + 6) % 7));
            return localDateKey(addDays(monday, 7 + monIdx));
        }
    }

    // 4. 周X / 星期X / 礼拜X (最近未来)
    const thisWeekMatch = raw.match(/^(?:周|星期|礼拜)([一二三四五六日天])/);
    if (thisWeekMatch) {
        const targetWeekday = WEEKDAY_MAP[thisWeekMatch[1]];
        if (targetWeekday !== undefined) {
            const diff = (targetWeekday - today0.getDay() + 7) % 7;
            return localDateKey(addDays(today0, diff));
        }
    }

    // 5. M月D日 / M月D号
    const monthDayMatch = raw.match(/^(\d{1,2})\s*月\s*(\d{1,2})[日号]?/);
    if (monthDayMatch) {
        const m = parseInt(monthDayMatch[1], 10);
        const d = parseInt(monthDayMatch[2], 10);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            let targetYear = today0.getFullYear();
            const cand = new Date(targetYear, m - 1, d);
            if (cand < today0) {
                cand.setFullYear(targetYear + 1);
            }
            if (cand.getMonth() === (cand < today0 ? m : m - 1)) {
                return localDateKey(cand);
            }
        }
    }

    // 6. ISO 或 yyyy/M/d
    const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
        const y = parseInt(isoMatch[1], 10);
        const m = parseInt(isoMatch[2], 10);
        const d = parseInt(isoMatch[3], 10);
        const cand = new Date(y, m - 1, d);
        if (cand.getFullYear() === y && cand.getMonth() === m - 1 && cand.getDate() === d) {
            return localDateKey(cand);
        }
    }

    return undefined;
}

function parsePriorityToken(token: string): QuickAddPriority | undefined {
    const val = token.slice(1).trim().toLowerCase(); // strip leading '!'
    if (["高", "1", "p1", "h", "high", "urgent"].includes(val)) return "high";
    if (["中", "2", "p2", "m", "med", "medium"].includes(val)) return "medium";
    if (["低", "3", "p3", "l", "low"].includes(val)) return "low";
    return undefined;
}

function parseCycleToken(token: string, today: Date): { cycle: string; anchor: "due" | "completion"; impliedDueDate?: string } | undefined {
    let raw = token.slice(1).trim(); // strip leading '*'
    if (!raw) return undefined;
    let anchor: "due" | "completion" = "due";
    if (/^(!|完成后|完成起|顺延)/.test(raw)) {
        anchor = "completion";
        raw = raw.replace(/^(!|完成后|完成起|顺延)/, "").trim();
    }
    if (/^每/.test(raw)) {
        raw = raw.slice(1).trim();
    }
    const monthDayMatch = raw.match(/^月\s*(\d{1,2})\s*[日号]?$/);
    if (monthDayMatch) {
        const dayNum = parseInt(monthDayMatch[1], 10);
        if (dayNum >= 1 && dayNum <= 31) {
            const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const maxThisMonth = new Date(today0.getFullYear(), today0.getMonth() + 1, 0).getDate();
            let cand = new Date(today0.getFullYear(), today0.getMonth(), Math.min(dayNum, maxThisMonth));
            if (cand < today0) {
                const nextMonth = new Date(today0.getFullYear(), today0.getMonth() + 1, 1);
                const maxNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
                cand = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dayNum, maxNextMonth));
            }
            return { cycle: "month", anchor, impliedDueDate: localDateKey(cand) };
        }
    }
    const lower = raw.toLowerCase();
    if (["天", "日", "day", "daily", "1d", "1天"].includes(lower)) return { cycle: "day", anchor };
    if (["周", "星期", "礼拜", "week", "weekly", "1w", "1周"].includes(lower)) return { cycle: "week", anchor };
    if (["月", "month", "monthly", "1m", "1月", "1个月"].includes(lower)) return { cycle: "month", anchor };
    if (["季", "季度", "quarter", "quarterly"].includes(lower)) return { cycle: "quarter", anchor };
    if (["年", "year", "yearly", "1y", "1年"].includes(lower)) return { cycle: "year", anchor };

    const nDay = lower.match(/^(\d{1,3})\s*(?:d|day|days|天|日)$/);
    if (nDay) return { cycle: `${parseInt(nDay[1], 10)}d`, anchor };
    const nWeek = lower.match(/^(\d{1,2})\s*(?:w|week|weeks|周|星期|礼拜)$/);
    if (nWeek) return { cycle: `${parseInt(nWeek[1], 10)}w`, anchor };
    const nMonth = lower.match(/^(\d{1,2})\s*(?:m|month|months|个?月)$/);
    if (nMonth) return { cycle: `${parseInt(nMonth[1], 10)}m`, anchor };
    return undefined;
}

/**
 * 解析快速备忘自然语言输入
 *
 * @param input 用户输入的文本，如 "交物业费 !高 #家庭 @明天 *每月"
 * @param today 参考基准时间，默认当前时间
 */
export function parseQuickAdd(input: string, today: Date = new Date()): QuickAddResult {
    const raw = String(input ?? "");
    let working = raw;

    let dueDate: string | undefined;
    let dateToken: string | undefined;
    let priority: QuickAddPriority | undefined;
    let priorityToken: string | undefined;
    let category: string | undefined;
    let categoryToken: string | undefined;
    let cycle: string | undefined;
    let cycleToken: string | undefined;
    let recurrenceAnchor: "due" | "completion" | undefined;

    // 1. 扫描 @日期 Token：匹配 @ 紧跟非空白字符（允许 @+3d, @明天, @2026-11-01, @10月15日 等）
    const atDateRegex = /@([^\s,，;；!#*]+)/;
    const atMatch = working.match(atDateRegex);
    if (atMatch) {
        const fullToken = atMatch[0];
        const parsedDate = parseAtDateToken(fullToken, today);
        if (parsedDate) {
            dueDate = parsedDate;
            dateToken = fullToken;
            working = working.replace(fullToken, " ");
        }
    }

    // 2. 扫描 *周期 Token：匹配 * 紧跟周期描述（允许 *每月, *每周, *14天, *!14天, *完成后7天, *每月15号 等）
    const cycleRegex = /\*(!?[^\s,，;；!#@]+)/;
    const cycMatch = working.match(cycleRegex);
    if (cycMatch) {
        const fullToken = cycMatch[0];
        const parsedCycle = parseCycleToken(fullToken, today);
        if (parsedCycle) {
            cycle = parsedCycle.cycle;
            cycleToken = fullToken;
            recurrenceAnchor = parsedCycle.anchor;
            if (!dueDate && parsedCycle.impliedDueDate) {
                dueDate = parsedCycle.impliedDueDate;
                dateToken = fullToken;
            }
            working = working.replace(fullToken, " ");
        }
    }

    // 3. 扫描 !优先级 Token：匹配 ! 紧跟字母/数字/中文
    const priorityRegex = /!([高|中|低|p1|p2|p3|1|2|3|high|med|medium|low|h|m|l|urgent]+)(?=\s|$)/i;
    const prioMatch = working.match(priorityRegex);
    if (prioMatch) {
        const fullToken = prioMatch[0];
        const parsedPriority = parsePriorityToken(fullToken);
        if (parsedPriority) {
            priority = parsedPriority;
            priorityToken = fullToken;
            working = working.replace(fullToken, " ");
        }
    }

    // 4. 扫描 #分类 Token：匹配 # 紧跟中文、字母、数字、下划线、短横线
    const categoryRegex = /#([\w\u4e00-\u9fa5-]+)/;
    const catMatch = working.match(categoryRegex);
    if (catMatch) {
        category = catMatch[1];
        categoryToken = catMatch[0];
        working = working.replace(catMatch[0], " ");
    }

    // 5. 扫描金额 Token：匹配 ¥/￥ 符号或 元/块/块钱 后缀，或末尾纯数字金额（如 "买水果 45", "打车 28元", "交物业费 ¥320"）
    let amount: number | undefined;
    let amountToken: string | undefined;

    const currencyRegex = /(?:[¥$￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱))(?=\s|$)/;
    const curMatch = working.match(currencyRegex);
    if (curMatch) {
        const valStr = curMatch[1] || curMatch[2];
        const num = parseFloat(valStr);
        if (Number.isFinite(num) && num > 0) {
            amount = num;
            amountToken = curMatch[0];
            working = working.replace(curMatch[0], " ");
        }
    } else {
        // 末尾的显式空格 + 纯数字（如 "买水果 45"）
        const endNumberMatch = working.match(/(?:\s+)(\d+(?:\.\d{1,2})?)\s*$/);
        if (endNumberMatch && endNumberMatch.index !== undefined) {
            const num = parseFloat(endNumberMatch[1]);
            // 排除明显的年份或月份数字误判（如 >= 1900）
            if (Number.isFinite(num) && num > 0 && num < 1900) {
                amount = num;
                amountToken = endNumberMatch[1];
                working = working.slice(0, endNumberMatch.index).trim();
            }
        }
    }

    // 6. 若未通过 @ 语法识别到日期，尝试复用传统自然语言中文日期解析（如 "明天交水费"）
    if (!dueDate) {
        const natural = parseNaturalDate(working, today);
        if (natural) {
            dueDate = natural.date;
            working = natural.rest;
        }
    }

    // 7. 收敛剩余空白获得干净的标题
    const cleanTitle = working.replace(/\s+/g, " ").trim();

    return {
        cleanTitle,
        raw,
        dueDate,
        dateToken,
        priority,
        priorityToken,
        category,
        categoryToken,
        cycle,
        cycleToken,
        recurrenceAnchor,
        amount,
        amountToken,
    };
}
