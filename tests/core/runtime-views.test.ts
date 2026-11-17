import { describe, it, expect } from "vitest";
import {
    saveNamedView,
    removeNamedView,
    applyNamedView,
    setReminderPlanDate,
    clearReminderPlanDate,
    getReminderPlanStatus,
    toggleReminderPinInRuntime,
    isReminderPinned,
    batchPushRemindersToTodayPlan,
} from "@/core/hub/runtime-views";
import { defaultRuntime } from "@/core/hub/runtime";

describe("runtime-views (提醒命名视图、计划排期与置顶状态引擎)", () => {
    it("命名视图保存、修改与删除", () => {
        const rt = defaultRuntime();
        const saved = saveNamedView(rt, {
            name: "近期待办",
            filter: "soon",
            dueWithin: "7",
        });

        expect(saved.id).toBeDefined();
        expect(rt.namedViews).toHaveLength(1);
        expect(rt.activeNamedViewId).toBe(saved.id);

        // 修改同名/同 ID 视图
        saveNamedView(rt, {
            id: saved.id,
            name: "紧急待办",
            filter: "overdue",
        });
        expect(rt.namedViews).toHaveLength(1);
        expect(rt.namedViews?.[0]?.name).toBe("紧急待办");

        // 应用视图
        applyNamedView(rt, rt.namedViews![0]);
        expect(rt.hubFilter).toBe("overdue");
        expect(rt.activeNamedViewId).toBe(saved.id);

        // 删除视图
        const removed = removeNamedView(rt, saved.id);
        expect(removed).toBe(true);
        expect(rt.namedViews).toHaveLength(0);
        expect(rt.activeNamedViewId).toBeUndefined();
    });

    it("双日期计划状态解析与偏离度计算", () => {
        const today = "2026-10-29";
        const dueDate = "2026-11-05";

        // 无计划日期
        const noPlan = getReminderPlanStatus(today, dueDate);
        expect(noPlan.hasPlan).toBe(false);
        expect(noPlan.isOverdueDeadline).toBe(false);

        // 计划日期在未来
        const futurePlan = getReminderPlanStatus(today, dueDate, "2026-10-31");
        expect(futurePlan.hasPlan).toBe(true);
        expect(futurePlan.planDaysDiff).toBe(2);
        expect(futurePlan.isPlannedNow).toBe(false);

        // 计划日期在今天（应专注处理）
        const todayPlan = getReminderPlanStatus(today, dueDate, "2026-10-29");
        expect(todayPlan.hasPlan).toBe(true);
        expect(todayPlan.isPlannedNow).toBe(true);

        // 截止日逾期
        const overdue = getReminderPlanStatus("2026-11-10", dueDate, "2026-11-02");
        expect(overdue.isOverdueDeadline).toBe(true);
    });

    it("计划处理日设置、清除与批量推进今日计划", () => {
        const rt = defaultRuntime();
        setReminderPlanDate(rt, "rem-1", "2026-10-29");
        expect(rt.planDates?.["rem-1"]).toBe("2026-10-29");

        clearReminderPlanDate(rt, "rem-1");
        expect(rt.planDates?.["rem-1"]).toBeUndefined();

        // 批量推进到今日
        const count = batchPushRemindersToTodayPlan(rt, ["rem-a", "rem-b"], "2026-10-29");
        expect(count).toBe(2);
        expect(rt.planDates?.["rem-a"]).toBe("2026-10-29");
        expect(rt.planDates?.["rem-b"]).toBe("2026-10-29");
    });

    it("提醒通用置顶状态切换与判定", () => {
        const rt = defaultRuntime();
        expect(isReminderPinned(rt, { id: "rem-1" })).toBe(false);

        // 切换置顶
        const isPinned = toggleReminderPinInRuntime(rt, "rem-1");
        expect(isPinned).toBe(true);
        expect(isReminderPinned(rt, { id: "rem-1" })).toBe(true);

        // 再次切换取消置顶
        const unpinned = toggleReminderPinInRuntime(rt, "rem-1");
        expect(unpinned).toBe(false);
        expect(isReminderPinned(rt, { id: "rem-1" })).toBe(false);

        // 兼容旧版 adhoc:: 前缀备忘置顶
        rt.pinnedMemoIds = ["memo-123"];
        expect(isReminderPinned(rt, { id: "adhoc::memo-123" })).toBe(true);
    });
});
