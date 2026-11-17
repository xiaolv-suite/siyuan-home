import { describe, it, expect, vi } from "vitest";
import { initEcosystemIntegration } from "@/core/ecosystem-integration";

describe("ecosystem-integration (小驴生态深度集成与雷切联动控制器)", () => {
    const mockPlugin = {
        settings: { enabledModules: ["certs", "members"] },
        runtime: {},
        scan: {
            reminders: [
                { id: "rem-1", level: "overdue", daysLeft: -3, title: "证件过期" },
                { id: "rem-2", level: "soon", daysLeft: 2, title: "疫苗接种" },
                { id: "rem-3", level: "lead", daysLeft: 20, title: "车险续约" },
            ],
            stale: false,
        },
        app: { plugins: [] },
    };

    it("初始化生态联动控制器并产出生命周期方法", () => {
        const ctrl = initEcosystemIntegration({
            plugin: mockPlugin,
            t: (k: string) => k,
            showTab: vi.fn(),
            openRemindersScreen: vi.fn(),
            openModuleTab: vi.fn(),
            addMemo: vi.fn().mockResolvedValue(undefined),
            complete: vi.fn().mockResolvedValue(undefined),
            markReminderDoneByBlockId: vi.fn().mockResolvedValue(true),
            emitHubChanged: vi.fn(),
        });

        expect(typeof ctrl.pullCheckinSummary).toBe("function");
        expect(typeof ctrl.buildHomeSummarySnapshot).toBe("function");
        expect(typeof ctrl.ensureSpeedSwitchActions).toBe("function");
        expect(typeof ctrl.dispose).toBe("function");

        // 验证家庭摘要快照生成格式 (EC17 雷切规范)
        const snapshot = ctrl.buildHomeSummarySnapshot();
        expect(snapshot.title).toBe("butler");
        expect(snapshot.sourceHealth).toBe("fresh");
        expect(snapshot.stat).toEqual({ value: "1", label: "hub.groupOverdue" }); // 1 项 daysLeft <= 0
        expect(Array.isArray(snapshot.items)).toBe(true);
        expect(snapshot.items).toHaveLength(2);

        // 安全注销
        expect(() => ctrl.dispose()).not.toThrow();
    });

    it("空提醒时家庭摘要快照降级为空态提示", () => {
        const emptyPlugin = {
            ...mockPlugin,
            scan: { reminders: [], stale: false },
        };
        const ctrl = initEcosystemIntegration({
            plugin: emptyPlugin,
            t: (k: string) => k,
            showTab: vi.fn(),
            openRemindersScreen: vi.fn(),
            openModuleTab: vi.fn(),
            addMemo: vi.fn().mockResolvedValue(undefined),
            complete: vi.fn().mockResolvedValue(undefined),
            markReminderDoneByBlockId: vi.fn().mockResolvedValue(true),
            emitHubChanged: vi.fn(),
        });

        const snapshot = ctrl.buildHomeSummarySnapshot();
        expect(snapshot.emptyHint).toBe("dash.allClear");
        expect(snapshot.stat).toEqual({ value: "0", label: "hub.groupOverdue" });

        ctrl.dispose();
    });
});
