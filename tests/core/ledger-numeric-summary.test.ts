import { describe, it, expect } from "vitest";

describe("ledger-numeric-summary (POOL-FEAT-12 / CAND-16: 台账表格底部实时数值/金额/库存汇总条)", () => {
    const mockRef = {
        columns: {
            name: "col-1",
            amount: "col-2",
            qty: "col-3",
        },
    };

    function computeSummaries(rows: any[], ref: typeof mockRef) {
        if (!ref?.columns || rows.length === 0) return null;
        let sumAmount = 0;
        let hasAmount = false;
        let sumQty = 0;
        let hasQty = false;

        const amountCol = ref.columns.amount;
        const qtyCol = ref.columns.qty;

        for (const r of rows) {
            if (amountCol) {
                const cell = r.cells?.[amountCol];
                const val = typeof cell?.number?.content === "number" ? cell.number.content
                    : typeof cell === "number" ? cell
                    : Number(cell?.text?.content || 0);
                if (Number.isFinite(val) && val > 0) {
                    sumAmount += val;
                    hasAmount = true;
                }
            }
            if (qtyCol) {
                const cell = r.cells?.[qtyCol];
                const val = typeof cell?.number?.content === "number" ? cell.number.content
                    : typeof cell === "number" ? cell
                    : Number(cell?.text?.content || 0);
                if (Number.isFinite(val) && val > 0) {
                    sumQty += val;
                    hasQty = true;
                }
            }
        }

        if (!hasAmount && !hasQty) return null;
        return {
            amount: hasAmount ? sumAmount : undefined,
            qty: hasQty ? sumQty : undefined,
        };
    }

    it("精准合计筛选结果中的金额与数量", () => {
        const rows = [
            { cells: { "col-1": { text: { content: "房租" } }, "col-2": { number: { content: 3500 } }, "col-3": { number: { content: 1 } } } },
            { cells: { "col-1": { text: { content: "物业费" } }, "col-2": { number: { content: 450 } }, "col-3": { number: { content: 1 } } } },
            { cells: { "col-1": { text: { content: "水电费" } }, "col-2": { number: { content: 280 } }, "col-3": { number: { content: 2 } } } },
        ];

        const res = computeSummaries(rows, mockRef);
        expect(res).not.toBeNull();
        expect(res?.amount).toBe(4230);
        expect(res?.qty).toBe(4);
    });

    it("过滤无效数值与负数/零", () => {
        const rows = [
            { cells: { "col-2": { number: { content: 100 } } } },
            { cells: { "col-2": { number: { content: 0 } } } },
            { cells: { "col-2": { number: { content: -50 } } } },
            { cells: { "col-2": "invalid" } },
        ];

        const res = computeSummaries(rows, mockRef);
        expect(res?.amount).toBe(100);
        expect(res?.qty).toBeUndefined();
    });

    it("无数值列时安全返回 null", () => {
        const nonNumericRef = { columns: { name: "col-1", note: "col-4" } };
        const rows = [{ cells: { "col-1": { text: { content: "纯文本" } } } }];
        const res = computeSummaries(rows, nonNumericRef as any);
        expect(res).toBeNull();
    });
});
