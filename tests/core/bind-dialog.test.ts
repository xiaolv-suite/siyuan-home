import { describe, it, expect, vi } from "vitest";
import { openBindExistingDocDialog } from "@/core/bind-dialog";

describe("bind-dialog (绑定已有文档为台账向导弹窗)", () => {
    it("openBindExistingDocDialog 安全容错调用", () => {
        expect(() => {
            openBindExistingDocDialog({
                active: "certs",
                schema: { columns: [{ key: "name", name: "名称", type: "text" }] } as any,
                plugin: { settings: { dbRefs: {} } },
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });
});
