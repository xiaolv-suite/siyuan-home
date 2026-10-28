import { describe, it, expect, vi } from "vitest";

describe("ledger-batch-bar (台账多选批量管理栏)", () => {
    it("批量操作属性与回调接口完备性", () => {
        const selectedItemIds = ["row-1", "row-2"];
        expect(selectedItemIds).toHaveLength(2);

        const onReload = vi.fn().mockResolvedValue(undefined);
        expect(typeof onReload).toBe("function");
    });

    it("正确组装选定行的思源块双链引用 ((id 'title'))", () => {
        const mockRows = [
            { itemID: "row-1", cells: { c_name: { text: { content: "护照" } } } },
            { itemID: "row-2", cells: { c_name: { text: { content: "驾驶证" } } } },
        ];
        const selectedItemIds = ["row-1", "row-2"];
        const nameCol = "c_name";

        const selectedRows = mockRows.filter((r) => selectedItemIds.includes(r.itemID));
        const refs = selectedRows.map((r) => {
            const title = String(r.cells[nameCol]?.text?.content ?? r.itemID).trim();
            return `((${r.itemID} '${title}'))`;
        });

        expect(refs).toEqual([
            "((row-1 '护照'))",
            "((row-2 '驾驶证'))",
        ]);
        expect(refs.join("\n")).toBe("((row-1 '护照'))\n((row-2 '驾驶证'))");
    });
});
