import { describe, it, expect } from "vitest";
import { renderEditableFormFields } from "@/core/record-form";

describe("record-form (详情抽屉动态编辑表单控件生成器)", () => {
    it("renderEditableFormFields 边界安全容错调用", () => {
        const inputs = renderEditableFormFields({
            container: {} as any,
            schemaCols: [{ key: "name", type: "text" }, { key: "status", type: "select", options: ["ok", "pending"] }],
            columns: { name: "col-name", status: "col-status" },
            rowCells: {},
            t: (k) => k,
            rawFromValueFn: () => "",
        });
        expect(Array.isArray(inputs)).toBe(true);
    });
});
