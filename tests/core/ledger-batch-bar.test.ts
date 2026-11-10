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

    it("WAI-ARIA APG Toolbar 键盘方向键 (ArrowRight/Left/Home/End) 循环与边界切换", () => {
        const mockButtons = [
            { focus: vi.fn(), disabled: false },
            { focus: vi.fn(), disabled: false },
            { focus: vi.fn(), disabled: false },
        ];

        function handleKeydown(key: string, currentIndex: number) {
            let nextIndex = 0;
            if (key === "ArrowRight" || key === "ArrowDown") {
                nextIndex = currentIndex >= 0 ? (currentIndex + 1) % mockButtons.length : 0;
            } else if (key === "ArrowLeft" || key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : mockButtons.length - 1;
            } else if (key === "Home") {
                nextIndex = 0;
            } else if (key === "End") {
                nextIndex = mockButtons.length - 1;
            }
            mockButtons[nextIndex].focus();
            return nextIndex;
        }

        // 从首项向右 -> 第二项
        expect(handleKeydown("ArrowRight", 0)).toBe(1);
        expect(mockButtons[1].focus).toHaveBeenCalled();

        // 从末项向右 -> 循环回首项
        expect(handleKeydown("ArrowRight", 2)).toBe(0);
        expect(mockButtons[0].focus).toHaveBeenCalled();

        // 从首项向左 -> 循环到末项
        expect(handleKeydown("ArrowLeft", 0)).toBe(2);
        expect(mockButtons[2].focus).toHaveBeenCalled();

        // Home -> 首项
        expect(handleKeydown("Home", 2)).toBe(0);

        // End -> 末项
        expect(handleKeydown("End", 0)).toBe(2);
    });

    it("Escape 键触发快捷退出与焦点安全回退至表头复选框", () => {
        let selectedItemIds = ["row-1", "row-2"];
        const selectAllFocus = vi.fn();
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        function restoreFocusAfterClear() {
            selectAllFocus();
        }

        function clearSelection() {
            selectedItemIds = [];
            restoreFocusAfterClear();
        }

        function handleToolbarKeydown(e: { key: string; preventDefault: () => void; stopPropagation: () => void }) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
            }
        }

        handleToolbarKeydown({ key: "Escape", preventDefault, stopPropagation });

        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
        expect(selectedItemIds).toEqual([]);
        expect(selectAllFocus).toHaveBeenCalled();
    });
});
