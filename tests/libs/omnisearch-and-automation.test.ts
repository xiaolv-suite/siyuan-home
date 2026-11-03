import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvOmnisearch, lvAutomation } from "@/libs/notice";

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
});
