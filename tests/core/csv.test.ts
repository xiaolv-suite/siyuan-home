/**
 * CSV 导出纯逻辑单测（第八十四轮）：RFC 4180 转义、BOM/CRLF、组装。
 */
import { describe, it, expect } from "vitest";
import { csvEscape, buildCsv, neutralizeFormula } from "@/core/csv";

describe("csv.csvEscape", () => {
    it("普通值不加引号；含逗号/引号/换行任一则整体加引号", () => {
        expect(csvEscape("正常")).toBe("正常");
        expect(csvEscape("a,b")).toBe('"a,b"');
        expect(csvEscape('他说"你好"')).toBe('"他说""你好"""');
        expect(csvEscape("行1\n行2")).toBe('"行1\n行2"');
        expect(csvEscape("回车\r\n测试")).toBe('"回车\r\n测试"');
        expect(csvEscape("")).toBe("");
    });

    it("电子表格公式注入防御 (OWASP CSV Injection Defense)", () => {
        expect(neutralizeFormula("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
        expect(neutralizeFormula("@SUM(A1:B10)")).toBe("'@SUM(A1:B10)");
        expect(neutralizeFormula("+cmd")).toBe("'+cmd");
        expect(neutralizeFormula("-evil")).toBe("'-evil");
        // 合法纯数值不中和
        expect(neutralizeFormula("-100")).toBe("-100");
        expect(neutralizeFormula("+50.5")).toBe("+50.5");
        expect(neutralizeFormula("300")).toBe("300");
        // csvEscape 综合表现
        expect(csvEscape("=1+1")).toBe("'=1+1");
        expect(csvEscape("=cmd,test")).toBe("\"'=cmd,test\"");
    });
});

describe("csv.buildCsv", () => {
    it("BOM 前缀 + CRLF 行结束 + 逐格转义", () => {
        const out = buildCsv(["名称", "备注"], [["药A", "含,逗号"], ["引号\"行", "普通"]]);
        expect(out.charCodeAt(0)).toBe(0xfeff);
        const body = out.slice(1);
        const lines = body.split("\r\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe("名称,备注");
        expect(lines[1]).toBe("药A,\"含,逗号\"");
        expect(lines[2]).toBe('"引号""行",普通');
    });

    it("空表/空行不崩；单元格全空串", () => {
        expect(buildCsv([], [])).toBe("\uFEFF");
        expect(buildCsv(["a"], [[""], [""]])).toBe("\uFEFFa\r\n\r\n");
    });
});
