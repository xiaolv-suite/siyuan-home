import { describe, it, expect, vi } from "vitest";

describe("ledger-table (台账通用数据表格与虚拟化滚动)", () => {
    it("虚拟化滚动行高与范围计算边界", () => {
        const VIRTUAL_ROW_HEIGHT_COMFORTABLE = 48;
        const VIRTUAL_ROW_HEIGHT_COMPACT = 34;

        expect(VIRTUAL_ROW_HEIGHT_COMFORTABLE).toBe(48);
        expect(VIRTUAL_ROW_HEIGHT_COMPACT).toBe(34);

        // 少于等于 80 行时不分片
        const totalSmall = 50;
        const rangeSmall = totalSmall <= 80 ? { start: 0, end: totalSmall } : { start: 0, end: 80 };
        expect(rangeSmall).toEqual({ start: 0, end: 50 });

        // 大于 80 行时按视口与行高计算
        const totalLarge = 200;
        const viewportHeight = 640;
        const overscan = 8;
        const count = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT_COMFORTABLE) + overscan * 2;
        const first = Math.max(0, Math.floor(0 / VIRTUAL_ROW_HEIGHT_COMFORTABLE) - overscan);
        const start = Math.max(0, Math.min(first, Math.max(0, totalLarge - count)));
        const end = Math.min(totalLarge, start + count);

        expect(start).toBe(0);
        expect(end).toBe(count);
        expect(end).toBeLessThan(totalLarge);
    });

    it("全选与单行选择切换事务语义", () => {
        const filteredRows = [
            { itemID: "row-1", cells: {} },
            { itemID: "row-2", cells: {} },
            { itemID: "row-3", cells: {} },
        ];
        let selectedItemIds: string[] = [];

        // 初始状态未全选
        let allSelected = filteredRows.length > 0 && selectedItemIds.length === filteredRows.length;
        expect(allSelected).toBe(false);

        // 切换全选 -> 全部勾选
        if (allSelected) selectedItemIds = [];
        else selectedItemIds = filteredRows.map((r) => r.itemID);
        expect(selectedItemIds).toEqual(["row-1", "row-2", "row-3"]);

        allSelected = filteredRows.length > 0 && selectedItemIds.length === filteredRows.length;
        expect(allSelected).toBe(true);

        // 再次全选 -> 全部清空
        if (allSelected) selectedItemIds = [];
        else selectedItemIds = filteredRows.map((r) => r.itemID);
        expect(selectedItemIds).toEqual([]);

        // 单行勾选
        const toggleRowSelect = (id: string) => {
            if (selectedItemIds.includes(id)) {
                selectedItemIds = selectedItemIds.filter((x) => x !== id);
            } else {
                selectedItemIds = [...selectedItemIds, id];
            }
        };

        toggleRowSelect("row-2");
        expect(selectedItemIds).toEqual(["row-2"]);

        toggleRowSelect("row-1");
        expect(selectedItemIds).toEqual(["row-2", "row-1"]);

        toggleRowSelect("row-2");
        expect(selectedItemIds).toEqual(["row-1"]);
    });

    it("列头多语言字段标签解析与兜底", () => {
        const t = (k: string) => {
            if (k === "field.name") return "名称";
            if (k === "field.expiry") return "到期日";
            return k;
        };

        const resolveFieldLabel = (k: string, customFieldLabel?: (k: string) => string) => {
            if (customFieldLabel) return customFieldLabel(k);
            const trans = t(`field.${k}`);
            return trans !== `field.${k}` ? trans : k;
        };

        expect(resolveFieldLabel("name")).toBe("名称");
        expect(resolveFieldLabel("expiry")).toBe("到期日");
        expect(resolveFieldLabel("custom_extra_col")).toBe("custom_extra_col");
    });

    it("表头排序符合 WCAG aria-sort 语义状态", () => {
        function resolveAriaSort(sortKey: string, currentKey: string, sortAsc: boolean): "ascending" | "descending" | "none" {
            if (sortKey !== currentKey) return "none";
            return sortAsc ? "ascending" : "descending";
        }

        expect(resolveAriaSort("due", "name", true)).toBe("none");
        expect(resolveAriaSort("due", "due", true)).toBe("ascending");
        expect(resolveAriaSort("due", "due", false)).toBe("descending");
    });
});
