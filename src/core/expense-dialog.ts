/**
 * 支出趋势与分类预算限额分析对话框（315波，G6）：
 * 聚合台账历史支出、分析月度环比/年度预测、比对分类月度预算限额，
 * 集中展示趋势、异常突增与超限/预警指标。
 * 纯逻辑 + DOM 独立模块，按需动态加载以减轻页面体积。
 */

import { calculateExpenseTrend, formatExpenseTrendReport, calculateFixedVsVariable, type ExpenseEntry } from "./expense-trend";
import { evaluateBudgetUsage, formatBudgetLimitReport } from "./budget-limit";
import { uiIcon } from "@/ui/icons";
import { escapeHtml, openModalShell } from "./modal-shell";

export interface ExpenseDialogOptions {
    entries: ExpenseEntry[];
    budgetLimits?: Record<string, number>;
    t: (k: string) => string;
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
}

export function openExpenseTrendDialog(opts: ExpenseDialogOptions): void {
    const { entries, budgetLimits = {}, t, DialogCls, showMessageFn } = opts;

    const trendReport = calculateExpenseTrend(entries);
    const fixedVsVar = calculateFixedVsVariable(entries);
    const trendText = formatExpenseTrendReport(trendReport, "元", fixedVsVar);

    // 仅在已配置分类限额时附加预算简报，不再展示无配置入口的“暂未配置”空壳区块
    const hasBudgetLimits = Object.keys(budgetLimits).some((k) => Number(budgetLimits[k]) > 0);
    const catLabel = (c: string) => {
        const key = `field.category.opt.${c}`;
        const val = t(key);
        return val !== key ? val : c;
    };
    const fullReportText = hasBudgetLimits
        ? `${trendText}\n\n${formatBudgetLimitReport(evaluateBudgetUsage(entries, budgetLimits), catLabel)}`
        : trendText;

    const shell = openModalShell({
        DialogCls,
        title: t("ledger.expenseTrendTitle"),
        bodyId: "lv-expense-body",
        body: `<pre class="lv-report-pre">${escapeHtml(fullReportText)}</pre>`,
        width: "580px",
        actions: [
            { id: "close", label: escapeHtml(t("close")), kind: "cancel" },
            { id: "copy", label: `${uiIcon("copy", "", 13)} ${escapeHtml(t("ledger.copyExpenseReport") || "复制支出分析")}`, kind: "primary" },
        ],
    });
    const copyBtn = shell.button("copy");
    if (copyBtn) {
        copyBtn.onclick = () => void shell.runBusy("copy", async () => {
            try {
                await navigator.clipboard.writeText(fullReportText);
                showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
            }
        });
    }
}
