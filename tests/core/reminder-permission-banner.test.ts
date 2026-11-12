import { describe, it, expect, vi } from "vitest";

describe("reminder-permission-banner (权限拒绝警告与一键重建提示横幅)", () => {
    it("点击重扫按钮分派重新扫描动作", () => {
        const onRescan = vi.fn();
        function handleRescan(rescanning: boolean) {
            if (rescanning) return;
            onRescan();
        }

        handleRescan(true);
        expect(onRescan).not.toHaveBeenCalled();

        handleRescan(false);
        expect(onRescan).toHaveBeenCalledTimes(1);
    });

    it("根据重扫状态正确生成文本和 aria-busy 属性", () => {
        function resolveButtonState(rescanning: boolean, t: (k: string) => string) {
            return {
                text: rescanning ? t("diag.rebuilding") : t("hub.rescan"),
                disabled: rescanning,
                busy: rescanning,
            };
        }

        const t = (k: string) => (k === "diag.rebuilding" ? "重建中..." : "重新扫描");

        expect(resolveButtonState(true, t)).toEqual({
            text: "重建中...",
            disabled: true,
            busy: true,
        });

        expect(resolveButtonState(false, t)).toEqual({
            text: "重新扫描",
            disabled: false,
            busy: false,
        });
    });
});
