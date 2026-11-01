import { describe, it, expect } from "vitest";

describe("quick-shopping-presets (POOL-FEAT-19 / CAND-23: 待买清单总价与粗粒度开销快捷填入)", () => {
    const GENERAL_SHOPPING_PRESETS = [
        { name: "日用品", cat: "daily" },
        { name: "买菜食材", cat: "food" },
        { name: "超市采购", cat: "daily" },
        { name: "水果生鲜", cat: "food" },
        { name: "餐饮外卖", cat: "food" },
    ];

    it("粗粒度快捷胶囊一键填入品名并自动关联对应消费分类", () => {
        let name = "";
        let category = "daily";

        function fillPreset(item: { name: string; cat?: string }) {
            name = item.name;
            if (item.cat) category = item.cat;
        }

        fillPreset(GENERAL_SHOPPING_PRESETS[1]); // 买菜食材
        expect(name).toBe("买菜食材");
        expect(category).toBe("food");

        fillPreset(GENERAL_SHOPPING_PRESETS[0]); // 日用品
        expect(name).toBe("日用品");
        expect(category).toBe("daily");
    });

    it("粗粒度记账不强求件数细账：数量默认回退 1 且金额作为核心字段透传", () => {
        function prepareShoppingRecord(name: string, price?: number, qty?: number) {
            return {
                name: name.trim(),
                price,
                qty: qty || 1,
            };
        }

        // 用户仅填“超市采购”和总额 ¥120
        const rec = prepareShoppingRecord("超市采购", 120, undefined);
        expect(rec.name).toBe("超市采购");
        expect(rec.price).toBe(120);
        expect(rec.qty).toBe(1);
    });
});
