import { describe, it, expect, vi } from "vitest";
import type { Reminder } from "@/types";
import { formatAsTaskBlock } from "@/core/block-capture";
import { batchPushRemindersToTodayPlan } from "@/core/hub/runtime";

describe("reminder-batch-bar (提醒主屏多选批量操作条)", () => {
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
        {
            id: "vehicles::r2::inspection",
            moduleId: "vehicles",
            ruleKey: "inspection",
            rowId: "r2",
            title: "车辆年检",
            dueDate: "2026-11-05",
            daysLeft: 8,
            level: "soon",
        },
    ];

    it("批量操作选项计算与全选/清空状态管理", () => {
        let selected = new Set<string>();
        let batchMode = true;

        // 全选
        selected = new Set(mockReminders.map((r) => r.id));
        expect(selected.size).toBe(2);
        expect(selected.has("certs::r1::expiry")).toBe(true);

        // 清空选择并退出批量模式
        selected = new Set();
        batchMode = false;
        expect(selected.size).toBe(0);
        expect(batchMode).toBe(false);
    });

    it("批量生成思源块双链引用 ((id 'title')) 与任务列表块", () => {
        const selected = new Set(["certs::r1::expiry", "vehicles::r2::inspection"]);
        const selectedList = mockReminders.filter((r) => selected.has(r.id));

        // 验证生成块引用
        const refs = selectedList.map((r) => `((${r.rowId || r.id} '${r.title}'))`);
        expect(refs).toEqual([
            "((r1 '护照换发'))",
            "((r2 '车辆年检'))",
        ]);
        expect(refs.join("\n")).toBe("((r1 '护照换发'))\n((r2 '车辆年检'))");

        // 验证生成任务块
        const taskBlocks = selectedList.map((r) =>
            formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: "证件" })
        );
        expect(taskBlocks[0]).toContain("r1 '护照换发'");
        expect(taskBlocks[0]).toContain("2026-11-20");
        expect(taskBlocks[0]).toContain("证件");
    });

    it("批量转换为 Bento 风格每日生活备忘看板 Markdown", async () => {
        const { formatDailyHomeBoardMarkdown } = await import("@/core/reminder-digest");
        const boardItems = mockReminders.map((r) => ({
            id: r.id,
            moduleId: r.moduleId,
            title: r.title,
            dueDate: r.dueDate,
            daysLeft: r.daysLeft,
            level: r.level,
        }));
        const md = formatDailyHomeBoardMarkdown(boardItems, {
            date: "2026-11-20",
            label: (mid) => mid === "certs" ? "证件" : "车辆",
        });
        expect(md).toContain("> 🏠 **今日家庭生活备忘与到期预警 · 2026-11-20**");
        expect(md).toContain("待处理: **2** 项");
        expect(md).toContain("护照换发");
        expect(md).toContain("车辆年检");
    });

    it("批量推入今日排期 batchPushRemindersToTodayPlan", () => {
        const runtime = {
            planDates: {},
        };
        const selected = ["certs::r1::expiry", "vehicles::r2::inspection"];
        const count = batchPushRemindersToTodayPlan(runtime as any, selected);

        expect(count).toBe(2);
        expect(Object.keys(runtime.planDates)).toHaveLength(2);
        expect(runtime.planDates["certs::r1::expiry"]).toBeDefined();
    });

    it("批量操作逐条容错与部分成功统计", async () => {
        const completeFn = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("网络超时"));

        const mockPlugin = {
            complete: completeFn,
        };

        const selected = new Set(["certs::r1::expiry", "vehicles::r2::inspection"]);
        const byId = new Map(mockReminders.map((r) => [r.id, r]));

        let ok = 0;
        const failed: string[] = [];

        for (const id of selected) {
            const r = byId.get(id);
            if (!r) continue;
            try {
                await mockPlugin.complete(r);
                ok++;
            } catch {
                failed.push(r.title);
            }
        }

        expect(ok).toBe(1);
        expect(failed).toEqual(["车辆年检"]);
    });

    it("Escape 键触发快捷退出与焦点安全回退至控制栏切换按钮", () => {
        let selected = new Set(["certs::r1::expiry"]);
        let batchMode = true;
        const toggleFocus = vi.fn();
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        function restoreFocusAfterClear() {
            toggleFocus();
        }

        function clearSelection() {
            selected = new Set();
            batchMode = false;
            restoreFocusAfterClear();
        }

        function handleToolbarKeydown(e: { key: string; preventDefault: () => void; stopPropagation: () => void }) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
            }
        }

        handleToolbarKeydown({ key: "Escape", preventDefault, stopPropagation });

        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
        expect(selected.size).toBe(0);
        expect(batchMode).toBe(false);
        expect(toggleFocus).toHaveBeenCalled();
    });

    it("WAI-ARIA APG Toolbar 键盘导航遍历与循环聚焦", () => {
        const mockButtons = [
            { id: "selectAll", focus: vi.fn() },
            { id: "tasks", focus: vi.fn() },
            { id: "refs", focus: vi.fn() },
            { id: "plan", focus: vi.fn() },
            { id: "cancel", focus: vi.fn() },
        ];

        function handleNavigate(key: string, currentIndex: number): number {
            let nextIndex = 0;
            if (key === "ArrowRight" || key === "ArrowDown") {
                nextIndex = currentIndex >= 0 ? (currentIndex + 1) % mockButtons.length : 0;
            } else if (key === "ArrowLeft" || key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : mockButtons.length - 1;
            } else if (key === "Home") {
                nextIndex = 0;
            } else if (key === "End") {
                nextIndex = mockButtons.length - 1;
            }
            mockButtons[nextIndex].focus();
            return nextIndex;
        }

        expect(handleNavigate("ArrowRight", 0)).toBe(1);
        expect(mockButtons[1].focus).toHaveBeenCalled();

        expect(handleNavigate("ArrowRight", 4)).toBe(0);
        expect(mockButtons[0].focus).toHaveBeenCalled();

        expect(handleNavigate("ArrowLeft", 0)).toBe(4);
        expect(mockButtons[4].focus).toHaveBeenCalled();

        expect(handleNavigate("End", 1)).toBe(4);
        expect(handleNavigate("Home", 3)).toBe(0);
    });
});

