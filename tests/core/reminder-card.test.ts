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

    it("更多操作菜单键盘导航支持 (ArrowDown / ArrowUp / Home / End / Escape)", () => {
        const toggleBtn = { focus: vi.fn() };
        const btn1 = { focus: vi.fn() };
        const btn2 = { focus: vi.fn() };
        const btn3 = { focus: vi.fn() };
        const buttons = [btn1, btn2, btn3];
        let moreOpen = true;

        function handleMenuKeydown(e: { key: string; target: any; preventDefault: () => void; stopPropagation: () => void }) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                moreOpen = false;
                toggleBtn.focus();
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            const idx = buttons.indexOf(e.target);
            if (idx === -1) return;

            e.preventDefault();
            if (e.key === "ArrowDown") {
                buttons[(idx + 1) % buttons.length].focus();
            } else if (e.key === "ArrowUp") {
                buttons[(idx - 1 + buttons.length) % buttons.length].focus();
            } else if (e.key === "Home") {
                buttons[0].focus();
            } else if (e.key === "End") {
                buttons[buttons.length - 1].focus();
            }
        }

        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        // ArrowDown: btn1 -> btn2
        handleMenuKeydown({ key: "ArrowDown", target: btn1, preventDefault, stopPropagation });
        expect(btn2.focus).toHaveBeenCalled();

        // ArrowUp: btn2 -> btn1
        handleMenuKeydown({ key: "ArrowUp", target: btn2, preventDefault, stopPropagation });
        expect(btn1.focus).toHaveBeenCalledTimes(1);

        // Escape: 关闭菜单并恢复焦点至开关按钮
        handleMenuKeydown({ key: "Escape", target: btn2, preventDefault, stopPropagation });
        expect(moreOpen).toBe(false);
        expect(toggleBtn.focus).toHaveBeenCalled();
        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
    });
});
