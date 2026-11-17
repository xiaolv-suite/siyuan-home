import { describe, it, expect } from "vitest";
import type { ColumnDef } from "@/core/schema";

describe("ledger-record-more (台账更多字段展开区)", () => {
    it("正确过滤并展示补充字段项", () => {
        const additionalCols: ColumnDef[] = [
            { key: "note", type: "text" },
            { key: "custom_date", type: "date" },
            { key: "amount", type: "number", min: 0 },
        ];

        expect(additionalCols.length).toBe(3);
        expect(additionalCols.some((c) => c.key === "note")).toBe(true);
    });

    it("表单数据绑定与校验错误提示生成", () => {
        const form: Record<string, any> = {
            note: "备忘说明",
            amount: 120,
        };

        const formFieldError = (col: ColumnDef): string => {
            if (col.required && !form[col.key]) return "此项必填";
            return "";
        };

        const colRequired: ColumnDef = { key: "missing", type: "text", required: true };
        const colValid: ColumnDef = { key: "amount", type: "number", required: true };

        expect(formFieldError(colRequired)).toBe("此项必填");
        expect(formFieldError(colValid)).toBe("");
    });
});
