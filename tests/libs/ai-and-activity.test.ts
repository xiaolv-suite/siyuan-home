import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvActivity, lvAi } from "@/libs/notice";

describe("lvAi & lvActivity (Epoch 7 Phase 3: AI 网关与今日活动流测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lvActivity 支持广播记录生态活动并在 getTodayRecords 中正确查询", () => {
        const title = `测试完成待办_${Date.now()}`;
        lvActivity.record({
            source: "管家",
            category: "task",
            title,
            detail: "到期日: 2026-11-03",
        });

        const records = lvActivity.getTodayRecords();
        expect(Array.isArray(records)).toBe(true);
        const target = records.find((r) => r.title === title);
        expect(target).toBeDefined();
        expect(target?.source).toBe("管家");
        expect(target?.category).toBe("task");
        expect(target?.timeStr).toMatch(/^\d{2}:\d{2}$/);
    });

    it("lvActivity.onActivity 支持订阅生态活动实时流", () => {
        const received: any[] = [];
        const unsub = lvActivity.onActivity((item) => {
            received.push(item);
        });

        const uniqueTitle = `实时待办广播_${Date.now()}`;
        lvActivity.record({
            source: "管家",
            category: "task",
            title: uniqueTitle,
        });

        unsub();

        const match = received.find((r) => r.title === uniqueTitle);
        expect(match).toBeDefined();
        expect(match.source).toBe("管家");
    });

    it("lvActivity.formatAsMarkdown 能够正确汇编今日全生态活动流", () => {
        lvActivity.record({
            source: "打卡",
            category: "habit",
            title: "英语单词打卡 20 词",
        });

        const md = lvActivity.formatAsMarkdown();
        expect(typeof md).toBe("string");
        expect(md).toContain("小驴全家桶 · 今日活动汇编");
        expect(md).toContain("[打卡]");
        expect(md).toContain("英语单词打卡 20 词");
    });

    it("lvAi 支持读取与保存共享全局凭据配置", () => {
        const sampleConfig = {
            endpoint: "https://api.deepseek.com/v1",
            apiKey: "sk-mock-test-key-12345",
            model: "deepseek-chat",
            temperature: 0.7,
        };

        lvAi.setConfig(sampleConfig);
        const stored = lvAi.getConfig();
        expect(stored?.endpoint).toBe("https://api.deepseek.com/v1");
        expect(stored?.apiKey).toBe("sk-mock-test-key-12345");
        expect(stored?.model).toBe("deepseek-chat");
    });
});
