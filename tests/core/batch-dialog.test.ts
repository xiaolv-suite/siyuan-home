import { describe, it, expect, vi } from "vitest";
import { openBatchMemberDialog, openBatchLocationDialog } from "@/core/batch-dialog";
import type { FamilyMember } from "@/types";

describe("batch-dialog (表格行批量改派成员与存放位置独立弹窗)", () => {
    it("openBatchMemberDialog 空入参安全容错", () => {
        expect(() => {
            openBatchMemberDialog({
                targetCol: "mem_col",
                membersList: [],
                selectedItemIds: [],
                avId: "av-test",
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("openBatchLocationDialog 空入参安全容错", () => {
        expect(() => {
            openBatchLocationDialog({
                targetCol: "loc_col",
                selectedItemIds: [],
                locOptions: ["客厅", "书房"],
                avId: "av-test",
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });
});
