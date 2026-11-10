import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "@/core/quick-add";

describe("quick-memo-syntax (手机端快速备忘语法提示条与点选插入逻辑测试)", () => {
    it("parseQuickAdd 能够正确解析点选插入的 @日期、!优先级、#分类", () => {
        const text = "给猫咪打疫苗 @明天 !高 #家庭";
        const parsed = parseQuickAdd(text);

        expect(parsed.cleanTitle).toBe("给猫咪打疫苗");
        expect(parsed.priority).toBe("high");
        expect(parsed.category).toBe("家庭");
        expect(parsed.dueDate).toBeDefined();
    });

    it("模拟手机语法提示条替换插入逻辑：输入 @ 后点选「明天」正确替换为 @明天", () => {
        function insertSyntaxChip(before: string, after: string, prefix: "@" | "!" | "#", val: string): string {
            const regex = new RegExp(`(?:^|\\s)\\${prefix}[^\\s@!#]*$`);
            const match = before.match(regex);
            let newBefore = before;
            if (match) {
                const startIdx = before.lastIndexOf(prefix);
                newBefore = before.slice(0, startIdx) + `${prefix}${val} `;
            } else {
                const needSpace = before.length > 0 && !before.endsWith(" ");
                newBefore = before + (needSpace ? " " : "") + `${prefix}${val} `;
            }
            return newBefore + after;
        }

        // 场景 1：输入框已有 "买牛奶 @"，点选 "明天"
        const r1 = insertSyntaxChip("买牛奶 @", "", "@", "明天");
        expect(r1).toBe("买牛奶 @明天 ");

        // 场景 2：输入框已有 "交物业费 !"，点选 "高"
        const r2 = insertSyntaxChip("交物业费 !", "", "!", "高");
        expect(r2).toBe("交物业费 !高 ");

        // 场景 3：输入框已有 "买菜 #"，点选 "家庭"
        const r3 = insertSyntaxChip("买菜 #", "", "#", "家庭");
        expect(r3).toBe("买菜 #家庭 ");

        // 场景 4：从默认引导条点选（当前未输入符号）
        const r4 = insertSyntaxChip("去体检", "", "@", "后天");
        expect(r4).toBe("去体检 @后天 ");
    });

    it("第 4 类金额语法支持：输入 $ 触发常用金额 chips 并能被 parseQuickAdd 精确识别为记账金额", () => {
        function insertSyntaxChip(before: string, after: string, prefix: "@" | "!" | "#" | "$", val: string): string {
            const regex = new RegExp(`(?:^|\\s)\\${prefix}[^\\s@!#$]*$`);
            const match = before.match(regex);
            let newBefore = before;
            if (match) {
                const startIdx = before.lastIndexOf(prefix);
                newBefore = before.slice(0, startIdx) + `${prefix}${val} `;
            } else {
                const needSpace = before.length > 0 && !before.endsWith(" ");
                newBefore = before + (needSpace ? " " : "") + `${prefix}${val} `;
            }
            return newBefore + after;
        }

        // 场景：输入 "修车 $" 点选 "500"
        const inserted = insertSyntaxChip("修车 $", "", "$", "500");
        expect(inserted).toBe("修车 $500 ");

        const parsed = parseQuickAdd(inserted);
        expect(parsed.cleanTitle).toBe("修车");
        expect(parsed.amount).toBe(500);
        expect(parsed.amountToken).toBe("$500");
    });
});
