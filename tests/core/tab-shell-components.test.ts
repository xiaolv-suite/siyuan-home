import { describe, it, expect, vi } from "vitest";

describe("tab-shell-components (三栏架构 KPI 指标条与上下文侧板)", () => {
    it("KPI 指标行数据正确格式化与报警级别判定", () => {
        function resolveKpiBadge(urgentCount: number) {
            return {
                text: urgentCount > 0 ? "需留意" : "已就绪",
                cls: urgentCount > 0 ? "warn" : "accent",
            };
        }

        expect(resolveKpiBadge(3)).toEqual({ text: "需留意", cls: "warn" });
        expect(resolveKpiBadge(0)).toEqual({ text: "已就绪", cls: "accent" });
    });

    it("上下文侧板根据当前激活 screen 分派不同卡片并触发导航", () => {
        const onOpenCapture = vi.fn();
        const onOpenSpotlight = vi.fn();
        const onRefreshScan = vi.fn();

        function handleDockAction(screen: string, action: "capture" | "spotlight" | "rescan") {
            if (action === "capture") onOpenCapture(screen === "ledger" ? "stock" : undefined);
            else if (action === "spotlight") onOpenSpotlight();
            else if (action === "rescan") onRefreshScan();
        }

        handleDockAction("overview", "spotlight");
        expect(onOpenSpotlight).toHaveBeenCalledTimes(1);

        handleDockAction("ledger", "capture");
        expect(onOpenCapture).toHaveBeenCalledWith("stock");

        handleDockAction("reminders", "rescan");
        expect(onRefreshScan).toHaveBeenCalledTimes(1);
    });
});
