import { describe, it, expect } from "vitest";
import { calculateFixedVsVariable, formatExpenseTrendReport, calculateExpenseTrend } from "@/core/expense-trend";

describe("expense-fixed-variable (Phase 4.1: 家庭月度开销固定支出与浮动支出分类核算)", () => {
    it("准确分类固定支出（房租/保单/宽带/学费/订阅）与浮动开销（餐饮/采买/出行）", () => {
        const entries = [
            { date: "2026-10-01", amount: 4500, category: "house_rent" }, // 固定
            { date: "2026-10-05", amount: 1200, category: "insurance" },  // 固定
            { date: "2026-10-10", amount: 150, category: "membership" },  // 固定
            { date: "2026-10-12", amount: 320, category: "daily" },       // 浮动
            { date: "2026-10-15", amount: 480, category: "food" },        // 浮动
            { date: "2026-10-20", amount: 350, category: "fuel" },        // 浮动
        ];

        const report = calculateFixedVsVariable(entries);
        expect(report.fixedTotal).toBe(5850);
        expect(report.variableTotal).toBe(1150);
        expect(report.total).toBe(7000);
        expect(report.fixedPct).toBe(84); // 5850 / 7000 = 83.57% -> 84%
        expect(report.variablePct).toBe(16);
        expect(report.fixedCount).toBe(3);
        expect(report.variableCount).toBe(3);
    });

    it("空记录或零金额时安全返回 0", () => {
        const report = calculateFixedVsVariable([]);
        expect(report.total).toBe(0);
        expect(report.fixedTotal).toBe(0);
        expect(report.variableTotal).toBe(0);
        expect(report.fixedPct).toBe(0);
    });

    it("趋势分析文本报告包含固定与浮动开销结构对比", () => {
        const entries = [
            { date: "2026-08-01", amount: 3000, category: "rent" },
            { date: "2026-08-15", amount: 1000, category: "daily" },
        ];
        const trend = calculateExpenseTrend(entries);
        const fv = calculateFixedVsVariable(entries);
        const text = formatExpenseTrendReport(trend, "元", fv);

        expect(text).toContain("支出结构（固定开支 vs 浮动开销）");
        expect(text).toContain("固定支出：3000元 (75%)");
        expect(text).toContain("浮动支出：1000元 (25%)");
    });
});
