import { describe, expect, it } from "vitest";
import { selectCellValue, selectCellContent, cellContentText, cellValue } from "../../src/core/avcell";

describe("avcell 内核兼容层（R8 select 写读双形态）", () => {
    it("写入 payload 同时携带 select 单值与 mSelect 数组（新旧内核双命中）", () => {
        const v = selectCellValue("id");
        expect(v.type).toBe("select");
        expect(v.select).toEqual({ content: "id" });
        expect(v.mSelect).toEqual([{ content: "id" }]);
    });

    it("读取：内核 3.8.x 存储形态（mSelect 数组）优先", () => {
        expect(selectCellContent({ type: "select", mSelect: [{ content: "id" }] })).toBe("id");
        expect(selectCellContent({ type: "select", mSelect: [{ content: "a" }, { content: "b" }] })).toBe("a");
    });

    it("读取：旧数据形态（select 单值）兼容", () => {
        expect(selectCellContent({ type: "select", select: { content: "old" } })).toBe("old");
    });

    it("读取：空值安全（空数组/空内容/null）", () => {
        expect(selectCellContent({ type: "select", mSelect: [] })).toBeUndefined();
        expect(selectCellContent({ type: "select", mSelect: [{ content: "" }] })).toBeUndefined();
        expect(selectCellContent(undefined)).toBeUndefined();
        expect(selectCellContent({})).toBeUndefined();
    });

    describe("cellContentText 单元格通用文本提取", () => {
        it("提取 text, block, select, number, date, url 内容", () => {
            expect(cellContentText({ text: { content: "hello" } })).toBe("hello");
            expect(cellContentText({ block: { content: "block text" } })).toBe("block text");
            expect(cellContentText({ select: { content: "choice" } })).toBe("choice");
            expect(cellContentText({ number: { content: 123.45 } })).toBe("123.45");
            expect(cellContentText({ url: { content: "https://example.com" } })).toBe("https://example.com");
            expect(cellContentText(undefined)).toBe("");
            expect(cellContentText(null)).toBe("");
        });
    });

    describe("cellValue 构造思源写入对象", () => {
        it("正确构造日期单元格毫秒时间戳", () => {
            const dateCell = cellValue("date", "2026-10-28") as any;
            expect(dateCell.type).toBe("date");
            expect(dateCell.date.content).toBe(new Date("2026-10-28T00:00:00").getTime());
            expect(dateCell.date.isNotEmpty).toBe(true);
            expect(dateCell.date.isNotTime).toBe(true);

            const emptyDate = cellValue("date", "") as any;
            expect(emptyDate.date.isNotEmpty).toBe(false);
        });

        it("正确构造数字单元格（兼容 number 及字符串数字）", () => {
            const numCell = cellValue("number", 100) as any;
            expect(numCell).toEqual({ type: "number", number: { content: 100 } });

            const strNumCell = cellValue("number", " 99.5 ") as any;
            expect(strNumCell).toEqual({ type: "number", number: { content: 99.5 } });

            expect(cellValue("number", "")).toBeNull();
            expect(cellValue("number", "abc")).toBeNull();
            expect(cellValue("number", NaN)).toBeNull();
            expect(cellValue("number", Infinity)).toBeNull();
            expect(cellValue("number", null)).toBeNull();
        });
    });
});
