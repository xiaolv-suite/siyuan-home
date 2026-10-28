import { describe, it, expect, vi } from "vitest";
import { createMobileController } from "@/core/mobile-controller";

describe("mobile-controller (移动端顶栏入口与全屏面板适配器)", () => {
    it("非移动端环境下安全跳过顶栏注入", () => {
        const mockPlugin = { app: {} };
        const ctrl = createMobileController({
            plugin: mockPlugin,
            t: (k: string) => k,
            isMobileFrontend: false,
        });

        expect(() => ctrl.ensureMobileTopBarButton()).not.toThrow();
        expect(() => ctrl.openMobilePanel()).not.toThrow();
        expect(() => ctrl.dispose()).not.toThrow();
    });

    it("移动端环境下顶栏未就绪时触发延迟重试调度", () => {
        (globalThis as any).document = {
            getElementById: vi.fn().mockReturnValue(null),
            querySelectorAll: vi.fn().mockReturnValue([]),
        };
        const scheduleTimeout = vi.fn().mockReturnValue(123);
        const ctrl = createMobileController({
            plugin: {},
            t: (k: string) => k,
            isMobileFrontend: true,
            scheduleTimeout,
        });

        try {
            ctrl.ensureMobileTopBarButton();
            // document.getElementById("mobileTopBar") 为 null 时应安排 800ms 重试
            expect(scheduleTimeout).toHaveBeenCalledWith(expect.any(Function), 800);
        } finally {
            delete (globalThis as any).document;
            ctrl.dispose();
        }
    });
});
