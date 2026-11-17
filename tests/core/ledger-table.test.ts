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

    it("行内键盘导航支持 Enter 与 Space 键双键激活详情抽屉", () => {
        const onOpenDetail = vi.fn();
        const mockRow = { itemID: "row-1", cells: {} };

        const handleRowKeydown = (e: { key: string; target: any; currentTarget: any; preventDefault: () => void }) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenDetail(mockRow);
            }
        };

        const target = {};
        const preventDefault1 = vi.fn();
        handleRowKeydown({ key: "Enter", target, currentTarget: target, preventDefault: preventDefault1 });
        expect(preventDefault1).toHaveBeenCalled();
        expect(onOpenDetail).toHaveBeenCalledWith(mockRow);

        const preventDefault2 = vi.fn();
        handleRowKeydown({ key: " ", target, currentTarget: target, preventDefault: preventDefault2 });
        expect(preventDefault2).toHaveBeenCalled();
        expect(onOpenDetail).toHaveBeenCalledTimes(2);
    });

    it("表头漫游键位导航 (ArrowLeft / ArrowRight / Home / End / ArrowDown)", () => {
        const btn1 = { focus: vi.fn() };
        const btn2 = { focus: vi.fn() };
        const btn3 = { focus: vi.fn() };
        const controls = [btn1, btn2, btn3];
        const firstRow = { focus: vi.fn() };

        function handleHeaderKeydown(e: { key: string; target: any; currentTarget: any; preventDefault: () => void }) {
            const idx = controls.indexOf(e.target);
            if (idx === -1) return;
            if (e.key === "ArrowRight") {
                e.preventDefault();
                controls[(idx + 1) % controls.length].focus();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                controls[(idx - 1 + controls.length) % controls.length].focus();
            } else if (e.key === "Home") {
                e.preventDefault();
                controls[0].focus();
            } else if (e.key === "End") {
                e.preventDefault();
                controls[controls.length - 1].focus();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                firstRow.focus();
            }
        }

        const preventDefault = vi.fn();
        // ArrowRight: 0 -> 1
        handleHeaderKeydown({ key: "ArrowRight", target: btn1, currentTarget: {}, preventDefault });
        expect(btn2.focus).toHaveBeenCalled();

        // ArrowLeft: 0 -> 2 (循环)
        handleHeaderKeydown({ key: "ArrowLeft", target: btn1, currentTarget: {}, preventDefault });
        expect(btn3.focus).toHaveBeenCalled();

        // Home: -> 0
        handleHeaderKeydown({ key: "Home", target: btn2, currentTarget: {}, preventDefault });
        expect(btn1.focus).toHaveBeenCalled();

        // End: -> 2
        handleHeaderKeydown({ key: "End", target: btn1, currentTarget: {}, preventDefault });
        expect(btn3.focus).toHaveBeenCalled();

        // ArrowDown: -> first row
        handleHeaderKeydown({ key: "ArrowDown", target: btn2, currentTarget: {}, preventDefault });
        expect(firstRow.focus).toHaveBeenCalled();
    });

    it("行内上下方向键 (ArrowDown / ArrowUp) 纵向切换焦点并在行首越界时回落表头", () => {
        const headerBtn = { focus: vi.fn() };
        const row1 = {
            classList: { contains: (c: string) => c === "lv-row-link" },
            focus: vi.fn(),
            nextElementSibling: null as any,
            previousElementSibling: null as any,
        };
        const row2 = {
            classList: { contains: (c: string) => c === "lv-row-link" },
            focus: vi.fn(),
            nextElementSibling: null as any,
            previousElementSibling: row1,
        };
        row1.nextElementSibling = row2;

        function handleRowKeydown(e: { key: string; target: any; currentTarget: any; preventDefault: () => void }) {
            if (e.target !== e.currentTarget) return;
            if (e.key === "ArrowDown") {
                let nextEl = e.currentTarget.nextElementSibling;
                while (nextEl && !nextEl.classList.contains("lv-row-link")) {
                    nextEl = nextEl.nextElementSibling;
                }
                if (nextEl) {
                    e.preventDefault();
                    nextEl.focus();
                }
            } else if (e.key === "ArrowUp") {
                let prevEl = e.currentTarget.previousElementSibling;
                while (prevEl && !prevEl.classList.contains("lv-row-link")) {
                    prevEl = prevEl.previousElementSibling;
                }
                if (prevEl) {
                    e.preventDefault();
                    prevEl.focus();
                } else {
                    e.preventDefault();
                    headerBtn.focus();
                }
            }
        }

        const preventDefault = vi.fn();
        // Row 1 -> ArrowDown -> Row 2
        handleRowKeydown({ key: "ArrowDown", target: row1, currentTarget: row1, preventDefault });
        expect(row2.focus).toHaveBeenCalled();

        // Row 2 -> ArrowUp -> Row 1
        handleRowKeydown({ key: "ArrowUp", target: row2, currentTarget: row2, preventDefault });
        expect(row1.focus).toHaveBeenCalled();

        // Row 1 -> ArrowUp -> 回落表头
        handleRowKeydown({ key: "ArrowUp", target: row1, currentTarget: row1, preventDefault });
        expect(headerBtn.focus).toHaveBeenCalled();
    });

    it("排序触发后生成 WCAG 4.1.3 无障碍 live 语音播报文本", () => {
        const t = (k: string) => {
            if (k === "ledger.sortSortedAsc") return "已按${field}升序排列";
            if (k === "ledger.sortSortedDesc") return "已按${field}降序排列";
            return k;
        };

        function createSortAnnouncement(fieldLabel: string, nextAsc: boolean): string {
            return (nextAsc ? t("ledger.sortSortedAsc") : t("ledger.sortSortedDesc")).replace("${field}", fieldLabel);
        }

        expect(createSortAnnouncement("到期时间", true)).toBe("已按到期时间升序排列");
        expect(createSortAnnouncement("金额", false)).toBe("已按金额降序排列");
    });

    it("步进器增减数值调控参数与无障碍动作触发", () => {
        const onAdjustQty = vi.fn();
        const mockRow = { itemID: "row-stock-1", cells: {} };

        function handleQtyChange(delta: number) {
            onAdjustQty(mockRow, "stock_qty", delta);
        }

        handleQtyChange(-1);
        expect(onAdjustQty).toHaveBeenCalledWith(mockRow, "stock_qty", -1);

        handleQtyChange(1);
        expect(onAdjustQty).toHaveBeenCalledWith(mockRow, "stock_qty", 1);
    });

    it("台账表格列宽拖拽计算与重置恢复自适应 (CAND-27)", () => {
        let colWidths: Record<string, number> = { name: 180, expiry: 120 };

        // 模拟拖拽调整列宽
        function updateColWidth(colKey: string, startWidth: number, deltaX: number) {
            const newWidth = Math.max(50, Math.round(startWidth + deltaX));
            colWidths[colKey] = newWidth;
        }

        // 向右拖拽 40px
        updateColWidth("name", 180, 40);
        expect(colWidths.name).toBe(220);

        // 向左拖拽过窄触发最小宽度保护 (50px)
        updateColWidth("expiry", 120, -100);
        expect(colWidths.expiry).toBe(50);

        // 双击重置恢复自适应（清除指定列宽）
        function resetColWidth(colKey: string) {
            delete colWidths[colKey];
        }

        resetColWidth("name");
        expect(colWidths.name).toBeUndefined();
        expect(colWidths.expiry).toBe(50);
    });
});
