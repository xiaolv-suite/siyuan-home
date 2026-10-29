import { describe, it, expect } from "vitest";
import {
    formatLedgerCellText,
    calculateLedgerTone,
    toneCls,
    toneColor,
    computeColumnSuggestions,
    computeDynamicLocations,
    sortLedgerRows,
    matchLedgerRowSearch,
} from "@/core/ledger-view-model";

describe("ledger-view-model (台账视图数据模型与单元格渲染辅助引擎)", () => {
    const t = (k: string) => k;

    it("formatLedgerCellText 正确格式化普通文本、证件脱敏与日期", () => {
        // 普通文本
        expect(formatLedgerCellText({ type: "text", text: { content: "护照" } }, "name", t)).toBe("护照");

        // 敏感证件脱敏
        const idCell = { type: "text", text: { content: "110101199003072345" } };
        expect(formatLedgerCellText(idCell, "x_cert_id_number", t, false, false)).toContain("*");
        expect(formatLedgerCellText(idCell, "x_cert_id_number", t, false, true)).toBe("110101199003072345");

        // 日期时间戳
        const dateCell = { type: "date", date: { content: 1793404800000, isNotEmpty: true } };
        expect(formatLedgerCellText(dateCell, "date", t)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // 空值兜底
        expect(formatLedgerCellText(null, "name", t)).toBe("—");
    });

    it("calculateLedgerTone 与状态色标计算", () => {
        const columns = { expiry: "c_exp" };
        const now = Date.now();

        // 逾期行
        const overdueRow = { cells: { c_exp: { type: "date", date: { content: now - 86400000 * 2, isNotEmpty: true } } } };
        const toneOverdue = calculateLedgerTone(overdueRow, columns, 30);
        expect(toneOverdue).toBe("danger");
        expect(toneCls(toneOverdue)).toBe("red");
        expect(toneColor(toneOverdue)).toBe("var(--lv-danger)");

        // 临期行
        const soonRow = { cells: { c_exp: { type: "date", date: { content: now + 86400000 * 5, isNotEmpty: true } } } };
        const toneSoon = calculateLedgerTone(soonRow, columns, 30);
        expect(toneSoon).toBe("warn");
        expect(toneCls(toneSoon)).toBe("orange");

        // 正常行
        const okRow = { cells: { c_exp: { type: "date", date: { content: now + 86400000 * 60, isNotEmpty: true } } } };
        const toneOk = calculateLedgerTone(okRow, columns, 30);
        expect(toneOk).toBe("ok");
        expect(toneCls(toneOk)).toBe("green");
    });

    it("computeColumnSuggestions 与 computeDynamicLocations 准确提取历史值", () => {
        const rows = [
            { cells: { c_loc: { text: { content: "书房书架" } }, c_name: { text: { content: "保险单" } } } },
            { cells: { c_loc: { text: { content: "保险柜" } }, c_name: { text: { content: "房产证" } } } },
        ];
        const columns = { location: "c_loc", name: "c_name" };
        const cellTextFn = (cell: any) => cell?.text?.content || "";

        const suggestions = computeColumnSuggestions(rows, columns, cellTextFn);
        expect(suggestions.name).toContain("保险单");
        expect(suggestions.name).toContain("房产证");

        const dynamicLocs = computeDynamicLocations(rows, columns, cellTextFn);
        expect(dynamicLocs).toContain("保险柜");
        expect(dynamicLocs).toContain("客厅药箱");
    });

    it("sortLedgerRows 按数值与字符串分别正确排序", () => {
        const cellTextFn = (cell: any) => String(cell?.content ?? "");
        const rows = [
            { id: "1", cells: { c_num: { content: 100 } } },
            { id: "2", cells: { c_num: { content: 20 } } },
            { id: "3", cells: { c_num: { content: 5 } } },
        ];

        // 数值升序排序
        const sortedNumAsc = sortLedgerRows(rows, "c_num", true, "number", cellTextFn);
        expect(sortedNumAsc.map((r) => r.id)).toEqual(["3", "2", "1"]);

        // 降序排序
        const sortedNumDesc = sortLedgerRows(rows, "c_num", false, "number", cellTextFn);
        expect(sortedNumDesc.map((r) => r.id)).toEqual(["1", "2", "3"]);
    });

    it("matchLedgerRowSearch 能够搜索行内任意列内容", () => {
        const row = {
            cells: {
                c_name: { text: { content: "粤B12345" } },
                c_brand: { text: { content: "比亚迪汉" } },
            },
        };
        const columns = { name: "c_name", brand: "c_brand" };
        const cellTextFn = (cell: any) => cell?.text?.content || "";

        expect(matchLedgerRowSearch(row, "粤B", columns, cellTextFn)).toBe(true);
        expect(matchLedgerRowSearch(row, "比亚迪", columns, cellTextFn)).toBe(true);
        expect(matchLedgerRowSearch(row, "奔驰", columns, cellTextFn)).toBe(false);
    });
});
