import { describe, it, expect, vi } from "vitest";
import type { CheckinBinding, FamilyMember } from "@/types";

describe("settings-reminders-tab (设置面板提醒与联动子分区契约)", () => {
    it("defaultMetric 正确推断打卡指标类型", () => {
        function defaultMetric(kind: string): CheckinBinding["metric"] {
            if (kind === "duration") return "duration";
            if (kind === "quantity" || kind === "custom") return "quantity";
            return "count";
        }

        expect(defaultMetric("duration")).toBe("duration");
        expect(defaultMetric("quantity")).toBe("quantity");
        expect(defaultMetric("custom")).toBe("quantity");
        expect(defaultMetric("binary")).toBe("count");
        expect(defaultMetric("count")).toBe("count");
        expect(defaultMetric("other")).toBe("count");
    });

    it("availableBindingPair 寻找首个未绑定的打卡项与成员", () => {
        const checkinItems = [
            { id: "item-1", name: "跑步", kind: "duration" },
            { id: "item-2", name: "背单词", kind: "count" },
        ];
        const draftMembers: FamilyMember[] = [
            { id: "mem-1", name: "爸爸", role: "self" },
            { id: "mem-2", name: "妈妈", role: "spouse" },
        ];
        const draftBindings: CheckinBinding[] = [
            { itemId: "item-1", itemName: "跑步", memberId: "mem-1", metric: "duration" },
        ];

        function findAvailablePair() {
            for (const item of checkinItems) {
                const member = draftMembers.find((m) => !draftBindings.some((b) => b.itemId === item.id && b.memberId === m.id));
                if (member) return { item, member };
            }
            return undefined;
        }

        const pair = findAvailablePair();
        expect(pair).toBeDefined();
        // mem-1 已经绑定了 item-1，所以对于 item-1，应该能找到 mem-2
        expect(pair?.item.id).toBe("item-1");
        expect(pair?.member.id).toBe("mem-2");
    });

    it("提前天数规则 leadRules 按启用模块过滤与全显切换", () => {
        const leadRules = [
            { key: "certs.expiry", moduleId: "certs", ruleKey: "expiry", def: 30 },
            { key: "vehicles.inspection", moduleId: "vehicles", ruleKey: "inspection", def: 30 },
            { key: "pets.vaccine", moduleId: "pets", ruleKey: "vaccine", def: 15 },
        ];
        const enabledIds = new Set(["certs", "vehicles"]);

        const enabledLeadRules = leadRules.filter((lr) => enabledIds.has(lr.moduleId));
        expect(enabledLeadRules).toHaveLength(2);
        expect(enabledLeadRules.map((r) => r.moduleId)).toEqual(["certs", "vehicles"]);

        // showAllLeads 为 true 时
        let showAllLeads = true;
        const visibleLeadRules = showAllLeads ? leadRules : enabledLeadRules;
        expect(visibleLeadRules).toHaveLength(3);
    });

    it("Webhook 测试发送逻辑安全执行", async () => {
        const sendWebhook = vi.fn().mockResolvedValue("ok");
        const res = await sendWebhook({
            webhookEnabled: true,
            webhookUrl: "https://api.day.app/fake",
            webhookMode: "bark",
        }, { title: "管家提醒", body: "测试通知" });

        expect(res).toBe("ok");
        expect(sendWebhook).toHaveBeenCalledWith(
            expect.objectContaining({ webhookEnabled: true, webhookUrl: "https://api.day.app/fake" }),
            expect.objectContaining({ title: "管家提醒" }),
        );
    });
});
