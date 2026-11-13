import { describe, it, expect, vi } from "vitest";
import { openCsvImportDialog } from "@/core/csv-import-dialog";

describe("csv-import-dialog (CSV批量导入向导弹窗)", () => {
    it("openCsvImportDialog 安全容错调用", () => {
        expect(() => {
            openCsvImportDialog({
                active: "certs",
                ref: { avId: "av-1", columns: { name: "name" } },
                schemaCols: [{ key: "name", name: "名称", type: "text" }],
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });
});
