import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "@/core/quick-add";

describe("quick-add-amount (自然语言快捷金额解析与纯净标题提取)", () => {
    const today = new Date(2026, 10, 1); // 2026-11-01

    it("解析末尾纯数字金额（如「买水果 45」）", () => {
        const res = parseQuickAdd("买水果 45", today);
        expect(res.amount).toBe(45);
        expect(res.cleanTitle).toBe("买水果");
    });

    it("解析中文货币单位金额（如「打车 28元」「买菜 35.5块」）", () => {
        const res1 = parseQuickAdd("打车 28元 @今天", today);
        expect(res1.amount).toBe(28);
        expect(res1.cleanTitle).toBe("打车");

        const res2 = parseQuickAdd("买菜 35.5块 #日常", today);
        expect(res2.amount).toBe(35.5);
        expect(res2.cleanTitle).toBe("买菜");
        expect(res2.category).toBe("日常");
    });

    it("解析货币符号前缀金额（如「交物业费 ¥320」「采购 ￥150」）", () => {
        const res1 = parseQuickAdd("交物业费 ¥320 !高", today);
        expect(res1.amount).toBe(320);
        expect(res1.cleanTitle).toBe("交物业费");
        expect(res1.priority).toBe("high");

        const res2 = parseQuickAdd("采购 ￥150.5", today);
        expect(res2.amount).toBe(150.5);
        expect(res2.cleanTitle).toBe("采购");
    });

    it("无金额输入时不误伤普通标题", () => {
        const res = parseQuickAdd("清洗空调滤网 !高 @明天", today);
        expect(res.amount).toBeUndefined();
        expect(res.cleanTitle).toBe("清洗空调滤网");
    });
});
