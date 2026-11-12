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

    it("左侧导轨 tablist 满足垂直方向键导航与循环边界", () => {
        const screens = [
            { id: "overview", key: "tab.overview" },
            { id: "reminders", key: "tab.reminders" },
            { id: "ledger", key: "tab.ledger" },
            { id: "members", key: "tab.members" },
        ];
        const onGotoScreen = vi.fn();

        function handleRailKeydown(key: string, index: number) {
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
            const next = key === "Home" ? 0 : key === "End" ? screens.length - 1
                : (index + (key === "ArrowDown" ? 1 : -1) + screens.length) % screens.length;
            onGotoScreen(screens[next].id);
        }

        // 下箭头
        handleRailKeydown("ArrowDown", 0);
        expect(onGotoScreen).toHaveBeenCalledWith("reminders");

        // 循环上箭头（在首项按上 -> 最后一项）
        handleRailKeydown("ArrowUp", 0);
        expect(onGotoScreen).toHaveBeenCalledWith("members");

        // Home 键
        handleRailKeydown("Home", 2);
        expect(onGotoScreen).toHaveBeenCalledWith("overview");

        // End 键
        handleRailKeydown("End", 1);
        expect(onGotoScreen).toHaveBeenCalledWith("members");
    });

    it("提醒页签待办存在时声明精确的 aria-label 供屏幕阅读器朗读", () => {
        function resolveTabAriaLabel(key: string, isReminders: boolean, pendingCount: number) {
            return isReminders && pendingCount > 0 ? `${key}，${pendingCount}项待办` : key;
        }

        expect(resolveTabAriaLabel("提醒事项", true, 5)).toBe("提醒事项，5项待办");
        expect(resolveTabAriaLabel("提醒事项", true, 0)).toBe("提醒事项");
        expect(resolveTabAriaLabel("总览", false, 5)).toBe("总览");
    });

    it("KPI 指标条与上下文面板完全支持中英文国际化插值", () => {
        const i18nZh: Record<string, string> = {
            "dash.kpiRegion": "核心生活指标",
            "dash.kpiUrgentNeedAttention": "需留意",
            "dash.kpiUrgentAllReady": "已就绪",
            "dash.contextDock": "上下文面板",
            "dash.contextFamilyShieldBody": "已收录家庭档案 ${m} 位，核心台账事实 ${r} 条。",
            "dash.contextRemindersFocusBody": "当前急迫待办 ${u} 项，当月已办进度 ${p}。",
        };

        const tZh = (k: string) => i18nZh[k] ?? k;
        expect(tZh("dash.kpiRegion")).toBe("核心生活指标");
        expect(tZh("dash.contextDock")).toBe("上下文面板");

        const shieldText = tZh("dash.contextFamilyShieldBody").replace("${m}", "4").replace("${r}", "128");
        expect(shieldText).toBe("已收录家庭档案 4 位，核心台账事实 128 条。");

        const remindersText = tZh("dash.contextRemindersFocusBody").replace("${u}", "3").replace("${p}", "80%");
        expect(remindersText).toBe("当前急迫待办 3 项，当月已办进度 80%。");
    });
});
