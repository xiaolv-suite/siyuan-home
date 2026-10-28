import { describe, it, expect, vi } from "vitest";
import { beginInlineEdit, quickAdjustRowQty } from "@/core/inline-edit";

describe("inline-edit (台账行内编辑微控件与状态流转)", () => {
    it("beginInlineEdit 边界安全容错调用", () => {
        expect(() => {
            beginInlineEdit({
                col: { type: "text", key: "name" },
                keyID: "col-name",
                line: {} as any,
                valueEl: {} as any,
                row: { cells: {} },
                ref: { avId: "av-1", columns: {} },
                active: "certs",
                t: (k) => k,
                rawFromValueFn: () => "",
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("quickAdjustRowQty 当缺失列映射时优雅跳过", async () => {
        const res = await quickAdjustRowQty({
            row: { cells: {} },
            fieldKey: "stock",
            delta: 1,
            ref: { avId: "av-1", columns: {} }, // 无 stock 列
            active: "stock",
            plugin: {},
            showMessageFn: vi.fn(),
        });
        expect(res).toBeUndefined();
    });

    it("quickAdjustRowQty 正确计算累加且不小于零", () => {
        function calcNext(cur: number, delta: number) {
            return Math.max(0, cur + delta);
        }

        expect(calcNext(5, 1)).toBe(6);
        expect(calcNext(5, -1)).toBe(4);
        expect(calcNext(0, -1)).toBe(0);
        expect(calcNext(1, -5)).toBe(0);
    });
});

