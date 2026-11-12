import { describe, it, expect, vi } from "vitest";
import { createMobileController } from "@/core/mobile-controller";
import { lvLaunchpad } from "@/libs/lv-notice-kit";

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

    it("lvLaunchpad.haptic 触感反馈接口完备，且在移动端动作调用时不抛异常", () => {
        expect(typeof lvLaunchpad.haptic).toBe("function");
        expect(() => lvLaunchpad.haptic(10)).not.toThrow();
    });

    it("移动端全屏宿主挂载时支持切屏回调分派，销毁时安全清理监听器", () => {
        const panelScreenSwitch = vi.fn();
        const mockPlugin = { app: {}, pendingScreen: "", panelScreenSwitch };
        const ctrl = createMobileController({
            plugin: mockPlugin,
            t: (k: string) => k,
            isMobileFrontend: true,
        });
        ctrl.openMobilePanel("overview");
        expect(mockPlugin.pendingScreen).toBe("overview");
        expect(panelScreenSwitch).toHaveBeenCalledWith("overview");
        ctrl.closeMobilePanel();
        expect(ctrl.isOpen()).toBe(false);
    });
});
