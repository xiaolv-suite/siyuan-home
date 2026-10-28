import { describe, it, expect, vi } from "vitest";
import {
    openLifeIndexModal,
    openEmergencyCardModal,
    openYearlyShareCardModal,
    type OverviewModalContext,
} from "@/core/overview-modals";
import type { Reminder } from "@/types";

describe("overview-modals (总览主屏专业分析与成就报告模态框分发中枢)", () => {
    const mockReminders: Reminder[] = [
        {
            id: "certs::r1::expiry",
            moduleId: "certs",
            ruleKey: "expiry",
            rowId: "r1",
            title: "护照换发",
            dueDate: "2026-11-20",
            daysLeft: 23,
            level: "soon",
        },
    ];

    const makeCtx = (overrides?: Partial<OverviewModalContext>): OverviewModalContext => ({
        plugin: {
            settings: { dbRefs: {}, members: [] },
            schemaCatalog: {},
            runtime: {},
        },
        allReminders: mockReminders,
        t: (k: string) => k,
        DialogCls: class {
            destroy = vi.fn();
            element = {
                querySelector: vi.fn().mockReturnValue({ onclick: null, textContent: "" }),
            };
        },
        showMessageFn: vi.fn(),
        ...overrides,
    });

    it("openLifeIndexModal 安全执行不抛出未捕获异常", async () => {
        const ctx = makeCtx();
        await expect(openLifeIndexModal(ctx)).resolves.not.toThrow();
    });

    it("openEmergencyCardModal 安全执行不抛出未捕获异常", async () => {
        const ctx = makeCtx();
        await expect(openEmergencyCardModal(ctx)).resolves.not.toThrow();
    });

    it("openYearlyShareCardModal 安全执行不抛出未捕获异常", async () => {
        const ctx = makeCtx();
        await expect(openYearlyShareCardModal(ctx)).resolves.not.toThrow();
    });

    it("异常抛出时通过 showMessageFn 优雅提示", async () => {
        const showMessageFn = vi.fn();
        const ctx = makeCtx({
            plugin: null, // 触发异常
            showMessageFn,
        });

        await openLifeIndexModal(ctx);
        expect(showMessageFn).toHaveBeenCalledWith(
            expect.stringContaining("ledger.logReadFailed"),
            5000,
            "error",
        );
    });
});
