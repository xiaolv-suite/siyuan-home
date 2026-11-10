import { describe, it, expect, vi } from "vitest";
import {
    openReminderPlanDialog,
    openNamedViewSaveDialog,
    openNamedViewDeleteConfirm,
    openReminderRenewDialog,
    openMemoEditDialog,
    openSnoozeMenu,
    openTriageToLedgerDialog,
    openReminderDigestDialog,
    exportReminderIcs,
} from "@/core/reminder-dialogs";
import type { Reminder } from "@/types";

describe("reminder-dialogs (提醒中枢业务弹窗与动作分发中枢)", () => {
    const mockReminder: Reminder = {
        id: "certs::row-1::expiry",
        moduleId: "certs",
        ruleKey: "expiry",
        rowId: "row-1",
        title: "护照到期",
        dueDate: "2026-11-20",
        daysLeft: 23,
        level: "soon",
    };

    const mockPlugin = {
        runtime: {
            planDates: {} as Record<string, string>,
            namedViews: [],
        },
        saveRuntime: vi.fn().mockResolvedValue(undefined),
        refreshHub: vi.fn().mockResolvedValue(undefined),
        renew: vi.fn().mockResolvedValue(undefined),
        updateMemo: vi.fn().mockResolvedValue(undefined),
        snooze: vi.fn().mockResolvedValue(undefined),
    };

    class MockDialog {
        element = {
            querySelector: vi.fn().mockReturnValue({
                addEventListener: vi.fn(),
                onclick: vi.fn(),
                focus: vi.fn(),
                value: "2026-11-01",
            }),
            querySelectorAll: vi.fn().mockReturnValue([]),
        };
        destroy = vi.fn();
    }

    class MockMenu {
        addItem = vi.fn();
        open = vi.fn();
    }

    it("openReminderPlanDialog 安全调用不抛异常", () => {
        expect(() => {
            openReminderPlanDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openReminderPlanDialog 正确回显已有 planDates", () => {
        (globalThis as any).document = {};
        try {
            let capturedContent = "";
            class ContentCaptureDialog {
                element = {
                    querySelector: vi.fn().mockReturnValue({
                        addEventListener: vi.fn(),
                        onclick: vi.fn(),
                        value: "2026-11-05",
                    }),
                    querySelectorAll: vi.fn().mockReturnValue([]),
                };
                destroy = vi.fn();
                constructor(options: { content: string }) {
                    capturedContent = options.content;
                }
            }
            mockPlugin.runtime.planDates[mockReminder.id] = "2026-11-05";

            openReminderPlanDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: ContentCaptureDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });

            expect(capturedContent).toContain('value="2026-11-05"');
            expect(capturedContent).toContain('id="lv-plan-clear"');
        } finally {
            delete (globalThis as any).document;
        }
    });

    it("openNamedViewSaveDialog 安全调用不抛异常", () => {
        expect(() => {
            openNamedViewSaveDialog({
                plugin: mockPlugin,
                currentFilter: {
                    filter: "all",
                    dueWithin: "all",
                },
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openNamedViewDeleteConfirm 安全调用", () => {
        expect(() => {
            openNamedViewDeleteConfirm({
                v: {
                    id: "v-1",
                    name: "紧急视图",
                    filter: "urgent",
                    dueWithin: "7d",
                    createdAt: "2026-10-28",
                },
                plugin: mockPlugin,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openReminderRenewDialog 安全调用", () => {
        expect(() => {
            openReminderRenewDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
            });
        }).not.toThrow();
    });

    it("openMemoEditDialog 安全调用", () => {
        expect(() => {
            openMemoEditDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openSnoozeMenu 安全打开延后天数菜单", () => {
        expect(() => {
            openSnoozeMenu({
                r: mockReminder,
                ev: {
                    currentTarget: { getBoundingClientRect: () => ({ right: 100, bottom: 200 }) },
                    detail: 1,
                    clientX: 100,
                    clientY: 200,
                } as any,
                MenuCls: MockMenu,
                t: (k) => k,
                onSnooze: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openTriageToLedgerDialog 安全打开备忘转正式台账分诊弹窗", () => {
        expect(() => {
            openTriageToLedgerDialog({
                r: { ...mockReminder, id: "adhoc::m1", moduleId: "adhoc" },
                plugin: {
                    ...mockPlugin,
                    settings: {
                        enabledModules: ["certs", "vehicles"],
                        dbRefs: { certs: { avId: "av-certs" } },
                        members: [],
                    },
                },
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openReminderDigestDialog 安全打开提醒周报摘要弹窗", async () => {
        await expect(openReminderDigestDialog({
            filtered: [mockReminder],
            plugin: mockPlugin,
            DialogCls: MockDialog,
            t: (k) => k,
            showMessageFn: vi.fn(),
        })).resolves.not.toThrow();
    });

    it("exportReminderIcs 敏感类别提醒导出前提示确认", async () => {
        const confirmFn = vi.fn();
        const showMessageFn = vi.fn();

        await exportReminderIcs({
            list: [mockReminder], // certs 属于高后果敏感模块
            t: (k) => k === "hub.icsBody" ? "导出 ${n} 条提醒" : k,
            showMessageFn,
            confirmFn,
        });

        expect(confirmFn).toHaveBeenCalledWith(
            "hub.icsTitle",
            expect.stringContaining("1"),
            expect.any(Function),
        );
    });
});


