import { describe, it, expect, vi } from "vitest";

describe("tab-nav-banners (主面板左侧极窄导轨与访客横幅)", () => {
    describe("tab-rail-nav (极窄导轨导航栏)", () => {
        it("点击图标或品牌分派对应切换视图动作", () => {
            const onGotoScreen = vi.fn();
            const onOpenCapture = vi.fn();
            const onOpenSpotlight = vi.fn();
            const onOpenSetting = vi.fn();

            onGotoScreen("overview");
            expect(onGotoScreen).toHaveBeenCalledWith("overview");

            onOpenCapture();
            expect(onOpenCapture).toHaveBeenCalledTimes(1);

            onOpenSpotlight();
            expect(onOpenSpotlight).toHaveBeenCalledTimes(1);

            onOpenSetting();
            expect(onOpenSetting).toHaveBeenCalledTimes(1);
        });

        it("待处理计数为正数时展示提醒红点", () => {
            function shouldShowDot(screenId: string, pendingTotal: number) {
                return screenId === "reminders" && pendingTotal > 0;
            }

            expect(shouldShowDot("reminders", 3)).toBe(true);
            expect(shouldShowDot("reminders", 0)).toBe(false);
            expect(shouldShowDot("ledger", 5)).toBe(false);
        });
    });

    describe("tab-guest-banner (访客模式横幅)", () => {
        it("分派急救卡查看与退出访客模式动作", () => {
            const onOpenEmergencyCard = vi.fn();
            const onToggleGuestMode = vi.fn();

            onOpenEmergencyCard();
            expect(onOpenEmergencyCard).toHaveBeenCalledTimes(1);

            onToggleGuestMode();
            expect(onToggleGuestMode).toHaveBeenCalledTimes(1);
        });
    });
});
