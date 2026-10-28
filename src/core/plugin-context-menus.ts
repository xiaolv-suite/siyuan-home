export interface PluginContextMenusOptions {
    plugin: any;
    eventBus: any;
    t: (k: string) => string;
    i18n: Record<string, any>;
    quickCapture: (text: string) => Promise<void>;
    captureTo: (moduleId: "bookmarks" | "address" | "snippets", text: string) => Promise<void>;
    showTab: () => void;
    openRemindersScreen: () => void;
    setActiveLedger: (mod: string) => void;
    refreshHub: (only?: string | string[], force?: boolean) => Promise<any>;
}

export interface PluginContextMenusController {
    dispose(): void;
}

export function registerPluginContextMenus(options: PluginContextMenusOptions): PluginContextMenusController {
    const {
        plugin,
        eventBus,
        t,
        i18n,
        quickCapture,
        captureTo,
        showTab,
        openRemindersScreen,
        setActiveLedger,
        refreshHub,
    } = options;

    let lastWsRescan = 0;
    const WS_RESCAN_MIN_MS = 60 * 1000;
    let lastScanAt = 0;
    const WAKE_RESCAN_MIN_MS = 10 * 60 * 1000;

    // C6c：块菜单入口——选中文字 → 存入（URL 命中二级菜单分流：存为网址/存为地址；其余进常用语）
    const captureMenuHandler = ((event: { detail: { menu: { addItem: (item: unknown) => void } } }) => {
        if (typeof window === "undefined") return;
        const text = (window.getSelection()?.toString() ?? "").trim();
        if (!text) return;
        if (/^https?:\/\/\S+$/i.test(text)) {
            event.detail.menu.addItem({
                icon: "iconInbox",
                label: t("capture.menuUrl"),
                submenu: ([
                    { id: "bookmarks", labelKey: "capture.toBookmarks" },
                    { id: "address", labelKey: "capture.toAddress" },
                ] as const).map((it) => ({
                    label: plugin.settings.enabledModules.includes(it.id)
                        ? t(it.labelKey)
                        : `${t(it.labelKey)}（${t(`module.${it.id}`)}${t("capture.off")}）`,
                    click: () => void captureTo(it.id, text),
                })),
            });
            return;
        }
        event.detail.menu.addItem({
            icon: "iconInbox",
            label: t("capture.menu"),
            click: () => void quickCapture(text),
        });
    }) as any;
    eventBus.on("open-menu-content", captureMenuHandler);

    // 块图标菜单（click-blockicon）：点击任何块开头的图标时，菜单中加入“收录到小驴管家”
    const blockIconHandler = (event?: any) => {
        const detail = event?.detail;
        const menu = detail?.menu;
        const blockEl = detail?.blockElements?.[0];
        if (!menu || !blockEl || typeof menu.addItem !== "function") return;
        const text = (blockEl.textContent ?? "").trim();
        if (!text) return;

        menu.addItem({
            icon: "iconLvHome",
            label: "🏠 " + (i18n.butler ?? "小驴管家") + " · 收录本块",
            submenu: ([
                { id: "snippets", labelKey: "capture.toSnippets", icon: "iconPaperclip" },
                { id: "address", labelKey: "capture.toAddress", icon: "iconLocation" },
                { id: "bookmarks", labelKey: "capture.toBookmarks", icon: "iconBookmark" },
            ] as const).map((it) => ({
                icon: it.icon,
                label: plugin.settings.enabledModules.includes(it.id)
                    ? t(it.labelKey)
                    : `${t(it.labelKey)}（${t(`module.${it.id}`)}${t("capture.off")}）`,
                click: () => void captureTo(it.id, text),
            })),
        });
    };
    eventBus.on("click-blockicon", blockIconHandler);

    // 思源插件自定义 URL Scheme 协议监听（siyuan://plugins/siyuan-home?...）
    const siyuanUrlHandler = (event?: any) => {
        const rawUrl = event?.detail?.url;
        if (!rawUrl || typeof rawUrl !== "string") return;
        try {
            const urlObj = new URL(rawUrl.startsWith("siyuan://") ? rawUrl.replace("siyuan://", "http://") : rawUrl);
            const screen = urlObj.searchParams.get("screen");
            const mod = urlObj.searchParams.get("module");
            const action = urlObj.searchParams.get("action");
            if (action === "capture") {
                showTab();
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("siyuan-home:open-capture", { detail: { module: mod } }));
                }
                return;
            }
            if (mod) setActiveLedger(mod);
            if (screen === "reminders") {
                openRemindersScreen();
            } else if (screen) {
                plugin.pendingScreen = screen;
                if (plugin.panelScreenSwitch) plugin.panelScreenSwitch(screen);
                showTab();
            } else {
                showTab();
            }
        } catch { /* ignore malformed urls */ }
    };
    eventBus.on("open-siyuan-url-plugin", siyuanUrlHandler);

    // 思源属性视图（AttributeView 原生数据库）行右键菜单扩展
    const avMenuHandler = (event?: any) => {
        const menu = event?.detail?.menu;
        if (!menu || typeof menu.addItem !== "function") return;
        menu.addItem({
            icon: "iconLvHome",
            label: "🏠 " + (i18n.butler ?? "小驴管家") + " · 打开管理面板",
            click: () => showTab(),
        });
        menu.addItem({
            icon: "iconZap",
            label: "⚡ " + (i18n["faq.quickCapture"] ?? "快速记录"),
            click: () => {
                showTab();
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                }
            },
        });
    };
    eventBus.on("open-menu-av", avMenuHandler);

    // PF13/15 组：休眠/切走后恢复可见 → 补扫
    const visibilityHandler = () => {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
        if (Date.now() - lastScanAt < WAKE_RESCAN_MIN_MS) return;
        lastScanAt = Date.now();
        refreshHub(undefined, true).catch((e: unknown) => console.warn("[LvHome] wake rescan failed:", e));
    };
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", visibilityHandler);
    }

    // PF06/18 组：他端台账变更（websocket 主通道消息）→ 60 秒节流补扫
    const wsHandler = (event?: any) => {
        const detail = event?.detail;
        if (detail && typeof detail === "object") {
            const cmd = detail.cmd;
            if (cmd === "setAppStorage" || cmd === "push_reload") return;
            if (detail.data) {
                const dataStr = typeof detail.data === "string" ? detail.data : JSON.stringify(detail.data);
                if (dataStr.includes("siyuan-home") || dataStr.includes("hub-runtime") || dataStr.includes("petal")) {
                    return;
                }
            }
            const isRelevant = cmd === "databaseIndexCommit" || cmd === "transactions" || cmd === "syncing" || cmd === "synced" || cmd === "dataChanges";
            if (!isRelevant) return;
        }
        if (Date.now() - lastWsRescan < WS_RESCAN_MIN_MS) return;
        lastWsRescan = Date.now();
        refreshHub().catch((e: unknown) => console.warn("[LvHome] ws rescan failed:", e));
    };
    eventBus.on("ws-main", wsHandler);

    return {
        dispose: () => {
            eventBus.off("open-menu-content", captureMenuHandler);
            eventBus.off("click-blockicon", blockIconHandler);
            eventBus.off("open-siyuan-url-plugin", siyuanUrlHandler);
            eventBus.off("open-menu-av", avMenuHandler);
            eventBus.off("ws-main", wsHandler);
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", visibilityHandler);
            }
        },
    };
}
