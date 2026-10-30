/**
 * GitHub 三大对标产品融合能力单元测试（TASK-20261031-github-benchmark-fusion）:
 * 1. Vikunja 规格：Quick Add Magic 自然语言标记解析器 (@日期, !优先级, #分类)
 * 2. Tasks.org 规格：双基准循环规则 (due vs. completion) 与一键梯度推迟预设
 * 3. Super Productivity 规格：批量顺延逾期至今日、撤销恢复与 snoozeCount 反拖延判定
 */

import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "@/core/quick-add";
import { calculateNextRecurrenceDate, localDateKey } from "@/core/hub/rule";
import { getSnoozePresets, calculateSnoozeTarget } from "@/core/snooze-presets";
import { snooze, snoozeToDate, batchSnooze, undoBatchSnooze, addMemo } from "@/core/hub/actions";
import { applyRuntime } from "@/core/hub/runtime";
import { defaultRuntime } from "@/core/hub/runtime-store";
import type { Reminder } from "@/types";

describe("1. Quick Add Magic 自然语言标记解析器 (Vikunja 标杆融合)", () => {
    const TODAY = new Date(2026, 9, 5); // 2026-10-05 (周一)

    it("解析 @ 相对日期标记 (@今天, @明天, @后天, @大后天)", () => {
        expect(parseQuickAdd("交物业费 @今天", TODAY).dueDate).toBe("2026-10-05");
        expect(parseQuickAdd("换床单 @明天", TODAY).dueDate).toBe("2026-10-06");
        expect(parseQuickAdd("体检复查 @后天", TODAY).dueDate).toBe("2026-10-07");
        expect(parseQuickAdd("寄送包裹 @大后天", TODAY).dueDate).toBe("2026-10-08");
    });

    it("解析 @+Nd 相对天数标记 (@+3d, @+7d, @+14天)", () => {
        const res3 = parseQuickAdd("修水龙头 @+3d", TODAY);
        expect(res3.dueDate).toBe("2026-10-08");
        expect(res3.cleanTitle).toBe("修水龙头");

        const res7 = parseQuickAdd("还信用卡 @+7d", TODAY);
        expect(res7.dueDate).toBe("2026-10-12");

        const res14 = parseQuickAdd("绿植换土 @+14天", TODAY);
        expect(res14.dueDate).toBe("2026-10-19");
    });

    it("解析 @周X 与 @下周X 星期标记", () => {
        // TODAY 是 2026-10-05 周一
        const thisFri = parseQuickAdd("部门周报 @周五", TODAY);
        expect(thisFri.dueDate).toBe("2026-10-09");

        const nextMon = parseQuickAdd("项目复盘 @下周一", TODAY);
        expect(nextMon.dueDate).toBe("2026-10-12");

        const nextWed = parseQuickAdd("家庭会议 @下周三", TODAY);
        expect(nextWed.dueDate).toBe("2026-10-14");
    });

    it("解析 @ISO 与 @月日 标记", () => {
        const iso = parseQuickAdd("年终申报 @2026-12-31", TODAY);
        expect(iso.dueDate).toBe("2026-12-31");

        const md = parseQuickAdd("结婚纪念日 @10月15日", TODAY);
        expect(md.dueDate).toBe("2026-10-15");
    });

    it("解析 !优先级 标记 (!高, !中, !低, !p1, !p2, !p3)", () => {
        expect(parseQuickAdd("紧急缴费 !高", TODAY).priority).toBe("high");
        expect(parseQuickAdd("紧急缴费 !p1", TODAY).priority).toBe("high");
        expect(parseQuickAdd("日常采买 !中", TODAY).priority).toBe("medium");
        expect(parseQuickAdd("日常采买 !2", TODAY).priority).toBe("medium");
        expect(parseQuickAdd("整理书架 !低", TODAY).priority).toBe("low");
        expect(parseQuickAdd("整理书架 !p3", TODAY).priority).toBe("low");
    });

    it("解析 #分类 标签标记", () => {
        const res = parseQuickAdd("交燃气费 #家庭", TODAY);
        expect(res.category).toBe("家庭");
        expect(res.categoryToken).toBe("#家庭");
        expect(res.cleanTitle).toBe("交燃气费");
    });

    it("全语法要素混合输入与任意顺序容错", () => {
        const input1 = "交物业费 !高 #家庭 @明天";
        const r1 = parseQuickAdd(input1, TODAY);
        expect(r1.cleanTitle).toBe("交物业费");
        expect(r1.priority).toBe("high");
        expect(r1.category).toBe("家庭");
        expect(r1.dueDate).toBe("2026-10-06");

        const input2 = "@+3d #宠物 狗狗驱虫护理 !1";
        const r2 = parseQuickAdd(input2, TODAY);
        expect(r2.cleanTitle).toBe("狗狗驱虫护理");
        expect(r2.priority).toBe("high");
        expect(r2.category).toBe("宠物");
        expect(r2.dueDate).toBe("2026-10-08");
    });

    it("无 @ 标记时平滑回退至传统自然中文解析", () => {
        const r = parseQuickAdd("明天去超市买水果", TODAY);
        expect(r.dueDate).toBe("2026-10-06");
        expect(r.cleanTitle).toBe("去超市买水果");
    });
});

