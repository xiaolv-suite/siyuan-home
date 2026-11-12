import { describe, it, expect } from "vitest";
import { formatDailyJournalMarkdown, describeRowLogAsLifelog } from "@/core/doc-sync";

describe("doc-sync-outline (Phase 3: 思源文档双链与 LifeLog 视觉大纲结构升级)", () => {
    it("待办备忘区支持金额标识透出 (💰 ¥...)", () => {
        const input = {
            docId: "doc-123",
            memos: [
                { id: "m-1", title: "交宽带费", dueDate: "2026-11-05", amount: 180, priority: "high" as const, category: "家庭" },
                { id: "m-2", title: "去邮局寄件", dueDate: "2026-11-06" },
            ],
            flowItems: [],
        };

        const md = formatDailyJournalMarkdown(input);
        expect(md).toContain("💰 ¥180");
        expect(md).toContain("🔥 高优");
        expect(md).toContain("#家庭");
        expect(md).toContain("- [ ] **去邮局寄件**");
    });

    it("待买/采购流水在 LifeLog 中包含价格标签与采购分类", () => {
        const spec = describeRowLogAsLifelog("quickflows", {
            kind: "shopping",
            title: "日用品采购",
            price: 85,
            qty: 1,
            time: "15:30",
            date: "2026-11-01",
        });

        expect(spec.lifelogType).toBe("待买清单");
        expect(spec.detailText).toContain("¥85");
        expect(spec.tags).toContain("#待买");
    });

    it("LifeLog 规范三级倒序大纲 (年H2 -> 月H3 -> 日H4) 完好生成", () => {
        const input = {
            docId: "doc-2026",
            memos: [],
            flowItems: [
                { idKey: "k1", date: "2026-11-01", time: "09:00", sortKey: "2026-11-01T09:00", lifelogType: "日常记录", detailText: "早晨散步" },
                { idKey: "k2", date: "2026-10-31", time: "20:00", sortKey: "2026-10-31T20:00", lifelogType: "日常记录", detailText: "整理书架" },
            ],
        };

        const md = formatDailyJournalMarkdown(input);
        expect(md).toContain("## 2026 年");
        expect(md).toContain("### 11 月");
        expect(md).toContain("#### 2026-11-01");
        expect(md).toContain("### 10 月");
        expect(md).toContain("#### 2026-10-31");
    });
});
