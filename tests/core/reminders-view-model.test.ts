import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getReminderRuleText,
    getReminderKindText,
    filterReminders,
    filterHandledEntries,
    sortPinnedFirst,
    computeReminderDisplayGroups,
    getReminderRuleSpec,
    getReminderStage,
    copyReminderAsTaskBlock,
    toggleReminderQuickPlanToday,
    formatFamilyNotice,
    copyReminderFamilyNotice,
} from "@/core/reminders-view-model";
import type { Reminder } from "@/types";
import type { HandledEntry } from "@/core/hub/runtime";

describe("reminders-view-model (提醒中枢视图模型与计算引擎)", () => {
    const t = (k: string) => {
        const dict: Record<string, string> = {
            "rule.expiry": "到期",
            "hub.kindRecurring": "周期",
            "hub.kindAnniversary": "周年",
            "hub.kindOneoff": "单次",
            "hub.kindAfter": "事后",
            "hub.groupOverdue": "已逾期",
            "hub.groupSoon": "临近到期",
            "hub.groupLead": "提前跟进",
            "stage.soon": "已临期",
            "hub.taskBlockCopied": "已复制任务块",
            "hub.planDateSaved": "已设为今日计划",
            "hub.planDateCleared": "已清除今日计划",
        };
        return dict[k] ?? k;
    };

    it("规则文本与类型标签解析", () => {
        expect(getReminderRuleText("expiry", t)).toBe("到期");
        expect(getReminderRuleText("unknown_rule", t)).toBe("unknown_rule");

        expect(getReminderKindText("recurring", t)).toBe("周期");
        expect(getReminderKindText("anniversary", t)).toBe("周年");
        expect(getReminderKindText("oneoff", t)).toBe("单次");
        expect(getReminderKindText("after", t)).toBe("事后");
        expect(getReminderKindText(undefined, t)).toBe("");
    });

    it("filterReminders 能按级别、成员、模块及时间窗口精确筛选", () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const todayStr = `${y}-${m}-${d}`;

        const items: Reminder[] = [
            { id: "1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "身份证", dueDate: "2026-01-01", daysLeft: -100, level: "overdue", memberId: "m1" },
            { id: "2", moduleId: "medicine", ruleKey: "exp", rowId: "r2", title: "感冒药", dueDate: todayStr, daysLeft: 0, level: "soon", memberId: "m2" },
            { id: "3", moduleId: "certs", ruleKey: "exp", rowId: "r3", title: "护照", dueDate: "2026-12-31", daysLeft: 60, level: "lead", memberId: "m1" },
        ];

        // 默认全选
        expect(filterReminders(items, "all")).toHaveLength(3);

        // 按级别
        expect(filterReminders(items, "overdue")).toHaveLength(1);
        expect(filterReminders(items, "soon")).toHaveLength(1);

        // 按成员
        expect(filterReminders(items, "all", "m1")).toHaveLength(2);

        // 按模块
        expect(filterReminders(items, "all", undefined, "medicine")).toHaveLength(1);

        // 按时间窗口（dueWithin: 0，今天及以前）
        const dueTodayOrEarlier = filterReminders(items, "all", undefined, undefined, "0");
        expect(dueTodayOrEarlier.map((r) => r.id)).toEqual(["1", "2"]);
    });

    it("filterHandledEntries 过滤已处理条目", () => {
        const handled: HandledEntry[] = [
            { id: "h1", title: "社保卡", moduleId: "certs", dueDate: "2026-05-01", kind: "done" },
            { id: "h2", title: "驾照", moduleId: "vehicles", dueDate: "2026-11-01", kind: "done" },
        ];
        const reminderById = new Map<string, Reminder>([
            ["h1", { id: "h1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "社保卡", dueDate: "2026-05-01", daysLeft: 10, level: "lead", memberId: "m1" }],
        ]);

        expect(filterHandledEntries(handled, reminderById, "m1")).toHaveLength(2); // h2 无法推断成员时保留条目避免漏显
        expect(filterHandledEntries(handled, reminderById, undefined, "certs")).toHaveLength(1);
    });

    it("sortPinnedFirst 与 computeReminderDisplayGroups 正确置顶与分组", () => {
        const isPinned = (r: Reminder) => r.id === "2";
        const items: Reminder[] = [
            { id: "1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "身份证", dueDate: "2026-01-01", daysLeft: -10, level: "overdue" },
            { id: "2", moduleId: "certs", ruleKey: "exp", rowId: "r2", title: "护照", dueDate: "2026-01-02", daysLeft: -5, level: "overdue" },
            { id: "3", moduleId: "medicine", ruleKey: "exp", rowId: "r3", title: "药品", dueDate: "2026-11-01", daysLeft: 5, level: "soon" },
        ];

        const sorted = sortPinnedFirst(items, isPinned);
        expect(sorted[0].id).toBe("2"); // 置顶项排前

        const groups = computeReminderDisplayGroups(items, "all", t, isPinned);
        expect(groups).toHaveLength(2);
        expect(groups[0].key).toBe("overdue");
        expect(groups[0].items[0].id).toBe("2"); // overdue 分组内置顶在前
        expect(groups[1].key).toBe("soon");
    });

    it("getReminderRuleSpec 与 getReminderStage 阶段推导", () => {
        const schemaCatalog = {
            certs: {
                reminders: [
                    { key: "exp", leadStages: [90, 30, 7], leadDays: 90 },
                ],
            },
        };
        const cache = new Map();
        const r: Reminder = {
            id: "1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "护照", dueDate: "2026-11-10", daysLeft: 20, level: "soon",
        };

        const spec = getReminderRuleSpec(schemaCatalog, cache, r);
        expect(spec.leadStages).toEqual([90, 30, 7]);
        expect(spec.leadDays).toBe(90);

        const stage = getReminderStage(schemaCatalog, cache, r, t);
        expect(stage).toBeDefined();
        expect(stage?.stages).toEqual([90, 30, 7]);
    });

    it("copyReminderAsTaskBlock 能生成任务块并写入剪贴板", async () => {
        let written = "";
        Object.defineProperty(navigator, "clipboard", {
            value: {
                writeText: vi.fn(async (txt: string) => { written = txt; }),
            },
            configurable: true,
        });
        const showMessage = vi.fn();
        const r: Reminder = {
            id: "1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "护照", dueDate: "2026-11-10", daysLeft: 20, level: "soon",
        };

        await copyReminderAsTaskBlock(r, t, showMessage);
        expect(written).toContain("- [ ] 护照 · certs");
        expect(written).toContain('custom-completion-time="2026-11-10"');
        expect(showMessage).toHaveBeenCalledWith("已复制任务块", 3000, "info");
    });

    it("toggleReminderQuickPlanToday 切换计划处理日", async () => {
        const mockPlugin = {
            runtime: {
                planDates: {},
            },
            saveData: vi.fn(),
            refreshHub: vi.fn(),
        };
        const showMessage = vi.fn();
        const r: Reminder = {
            id: "r1", moduleId: "certs", ruleKey: "exp", rowId: "r1", title: "护照", dueDate: "2026-11-10", daysLeft: 20, level: "soon",
        };

        await toggleReminderQuickPlanToday(r, mockPlugin, t, showMessage);
        expect(showMessage).toHaveBeenCalledWith("已设为今日计划", 2000, "info");
        expect(mockPlugin.refreshHub).toHaveBeenCalled();

        // 再次切换应清除
        await toggleReminderQuickPlanToday(r, mockPlugin, t, showMessage);
        expect(showMessage).toHaveBeenCalledWith("已清除今日计划", 2000, "info");

        // 异常分支回滚守护：保存失败时内存状态严格回滚
        const failingPlugin = {
            runtime: {
                planDates: { r1: "2026-10-30" },
            },
            saveData: vi.fn().mockRejectedValue(new Error("disk IO error")),
            refreshHub: vi.fn(),
        };
        await toggleReminderQuickPlanToday(r, failingPlugin, t, showMessage);
        expect(failingPlugin.runtime.planDates.r1).toBe("2026-10-30"); // 保持原值，不留脏数据
    });

    it("formatFamilyNotice 与 copyReminderFamilyNotice 格式化并复制家庭群通知 (CAND-24)", async () => {
        const r: Reminder = {
            id: "r-notice",
            moduleId: "certs",
            ruleKey: "exp",
            rowId: "r-row",
            title: "妈妈的护照换发",
            dueDate: "2026-11-20",
            daysLeft: 19,
            level: "soon",
            tag: "出国游",
        };

        const notice = formatFamilyNotice(r, { memberName: "妈妈", moduleName: "证件", note: "#出国游" });
        expect(notice).toContain("📢【家庭提醒 · 证件】");
        expect(notice).toContain("📌 事项：妈妈的护照换发");
        expect(notice).toContain("📅 截止：2026-11-20 （还剩 19 天）");
        expect(notice).toContain("👤 责任人：妈妈");
        expect(notice).toContain("📝 备注：#出国游");
        expect(notice).toContain("💡 来自小驴管家智能提醒");

        let written = "";
        Object.defineProperty(navigator, "clipboard", {
            value: {
                writeText: vi.fn(async (txt: string) => { written = txt; }),
            },
            configurable: true,
        });
        const showMessage = vi.fn();
        await copyReminderFamilyNotice(r, t, showMessage, { memberName: "妈妈" });
        expect(written).toContain("📢【家庭提醒 · certs】");
        expect(showMessage).toHaveBeenCalled();
    });
});
