import { describe, it, expect, vi } from "vitest";
import { createMobileController } from "@/core/mobile-controller";

describe("mobile-controller (移动端全屏面板适配器与下滑关闭手势)", () => {
    it("非移动端环境下安全调用不抛异常，且旧顶栏注入方法安全 no-op", () => {
        const mockPlugin = { app: {} };
        const ctrl = createMobileController({
            plugin: mockPlugin,
            t: (k: string) => k,
            isMobileFrontend: false,
        });

        expect(() => ctrl.ensureMobileTopBarButton?.()).not.toThrow();
        expect(() => ctrl.openMobilePanel()).not.toThrow();
        expect(ctrl.isOpen()).toBe(false);
        expect(() => ctrl.closeMobilePanel()).not.toThrow();
        expect(() => ctrl.dispose()).not.toThrow();
    });

    it("移动端环境下支持打开全屏面板、检查状态并支持关闭与销毁", () => {
        const mockPlugin = { app: {}, pendingScreen: "" };
        const ctrl = createMobileController({
            plugin: mockPlugin,
            t: (k: string) => k,
            isMobileFrontend: true,
        });

        expect(ctrl.isOpen()).toBe(false);
        ctrl.openMobilePanel("reminders");
        expect(mockPlugin.pendingScreen).toBe("reminders");
        ctrl.closeMobilePanel();
        expect(ctrl.isOpen()).toBe(false);
        ctrl.dispose();
    });
});
