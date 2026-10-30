import { describe, it, expect, vi } from "vitest";

describe("ledger-record-foot (台账建档弹层底部动作栏)", () => {
    it("正确分派保存动作（继续录入与保存关闭）", () => {
        const onSaveNewRecord = vi.fn();

        function handleSave(continueAfter: boolean) {
            onSaveNewRecord(continueAfter);
        }

        handleSave(true);
        expect(onSaveNewRecord).toHaveBeenCalledWith(true);

        handleSave(false);
        expect(onSaveNewRecord).toHaveBeenCalledWith(false);
    });

    it("身份待定状态下展示核查台账与放弃未决草稿选项", () => {
        const onOpenPendingLedger = vi.fn();
        const onDiscardUncertainDraft = vi.fn();

        function handlePendingAction(action: "check" | "discard") {
            if (action === "check") onOpenPendingLedger();
            else onDiscardUncertainDraft();
        }

        handlePendingAction("check");
        expect(onOpenPendingLedger).toHaveBeenCalledTimes(1);

        handlePendingAction("discard");
        expect(onDiscardUncertainDraft).toHaveBeenCalledTimes(1);
    });

    it("部分写入与草稿清空按钮文案动态判定", () => {
        function resolveClearButtonLabel(pendingItemID: string | null) {
            return pendingItemID ? "放弃部分记录" : "清空草稿";
        }

        expect(resolveClearButtonLabel("row-999")).toBe("放弃部分记录");
        expect(resolveClearButtonLabel(null)).toBe("清空草稿");
    });

    it("保存进行中 (saving) 强力阻断重复提交并发", () => {
        function canClickSubmit(saving: boolean, canSubmit: boolean) {
            return !saving && canSubmit;
        }

        expect(canClickSubmit(true, true)).toBe(false);
        expect(canClickSubmit(false, true)).toBe(true);
        expect(canClickSubmit(false, false)).toBe(false);
    });
});
