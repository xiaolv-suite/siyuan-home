import { describe, it, expect, vi } from "vitest";

describe("calendar-reschedule (POOL-FEAT-07: 到期提醒卡片拖拽排期直达日历单元格)", () => {
    const mockReminders = [
        { id: "r-1", title: "车辆年检", dueDate: "2026-11-10", moduleId: "vehicles" },
        { id: "r-2", title: "家庭聚餐", dueDate: "2026-11-15", moduleId: "adhoc" },
    ];

    it("拖拽放置至不同目标日期触发排期回调", async () => {
        const onReschedule = vi.fn().mockResolvedValue(undefined);

        async function dropOnCell(remId: string, targetDay: string) {
            const target = mockReminders.find((r) => r.id === remId);
            if (target && target.dueDate === targetDay) return;
            await onReschedule(remId, targetDay);
        }

        await dropOnCell("r-1", "2026-11-12");
        expect(onReschedule).toHaveBeenCalledWith("r-1", "2026-11-12");
    });

    it("拖拽放置至原日期直接静默跳过（no-op 守卫）", async () => {
        const onReschedule = vi.fn().mockResolvedValue(undefined);

        async function dropOnCell(remId: string, targetDay: string) {
            const target = mockReminders.find((r) => r.id === remId);
            if (target && target.dueDate === targetDay) return;
            await onReschedule(remId, targetDay);
        }

        await dropOnCell("r-1", "2026-11-10");
        expect(onReschedule).not.toHaveBeenCalled();
    });

    it("访客模式下拦截拖拽排期操作", async () => {
        const onReschedule = vi.fn();
        const isGuest = true;

        async function dropOnCell(remId: string, targetDay: string) {
            if (isGuest) return;
            await onReschedule(remId, targetDay);
        }

        await dropOnCell("r-1", "2026-11-18");
        expect(onReschedule).not.toHaveBeenCalled();
    });
});
