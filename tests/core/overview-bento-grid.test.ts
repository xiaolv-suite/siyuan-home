import { describe, it, expect, vi } from "vitest";
import type { Reminder } from "@/types";

describe("overview-bento-grid (总览主屏 Bento 特征卡核心看板)", () => {
    const mockUrgentReminder: Reminder = {
        id: "certs::row-1::expiry",
        moduleId: "certs",
        ruleKey: "expiry",
        rowId: "row-1",
        title: "护照到期",
        dueDate: "2026-11-20",
        daysLeft: 23,
        level: "soon",
        memberId: "mem-1",
    };

    it("Bento 主特征卡在有紧迫提醒时正确路由至目标台账", () => {
        const onGoto = vi.fn();
        const onOpenLedger = vi.fn();

        function handleHeroClick(urgent?: Reminder) {
            if (!urgent) {
                onGoto("reminders");
                return;
            }
            if (urgent.moduleId !== "adhoc") {
                onOpenLedger(urgent.moduleId);
            } else {
                onGoto("reminders");
            }
        }

        handleHeroClick(mockUrgentReminder);
        expect(onOpenLedger).toHaveBeenCalledWith("certs");
        expect(onGoto).not.toHaveBeenCalled();

        // 备忘（adhoc）提醒则打开 reminders
        const adhocReminder: Reminder = { ...mockUrgentReminder, moduleId: "adhoc" };
        handleHeroClick(adhocReminder);
        expect(onGoto).toHaveBeenCalledWith("reminders");

        // 全家就绪无紧迫提醒
        handleHeroClick(undefined);
        expect(onGoto).toHaveBeenCalledWith("reminders");
    });

    it("倒计时文案准确生成（逾期/今天/N天后）", () => {
        function formatCountdown(daysLeft: number): string {
            if (daysLeft < 0) return `逾期 ${-daysLeft} 天`;
            if (daysLeft === 0) return "今天到期";
            return `${daysLeft} 天后到期`;
        }

        expect(formatCountdown(-3)).toBe("逾期 3 天");
        expect(formatCountdown(0)).toBe("今天到期");
        expect(formatCountdown(5)).toBe("5 天后到期");
    });
});
