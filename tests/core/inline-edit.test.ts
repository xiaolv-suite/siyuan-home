import { describe, it, expect, vi } from "vitest";
import { beginInlineEdit } from "@/core/inline-edit";

describe("inline-edit (台账行内编辑微控件与状态流转)", () => {
    it("beginInlineEdit 边界安全容错调用", () => {
        expect(() => {
            beginInlineEdit({
                col: { type: "text", key: "name" },
                keyID: "col-name",
                line: {} as any,
                valueEl: {} as any,
                row: { cells: {} },
                ref: { avId: "av-1", columns: {} },
                active: "certs",
                t: (k) => k,
                rawFromValueFn: () => "",
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });
});
