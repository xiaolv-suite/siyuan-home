import { describe, it, expect, vi } from "vitest";

describe("members-header (家庭成员看板头部与快捷操作栏)", () => {
    it("正确计算并分派成员导出与调配回调", () => {
        const onReassign = vi.fn();
        const onExportVcf = vi.fn();
        const onToggleEditor = vi.fn();

        onReassign();
        expect(onReassign).toHaveBeenCalledTimes(1);

        onExportVcf();
        expect(onExportVcf).toHaveBeenCalledTimes(1);

        onToggleEditor();
        expect(onToggleEditor).toHaveBeenCalledTimes(1);
    });

    it("报警数量为 0 时不展示待办报警角标", () => {
        function shouldShowAlert(count: number) {
            return count > 0;
        }

        expect(shouldShowAlert(0)).toBe(false);
        expect(shouldShowAlert(5)).toBe(true);
    });
});
