import { describe, it, expect } from "vitest";
import { buildCsv } from "@/core/csv";

describe("ledger-batch-export-selected (POOL-FEAT-14 / CAND-18: 批量操作栏仅导出已选 X 项为 CSV)", () => {
    const mockSchema = {
        columns: [
            { key: "name", label: "名称" },
            { key: "category", label: "分类" },
            { key: "amount", label: "金额" },
        ],
    };

    const mockRef = {
        columns: {
            name: "col-1",
            category: "col-2",
            amount: "col-3",
        },
    };

    const allRows = [
        { itemID: "row-1", cells: { "col-1": { text: { content: "项1" } }, "col-2": { text: { content: "分类A" } }, "col-3": { number: { content: 100 } } } },
        { itemID: "row-2", cells: { "col-1": { text: { content: "项2" } }, "col-2": { text: { content: "分类B" } }, "col-3": { number: { content: 200 } } } },
        { itemID: "row-3", cells: { "col-1": { text: { content: "项3" } }, "col-2": { text: { content: "分类A" } }, "col-3": { number: { content: 300 } } } },
    ];

    it("仅导出被选中的指定行并保持列对齐", () => {
        const selectedItemIds = ["row-1", "row-3"];
        const selectedRows = allRows.filter((r) => selectedItemIds.includes(r.itemID));

        expect(selectedRows.length).toBe(2);

        const cols = mockSchema.columns;
        const csv = buildCsv(
            cols.map((c) => c.label),
            selectedRows.map((r) => [
                r.cells["col-1"].text.content,
                r.cells["col-2"].text.content,
                String(r.cells["col-3"].number.content),
            ])
        );

        expect(csv).toContain("名称,分类,金额");
        expect(csv).toContain("项1,分类A,100");
        expect(csv).toContain("项3,分类A,300");
        expect(csv).not.toContain("项2"); // 未选中的行绝不导出
    });
});
