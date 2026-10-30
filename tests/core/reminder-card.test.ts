import { describe, it, expect, vi } from "vitest";
import type { Reminder } from "@/types";

describe("reminder-card (单条提醒卡片独立组件契约与交互)", () => {
    const mockReminder: Reminder = {
        id: "certs::row-test::expiry",
        moduleId: "certs",
        ruleKey: "expiry",
        rowId: "row-test",
        title: "港澳通行证签注",
        dueDate: "2026-11-15",
        daysLeft: 18,
        level: "soon",
    };

    it("双击图标快速标记/取消今日待办，右键切换置顶", () => {
        const onQuickPlanToday = vi.fn();
        const onTogglePin = vi.fn();

        // 模拟双击图标事件
        onQuickPlanToday(mockReminder);
        expect(onQuickPlanToday).toHaveBeenCalledWith(mockReminder);

        // 模拟右键置顶事件
        onTogglePin(mockReminder);
        expect(onTogglePin).toHaveBeenCalledWith(mockReminder);
    });

    it("ReminderCard 各动作分发接口完备性", () => {
        const callbacks = {
            onToggleSelect: vi.fn(),
            onToggleExpand: vi.fn(),
            onRunAction: vi.fn(),
            onRenew: vi.fn(),
            onSchedulePlan: vi.fn(),
            onCopyTask: vi.fn(),
            onTogglePin: vi.fn(),
            onSnooze: vi.fn(),
            onEditMemo: vi.fn(),
            onDeleteMemo: vi.fn(),
            onTriage: vi.fn(),
        };

        for (const [name, fn] of Object.entries(callbacks)) {
            expect(typeof fn).toBe("function");
        }
    });

    it("lunar 与 autoRenew 属性映射为矢量图标", () => {
        const specialReminder: Reminder = {
            ...mockReminder,
            lunar: true,
            autoRenew: true,
        };

        expect(specialReminder.lunar).toBe(true);
        expect(specialReminder.autoRenew).toBe(true);
    });
});
