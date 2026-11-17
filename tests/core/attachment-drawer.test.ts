import { describe, it, expect, vi } from "vitest";
import { renderAttachmentDrawerSection } from "@/core/attachment-drawer";

describe("attachment-drawer (详情抽屉附件预览、下载与OCR)", () => {
    it("renderAttachmentDrawerSection 边界安全容错调用", () => {
        expect(() => {
            renderAttachmentDrawerSection({
                body: {} as any,
                assetCols: [{ key: "attachments", type: "mAsset" }],
                ref: { avId: "av-1", columns: { attachments: "col-att" } },
                row: { cells: {} },
                active: "certs",
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });
});
