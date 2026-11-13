/**
 * 家庭周期性支出趋势与异常波动监测（§16/§17 305波）：
 * 依据台账行记录（月份 + 金额 + 分类），按月汇总并计算环比/同比，
 * 识别支出突增异常（对比历史中位数）与全年预测，帮助家庭保持开支健康。
 * 纯函数，100% 可单元测试。
 */

export interface ExpenseEntry {
    /** YYYY-MM 或 YYYY-MM-DD */
    date: string;
    amount: number;
    category?: string;
}

export interface MonthlyExpense {
    month: string;
    total: number;
    count: number;
}

export interface ExpenseSpike {
    month: string;
    total: number;
    baseline: number;
    /** 超出基线的百分比（正数表示突增） */
    overflowPct: number;
}

export interface ExpenseTrendReport {
    months: MonthlyExpense[];
    /** 最近一个月的环比变化百分比；无上期时为 null */
    latestMoM: number | null;
    /** 全部月份均值 */
    average: number;
    /** 中位数（用于异常检测基线） */
    median: number;
    /** 全期总和 */
    totalAll: number;
    /** 基于最近 3 个月均值的全年预测 */
    yearlyForecast: number;
    spikes: ExpenseSpike[];
}

/** 从日期字符串中提取 YYYY-MM */
export function toMonthKey(date: string): string {
    const m = /^(\d{4})-(\d{1,2})/.exec((date ?? "").trim());
    if (!m) return "";
    return `${m[1]}-${m[2].padStart(2, "0")}`;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * 按月汇总支出并计算趋势指标
 */
export function calculateExpenseTrend(
    entries: ExpenseEntry[],
    options: { monthsWindow?: number; spikeThresholdPct?: number } = {},
): ExpenseTrendReport {
    const { monthsWindow = 12, spikeThresholdPct = 50 } = options;

    const bucket = new Map<string, MonthlyExpense>();
    for (const e of entries ?? []) {
        if (!e) continue;
        const month = toMonthKey(e.date);
        const amount = Number(e.amount);
        if (!month || !Number.isFinite(amount) || amount <= 0) continue;
        const cur = bucket.get(month);
        if (cur) {
            cur.total += amount;
            cur.count++;
        } else {
            bucket.set(month, { month, total: amount, count: 1 });
        }
    }

    const allMonths = Array.from(bucket.values())
        .map((m) => ({ ...m, total: round2(m.total) }))
        .sort((a, b) => a.month.localeCompare(b.month));

    const months = allMonths.slice(-Math.max(1, monthsWindow));

    const totals = months.map((m) => m.total);
    const totalAll = round2(totals.reduce((s, v) => s + v, 0));
    const average = totals.length > 0 ? round2(totalAll / totals.length) : 0;

    const sortedTotals = [...totals].sort((a, b) => a - b);
    let median = 0;
    if (sortedTotals.length > 0) {
        const mid = Math.floor(sortedTotals.length / 2);
        median =
            sortedTotals.length % 2 === 0
                ? round2((sortedTotals[mid - 1] + sortedTotals[mid]) / 2)
                : sortedTotals[mid];
    }

    let latestMoM: number | null = null;
    if (months.length >= 2) {
        const prev = months[months.length - 2].total;
        const latest = months[months.length - 1].total;
        if (prev > 0) latestMoM = round2(((latest - prev) / prev) * 100);
    }

    // 异常突增检测：以中位数为基线（避免自身拉高基线）
    const spikes: ExpenseSpike[] = [];
    if (median > 0 && months.length >= 3) {
        for (const m of months) {
            const overflowPct = round2(((m.total - median) / median) * 100);
            if (overflowPct >= spikeThresholdPct) {
                spikes.push({ month: m.month, total: m.total, baseline: median, overflowPct });
            }
        }
    }

    // 全年预测：最近 3 个月（不足则全部）均值 × 12
    const recent = months.slice(-3);
    const recentAvg =
        recent.length > 0 ? recent.reduce((s, m) => s + m.total, 0) / recent.length : 0;

    return {
        months,
        latestMoM,
        average,
        median,
        totalAll,
        yearlyForecast: round2(recentAvg * 12),
        spikes,
    };
}

export interface FixedVsVariableReport {
    fixedTotal: number;
    variableTotal: number;
    total: number;
    fixedPct: number;
    variablePct: number;
    fixedCount: number;
    variableCount: number;
}

const FIXED_CATEGORIES = new Set([
    "house_rent", "rent", "mortgage", "house_mortgage", "property", "management",
    "utility", "utilities", "broadband", "tuition", "school", "schooling",
    "insurance", "premium", "loan", "membership", "memberships", "subscription",
]);

/**
 * 分析支出结构中的固定支出（房租/房贷/保险/学费/订阅）与浮动开销（餐饮/日用/采买等）
 */
export function calculateFixedVsVariable(entries: ExpenseEntry[]): FixedVsVariableReport {
    let fixedTotal = 0;
    let variableTotal = 0;
    let fixedCount = 0;
    let variableCount = 0;

    for (const e of entries ?? []) {
        if (!e) continue;
        const amount = Number(e.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const cat = String(e.category ?? "").trim().toLowerCase();
        const isFixed = FIXED_CATEGORIES.has(cat) || /rent|mortgage|insurance|loan|tuition|房租|房贷|物业|保险|学费|订阅|会员|宽带/i.test(cat);
        if (isFixed) {
            fixedTotal += amount;
            fixedCount++;
        } else {
            variableTotal += amount;
            variableCount++;
        }
    }

    const total = round2(fixedTotal + variableTotal);
    fixedTotal = round2(fixedTotal);
    variableTotal = round2(variableTotal);
    const fixedPct = total > 0 ? Math.round((fixedTotal / total) * 100) : 0;
    const variablePct = total > 0 ? 100 - fixedPct : 0;

    return {
        fixedTotal,
        variableTotal,
        total,
        fixedPct,
        variablePct,
        fixedCount,
        variableCount,
    };
}

/**
 * 格式化支出趋势为可读文本（用于剪贴板/对话框）
 */
export function formatExpenseTrendReport(
    report: ExpenseTrendReport,
    unit = "元",
    fixedVsVar?: FixedVsVariableReport,
): string {
    if (report.months.length === 0) return "暂无可用支出记录。";

    const lines: string[] = [
        "📊 家庭支出趋势分析",
        `区间：${report.months[0].month} ~ ${report.months[report.months.length - 1].month}（共 ${report.months.length} 个月）`,
        `累计支出：${report.totalAll}${unit} · 月均：${report.average}${unit}`,
        `环比变化：${report.latestMoM === null ? "无法计算" : `${report.latestMoM > 0 ? "+" : ""}${report.latestMoM}%`}`,
        `年度预测：约 ${report.yearlyForecast}${unit}（按近 3 个月均值推算）`,
    ];

    if (fixedVsVar && fixedVsVar.total > 0) {
        lines.push(
            "",
            "⚖️ 支出结构（固定开支 vs 浮动开销）：",
            `  • 固定支出：${fixedVsVar.fixedTotal}${unit} (${fixedVsVar.fixedPct}%) — 房租/房贷/保险/学费/订阅等`,
            `  • 浮动支出：${fixedVsVar.variableTotal}${unit} (${fixedVsVar.variablePct}%) — 餐饮/买菜/日用/出行/耗材等`,
        );
    }

    lines.push(
        "",
        "明细：",
        ...report.months.map((m) => `  • ${m.month}：${m.total}${unit}（${m.count} 笔）`),
    );

    if (report.spikes.length > 0) {
        lines.push("", "⚠️ 异常突增月份：");
        for (const s of report.spikes) {
            lines.push(
                `  • ${s.month}：${s.total}${unit}，超出中位数基线 ${s.overflowPct}%`,
            );
        }
    } else {
        lines.push("", "🟢 未发现显著异常突增。");
    }

    return lines.join("\n");
}
