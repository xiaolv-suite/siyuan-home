import { type Custom, getFrontend } from "siyuan";
import { createMobileController, type MobileController } from "@/core/mobile-controller";

export const TAB_TYPE = "hub-tab";

export interface PluginEntrypointsOptions {
    plugin: any;
    t: (key: string) => string;
    i18n: Record<string, any>;
    showTab: () => void;
    openRemindersScreen: () => void;
    openModuleTab: (moduleId: string) => void;
    openSetting: () => void;
    getActiveLedger: () => string;
    setPendingScreen: (screen: string) => void;
    getPanelScreenSwitch: () => ((screen: string) => void) | undefined;
    scheduleTimeout: (fn: () => void, delay: number) => number;
    mountTab?: (element: HTMLElement | Element) => (() => void);
}

export interface PluginEntrypointsController {
    updateStatusbar(count: number): void;
    getTopBarEl(): HTMLElement | undefined;
    getMobileController(): MobileController | undefined;
    dispose(): void;
}

/**
 * 思源 UI 同步入口控制器：
 * 负责页签、顶栏、命令面板、状态栏、斜杠指令及存活守护的装配与卸载。
 * 必须在 onload 的首个 await 之前同步调用，确保在宿主装配窗口内完成登记。
 */
export function registerPluginEntrypoints(options: PluginEntrypointsOptions): PluginEntrypointsController {
    const {
        plugin,
        t,
        i18n,
        showTab,
        openRemindersScreen,
        openModuleTab,
        openSetting,
        getActiveLedger,
        setPendingScreen,
        getPanelScreenSwitch,
        scheduleTimeout,
        mountTab,
    } = options;

    const isMobileFrontend = getFrontend() === "mobile" || getFrontend() === "browser-mobile";
    const mobileController = createMobileController({
        plugin,
        t,
        isMobileFrontend,
        scheduleTimeout,
    });

    // 全端无条件注册思源 litheness 24x24 线性矢量图标 (iconLvHome / iconHome / iconLocation / iconUser)
    if (typeof plugin.addIcons === "function") {
        plugin.addIcons(`<symbol id="iconLvHome" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" fill="none"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none"/>
        </symbol>
        <symbol id="icon-lv-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" fill="none"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none"/>
        </symbol>
        <symbol id="iconHome" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" fill="none"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none"/>
        </symbol>
        <symbol id="iconLocation" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" fill="none"/>
            <circle cx="12" cy="10" r="3" fill="none"/>
        </symbol>
        <symbol id="iconUser" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" fill="none"/>
            <circle cx="12" cy="7" r="4" fill="none"/>
        </symbol>`);
    }

    // Tab 面板：init 时挂载 Svelte，destroy 时卸载（同一 Tab 可多次打开）
    const unmounts = new WeakMap<Element, () => void>();
    plugin.addTab({
        type: TAB_TYPE,
        init(this: Custom) {
            if (mountTab) {
                const um = mountTab(this.element);
                if (um) unmounts.set(this.element, um);
            }
        },
        destroy(this: Custom) {
            const um = unmounts.get(this.element);
            if (um) {
                try { um(); } catch { /* soft unmount */ }
            }
        },
    });

    // 启动前排查并清除任何残留的历史顶栏与状态栏节点，确保全局唯一
    if (typeof document !== "undefined") {
        const staleIcons = document.querySelectorAll(
            '#toolbar [data-id="siyuan-home-topbar"], #toolbar [id^="plugin_siyuan-home"], #toolbar [aria-label="小驴管家"], #toolbar [aria-label="Lv Home"]',
        );
        staleIcons.forEach((el) => el.remove());
        const staleStatus = document.querySelectorAll('#status .lv-statusbar, .lv-statusbar');
        staleStatus.forEach((el) => el.remove());
        const staleMobile = document.querySelectorAll("#lvHomeMobileTopBarButton");
        staleMobile.forEach((el) => el.remove());
    }

    function createTopBarOptions() {
        return {
            id: "siyuan-home-topbar",
            icon: "iconLvHome",
            title: String(i18n.butler ?? "Lv Home"),
            callback: () => showTab(),
            contextMenu: (menu: any) => {
                if (!menu || typeof menu.addItem !== "function") return;
                menu.addItem({
                    icon: "iconZap",
                    label: "⚡ " + (i18n["faq.quickCapture"] ?? "快速记录"),
                    click: () => {
                        showTab();
                        window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                    },
                });
                menu.addItem({
                    icon: "iconClock",
                    label: "⏰ " + (i18n.tabReminders ?? "到期提醒"),
                    click: () => openRemindersScreen(),
                });
                menu.addItem({
                    icon: "iconFolder",
                    label: "🗂️ " + (i18n.tabLedger ?? "家庭台账"),
                    click: () => openModuleTab(getActiveLedger()),
                });
                menu.addItem({
                    icon: "iconUser",
                    label: "👥 " + (i18n.tabMembers ?? "家庭成员"),
                    click: () => {
                        setPendingScreen("members");
                        const switchFn = getPanelScreenSwitch();
                        if (switchFn) switchFn("members");
                        showTab();
                    },
                });
                if (typeof menu.addSeparator === "function") menu.addSeparator();
                menu.addItem({
                    icon: "iconSettings",
                    label: "⚙️ " + (i18n.settingsTitle ?? "管家设置"),
                    click: () => openSetting(),
                });
            },
        };
    }

    let topBarEl: HTMLElement | undefined = plugin.addTopBar(createTopBarOptions());
    (plugin as any).topBarElement = topBarEl;
    let topBarObserver: MutationObserver | undefined;
    let topBarReviveTimer: number | undefined;
    let isDisposed = false;

    /**
     * 309 波：顶栏图标存活守护。宿主会在主题切换/窗口重建/插件热重载时重建 #toolbar，
     * 把已注册的条目元素丢掉——表现为图标“突然消失”。这里用一次轻量 MutationObserver
     * 观察顶栏容器，一旦发现我们的按钮离开文档，就重新调用 addTopBar 登记（同插件内幂等）。
     */
    function ensureTopBarIconAlive(): void {
        if (isMobileFrontend || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return;
        topBarObserver?.disconnect();
        const observer = new MutationObserver(() => {
            if (isDisposed) return;
            // 自动排重守护：查找 toolbar 中所有属于管家的按钮
            const icons = toolbar.querySelectorAll(
                '[data-id="siyuan-home-topbar"], [id^="plugin_siyuan-home"], [aria-label="小驴管家"], [aria-label="Lv Home"]',
            );
            if (icons.length > 1) {
                // 如果发现多个同名图标，自动清理多余的，严格只保留 1 个！
                for (let i = 1; i < icons.length; i++) {
                    icons[i].remove();
                }
                return;
            }
            if (icons.length === 1) {
                topBarEl = icons[0] as HTMLElement;
                return; // 已经有且仅有 1 个，绝不重复创建！
            }
            if (topBarEl && topBarEl.isConnected) return;
            if (!document.getElementById("toolbar")) return;
            if (topBarReviveTimer !== undefined) window.clearTimeout(topBarReviveTimer);
            topBarReviveTimer = window.setTimeout(() => {
                topBarReviveTimer = undefined;
                if (isDisposed) return;
                const checkAgain = toolbar.querySelectorAll(
                    '[data-id="siyuan-home-topbar"], [id^="plugin_siyuan-home"], [aria-label="小驴管家"], [aria-label="Lv Home"]',
                );
                if (checkAgain.length > 0) {
                    for (let i = 1; i < checkAgain.length; i++) checkAgain[i].remove();
                    topBarEl = checkAgain[0] as HTMLElement;
                    return;
                }
                if (!document.getElementById("toolbar")) return;
                try {
                    topBarEl = plugin.addTopBar(createTopBarOptions());
                } catch {
                    // 宿主尚未装配完成：留给下一次 DOM 变更重试
                }
            }, 300);
        });
        observer.observe(toolbar, { childList: true });
        topBarObserver = observer;
    }

    ensureTopBarIconAlive();

    const butlerLabel = String(i18n.butler ?? "小驴管家");

    // 1. 命令面板：打开小驴管家主面板
    plugin.addCommand({
        langKey: "openButler",
        langText: `${butlerLabel}：${t("openButler")}`,
        hotkey: "Ctrl+Alt+H",
        callback: () => showTab(),
    });

    // 2. 命令面板：⚡ 快速记录流水/便签/档案
    plugin.addCommand({
        langKey: "quickCapture",
        langText: `${butlerLabel}：${i18n["faq.quickCapture"] ?? "快速记录流水/便签"}`,
        hotkey: "",
        callback: () => {
            showTab();
            window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
        },
    });

    // 3. 命令面板：🔍 全景生活检索
    plugin.addCommand({
        langKey: "spotlightSearch",
        langText: `${butlerLabel}：${i18n["spotlight.title"] ?? "全景生活检索"}`,
        hotkey: "",
        callback: () => {
            showTab();
            window.dispatchEvent(new CustomEvent("siyuan-home:open-spotlight"));
        },
    });

    // 4. 命令面板：⏰ 到期提醒中枢
    plugin.addCommand({
        langKey: "openReminders",
        langText: `${butlerLabel}：${i18n.tabReminders ?? "到期提醒中枢"}`,
        hotkey: "",
        callback: () => openRemindersScreen(),
    });

    // 5. 命令面板：🗂️ 家庭台账列表
    plugin.addCommand({
        langKey: "openLedger",
        langText: `${butlerLabel}：${i18n.tabLedger ?? "家庭台账列表"}`,
        hotkey: "",
        callback: () => openModuleTab(getActiveLedger()),
    });

    // 6. 命令面板：🚨 家庭急救卡与医疗资料
    plugin.addCommand({
        langKey: "openEmergencyCard",
        langText: `${butlerLabel}：${i18n["overview.emergencyCard"] ?? "家庭急救卡与医疗资料"}`,
        callback: () => {
            showTab();
            window.dispatchEvent(new CustomEvent("siyuan-home:open-emergency"));
        },
    });

    // 7. 命令面板：👥 家庭成员档案管理
    plugin.addCommand({
        langKey: "openMembers",
        langText: `${butlerLabel}：${i18n.tabMembers ?? "家庭成员档案"}`,
        callback: () => {
            setPendingScreen("members");
            const switchFn = getPanelScreenSwitch();
            if (switchFn) switchFn("members");
            showTab();
        },
    });

    // 8. 命令面板：⚙️ 管家设置选项
    plugin.addCommand({
        langKey: "openSettings",
        langText: `${butlerLabel}：${i18n.settingsTitle ?? "管家设置选项"}`,
        callback: () => openSetting(),
    });

    // 9. 思源原生编辑器斜杠菜单（Slash Commands）深度联动
    plugin.protyleSlash = [
        {
            filter: ["lvhome", "guanjiia", "xiaolv", "管家", "快速记录", "记一笔", "记账"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">⚡ ${butlerLabel}：${i18n["faq.quickCapture"] ?? "快速记录流水/便签"}</span></div>`,
            id: "lvHomeSlashQuickCapture",
            callback: (_protyle: any, nodeElement: HTMLElement) => {
                const text = nodeElement?.textContent?.trim() ?? "";
                showTab();
                window.dispatchEvent(new CustomEvent("siyuan-home:open-capture", { detail: { text } }));
            },
        },
        {
            filter: ["lvhome", "home", "guanjiia", "管家", "家庭管家", "小驴管家"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">🏠 ${butlerLabel}：${t("openButler")}</span></div>`,
            id: "lvHomeSlashOpen",
            callback: () => showTab(),
        },
        {
            filter: ["lvrem", "tixing", "提醒", "到期提醒", "中枢"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">⏰ ${butlerLabel}：${i18n.tabReminders ?? "到期提醒中枢"}</span></div>`,
            id: "lvHomeSlashReminders",
            callback: () => openRemindersScreen(),
        },
    ];

    // 28 组：状态栏「今日到期 N」角标（点击打开管家并预选提醒页）
    const statusEl = document.createElement("div");
    statusEl.className = "lv-statusbar";
    statusEl.onclick = () => openRemindersScreen();
    plugin.addStatusBar({ element: statusEl });

    function updateStatusbar(count: number): void {
        if (!statusEl) return;
        statusEl.textContent = `⏰ ${count}`;
        statusEl.style.display = count > 0 ? "" : "none";
        statusEl.setAttribute("aria-label", t("statusbar.tip").replace("${n}", String(count)));
        statusEl.title = t("statusbar.tip").replace("${n}", String(count));
    }

    function dispose(): void {
        isDisposed = true;
        if (topBarReviveTimer !== undefined) {
            window.clearTimeout(topBarReviveTimer);
            topBarReviveTimer = undefined;
        }
        if (topBarObserver) {
            topBarObserver.disconnect();
            topBarObserver = undefined;
        }
        try {
            plugin.removeTopBar("siyuan-home-topbar");
        } catch { /* soft cleanup */ }
        topBarEl?.remove();
        topBarEl = undefined;
        if (typeof document !== "undefined") {
            const staleIcons = document.querySelectorAll(
                '#toolbar [data-id="siyuan-home-topbar"], #toolbar [id^="plugin_siyuan-home"], #toolbar [aria-label="小驴管家"], #toolbar [aria-label="Lv Home"]',
            );
            staleIcons.forEach((el) => el.remove());
        }
        statusEl?.remove();
        if (typeof document !== "undefined") {
            document.querySelectorAll(".lv-statusbar").forEach((el) => el.remove());
        }
        mobileController?.dispose();
    }

    return {
        updateStatusbar,
        getTopBarEl: () => topBarEl,
        getMobileController: () => mobileController,
        dispose,
    };
}
