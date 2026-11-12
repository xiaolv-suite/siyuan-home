import { describe, it, expect, vi } from "vitest";
import { openTriageToLedgerDialog } from "@/core/triage-to-ledger";
import type { Reminder } from "@/types";

describe("triage-to-ledger (收件箱备忘归档与转正式台账引擎)", () => {
    const mockReminder: Reminder = {
        id: "adhoc::row-adhoc-1::due",
        moduleId: "adhoc",
        ruleKey: "due",
        rowId: "row-adhoc-1",
        title: "办理港澳通行证签注",
        dueDate: "2026-11-20",
        daysLeft: 23,
        level: "soon",
    };

    const mockPlugin = {
        settings: {
            enabledModules: ["certs", "shopping"],
            dbRefs: {
                certs: { avId: "av-certs-1", columns: { name: "c_name", expiry: "c_exp" } },
            },
            members: [{ id: "m-1", name: "本人", avItemId: "av-m-1" }],
        },
        schemaCatalog: {
            certs: {
                columns: [
                    { key: "name", type: "text" },
                    { key: "expiry", type: "date" },
                ],
                reminders: [{ field: "expiry" }],
            },
        },
        complete: vi.fn().mockResolvedValue(undefined),
        refreshHub: vi.fn().mockResolvedValue(undefined),
    };

    class MockDialog {
        element = {
            querySelector: vi.fn().mockReturnValue({
                append: vi.fn(),
                addEventListener: vi.fn(),
                onclick: vi.fn(),
                focus: vi.fn(),
                value: "certs",
            }),
            querySelectorAll: vi.fn().mockReturnValue([]),
        };
        destroy = vi.fn();
    }

    it("非浏览器环境（document === undefined）优雅跳过", () => {
        expect(() => {
            openTriageToLedgerDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("在具备 document 环境下正确构造归档转台账对话框", () => {
        const createMockEl = () => ({
            style: {},
            className: "",
            textContent: "",
            value: "",
            append: vi.fn(),
            addEventListener: vi.fn(),
            setAttribute: vi.fn(),
            focus: vi.fn(),
            querySelector: vi.fn(),
        });

        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation(() => createMockEl()),
        };

        try {
            const showMessageFn = vi.fn();
            openTriageToLedgerDialog({
                r: mockReminder,
                plugin: mockPlugin,
                DialogCls: MockDialog,
                t: (k) => k,
                showMessageFn,
            });
            expect(document.createElement).toHaveBeenCalled();
        } finally {
            delete (globalThis as any).document;
        }
    });
});
