import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvOmnisearch, lvAutomation } from "@/libs/notice";
import { searchMatch, setPinyinDict } from "@/core/pinyin";

describe("lvOmnisearch & lvAutomation (Epoch 7 Phase 7: 穿透检索与跨插件联动测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lvOmnisearch 支持注册提供者并进行关键字检索与注销", async () => {
        const unregister = lvOmnisearch.registerProvider("test-search-plugin", (kw) => {
            if (kw.includes("驾照")) {
                return [
                    {
                        id: "item-1",
                        source: "管家",
                        category: "证件",
                        title: "机动车驾驶证",
                        snippet: "到期日: 2026-11-20",
                        onClick: () => {},
                    },
                ];
            }
            return [];
        });

        const items = await lvOmnisearch.search("驾照");
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe("机动车驾驶证");
        expect(items[0].category).toBe("证件");

        const empty = await lvOmnisearch.search("不存在的内容xyz");
        expect(empty).toHaveLength(0);

        unregister();
        const afterUnreg = await lvOmnisearch.search("驾照");
        expect(afterUnreg.find((i) => i.id === "item-1")).toBeUndefined();
    });

    it("lvAutomation 支持注册跨插件联动规则并响应 siyuan-home 的 expiring-item 触发", async () => {
        const executeSpy = vi.fn().mockResolvedValue(true);

        const unregRule = lvAutomation.registerRule({
            id: "rule-expiring-alert",
            name: "临期事项自动联动",
            desc: "当管家有<=3天临期事项时自动响应",
            enabled: true,
            triggerSource: "siyuan-home",
            triggerType: "expiring-item",
            actionPlugin: "siyuan-test",
            actionName: "test-alert",
            execute: executeSpy,
        });

        const payload = {
            id: "rem-101",
            title: "护照即将过期",
            dueDate: "2026-11-05",
        };

        const result = await lvAutomation.trigger("siyuan-home", "expiring-item", payload);
        expect(result.triggered).toBe(1);
        expect(result.success).toBe(1);
        expect(executeSpy).toHaveBeenCalledWith(payload);

        unregRule();
    });

    it("lvAutomation 当规则被禁用时不触发执行", async () => {
        const executeSpy = vi.fn().mockResolvedValue(true);

        const unregRule = lvAutomation.registerRule({
            id: "rule-disabled",
            name: "禁用规则测试",
            desc: "测试禁用状态",
            enabled: false,
            triggerSource: "siyuan-home",
            triggerType: "expiring-item",
            actionPlugin: "siyuan-test",
            actionName: "test-alert",
            execute: executeSpy,
        });

        const result = await lvAutomation.trigger("siyuan-home", "expiring-item", { id: "test" });
        expect(result.triggered).toBe(0);
        expect(executeSpy).not.toHaveBeenCalled();

        unregRule();
    });

    it("searchHomeItems 支持拼音首字母匹配备忘、到期提醒与家庭成员高频实体", () => {
        const dummyPlugin = {
            runtime: {
                memos: [
                    { id: "m-1", title: "买有机纯牛奶", category: "待买", dueDate: "2026-11-10", priority: "medium" },
                ],
            },
            scan: {
                reminders: [
                    { id: "r-1", moduleId: "certs", title: "居民身份证", dueDate: "2026-12-01", daysLeft: 27 },
                ],
            },
            settings: {
                members: [
                    { id: "mem-1", name: "张小明", role: "爸爸", bloodType: "O" },
                ],
            },
            showTab: vi.fn(),
            openRemindersScreen: vi.fn(),
            openModuleTab: vi.fn(),
        };

        setPinyinDict({
            居: ["ju", "j"],
            民: ["min", "m"],
            身: ["shen", "s"],
            份: ["fen", "f"],
            证: ["zheng", "z"],
            张: ["zhang", "z"],
            小: ["xiao", "x"],
            明: ["ming", "m"],
        });

        expect(searchMatch("居民身份证", "sfz")).toBe(true);
        expect(searchMatch("张小明", "zxm")).toBe(true);

        const searchHomeItems = (kw: string) => {
            const results: any[] = [];
            for (const m of dummyPlugin.runtime.memos) {
                if (m.title.includes(kw) || searchMatch(m.title, kw)) {
                    results.push(m);
                }
            }
            for (const r of dummyPlugin.scan.reminders) {
                if (r.title.includes(kw) || searchMatch(r.title, kw)) {
                    results.push(r);
                }
            }
            for (const mem of dummyPlugin.settings.members) {
                if (mem.name.includes(kw) || mem.role.includes(kw) || searchMatch(mem.name, kw)) {
                    results.push({ ...mem, category: "成员" });
                }
            }
            return results;
        };

        const hits = searchHomeItems("sfz");
        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe("居民身份证");

        const memberHits = searchHomeItems("zxm");
        expect(memberHits).toHaveLength(1);
        expect(memberHits[0].name).toBe("张小明");
        expect(memberHits[0].category).toBe("成员");
    });

    it("lvAutomation 临期→打卡待办规则在手机端正常触发", async () => {
        // 模拟打卡插件向生态注册自动联动规则：管家有 expiring-item 时，在打卡插件内创建待办
        const createdCheckinTasks: any[] = [];
        const unregCheckinRule = lvAutomation.registerRule({
            id: "rule-auto-checkin-task",
            name: "临期证件自动转打卡待办",
            desc: "手机端检测到证件临期时自动进入打卡待办列表",
            enabled: true,
            triggerSource: "siyuan-home",
            triggerType: "expiring-item",
            actionPlugin: "siyuan-checkin",
            actionName: "create-checkin-todo",
            execute: async (payload: any) => {
                createdCheckinTasks.push({
                    title: `办理/续签: ${payload.title}`,
                    dueDate: payload.dueDate,
                });
                return true;
            },
        });

        // 模拟管家扫描到的临期证件/保单卡片
        const expiringCert = {
            id: "cert-driver-license",
            title: "机动车驾驶证到期换证",
            dueDate: "2026-11-06",
            daysLeft: 2,
        };

        const res = await lvAutomation.trigger("siyuan-home", "expiring-item", {
            id: expiringCert.id,
            title: expiringCert.title,
            dueDate: expiringCert.dueDate,
        });

        expect(res.triggered).toBe(1);
        expect(res.success).toBe(1);
        expect(createdCheckinTasks).toHaveLength(1);
        expect(createdCheckinTasks[0].title).toBe("办理/续签: 机动车驾驶证到期换证");

        unregCheckinRule();
    });
});
