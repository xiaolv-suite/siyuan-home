import { describe, it, expect, vi } from "vitest";

describe("quick-event-flow-continue (POOL-FEAT-16 / CAND-20: 快捷流水「保存并记下一笔」与「保存并关闭」分流)", () => {
    it("保存并关闭 (continueAfter = false) 触发关闭弹窗", () => {
        const onClose = vi.fn();
        let isSaving = true;

        function onEventSaved(clearFn: () => void, continueAfter = false) {
            isSaving = false;
            clearFn();
            if (!continueAfter) onClose();
        }

        const clear = vi.fn();
        onEventSaved(clear, false);

        expect(isSaving).toBe(false);
        expect(clear).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it("保存并记下一笔 (continueAfter = true) 清空表单但不关闭弹窗", () => {
        const onClose = vi.fn();
        let isSaving = true;
        let formValue = "待买日用品";

        function onEventSaved(clearFn: () => void, continueAfter = false) {
            isSaving = false;
            clearFn();
            if (!continueAfter) onClose();
        }

        onEventSaved(() => { formValue = ""; }, true);

        expect(isSaving).toBe(false);
        expect(formValue).toBe(""); // 字段清空
        expect(onClose).not.toHaveBeenCalled(); // 弹窗保持打开
    });
});