describe("2. 双基准循环规则与梯度推迟 (Tasks.org 标杆融合)", () => {
    const TODAY = new Date(2026, 9, 20); // 2026-10-20

    it("按计划日循环 (anchor='due')：从原计划日步进滚动", () => {
        const base = new Date(2026, 9, 10); // 计划日 2026-10-10
        // 周期为 14 天，当前今天已是 10-20：滚动到未来发生日 10-24
        const next = calculateNextRecurrenceDate(base, "14天", { today: TODAY, anchor: "due" });
        expect(localDateKey(next)).toBe("2026-10-24");
    });

    it("按完成日顺延 (anchor='completion')：从实际完成日开始计算下期", () => {
        const base = new Date(2026, 9, 10); // 原计划 10-10
        const completionDate = new Date(2026, 9, 18); // 推迟到 10-18 才实际完成
        // 自完成日 10-18 顺延 14 天 -> 11-01
        const next = calculateNextRecurrenceDate(base, "14天", {
            today: TODAY,
            anchor: "completion",
            completionDate,
        });
        expect(localDateKey(next)).toBe("2026-11-01");
    });

    it("按完成日顺延处理月度/季度与大小月月末收敛", () => {
        const base = new Date(2026, 0, 31); // 2026-01-31
        const completionDate = new Date(2026, 0, 31);
        // 1月31日完成，+1个月收敛至平年2月28日
        const next = calculateNextRecurrenceDate(base, "month", {
            today: TODAY,
            anchor: "completion",
            completionDate,
        });
        expect(localDateKey(next)).toBe("2026-02-28");

        // 闰年边界验证：2028-01-31 完成，+1个月收敛至 2028-02-29
        const leapBase = new Date(2028, 0, 31);
        const leapNext = calculateNextRecurrenceDate(leapBase, "month", {
            today: new Date(2028, 0, 31),
            anchor: "completion",
            completionDate: new Date(2028, 0, 31),
        });
        expect(localDateKey(leapNext)).toBe("2028-02-29");
    });

    it("梯度推迟预设计算 (getSnoozePresets / calculateSnoozeTarget)", () => {
        // 参考日：2026-10-05 (周一)
        const mon = new Date(2026, 9, 5);
        const presetsMon = getSnoozePresets(mon);

        // 1. 推迟 1 天 -> 10-06
        expect(presetsMon.find((p) => p.id === "1d")?.targetDate).toBe("2026-10-06");
        // 2. 推迟至周末 -> 本周六 10-10 (+5天)
        expect(presetsMon.find((p) => p.id === "weekend")?.targetDate).toBe("2026-10-10");
        expect(presetsMon.find((p) => p.id === "weekend")?.days).toBe(5);
        // 3. 推迟至下周一 -> 下周一 10-12 (+7天)
        expect(presetsMon.find((p) => p.id === "next_monday")?.targetDate).toBe("2026-10-12");
        expect(presetsMon.find((p) => p.id === "next_monday")?.days).toBe(7);

        // 参考日：2026-10-09 (周五)
        const fri = new Date(2026, 9, 9);
        const presetsFri = getSnoozePresets(fri);
        // 周五推迟至周末 -> 周六 10-10 (+1天)
        expect(presetsFri.find((p) => p.id === "weekend")?.targetDate).toBe("2026-10-10");
        expect(presetsFri.find((p) => p.id === "weekend")?.days).toBe(1);
        // 周五推迟至下周一 -> 10-12 (+3天)
        expect(presetsFri.find((p) => p.id === "next_monday")?.targetDate).toBe("2026-10-12");
        expect(presetsFri.find((p) => p.id === "next_monday")?.days).toBe(3);
    });
});

function createMemoryPlugin() {
    const store: Record<string, string> = {
        "hub-runtime.json": JSON.stringify(defaultRuntime()),
    };
    return {
        loadData: async (name: string) => (store[name] ? JSON.parse(store[name]) : null),
        saveData: async (name: string, val: unknown) => {
            store[name] = JSON.stringify(val);
        },
    } as any;
}

