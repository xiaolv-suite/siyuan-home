import { describe, it, expect, vi } from "vitest";
import { registerPluginContextMenus } from "@/core/plugin-context-menus";

describe("plugin-context-menus (思源右键菜单与原生事件桥接器)", () => {
    it("正确在 eventBus 上挂载与卸载全部菜单监听器", () => {
        const registered = new Map<string, Function>();
        const mockEventBus = {
            on: vi.fn((event: string, fn: Function) => {
                registered.set(event, fn);
            }),
            off: vi.fn((event: string) => {
                registered.delete(event);
            }),
        };

        const mockPlugin = {
            settings: { enabledModules: ["snippets", "bookmarks", "address"] },
        };

        const ctrl = registerPluginContextMenus({
            plugin: mockPlugin,
            eventBus: mockEventBus,
            t: (k: string) => k,
            i18n: { butler: "小驴管家" },
            quickCapture: vi.fn().mockResolvedValue(undefined),
            captureTo: vi.fn().mockResolvedValue(undefined),
            showTab: vi.fn(),
            openRemindersScreen: vi.fn(),
            setActiveLedger: vi.fn(),
            refreshHub: vi.fn().mockResolvedValue(undefined),
        });

        expect(mockEventBus.on).toHaveBeenCalledWith("open-menu-content", expect.any(Function));
        expect(mockEventBus.on).toHaveBeenCalledWith("click-blockicon", expect.any(Function));
        expect(mockEventBus.on).toHaveBeenCalledWith("open-siyuan-url-plugin", expect.any(Function));
        expect(mockEventBus.on).toHaveBeenCalledWith("open-menu-av", expect.any(Function));
        expect(mockEventBus.on).toHaveBeenCalledWith("ws-main", expect.any(Function));

        // 验证注销
        ctrl.dispose();
        expect(mockEventBus.off).toHaveBeenCalledWith("open-menu-content", expect.any(Function));
        expect(mockEventBus.off).toHaveBeenCalledWith("click-blockicon", expect.any(Function));
        expect(mockEventBus.off).toHaveBeenCalledWith("open-siyuan-url-plugin", expect.any(Function));
        expect(mockEventBus.off).toHaveBeenCalledWith("open-menu-av", expect.any(Function));
        expect(mockEventBus.off).toHaveBeenCalledWith("ws-main", expect.any(Function));
    });

    it("siyuan URL scheme 事件分发与屏幕跳转路由", () => {
        const registered = new Map<string, Function>();
        const mockEventBus = {
            on: vi.fn((event: string, fn: Function) => { registered.set(event, fn); }),
            off: vi.fn(),
        };
        const openRemindersScreen = vi.fn();
        const setActiveLedger = vi.fn();
        const showTab = vi.fn();

        registerPluginContextMenus({
            plugin: { settings: { enabledModules: [] } },
            eventBus: mockEventBus,
            t: (k: string) => k,
            i18n: {},
            quickCapture: vi.fn().mockResolvedValue(undefined),
            captureTo: vi.fn().mockResolvedValue(undefined),
            showTab,
            openRemindersScreen,
            setActiveLedger,
            refreshHub: vi.fn().mockResolvedValue(undefined),
        });

        const urlHandler = registered.get("open-siyuan-url-plugin");
        expect(urlHandler).toBeDefined();

        // 1. 跳转提醒中枢
        urlHandler!({ detail: { url: "siyuan://plugins/siyuan-home?screen=reminders" } });
        expect(openRemindersScreen).toHaveBeenCalled();

        // 2. 预选并切换台账
        urlHandler!({ detail: { url: "siyuan://plugins/siyuan-home?module=vehicle" } });
        expect(setActiveLedger).toHaveBeenCalledWith("vehicle");
        expect(showTab).toHaveBeenCalled();
    });
});
