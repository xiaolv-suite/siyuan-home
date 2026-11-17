/**
 * 囤货采购建议单测（16 组/188 波）：H15 同口径（缺列不评估）、qty≤阈值、建议量下限 1、名称排序。
 */
import { describe, it, expect } from "vitest";
import { buildShoppingList, openLowStockShoppingDialog, buildBatchStockInFromShopping } from "@/core/shopping";
import type { AvRow } from "@/core/siyuan";

const KEYS = { nameKey: "k_name", qtyKey: "k_qty", thresholdKey: "k_low" };

const row = (name: string, qty: unknown, low: unknown): AvRow => ({
    itemID: `row-${name}`,
    cells: {
        k_name: name ? { type: "text", text: { content: name } } : { type: "text", text: { content: "" } },
        ...(qty === undefined ? {} : { k_qty: { type: "number", number: qty } }),
        ...(low === undefined ? {} : { k_low: { type: "number", number: low } }),
    } as AvRow["cells"],
});

const full = (isNotEmpty: boolean, content: number) => ({ isNotEmpty, content });

describe("buildShoppingList", () => {
    it("qty ≤ 阈值入清单，建议量 = 阈值 − 现有（下限 1）", () => {
        const list = buildShoppingList(
            [row("纸巾", full(true, 1), full(true, 4)), row("洗衣液", full(true, 2), full(true, 2)), row("够用", full(true, 5), full(true, 2))],
            KEYS,
        );
        expect(list.map((i) => i.name)).toEqual(["洗衣液", "纸巾"]); // 名称排序
        expect(list[0].suggest).toBe(1); // 恰在阈值 → 补 1
        expect(list[1].suggest).toBe(3);
    });

    it("缺阈值/缺数量/缺名称不评估（H15 同口径，不误报）", () => {
        const list = buildShoppingList(
            [
                row("无阈值", full(true, 0), undefined),
                row("无数量", undefined, full(true, 3)),
                row("", full(true, 0), full(true, 3)),
                row("空数量", full(false, 0), full(true, 3)),
            ],
            KEYS,
        );
        expect(list).toHaveLength(0);
    });

    it("openLowStockShoppingDialog 安全容错调用", () => {
        expect(() => {
            openLowStockShoppingDialog({
                ref: { avId: "av-stock", columns: { name: "name", qty: "qty", low_stock_at: "low" } },
                allRows: [],
                t: (k) => k,
                plugin: {},
                DialogCls: class {} as any,
                showMessageFn: () => {},
            });
        }).not.toThrow();
    });

    it("buildBatchStockInFromShopping 从采购清单正确组装批量入库草稿", () => {
        const mockRows = [
            {
                itemID: "shop-row-1",
                cells: {
                    s_name: { type: "text", text: { content: "抽纸" } },
                    s_qty: { type: "number", number: { content: 5 } },
                    s_price: { type: "number", number: { content: 49.9 } },
                },
            },
            {
                itemID: "shop-row-2",
                cells: {
                    s_name: { type: "text", text: { content: "洗洁精" } },
                },
            },
        ];
        const drafts = buildBatchStockInFromShopping(mockRows, {
            name: "s_name",
            qty: "s_qty",
            price: "s_price",
        });
        expect(drafts).toHaveLength(2);
        expect(drafts[0].name).toBe("抽纸");
        expect(drafts[0].qty).toBe(5);
        expect(drafts[0].price).toBe(49.9);
        expect(drafts[0].sourceRowId).toBe("shop-row-1");
        expect(drafts[1].name).toBe("洗洁精");
        expect(drafts[1].qty).toBe(1); // 缺省数量为 1
    });
});
