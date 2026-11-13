import { describe, it, expect, vi } from "vitest";
import { openReminderDigestDialog, exportReminderIcs } from "@/core/reminder-exporter";
import type { Reminder } from "@/types";

describe("reminder-exporter (提醒中枢摘要周报与日历 ICS 导出引擎)", () => {
    const mockReminders: Reminder[] = [
        {
            id: "certs::row-1::expiry",
            moduleId: "certs",
            ruleKey: "expiry",
            rowId: "row-1",
            title: "护照到期",
            dueDate: "2026-11-20",
            daysLeft: 23,
            level: "soon",
        },
        {
            id: "shopping::row-2::restock",
            moduleId: "shopping",
            ruleKey: "restock",
            rowId: "row-2",
            title: "补货洗发水",
            dueDate: "2026-10-30",
            daysLeft: 2,
            level: "soon",
        },
    ];

    const mockPlugin = {
        runtime: {
            digestHistory: { overdue: 0, at: "2026-10-20" },
        },
        saveData: vi.fn().mockResolvedValue(undefined),
    };

    class MockDialog {
        element = {
            querySelector: vi.fn().mockReturnValue({
                textContent: "",
                onclick: vi.fn(),
            }),
            querySelectorAll: vi.fn().mockReturnValue([]),
        };
        destroy = vi.fn();
    }

    it("openReminderDigestDialog 优雅跳过非DOM环境并可在具备DOM时安全弹出", async () => {
        // 无 document
        await expect(openReminderDigestDialog({
            filtered: mockReminders,
            plugin: mockPlugin,
            DialogCls: MockDialog,
            t: (k) => k,
            showMessageFn: vi.fn(),
        })).resolves.not.toThrow();

        // 具备 document
        (globalThis as any).document = {
            createElement: vi.fn().mockReturnValue({}),
        };

        try {
            await expect(openReminderDigestDialog({
                filtered: mockReminders,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            })).resolves.not.toThrow();
        } finally {
            delete (globalThis as any).document;
        }
    });

    it("exportReminderIcs 在空列表时提示错误，敏感类别提示二次确认", async () => {
        const showMessageFn = vi.fn();
        const confirmFn = vi.fn();

        // 空列表
        await exportReminderIcs({
            list: [],
            t: (k) => k,
            showMessageFn,
            confirmFn,
        });
        expect(showMessageFn).toHaveBeenCalledWith("hub.icsEmpty", 3000, "error");

        // 包含敏感分类（certs）触发 confirmFn 二次确认
        await exportReminderIcs({
            list: mockReminders,
            t: (k) => k,
            showMessageFn,
            confirmFn,
        });
        expect(confirmFn).toHaveBeenCalled();
    });
});
