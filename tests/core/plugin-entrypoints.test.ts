import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerPluginEntrypoints, TAB_TYPE } from "@/core/plugin-entrypoints";

class MockElement {
    tagName: string;
    style: Record<string, string> = {};
    className = "";
    innerHTML = "";
    textContent = "";
    dataset: Record<string, string> = {};
    title = "";
    onclick: (() => void) | null = null;
    isConnected = true;
    attributes = new Map<string, string>();

    constructor(tag = "div") {
        this.tagName = tag.toUpperCase();
    }

    setAttribute(key: string, val: string) {
        this.attributes.set(key, val);
    }
    getAttribute(key: string) {
        return this.attributes.get(key) ?? null;
    }
    remove() {
        this.isConnected = false;
    }
    appendChild() {}
    querySelectorAll() {
        return [];
    }
}

class MockMutationObserver {
    constructor(public callback: () => void) {}
    observe() {}
    disconnect() {}
}

class MockWindow {
    dispatchEvent = vi.fn();
}

describe("plugin-entrypoints", () => {
    let mockPlugin: any;
    let mockToolbar: MockElement;
    let mockStatus: MockElement;
    let createdStatusbar: MockElement | undefined;

    beforeEach(() => {
        mockToolbar = new MockElement("div");
        mockStatus = new MockElement("div");
        createdStatusbar = undefined;

        (globalThis as any).MutationObserver = MockMutationObserver;
        (globalThis as any).window = new MockWindow();
        (globalThis as any).document = {
            getElementById: vi.fn((id: string) => {
                if (id === "toolbar") return mockToolbar;
                if (id === "status") return mockStatus;
                return null;
            }),
            querySelectorAll: vi.fn().mockReturnValue([]),
            createElement: vi.fn((tag: string) => {
                const el = new MockElement(tag);
                if (el.className === "lv-statusbar" || tag === "div") {
                    createdStatusbar = el;
                }
                return el;
            }),
        };

        mockPlugin = {
            addIcons: vi.fn(),
            addTab: vi.fn(),
            addTopBar: vi.fn((opts: any) => {
                const el = new MockElement("div");
                el.dataset.id = opts.id || "siyuan-home-topbar";
                el.textContent = opts.title;
                return el;
            }),
            removeTopBar: vi.fn(),
            addCommand: vi.fn(),
            addStatusBar: vi.fn(),
            protyleSlash: [],
        };
    });

    afterEach(() => {
        delete (globalThis as any).MutationObserver;
        delete (globalThis as any).document;
        delete (globalThis as any).window;
        vi.clearAllMocks();
    });

    it("同步完成图标、页签、顶栏、命令、斜杠指令与状态栏的注册", () => {
        const showTab = vi.fn();
        const openRemindersScreen = vi.fn();
        const openModuleTab = vi.fn();
        const openSetting = vi.fn();
        const getActiveLedger = vi.fn(() => "certs");
        const setPendingScreen = vi.fn();
        const getPanelScreenSwitch = vi.fn(() => vi.fn());
        const scheduleTimeout = vi.fn((fn) => { fn(); return 1; });

        const i18n = {
            butler: "小驴管家",
            tabReminders: "到期提醒",
            tabLedger: "家庭台账",
            tabMembers: "家庭成员",
            settingsTitle: "管家设置",
            openButler: "打开管家",
            "faq.quickCapture": "快速记录",
            "spotlight.title": "生活检索",
            "overview.emergencyCard": "急救卡",
            "statusbar.tip": "今日到期 ${n} 项",
        };

        const controller = registerPluginEntrypoints({
            plugin: mockPlugin,
            t: (k) => i18n[k as keyof typeof i18n] ?? k,
            i18n,
            showTab,
            openRemindersScreen,
            openModuleTab,
            openSetting,
            getActiveLedger,
            setPendingScreen,
            getPanelScreenSwitch,
            scheduleTimeout,
            mountTab: vi.fn(),
        });

        // 1. 图标注册
        expect(mockPlugin.addIcons).toHaveBeenCalled();
        expect(mockPlugin.addIcons.mock.calls[0][0]).toContain("iconLvHome");

        // 2. 页签注册
        expect(mockPlugin.addTab).toHaveBeenCalledWith(
            expect.objectContaining({ type: TAB_TYPE }),
        );

        // 3. 顶栏注册
        expect(mockPlugin.addTopBar).toHaveBeenCalled();
        expect(controller.getTopBarEl()).toBeDefined();

        // 4. 命令面板注册（8 个命令）
        expect(mockPlugin.addCommand).toHaveBeenCalledTimes(8);
        const registeredCommands = mockPlugin.addCommand.mock.calls.map((c: any) => c[0].langKey);
        expect(registeredCommands).toContain("openButler");
        expect(registeredCommands).toContain("quickCapture");
        expect(registeredCommands).toContain("spotlightSearch");
        expect(registeredCommands).toContain("openReminders");
        expect(registeredCommands).toContain("openLedger");
        expect(registeredCommands).toContain("openEmergencyCard");
        expect(registeredCommands).toContain("openMembers");
        expect(registeredCommands).toContain("openSettings");

        // 5. 斜杠菜单指令
        expect(mockPlugin.protyleSlash).toHaveLength(3);
        const slashIds = mockPlugin.protyleSlash.map((s: any) => s.id);
        expect(slashIds).toContain("lvHomeSlashQuickCapture");
        expect(slashIds).toContain("lvHomeSlashOpen");
        expect(slashIds).toContain("lvHomeSlashReminders");

        // 6. 状态栏注册与更新
        expect(mockPlugin.addStatusBar).toHaveBeenCalled();
        controller.updateStatusbar(3);
        expect(createdStatusbar).toBeDefined();
        expect(createdStatusbar?.textContent).toBe("⏰ 3");
        expect(createdStatusbar?.title).toContain("3 项");

        controller.updateStatusbar(0);
        expect(createdStatusbar?.style.display).toBe("none");

        // 7. 销毁逻辑
        controller.dispose();
        expect(mockPlugin.removeTopBar).toHaveBeenCalledWith("siyuan-home-topbar");
    });

    it("顶栏右键上下文菜单项能正常触发对应动作", () => {
        const showTab = vi.fn();
        const openRemindersScreen = vi.fn();
        const openModuleTab = vi.fn();
        const openSetting = vi.fn();
        const setPendingScreen = vi.fn();
        const panelSwitch = vi.fn();
        const getPanelScreenSwitch = vi.fn(() => panelSwitch);

        let topBarOpts: any;
        mockPlugin.addTopBar = vi.fn((opts: any) => {
            topBarOpts = opts;
            return new MockElement("div");
        });

        registerPluginEntrypoints({
            plugin: mockPlugin,
            t: (k) => k,
            i18n: { butler: "小驴管家" },
            showTab,
            openRemindersScreen,
            openModuleTab,
            openSetting,
            getActiveLedger: () => "medicine",
            setPendingScreen,
            getPanelScreenSwitch,
            scheduleTimeout: vi.fn(),
            mountTab: vi.fn(),
        });

        expect(topBarOpts).toBeDefined();
        const menuItems: any[] = [];
        const mockMenu = {
            addItem: (item: any) => menuItems.push(item),
            addSeparator: vi.fn(),
        };

        topBarOpts.contextMenu(mockMenu);
        expect(menuItems.length).toBe(5);

        // 快速记录
        menuItems[0].click();
        expect(showTab).toHaveBeenCalled();
        expect((window as any).dispatchEvent).toHaveBeenCalled();

        // 到期提醒
        menuItems[1].click();
        expect(openRemindersScreen).toHaveBeenCalled();

        // 家庭台账
        menuItems[2].click();
        expect(openModuleTab).toHaveBeenCalledWith("medicine");

        // 家庭成员
        menuItems[3].click();
        expect(setPendingScreen).toHaveBeenCalledWith("members");
        expect(panelSwitch).toHaveBeenCalledWith("members");
        expect(showTab).toHaveBeenCalled();

        // 管家设置
        menuItems[4].click();
        expect(openSetting).toHaveBeenCalled();
    });
});
