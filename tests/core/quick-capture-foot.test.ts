import { describe, it, expect, vi } from "vitest";

describe("quick-capture-foot (快速记录弹层底部动作栏)", () => {
    it("生活事件流模式与台账建档模式分派对应保存动作", () => {
        const onSubmitEvent = vi.fn();
        const onSaveLedger = vi.fn();

        function handleSave(mode: "event" | "ledger", continueAfter = false) {
            if (mode === "event") onSubmitEvent();
            else onSaveLedger(continueAfter);
        }

        handleSave("event");
        expect(onSubmitEvent).toHaveBeenCalledTimes(1);

        handleSave("ledger", true);
        expect(onSaveLedger).toHaveBeenCalledWith(true);

        handleSave("ledger", false);
        expect(onSaveLedger).toHaveBeenCalledWith(false);
    });

    it("身份确认待定状态下展示校验提示标签", () => {
        function resolveButtonLabel(identityPending: boolean, pendingRowId?: string) {
            return (identityPending || pendingRowId) ? "重试" : "保存";
        }

        expect(resolveButtonLabel(true)).toBe("重试");
        expect(resolveButtonLabel(false, "row-123")).toBe("重试");
        expect(resolveButtonLabel(false)).toBe("保存");
    });
});
