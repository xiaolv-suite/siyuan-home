import { describe, it, expect } from "vitest";

describe("ledger-multi-select (POOL-FEAT-06: 台账表格 Shift 连续区间多选行操作)", () => {
    const mockRows = [
        { itemID: "row-0", name: "记录0" },
        { itemID: "row-1", name: "记录1" },
        { itemID: "row-2", name: "记录2" },
        { itemID: "row-3", name: "记录3" },
        { itemID: "row-4", name: "记录4" },
        { itemID: "row-5", name: "记录5" },
    ];

    it("普通单击复选框切换单行选中状态", () => {
        let selectedItemIds: string[] = [];
        let lastCheckedIndex: number | null = null;

        function toggleRowSelect(id: string, rowIndex: number, shiftKey = false) {
            if (shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== rowIndex) {
                const start = Math.min(lastCheckedIndex, rowIndex);
                const end = Math.max(lastCheckedIndex, rowIndex);
                const rangeIds = mockRows.slice(start, end + 1).map((r) => r.itemID);
                const nextSet = new Set(selectedItemIds);
                rangeIds.forEach((rid) => nextSet.add(rid));
                selectedItemIds = Array.from(nextSet);
            } else {
                if (selectedItemIds.includes(id)) {
                    selectedItemIds = selectedItemIds.filter((x) => x !== id);
                } else {
                    selectedItemIds = [...selectedItemIds, id];
                }
            }
            lastCheckedIndex = rowIndex;
        }

        toggleRowSelect("row-1", 1, false);
        expect(selectedItemIds).toEqual(["row-1"]);
        expect(lastCheckedIndex).toBe(1);

        toggleRowSelect("row-1", 1, false);
        expect(selectedItemIds).toEqual([]);
        expect(lastCheckedIndex).toBe(1);
    });

    it("按住 Shift 点击实现正向连续区间多选 [1 -> 4]", () => {
        let selectedItemIds: string[] = [];
        let lastCheckedIndex: number | null = null;

        function toggleRowSelect(id: string, rowIndex: number, shiftKey = false) {
            if (shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== rowIndex) {
                const start = Math.min(lastCheckedIndex, rowIndex);
                const end = Math.max(lastCheckedIndex, rowIndex);
                const rangeIds = mockRows.slice(start, end + 1).map((r) => r.itemID);
                const nextSet = new Set(selectedItemIds);
                rangeIds.forEach((rid) => nextSet.add(rid));
                selectedItemIds = Array.from(nextSet);
            } else {
                if (selectedItemIds.includes(id)) {
                    selectedItemIds = selectedItemIds.filter((x) => x !== id);
                } else {
                    selectedItemIds = [...selectedItemIds, id];
                }
            }
            lastCheckedIndex = rowIndex;
        }

        // 先点第 1 行
        toggleRowSelect("row-1", 1, false);
        expect(selectedItemIds).toEqual(["row-1"]);

        // Shift 点击第 4 行
        toggleRowSelect("row-4", 4, true);
        expect(selectedItemIds).toEqual(["row-1", "row-2", "row-3", "row-4"]);
        expect(lastCheckedIndex).toBe(4);
    });

    it("按住 Shift 反向点击实现逆向连续区间多选 [4 -> 1]", () => {
        let selectedItemIds: string[] = [];
        let lastCheckedIndex: number | null = null;

        function toggleRowSelect(id: string, rowIndex: number, shiftKey = false) {
            if (shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== rowIndex) {
                const start = Math.min(lastCheckedIndex, rowIndex);
                const end = Math.max(lastCheckedIndex, rowIndex);
                const rangeIds = mockRows.slice(start, end + 1).map((r) => r.itemID);
                const nextSet = new Set(selectedItemIds);
                rangeIds.forEach((rid) => nextSet.add(rid));
                selectedItemIds = Array.from(nextSet);
            } else {
                if (selectedItemIds.includes(id)) {
                    selectedItemIds = selectedItemIds.filter((x) => x !== id);
                } else {
                    selectedItemIds = [...selectedItemIds, id];
                }
            }
            lastCheckedIndex = rowIndex;
        }

        // 先点第 4 行
        toggleRowSelect("row-4", 4, false);
        expect(selectedItemIds).toEqual(["row-4"]);

        // Shift 点击第 1 行
        toggleRowSelect("row-1", 1, true);
        expect(selectedItemIds).toContain("row-1");
        expect(selectedItemIds).toContain("row-2");
        expect(selectedItemIds).toContain("row-3");
        expect(selectedItemIds).toContain("row-4");
        expect(selectedItemIds.length).toBe(4);
        expect(lastCheckedIndex).toBe(1);
    });

    it("首选时即便带有 Shift 也安全退化为单选", () => {
        let selectedItemIds: string[] = [];
        let lastCheckedIndex: number | null = null;

        function toggleRowSelect(id: string, rowIndex: number, shiftKey = false) {
            if (shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== rowIndex) {
                const start = Math.min(lastCheckedIndex, rowIndex);
                const end = Math.max(lastCheckedIndex, rowIndex);
                const rangeIds = mockRows.slice(start, end + 1).map((r) => r.itemID);
                const nextSet = new Set(selectedItemIds);
                rangeIds.forEach((rid) => nextSet.add(rid));
                selectedItemIds = Array.from(nextSet);
            } else {
                if (selectedItemIds.includes(id)) {
                    selectedItemIds = selectedItemIds.filter((x) => x !== id);
                } else {
                    selectedItemIds = [...selectedItemIds, id];
                }
            }
            lastCheckedIndex = rowIndex;
        }

        toggleRowSelect("row-3", 3, true);
        expect(selectedItemIds).toEqual(["row-3"]);
        expect(lastCheckedIndex).toBe(3);
    });
});
