import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    deliverPriorityReminderCard,
    filterPriorityReminders,
    formatPriorityItemLine,
    PRIORITY_CATEGORY,
} from "@/core/hub/priority-reminder-delivery";
import { lvNotify } from "@/libs/lv-notice-kit";
import type { Reminder, HomeSettings } from "@/types";
import type { HubRuntime } from "@/core/hub/runtime";

describe("priority-reminder-delivery (重点到期卡片化通知引擎)", () => {
    const t = (k: string) => {
        const dict: Record<string, string> = {
            "module.certs": "证件",
            "module.insurance": "保单",
            "module.medicine": "药品",
            "module.contracts": "合同",
        };
        return dict[k] ?? k;
    };

    const mockSettings = {
        enabledModules: ["certs", "insurance", "medicine"],
        silentFrom: 22,
        silentTo: 8,
    } as unknown as HomeSettings;

    const mockRuntime = {
        planDates: {},
    } as unknown as HubRuntime;

    const mockReminders: Reminder[] = [
        {
            id: "rem-1",
            moduleId: "certs",
            ruleKey: "expiry",
            rowId: "row-1",
            title: "居民身份证",
            dueDate: "2026-11-05",
            daysLeft: 2,
            level: "soon",
        },
        {
            id: "rem-2",
            moduleId: "insurance",
            ruleKey: "expiry",
            rowId: "row-2",
            title: "百万医疗险",
            dueDate: "2026-11-02",
            daysLeft: -1,
            level: "overdue",
        },
        {
            id: "rem-3",
            moduleId: "medicine",
            ruleKey: "expiry",
            rowId: "row-3",
            title: "布洛芬缓释胶囊",
            dueDate: "2026-11-10",
            daysLeft: 7,
            level: "soon",
        },
        {
            id: "rem-4",
            moduleId: "certs",
            ruleKey: "expiry",
            rowId: "row-4",
            title: "护照（远期）",
            dueDate: "2027-11-03",
            daysLeft: 365,
            level: "later",
        },
        {
            id: "rem-5",
            moduleId: "other_non_priority",
            ruleKey: "oneoff",
            rowId: "row-5",
            title: "非核心模块条目",
            dueDate: "2026-11-04",
            daysLeft: 1,
            level: "soon",
        },
    ];

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("精准筛选出证件、保单、药品等处于逾期或7天临期内的重点条目并升序排列", () => {
        const filtered = filterPriorityReminders(mockReminders);
        expect(filtered.length).toBe(3);
        expect(filtered[0].title).toBe("百万医疗险"); // daysLeft: -1
        expect(filtered[1].title).toBe("居民身份证"); // daysLeft: 2
        expect(filtered[2].title).toBe("布洛芬缓释胶囊"); // daysLeft: 7
    });

    it("正确格式化单条重点事项的文本行", () => {
        const overdueLine = formatPriorityItemLine(mockReminders[1], t);
        expect(overdueLine).toContain("·【保单】百万医疗险");
        expect(overdueLine).toContain("已逾期 1 天");

        const soonLine = formatPriorityItemLine(mockReminders[0], t);
        expect(soonLine).toContain("·【证件】居民身份证");
        expect(soonLine).toContain("还剩 2 天到期");
    });

    it("成功派发卡片并提供去处理、稍后提醒与今日跳过动作", () => {
        const cardSpy = vi.spyOn(lvNotify, "card").mockReturnValue("card-123");
        vi.spyOn(lvNotify, "isMutedToday").mockReturnValue(false);

        const openReminders = vi.fn();
        const daytime = new Date("2026-11-03T10:00:00Z");

        const res = deliverPriorityReminderCard(
            {
                reminders: mockReminders,
                settings: mockSettings,
                runtime: mockRuntime,
                t,
                onOpenReminders: openReminders,
            },
            daytime,
        );

        expect(res.delivered).toBe(true);
        expect(res.cardId).toBe("card-123");
        expect(res.itemCount).toBe(3);
        expect(cardSpy).toHaveBeenCalledTimes(1);

        const callArg = cardSpy.mock.calls[0][0];
        expect(callArg.source).toBe("小驴管家");
        expect(callArg.category).toBe(PRIORITY_CATEGORY);
        expect(callArg.level).toBe("error"); // 因为含有 overdue 事项
        expect(callArg.actions?.length).toBe(3);
        expect(callArg.actions?.[0].label).toBe("去处理");
        expect(callArg.actions?.[1].label).toBe("稍后提醒");
        expect(callArg.actions?.[2].label).toBe("今日跳过");

        // 模拟点击【去处理】
        callArg.actions?.[0].onClick?.();
        expect(openReminders).toHaveBeenCalledTimes(1);
    });

    it("当今日已被免打扰时，静默跳过派发", () => {
        vi.spyOn(lvNotify, "isMutedToday").mockReturnValue(true);
        const cardSpy = vi.spyOn(lvNotify, "card");

        const res = deliverPriorityReminderCard({
            reminders: mockReminders,
            settings: mockSettings,
            runtime: mockRuntime,
            t,
            onOpenReminders: vi.fn(),
        });

        expect(res.delivered).toBe(false);
        expect(res.reason).toBe("muted_today");
        expect(cardSpy).not.toHaveBeenCalled();
    });

    it("当处于静默时段时，静默跳过派发", () => {
        vi.spyOn(lvNotify, "isMutedToday").mockReturnValue(false);
        const cardSpy = vi.spyOn(lvNotify, "card");

        const nightTime = new Date();
        nightTime.setHours(23, 30, 0);

        const res = deliverPriorityReminderCard(
            {
                reminders: mockReminders,
                settings: mockSettings,
                runtime: mockRuntime,
                t,
                onOpenReminders: vi.fn(),
            },
            nightTime,
        );

        expect(res.delivered).toBe(false);
        expect(res.reason).toBe("in_silent_hours");
        expect(cardSpy).not.toHaveBeenCalled();
    });

    it("当没有重点临期/逾期事项时，不触发派发", () => {
        vi.spyOn(lvNotify, "isMutedToday").mockReturnValue(false);
        const cardSpy = vi.spyOn(lvNotify, "card");
        const daytime = new Date("2026-11-03T10:00:00Z");

        const res = deliverPriorityReminderCard(
            {
                reminders: [mockReminders[3]], // 只有 365 天后的护照
                settings: mockSettings,
                runtime: mockRuntime,
                t,
                onOpenReminders: vi.fn(),
            },
            daytime,
        );

        expect(res.delivered).toBe(false);
        expect(res.reason).toBe("no_priority_items");
        expect(cardSpy).not.toHaveBeenCalled();
    });
});
