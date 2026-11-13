import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initPluginAuthGuard } from "@/core/plugin-auth-guard";

class MockWindow {
    private listeners = new Map<string, Set<(e: any) => void>>();
    addEventListener(type: string, handler: (e: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(handler);
    }
    removeEventListener(type: string, handler: (e: any) => void) {
        this.listeners.get(type)?.delete(handler);
    }
    dispatchEvent(event: any) {
        const handlers = this.listeners.get(event.type);
        if (handlers) {
            for (const h of handlers) h(event);
        }
        return true;
    }
}

class MockCustomEvent {
    detail?: any;
    constructor(public type: string, opts?: { detail?: any }) {
        this.detail = opts?.detail;
    }
}

describe("plugin-auth-guard", () => {
    let mockPlugin: any;
    let storageMap: Map<string, string>;
    let mockWin: MockWindow;

    beforeEach(() => {
        storageMap = new Map();
        const mockSessionStorage = {
            getItem: (k: string) => storageMap.get(k) ?? null,
            setItem: (k: string, v: string) => storageMap.set(k, String(v)),
            removeItem: (k: string) => storageMap.delete(k),
            clear: () => storageMap.clear(),
        };
        mockWin = new MockWindow();
        (globalThis as any).window = mockWin;
        (globalThis as any).CustomEvent = MockCustomEvent;
        (globalThis as any).sessionStorage = mockSessionStorage;
        (globalThis as any).location = {
            origin: "http://localhost:6806",
            pathname: "/",
            search: "",
            hash: "",
            assign: vi.fn(),
            replace: vi.fn(),
        };

        mockPlugin = {
            runtime: {
                cache: {
                    errors: [],
                },
            },
            scan: {
                errors: [],
                stale: false,
            },
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete (globalThis as any).window;
        delete (globalThis as any).CustomEvent;
        delete (globalThis as any).sessionStorage;
        delete (globalThis as any).location;
    });

    it("捕获 siyuan-home:auth-expired 事件时记录错误并保存返回路径", () => {
        const emitHubChanged = vi.fn();
        const scheduleTimeout = vi.fn((fn) => { fn(); return 1; });
        const showTab = vi.fn();

        const guard = initPluginAuthGuard({
            plugin: mockPlugin,
            t: (k) => k,
            emitHubChanged,
            scheduleTimeout,
            showTab,
        });

        mockWin.dispatchEvent(
            new MockCustomEvent("siyuan-home:auth-expired", {
                detail: { returnTo: "/stage/build/app/" },
            }),
        );

        expect(emitHubChanged).toHaveBeenCalled();
        expect(mockPlugin.runtime.cache.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ moduleId: "auth" })]),
        );
        expect(mockPlugin.scan.stale).toBe(true);
        expect(storageMap.get("siyuan-home:auth-return")).toBe("/stage/build/app/");

        guard.dispose();
    });

    it("捕获 siyuan-home:permission-denied 事件时记录权限错误并触发更新", () => {
        const emitHubChanged = vi.fn();
        const scheduleTimeout = vi.fn();
        const showTab = vi.fn();

        const guard = initPluginAuthGuard({
            plugin: mockPlugin,
            t: (k) => k,
            emitHubChanged,
            scheduleTimeout,
            showTab,
        });

        mockWin.dispatchEvent(
            new MockCustomEvent("siyuan-home:permission-denied", {
                detail: { message: "用户无权访问该资源" },
            }),
        );

        expect(emitHubChanged).toHaveBeenCalled();
        expect(mockPlugin.runtime.cache.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ moduleId: "permission", message: "用户无权访问该资源" })]),
        );
        expect(mockPlugin.scan.stale).toBe(true);

        guard.dispose();
    });

    it("checkRestoredAuth 在发现返回路径时执行恢复并清空标记", () => {
        storageMap.set("siyuan-home:auth-return", "/");
        const emitHubChanged = vi.fn();
        const scheduleTimeout = vi.fn((fn) => { fn(); return 1; });
        const showTab = vi.fn();

        const guard = initPluginAuthGuard({
            plugin: mockPlugin,
            t: (k) => k,
            emitHubChanged,
            scheduleTimeout,
            showTab,
        });

        guard.checkRestoredAuth();

        expect(storageMap.get("siyuan-home:auth-return")).toBeUndefined();
        expect(scheduleTimeout).toHaveBeenCalled();
        expect(showTab).toHaveBeenCalled();

        guard.dispose();
    });
});