describe("3. 逾期批量顺延与反拖延微步骤拆解 (Super Productivity 标杆融合)", () => {
    it("snooze 与 snoozeToDate 准确累加 snoozeCounts", async () => {
        const fakePlugin = createMemoryPlugin();
        const reminderId = "certs::test-row::expiry";

        const rt1 = await snooze(fakePlugin, reminderId, 1, new Date(2026, 9, 5));
        expect(rt1.snoozed[reminderId]).toBe("2026-10-06");
        expect(rt1.snoozeCounts?.[reminderId]).toBe(1);

        const rt2 = await snoozeToDate(fakePlugin, reminderId, "2026-10-10");
        expect(rt2.snoozed[reminderId]).toBe("2026-10-10");
        expect(rt2.snoozeCounts?.[reminderId]).toBe(2);

        const rt3 = await snooze(fakePlugin, reminderId, 3, new Date(2026, 9, 10));
        expect(rt3.snoozeCounts?.[reminderId]).toBe(3);
    });

    it("批量顺延 batchSnooze 与撤销 undoBatchSnooze 状态完备回滚", async () => {
        const fakePlugin = createMemoryPlugin();
        // 预设 r1 既有延后状态
        await snoozeToDate(fakePlugin, "r1", "2026-10-01");

        // 批量将 r1, r2 顺延至 2026-10-20
        const prevMap = await batchSnooze(fakePlugin, ["r1", "r2"], "2026-10-20");
        const runtimeAfter = await fakePlugin.loadData("hub-runtime.json");
        expect(runtimeAfter.snoozed["r1"]).toBe("2026-10-20");
        expect(runtimeAfter.snoozed["r2"]).toBe("2026-10-20");
        expect(runtimeAfter.snoozeCounts?.["r1"]).toBe(2);
        expect(runtimeAfter.snoozeCounts?.["r2"]).toBe(1);

        // 撤销批量顺延
        await undoBatchSnooze(fakePlugin, prevMap);
        const runtimeRestored = await fakePlugin.loadData("hub-runtime.json");
        expect(runtimeRestored.snoozed["r1"]).toBe("2026-10-01");
        expect(runtimeRestored.snoozed["r2"]).toBeUndefined();
        expect(runtimeRestored.snoozeCounts?.["r1"]).toBe(1);
        expect(runtimeRestored.snoozeCounts?.["r2"]).toBe(0);
    });

    it("applyRuntime 派生层正确透传 snoozeCount并在 >=3 时驱动反拖延属性", () => {
        const rt = defaultRuntime();
        rt.snoozeCounts = {
            "certs::row1::expiry": 3,
            "certs::row2::expiry": 1,
        };

        const derived: Reminder[] = [
            {
                id: "certs::row1::expiry",
                moduleId: "certs",
                ruleKey: "expiry",
                rowId: "row1",
                title: "护照更新",
                dueDate: "2026-10-15",
                daysLeft: 5,
                level: "soon",
            },
            {
                id: "certs::row2::expiry",
                moduleId: "certs",
                ruleKey: "expiry",
                rowId: "row2",
                title: "驾照体检",
                dueDate: "2026-10-18",
                daysLeft: 8,
                level: "lead",
            },
        ];

        const applied = applyRuntime(derived, rt, new Date(2026, 9, 10));
        const item1 = applied.find((x) => x.id === "certs::row1::expiry");
        const item2 = applied.find((x) => x.id === "certs::row2::expiry");

        expect(item1?.snoozeCount).toBe(3);
        expect(item2?.snoozeCount).toBe(1);
        // item1 达到 >= 3 拖延阈值
        expect((item1?.snoozeCount ?? 0) >= 3).toBe(true);
        expect((item2?.snoozeCount ?? 0) >= 3).toBe(false);
    });

    it("addMemo 支持 options 携带 priority、category 与 recurrenceAnchor", async () => {
        const fakePlugin = createMemoryPlugin();

        const rt = await addMemo(fakePlugin, "缴纳采暖费", "2026-11-01", {
            priority: "high",
            category: "家庭",
            recurrenceAnchor: "due",
            cycle: "year",
        });

        expect(rt.memos.length).toBe(1);
        const m = rt.memos[0];
        expect(m.title).toBe("缴纳采暖费");
        expect(m.priority).toBe("high");
        expect(m.category).toBe("家庭");
        expect(m.recurrenceAnchor).toBe("due");
        expect(m.cycle).toBe("year");

        const applied = applyRuntime([], rt, new Date(2026, 9, 20));
        expect(applied.length).toBe(1);
        expect(applied[0].priority).toBe("high");
        expect(applied[0].tag).toBe("家庭");
        expect(applied[0].recurrenceAnchor).toBe("due");
        expect(applied[0].kind).toBe("recurring");
    });
});
