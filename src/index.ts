import { Plugin, showMessage, openTab, Custom, getFrontend } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import TabPanel from "@/panels/tab-panel.svelte";
import HomeSettingsPanel from "@/panels/settings.svelte";
import { svelteDialog } from "@/libs/dialog";
import { loadSettings, saveSettings } from "@/core/settings";
import { loadRuntime, saveRuntime, purgeHandled, listHandled, type HubRuntime } from "@/core/hub/runtime";
import { runScan, deriveVisible, type ScanResult } from "@/core/hub/scanner";
import { buildScanProviders } from "@/core/hub/registry";
import { dailyDigest, markNotified, inSilentHours, weeklyPreview, markWeeklyNotified } from "@/core/hub/notify";
import { complete, snooze, mute, unmute, renew, restore, addMemo, removeMemo, updateMemo } from "@/core/hub/actions";
import { getProvisioningReport, provisionModule, type ProvisioningReport } from "@/core/provisioner";
import { createSingleFlightUntilStable } from "@/core/single-flight";
import { loadRowLogs } from "@/core/rowlog";
import { compactUserMessage, sameOriginReturnPath } from "@/core/auth";
import { logCheckinEventSafely } from "@/libs/ecosystem-bridge-kit";
import { initEcosystemIntegration, type EcosystemController } from "@/core/ecosystem-integration";
import { createMobileController, type MobileController } from "@/core/mobile-controller";
import { registerPluginContextMenus, type PluginContextMenusController } from "@/core/plugin-context-menus";
import { SCHEMA_CATALOG, validateSchema } from "@/core/schema";
import type { HomeSettings } from "@/types";

const TAB_TYPE = "hub-tab";
/** 版本显示（诊断/关于）：构建时由 vite define 从 plugin.json 注入（REL-01 版本单源，勿写字面量） */
const PLUGIN_VERSION = __PLUGIN_VERSION__;

/**
 * 小驴管家（Lv Home）
 * 家庭与生活管家：成员档案 · 资产 · 育儿上学 · 病历社保 · 影音书库 · 出行旅行
 */
export default class LvHomePlugin extends Plugin {
    settings: HomeSettings;
    runtime: HubRuntime;
    scan: ScanResult;
    private heartbeat: number | undefined;
    /** 所有延迟回调统一登记，确保卸载时没有匿名计时器继续访问插件实例。 */
    private readonly timeoutIds = new Set<number>();
    /** 统一处理内核鉴权失效，避免每个面板各自跳转或留下空白状态。 */
    private authExpiredHandler?: (event: Event) => void;
    private permissionDeniedHandler?: (event: Event) => void;
    /** Multiple providers can fail with the same expired token in one scan. */
    private authRedirectScheduled = false;
    /** moduleId → schema 目录（193 波收口为 SCHEMA_CATALOG 单源；UI 按需读取列定义/枚举，与 ensureCoreLedgers 同源） */
    schemaCatalog: Record<string, any> = SCHEMA_CATALOG;
    /** Tab 面板刷新回调（支持多实例，33.1：所有打开的管家面板同步刷新） */
    hubListeners = new Set<() => void>();
    /** 扫描序号（H11）：慢的旧扫描不得覆写新扫描结果或之后的手动动作 */
    private scanSeq = 0;
    private readonly provisionLedgersSingleFlight = createSingleFlightUntilStable(
        () => [...new Set(this.settings.enabledModules)].sort().join("\0"),
        () => this.provisionLedgers(),
    );
    /** 生态集成控制器（雷切动作、服务桥、打卡/考试/闪卡/任务事件联动） */
    private ecosystemController?: EcosystemController;
    /** 下次面板挂载的目标页签（状态栏/通知入口预选） */
    pendingScreen?: string;
    /** 已挂载面板的页签直切回调（tab-panel 挂载时注册、卸载时清空） */
    panelScreenSwitch?: (screen: string) => void;
    private statusbarEl?: HTMLElement;
    /** 309 波：addTopBar 返回的顶栏元素（存活守护用；onunload 清理） */
    private topBarEl?: HTMLElement;
    /** 309 波：顶栏被宿主重建后的重挂守护 */
    private topBarObserver?: MutationObserver;
    private isUnloading = false;
    private topBarReviveTimer?: number;
    private isMobileFrontend = false;
    /** 移动前端顶栏与全屏面板适配控制器（DEVICE-07） */
    private mobileController?: MobileController;
    /** 原生菜单联动控制器（块菜单、块图标菜单、自定义 URL、AV 右键菜单、WS 同步监听） */
    private contextMenusController?: PluginContextMenusController;
    /** C6c captureTo idempotency window: duplicate block-menu clicks while
     * the first kernel write is still pending must not add duplicate rows. */
    private readonly captureDedupe = new Map<string, number>();
    private lastScanAt = 0;
    /** 20 组：全量扫描去抖——Tab/面板快速开关 30 秒内不重复全量（增量扫描与手动强制不受限） */
    private static FULL_SCAN_MIN_MS = 30 * 1000;
    /** 状态栏角标更新（28 组：今日到期 N） */
    private updateStatusbar(count: number) {
        if (!this.statusbarEl) return;
        this.statusbarEl.textContent = `⏰ ${count}`;
        this.statusbarEl.style.display = count > 0 ? "" : "none";
        this.statusbarEl.setAttribute("aria-label", this.i18nText("statusbar.tip").replace("${n}", String(count)));
        this.statusbarEl.title = this.i18nText("statusbar.tip").replace("${n}", String(count));
    }

    /** i18n 取值（1.2.8 起 i18n 为 JSONValue，字符串位置统一转 string） */
    i18nText(key: string): string {
        return String(this.i18n[key] ?? key);
    }

    private createTopBarOptions() {
        return {
            id: "siyuan-home-topbar",
            icon: "iconLvHome",
            title: String(this.i18n.butler ?? "Lv Home"),
            callback: () => this.showTab(),
            contextMenu: (menu: any) => {
                if (!menu || typeof menu.addItem !== "function") return;
                menu.addItem({
                    icon: "iconZap",
                    label: "⚡ " + (this.i18n["faq.quickCapture"] ?? "快速记录"),
                    click: () => {
                        this.showTab();
                        window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                    },
                });
                menu.addItem({
                    icon: "iconClock",
                    label: "⏰ " + (this.i18n.tabReminders ?? "到期提醒"),
                    click: () => this.openRemindersScreen(),
                });
                menu.addItem({
                    icon: "iconFolder",
                    label: "🗂️ " + (this.i18n.tabLedger ?? "家庭台账"),
                    click: () => this.openModuleTab(this.activeLedger),
                });
                menu.addItem({
                    icon: "iconUser",
                    label: "👥 " + (this.i18n.tabMembers ?? "家庭成员"),
                    click: () => {
                        this.pendingScreen = "members";
                        if (this.panelScreenSwitch) this.panelScreenSwitch("members");
                        this.showTab();
                    },
                });
                if (typeof menu.addSeparator === "function") menu.addSeparator();
                menu.addItem({
                    icon: "iconSettings",
                    label: "⚙️ " + (this.i18n.settingsTitle ?? "管家设置"),
                    click: () => this.openSetting(),
                });
            },
        };
    }

    /**
     * 309 波：所有思源 UI 入口的同步登记（页签/顶栏/命令/状态栏/图标）。
     * 必须在 onload 的首个 await 之前调用：宿主在 onload 返回前完成顶栏与页签装配，
     * 位于 await 之后的登记可能落不到 toolbar —— 这正是“顶栏图标突然消失”的根因。
     */
    private registerEntrypoints(): void {
        const self = this;

        // 全端无条件注册官方统一山墙小屋+烟囱火种矢量图标 (iconLvHome)
        this.isMobileFrontend = getFrontend() === "mobile" || getFrontend() === "browser-mobile";
        this.mobileController = createMobileController({
            plugin: this,
            t: (k) => this.i18nText(k),
            isMobileFrontend: this.isMobileFrontend,
            scheduleTimeout: (fn, delay) => this.scheduleTimeout(fn, delay),
        });
        if (typeof this.addIcons === "function") {
            this.addIcons(`<symbol id="iconLvHome" viewBox="0 0 32 32">
                <path d="M20 9V6h3v5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 14 16 4.5 28 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 13.5V26c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V13.5" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M13 28v-6c0-1.7 1.3-3 3-3s3 1.3 3 3v6" fill="currentColor"/>
                <circle cx="21.5" cy="4" r="2.5" fill="currentColor"/>
            </symbol>`);
        }

        // Tab 面板：init 时挂载 Svelte，destroy 时卸载（同一 Tab 可多次打开）
        const unmounts = new WeakMap<Element, () => void>();
        this.addTab({
            type: TAB_TYPE,
            init(this: Custom) {
                const um = mount(TabPanel, { target: this.element, props: { plugin: self } });
                unmounts.set(this.element, um as () => void);
            },
            destroy(this: Custom) {
                const um = unmounts.get(this.element);
                if (um) unmount(um as any);
            },
        });

        // 启动前排查并清除任何残留的历史顶栏与状态栏节点，确保全局唯一
        if (typeof document !== "undefined") {
            const staleIcons = document.querySelectorAll('#toolbar [data-id="siyuan-home-topbar"], #toolbar [id*="siyuan-home"], #toolbar [aria-label*="小驴管家"], #toolbar [aria-label*="Lv Home"]');
            staleIcons.forEach((el) => el.remove());
            const staleStatus = document.querySelectorAll('#status .lv-statusbar, .lv-statusbar');
            staleStatus.forEach((el) => el.remove());
            const staleMobile = document.querySelectorAll("#lvHomeMobileTopBarButton");
            staleMobile.forEach((el) => el.remove());
        }

        // 顶栏入口（桌面端图标 + 点击开面板，支持固定 id 幂等注册与原生右键菜单）
        this.topBarEl = this.addTopBar(this.createTopBarOptions());
        this.ensureTopBarIconAlive();

        const butlerLabel = String(this.i18n.butler ?? "小驴管家");

        // 1. 命令面板：打开小驴管家主面板
        this.addCommand({
            langKey: "openButler",
            langText: `${butlerLabel}：${this.i18nText("openButler")}`,
            hotkey: "Ctrl+Alt+H",
            callback: () => this.showTab(),
        });

        // 2. 命令面板：⚡ 快速记录流水/便签/档案
        this.addCommand({
            langKey: "quickCapture",
            langText: `${butlerLabel}：${this.i18n["faq.quickCapture"] ?? "快速记录流水/便签"}`,
            hotkey: "",
            callback: () => {
                this.showTab();
                window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
            },
        });

        // 3. 命令面板：🔍 全景生活检索
        this.addCommand({
            langKey: "spotlightSearch",
            langText: `${butlerLabel}：${this.i18n["spotlight.title"] ?? "全景生活检索"}`,
            hotkey: "",
            callback: () => {
                this.showTab();
                window.dispatchEvent(new CustomEvent("siyuan-home:open-spotlight"));
            },
        });

        // 4. 命令面板：⏰ 到期提醒中枢
        this.addCommand({
            langKey: "openReminders",
            langText: `${butlerLabel}：${this.i18n.tabReminders ?? "到期提醒中枢"}`,
            hotkey: "",
            callback: () => this.openRemindersScreen(),
        });

        // 5. 命令面板：🗂️ 家庭台账列表
        this.addCommand({
            langKey: "openLedger",
            langText: `${butlerLabel}：${this.i18n.tabLedger ?? "家庭台账列表"}`,
            hotkey: "",
            callback: () => this.openModuleTab(this.activeLedger),
        });

        // 6. 命令面板：🚨 家庭急救卡与医疗资料
        this.addCommand({
            langKey: "openEmergencyCard",
            langText: `${butlerLabel}：${this.i18n["overview.emergencyCard"] ?? "家庭急救卡与医疗资料"}`,
            callback: () => {
                this.showTab();
                window.dispatchEvent(new CustomEvent("siyuan-home:open-emergency"));
            },
        });

        // 7. 命令面板：👥 家庭成员档案管理
        this.addCommand({
            langKey: "openMembers",
            langText: `${butlerLabel}：${this.i18n.tabMembers ?? "家庭成员档案"}`,
            callback: () => {
                this.pendingScreen = "members";
                if (this.panelScreenSwitch) this.panelScreenSwitch("members");
                this.showTab();
            },
        });

        // 8. 命令面板：⚙️ 管家设置选项
        this.addCommand({
            langKey: "openSettings",
            langText: `${butlerLabel}：${this.i18n.settingsTitle ?? "管家设置选项"}`,
            callback: () => this.openSetting(),
        });

        // 9. 思源原生编辑器斜杠菜单（Slash Commands）深度联动
        this.protyleSlash = [
            {
                filter: ["lvhome", "guanjiia", "xiaolv", "管家", "快速记录", "记一笔", "记账"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">⚡ ${butlerLabel}：${this.i18n["faq.quickCapture"] ?? "快速记录流水/便签"}</span></div>`,
                id: "lvHomeSlashQuickCapture",
                callback: (_protyle: any, nodeElement: HTMLElement) => {
                    const text = nodeElement?.textContent?.trim() ?? "";
                    this.showTab();
                    window.dispatchEvent(new CustomEvent("siyuan-home:open-capture", { detail: { text } }));
                },
            },
            {
                filter: ["lvhome", "home", "guanjiia", "管家", "家庭管家", "小驴管家"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">🏠 ${butlerLabel}：${this.i18nText("openButler")}</span></div>`,
                id: "lvHomeSlashOpen",
                callback: () => this.showTab(),
            },
            {
                filter: ["lvrem", "tixing", "提醒", "到期提醒", "中枢"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">⏰ ${butlerLabel}：${this.i18n.tabReminders ?? "到期提醒中枢"}</span></div>`,
                id: "lvHomeSlashReminders",
                callback: () => this.openRemindersScreen(),
            },
        ];

        // 28 组：状态栏「今日到期 N」角标（点击打开管家并预选提醒页）
        const statusEl = document.createElement("div");
        statusEl.className = "lv-statusbar";
        statusEl.style.cssText = "cursor:pointer;padding:0 6px;font-size:12px;display:none";
        statusEl.onclick = () => this.openRemindersScreen();
        this.addStatusBar({ element: statusEl });
        this.statusbarEl = statusEl;
    }

    private scheduleTimeout(callback: () => void, delay: number): number {
        let timer = 0;
        timer = window.setTimeout(() => {
            this.timeoutIds.delete(timer);
            callback();
        }, delay);
        this.timeoutIds.add(timer);
        return timer;
    }

    /**
     * 309 波：顶栏图标存活守护。宿主会在主题切换/窗口重建/插件热重载时重建 #toolbar，
     * 把已注册的条目元素丢掉——表现为图标“突然消失”。这里用一次轻量 MutationObserver
     * 观察顶栏容器，一旦发现我们的按钮离开文档，就重新调用 addTopBar 登记（同插件内幂等）。
     * 增加卸载守卫与 300ms 防抖，彻底避免在宿主卸载/销毁插件时与 DOM 清理发生瞬间抢挂与排布闪烁。
     * 只在桌面端生效；卸载时断开观察。
     */
    private ensureTopBarIconAlive(): void {
        if (this.isMobileFrontend || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return;
        this.topBarObserver?.disconnect();
        const observer = new MutationObserver(() => {
            if (this.isUnloading) return;
            // 自动排重守护：查找 toolbar 中所有属于管家的按钮
            const icons = toolbar.querySelectorAll('[data-id="siyuan-home-topbar"], [id*="siyuan-home"], [aria-label*="小驴管家"], [aria-label*="Lv Home"]');
            if (icons.length > 1) {
                // 如果发现多个同名图标，自动清理多余的，严格只保留 1 个！
                for (let i = 1; i < icons.length; i++) {
                    icons[i].remove();
                }
                return;
            }
            if (icons.length === 1) {
                this.topBarEl = icons[0] as HTMLElement;
                return; // 已经有且仅有 1 个，绝不重复创建！
            }
            if (this.topBarEl && this.topBarEl.isConnected) return;
            if (!document.getElementById("toolbar")) return;
            if (this.topBarReviveTimer !== undefined) window.clearTimeout(this.topBarReviveTimer);
            this.topBarReviveTimer = window.setTimeout(() => {
                this.topBarReviveTimer = undefined;
                if (this.isUnloading) return;
                const checkAgain = toolbar.querySelectorAll('[data-id="siyuan-home-topbar"], [id*="siyuan-home"], [aria-label*="小驴管家"], [aria-label*="Lv Home"]');
                if (checkAgain.length > 0) {
                    for (let i = 1; i < checkAgain.length; i++) checkAgain[i].remove();
                    this.topBarEl = checkAgain[0] as HTMLElement;
                    return;
                }
                if (!document.getElementById("toolbar")) return;
                try {
                    this.topBarEl = this.addTopBar(this.createTopBarOptions());
                } catch {
                    // 宿主尚未装配完成：留给下一次 DOM 变更重试
                }
            }, 300);
        });
        observer.observe(toolbar, { childList: true });
        this.topBarObserver = observer;
    }

    private hubChangedScheduled = false;
    /** 微任务级合并广播：多次数据变更自动合为一次 UI 响应，彻底杜绝短时间内高频 re-render 引起的页面抖动 */
    emitHubChanged(): void {
        if (this.hubChangedScheduled) return;
        this.hubChangedScheduled = true;
        queueMicrotask(() => {
            this.hubChangedScheduled = false;
            this.hubListeners.forEach((fn) => fn());
        });
    }

    async onload() {
        // 309 波（顶栏图标突然消失的真因）：思源宿主在插件 onload 返回前完成顶栏/页签装配，
        // 历史实现在 `await loadSettings/loadRuntime` 之后才 addTopBar，注册时机落在装配窗口之外，
        // 重载/热更新后条目就会丢失（图标“突然消失”，面板同时被重新渲染）。
        // 修法：所有 UI 登记全部提到第一个 await 之前，同步完成。
        this.registerEntrypoints();

        this.settings = await loadSettings(this);
        this.runtime = await loadRuntime(this);

        // All API wrappers dispatch the same event for expired sessions. Keep
        // the current location in sessionStorage so the host login page can
        // return here, and fail closed while credentials are being renewed.
        this.authExpiredHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ returnTo?: unknown }>).detail;
            const currentLocation = typeof location !== "undefined"
                ? `${location.pathname}${location.search}${location.hash}`
                : "/";
            const candidate = typeof detail?.returnTo === "string" && detail.returnTo ? detail.returnTo : currentLocation;
            const returnTo = sameOriginReturnPath(candidate, location.origin, currentLocation);
            try { sessionStorage.setItem("siyuan-home:auth-return", returnTo); } catch { /* storage may be unavailable */ }
            if (this.runtime?.cache) {
                const errors = (this.runtime.cache.errors ?? []).filter((error) => error.moduleId !== "auth");
                this.runtime.cache = { ...this.runtime.cache, errors: [...errors, { moduleId: "auth", message: this.i18nText("auth.expired") }] };
            }
            if (this.scan) {
                const errors = (this.scan.errors ?? []).filter((error) => error.moduleId !== "auth");
                this.scan = { ...this.scan, stale: true, errors: [...errors, { moduleId: "auth", message: this.i18nText("auth.expired") }] };
            }
            this.emitHubChanged();
            showMessage(this.i18nText("auth.expired"), 7000, "error");
            const authPath = "/check-auth";
            if (!this.authRedirectScheduled && location.pathname !== authPath && !location.pathname.startsWith(`${authPath}/`)) {
                const target = `${authPath}?returnTo=${encodeURIComponent(returnTo)}`;
                this.authRedirectScheduled = true;
                this.scheduleTimeout(() => {
                    // Avoid racing a successful login or repeatedly redirecting
                    // if several requests fail in the same render cycle.
                    if (location.pathname === authPath || location.pathname.startsWith(`${authPath}/`)) return;
                    location.assign(target);
                }, 0);
            }
        };
        window.addEventListener("siyuan-home:auth-expired", this.authExpiredHandler);
        this.permissionDeniedHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ message?: unknown }>).detail;
            const message = compactUserMessage(detail?.message, this.i18nText("permission.denied"));
            if (this.runtime?.cache) {
                const errors = (this.runtime.cache.errors ?? []).filter((error) => error.moduleId !== "permission");
                this.runtime.cache = {
                    ...this.runtime.cache,
                    errors: [...errors, { moduleId: "permission", message }],
                };
            }
            if (this.scan) {
                const errors = (this.scan.errors ?? []).filter((error) => error.moduleId !== "permission");
                this.scan = { ...this.scan, stale: true, errors: [...errors, { moduleId: "permission", message }] };
            }
            this.emitHubChanged();
            showMessage(message, 7000, "error");
        };
        window.addEventListener("siyuan-home:permission-denied", this.permissionDeniedHandler);
        try {
            const restored = sessionStorage.getItem("siyuan-home:auth-return");
            if (restored) {
                const current = `${location.pathname}${location.search}${location.hash}`;
                const targetPath = sameOriginReturnPath(restored, location.origin, current);
                if (targetPath && targetPath !== current) {
                    // Some SiYuan versions honor returnTo themselves and some
                    // return to the workspace root. Restore the same-origin
                    // location saved before redirect in either case.
                    location.replace(new URL(targetPath, location.origin).href);
                } else {
                    sessionStorage.removeItem("siyuan-home:auth-return");
                    this.scheduleTimeout(() => {
                        this.showTab();
                        showMessage(this.i18nText("auth.restored"), 3500, "info");
                    }, 100);
                }
            }
        } catch { /* storage may be unavailable */ }

        // DEVICE-07（227 波）：移动前端标识（图标符号与按钮注入已在 registerEntrypoints 中完成）
        this.mobileController?.ensureMobileTopBarButton();

        // 309 波：页签/顶栏/命令/图标的注册已全部移到 registerEntrypoints()，
        // 在 onload 的首个 await 之前同步完成（宿主装配窗口内）——此处不再重复登记。

        // schema 契约门禁（33.2；193 波收口 SCHEMA_CATALOG 单源）：开发期发现违规立即暴露
        for (const [id, schema] of Object.entries(SCHEMA_CATALOG)) {
            const errors = validateSchema(id, schema);
            if (errors.length) console.error("[LvHome] schema contract violations:", errors);
        }

        // 欢迎提示与初次引导优化：
        // 1. 仅在全新空白安装且从未提示过时给出温馨提示；
        // 2. 凡已有成员、已有台账、已完成向导、或当前会话已提示过的，坚决不弹，彻底杜绝重复弹窗打扰
        const isFreshInstall = !this.settings.onboarded && this.settings.members.length === 0 && Object.keys(this.settings.dbRefs).length === 0;
        if (isFreshInstall && !this.runtime?.firstRunWelcomed) {
            if (this.runtime) this.runtime.firstRunWelcomed = true;
            showMessage(this.i18nText("firstRun"), 5000, "info");
        }

        // 15 组：settings.json 损坏已回退默认 → 明确警告（诊断区可见 settings.json.corrupted.json 标记）
        if (this.settings.corruptedSettings) {
            // 269 波：损坏原因就地显示（用户不必翻 marker 文件）；时长 8s→10s 给足阅读时间
            const reason = this.settings.corruptedSettings;
            const detail = typeof reason === "string" ? `（${reason}）` : "";
            showMessage(this.i18nText("settings.corrupted") + detail, 10000, "error");
        }

        // B2d 降级定案（kernel.js 无定时器 API）：前端心跳 30min 驱动定时扫描
        this.heartbeat = window.setInterval(() => {
            this.refreshHub().catch((e) => console.warn("[LvHome] heartbeat scan failed:", e));
        }, 30 * 60 * 1000);

        // 注册思源原生菜单与事件监听（块菜单、块图标菜单、自定义 URL、AV 属性视图菜单、WS 变更节流同步与休眠唤醒补扫）
        this.contextMenusController = registerPluginContextMenus({
            plugin: this,
            eventBus: this.eventBus,
            t: (k) => this.i18nText(k),
            i18n: this.i18n,
            quickCapture: (text) => this.quickCapture(text),
            captureTo: (moduleId, text) => this.captureTo(moduleId, text),
            showTab: () => this.showTab(),
            openRemindersScreen: () => this.openRemindersScreen(),
            setActiveLedger: (mod) => this.setActiveLedger(mod),
            refreshHub: (only, force) => this.refreshHub(only, force),
        });

        // 初始化小驴生态深度联动（雷切快捷动作与小组件、服务桥 window.LvHome、打卡/考试/闪卡/任务事件）
        this.ecosystemController = initEcosystemIntegration({
            plugin: this,
            t: (k: string) => this.i18nText(k),
            showTab: () => this.showTab(),
            openRemindersScreen: () => this.openRemindersScreen(),
            openModuleTab: (m: string) => this.openModuleTab(m),
            addMemo: (title: string, due: string) => this.addMemo(title, due),
            complete: (r: any) => this.complete(r),
            markReminderDoneByBlockId: (bId: string) => this.markReminderDoneByBlockId(bId),
            emitHubChanged: () => this.emitHubChanged(),
        });
    }

    /** 布局就绪后：首次引导数据准备 + 智能找回历史台账 + 扫描（不阻塞启动，不强制全量建库） */
    async onLayoutReady() {
        try {
            await this.adoptHistoryLedgers();
            await this.refreshHub(undefined, true);
        } catch (e) {
            console.warn("[LvHome] initial adopt/scan deferred:", e instanceof Error ? e.message : e);
        }
    }

    /**
     * 覆盖思源官方生命周期钩子（根治重载死循环的终极钥匙）：
     * 思源官方规范明确说明：未覆盖 onDataChanged 方法的插件在收到存储变更时会强制重载整个插件（卸载并重新加载）。
     * 覆盖此方法后，思源内核在存储数据更新时将直接回调本方法，绝不重载插件，彻底根除顶栏闪烁、页面抖动与向导重启循环！
     */
    async onDataChanged(reason?: any): Promise<void> {
        if (this.isUnloading) return;
        try {
            const nextSettings = await loadSettings(this);
            this.settings = nextSettings;
            this.runtime = await loadRuntime(this);
            this.emitHubChanged();
            // 契约延伸：若是云端跨设备同步 (sync) 带来的变更，触发只读补扫更新到期提醒，实现多端感知
            if (reason === "sync") {
                this.refreshHub(undefined, false).catch(() => undefined);
            }
        } catch (e) {
            console.warn("[LvHome] onDataChanged sync failed:", e);
        }
    }

    /** 智能扫描并找回思源中已有的全部历史台账（老版本平滑升级匹配） */
    async adoptHistoryLedgers() {
        const { discoverAndAdoptAllLedgers } = await import("@/core/provisioner");
        const resolveName = (key: string) => String(this.i18n[`field.${key}`] ?? this.i18nText(key));
        const report = await discoverAndAdoptAllLedgers(this.settings, this.schemaCatalog, resolveName);
        if (report.adoptedCount > 0) {
            try {
                await saveSettings(this, this.settings);
            } catch { /* soft persist */ }
        }
        return report;
    }

    /** members 先建（relation 目标），其余按需；幂等。启用模块才建库（P4）。
     * 12 轮修复：遍历 schemaCatalog（members 声明序居首），删除第二份手工清单防漂移 */
    async ensureCoreLedgers(): Promise<ProvisioningReport> {
        await this.provisionLedgersSingleFlight();
        return getProvisioningReport(this.settings);
    }

    /** 单模块独立自愈/建库（毫秒级执行，不阻塞其他模块） */
    async repairModule(moduleId: string): Promise<any> {
        const schema = this.schemaCatalog[moduleId];
        if (!schema) return;
        const resolveName = (key: string) => String(this.i18n[`field.${key}`] ?? key);
        const res = await provisionModule(this.settings, moduleId, schema, this.i18nText("module." + moduleId), {
            resolveName,
            reconcileGhostColumns: true,
        });
        try {
            await saveSettings(this, this.settings);
        } catch (e) {
            console.warn("[LvHome] saveSettings in repairModule failed:", e);
        }
        await this.refreshHub(moduleId, true);
        return res;
    }

    private async provisionLedgers(): Promise<void> {
        const resolveName = (key: string) => String(this.i18n[`field.${key}`] ?? key);
        const enabled = new Set(this.settings.enabledModules);
        for (const [id, schema] of Object.entries(this.schemaCatalog)) {
            if (!enabled.has(id)) continue;
            await provisionModule(this.settings, id, schema, this.i18nText("module." + id), { resolveName });
        }
        try {
            await saveSettings(this, this.settings);
        } catch (e) {
            console.warn("[LvHome] saveSettings in provision failed:", e);
        }
    }

    /** 扫描 → 运行态合并 → 缓存 → 每日摘要 → 通知面板。
     * PF06：传入模块范围则只实扫这些模块（写行后的增量刷新），其余沿用上次快照；
     * 20 组：非强制全量扫描 30 秒内去抖（Tab 快速开关不重复全量），force 用于手动重扫/设置变更 */
    async refreshHub(only?: string | string[], force = false): Promise<ScanResult> {
        const seq = ++this.scanSeq;
        // PF01/PF02：性能标记（PerformanceObserver / DevTools 可读取）
        const perfMark = `lvhome-scan-${seq}`;
        performance.mark(`${perfMark}-start`);
        const onlySet = only ? new Set(Array.isArray(only) ? only : [only]) : undefined;
        if (!onlySet && !force && this.lastScanAt && Date.now() - this.lastScanAt < LvHomePlugin.FULL_SCAN_MIN_MS) {
            const cached = this.scan;
            if (cached) {
                this.emitHubChanged();
                return cached;
            }
        }
        // 264 波：行数口径收集器——providers 经 deps.onStats 上报，runScan 并入 byModule 快照
        const moduleStats = new Map<string, { rowCount: number; memberCounts: Record<string, number> }>();
        const deps = {
            settings: this.settings,
            getDbRef: (id: string) => this.settings.dbRefs[id],
            loadRowLogs: () => loadRowLogs(this),
            t: (key: string) => this.i18nText(key),
            onStats: (id: string, stats: { rowCount: number; memberCounts: Record<string, number> }) => moduleStats.set(id, stats),
        };
        // 12 轮修复：provider 由 schemaCatalog 程序化派生（手工清单曾漏掉 parenting/schooling，
        // 两模块提醒从未生效）；覆盖契约见 registry.providerCoverage
        const providers = buildScanProviders(this.schemaCatalog, deps);
        const scan = await runScan(providers, this.settings, this.runtime, new Date(), onlySet, moduleStats);
        // H11：扫描期间已有更新的扫描启动（或手动动作已改运行态）→ 旧结果丢弃，不落盘不广播
        if (seq !== this.scanSeq) return scan;
        this.scan = scan;
        this.runtime.cache = {
            reminders: scan.reminders,
            counts: scan.counts,
            errors: scan.errors,
            derived: scan.derived,
            byModule: scan.byModule,
        };
        this.runtime.scannedAt = scan.scannedAt;
        // 摘要与逾期提示只在全量扫描时评估（PF06 增量扫描的数据是部分的，少报会压制当天真实提醒）
        if (!onlySet) {
            const digest = dailyDigest(scan, this.settings, this.runtime);
            if (digest.shouldNotify) {
                markNotified(this.runtime);
                const text = this.i18nText("notify.digest")
                    .replace("${overdue}", String(digest.overdue))
                    .replace("${soon}", String(digest.soon));
                showMessage(text, 6000, "info");
            }
            // B3b：逾期事项每日首次发现立即提示（H12：与摘要共用静默判断）
            const { localDateKey } = await import("@/core/hub/rule");
            const today = localDateKey(new Date());
            let pushedOverdueAlert = false;
            if (scan.counts.overdue > 0 && !inSilentHours(this.settings, this.runtime) && this.runtime.lastOverdueAlertDate !== today) {
                this.runtime.lastOverdueAlertDate = today;
                showMessage(this.i18nText("notify.overdue").replace("${n}", String(scan.counts.overdue)), 6000, "error");
                pushedOverdueAlert = true;
            }
            // 229 波：Webhook 推送（路线图"下一阶段"）——随摘要/逾期首报两个既定时点外发一次；
            // 用户显式配置才启用；失败静默（sendWebhook 内部吞错），绝不阻断本地提醒
            if (digest.shouldNotify || pushedOverdueAlert) {
                const { sendWebhook, buildDigestBody } = await import("@/core/webhook");
                const topTitles = scan.reminders
                    .filter((r) => r.level === "overdue" || (r.level === "soon" && r.daysLeft <= 7))
                    .sort((a, b) => a.daysLeft - b.daysLeft)
                    .slice(0, 3)
                    .map((r) => r.title);
                await sendWebhook(this.settings, buildDigestBody(scan.counts, topTitles));
            }
            // 29 组：每周预告（周日一次，未来 7 天清单计数；ISO 周去重）
            const weekly = weeklyPreview(scan, this.settings, this.runtime);
            if (weekly.shouldNotify) {
                markWeeklyNotified(this.runtime);
                showMessage(this.i18nText("notify.weekly").replace("${n}", String(weekly.upcoming)), 6000, "info");
            }
        }
        // H03：显式清理已完成运行态记录（未处理项永不自动删），清理结果随本次落盘
        purgeHandled(this.runtime, new Date());
        // 29 组月度应到基数：全量扫描时统计当月去重后到期提醒总数（增量扫描不更新，避免少报）
        if (!onlySet) {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const dueIds = new Set(scan.reminders.filter((r) => r.daysLeft <= 0).map((r) => r.id));
            this.runtime.monthlyDueTotals = { ...(this.runtime.monthlyDueTotals ?? {}), [monthKey]: dueIds.size };
            // 266 波模块趋势条：记录当日各模块待办计数（滚动 14 天，同日覆盖），供总览模块卡 spark 渲染
            const { recordModuleHistory } = await import("@/core/hub/runtime");
            recordModuleHistory(this.runtime, scan.reminders, now);
        }
        await saveRuntime(this, this.runtime);
        this.lastScanAt = Date.now();
        performance.mark(`${perfMark}-end`);
        try { performance.measure(perfMark, `${perfMark}-start`, `${perfMark}-end`); } catch { /* PF01 测量标记 */ }
        const todayDue = scan.reminders.filter((r) => r.daysLeft <= 0).length;
        this.updateStatusbar(todayDue);
        this.emitHubChanged();
        return scan;
    }

    /**
     * 动作后即时刷新（H02）：免重扫，从缓存派生列表重算可见集合并广播全部面板。
     * 动作只改运行态，不回写台账（renew 除外——走 refreshHub 全量扫描）。
     */
    async notifyHubChanged(): Promise<void> {
        const { reminders, counts } = deriveVisible(
            this.runtime.cache?.derived ?? [],
            this.settings,
            this.runtime,
        );
        this.scan = {
            ...(this.scan ?? {
                reminders, counts, scannedAt: this.runtime.scannedAt ?? new Date().toISOString(),
                errors: [], stale: false, derived: this.runtime.cache?.derived ?? [], byModule: this.runtime.cache?.byModule ?? {},
            }),
            reminders,
            counts,
        };
        this.runtime.cache = {
            reminders,
            counts,
            errors: this.runtime.cache?.errors ?? [],
            derived: this.runtime.cache?.derived ?? [],
            byModule: this.runtime.cache?.byModule ?? {},
        };
        try {
            await saveRuntime(this, this.runtime);
        } catch (e) {
            // The action itself was already committed by withRuntime. Keep
            // the derived in-memory view current and explain that only its
            // cache snapshot failed; throwing here would falsely imply the
            // action failed and invite a duplicate completion.
            const detail = e instanceof Error ? e.message : String(e);
            const message = this.i18nText("hub.cacheSaveFailed").replace("${msg}", detail);
            this.scan = { ...this.scan, stale: true, errors: [...(this.scan.errors ?? []), { moduleId: "runtime", message: detail }] };
            showMessage(message, 6500, "error");
        }
        this.updateStatusbar(reminders.filter((r) => r.daysLeft <= 0).length);
        this.emitHubChanged();
    }

    /**
     * C6c：选中文字快速存入（非 URL → snippets.content）。
     */
    async quickCapture(text: string) {
        if (/^https?:\/\/\S+$/i.test(text)) return; // URL 走块菜单二级分流（capture.menuUrl 子项）
        await this.captureTo("snippets", text);
    }

    /**
     * C6c 收尾：按目标模块写入——bookmarks.url / address.address_full / snippets.content
     */
    async captureTo(moduleId: "bookmarks" | "address" | "snippets", text: string) {
        const { executeCaptureTo } = await import("@/core/quick-capture-action");
        await executeCaptureTo({
            plugin: this,
            moduleId,
            text,
            captureDedupe: this.captureDedupe,
            t: (k) => this.i18nText(k),
        });
    }

    showTab() {
        // 已有管家页签时聚焦而非新开（重复点顶栏/命令不再堆叠页签，225 波真机发现）。
        // 前端无公开的"聚焦已开自定义页签"API——走页签头 DOM 事件（与用户点击同源行为）；
        // 多开的旧页签逐个点其关闭钮回收（对象全部是本插件的页签）。
        const title = this.i18nText("butler");
        const heads = Array.from(document.querySelectorAll<HTMLElement>(".layout-tab-bar .item"));
        const mine = heads.filter((h) => h.querySelector(".item__text")?.textContent?.trim() === title);
        if (mine.length) {
            for (const h of mine.slice(0, -1)) h.querySelector(".item__close")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            mine[mine.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return;
        }
        openTab({
            app: this.app,
            custom: {
                id: `${this.name}${TAB_TYPE}`,
                title,
                icon: "iconHome",
            },
        });
    }

    /** 打开面板并预选提醒页签——pendingScreen 仅在挂载时消费（SiYuan 会恢复上次打开的页签，
     *  日常路径几乎总是"已挂载"），已挂载时经 panelScreenSwitch 直切（2026-10-09 R6 实证修复）。 */
    openRemindersScreen() {
        this.pendingScreen = "reminders";
        this.showTab();
        this.panelScreenSwitch?.("reminders");
    }

    /** 导航并打开指定台账模块（如 "assets" | "members" | "medicine" | "vehicle" 等） */
    openModuleTab(moduleId: string) {
        this.pendingScreen = moduleId;
        this.showTab();
        this.panelScreenSwitch?.(moduleId);
    }

    /** 打开台账文档或定位具体块（R5 降级定位） */
    showTabDocs(docId?: string, blockId?: string) {
        const targetId = blockId ?? docId ?? this.settings.dbRefs[this.activeLedger]?.docId;
        if (!targetId) return;
        openTab({
            app: this.app,
            doc: {
                id: targetId,
                action: blockId ? ["cb-get-focus", "cb-get-hl"] : ["cb-get-focus"],
            },
            keepCursor: false,
        });
    }

    activeLedger = "certs";
    setActiveLedger(id: string) { this.activeLedger = id; }

    /** 诊断数据（33.5/A6）：台账落点状态、最近扫描、扫描错误、schema 契约 */
    getDiagnostics() {
        return {
            version: PLUGIN_VERSION,
            scannedAt: this.runtime?.scannedAt,
            errors: this.scan?.errors ?? [],
            ledgers: Object.entries(this.settings.dbRefs).map(([id, ref]: [string, any]) => ({
                id,
                provisioned: !!ref?.docId,
                provisional: !!ref?.provisional,
                columns: Object.keys(ref?.columns ?? {}).length,
                error: ref?.provisionError,
            })),
            contracts: [
                validateSchema("members", SCHEMA_CATALOG.members),
                validateSchema("certs", SCHEMA_CATALOG.certs),
            ].flat(),
        };
    }

    // ── 提醒动作（B4 + H05/H07，转发 actions.ts；动作后 notifyHubChanged 即时刷新）──
    /**
     * 联动 Task Horizon（任务视界）：根据 blockId（或 rowId / id）反向核销管家待办事项
     */
    async markReminderDoneByBlockId(blockId: string): Promise<boolean> {
        if (!blockId) return false;
        const bid = String(blockId).trim();
        const target = (this.scan?.reminders ?? []).find((r: any) =>
            r.rowId === bid || r.id === bid || (r.id && r.id.includes(bid))
        );
        if (target) {
            await this.complete(target);
            return true;
        }
        return false;
    }

    async complete(r: any) {
        await complete(this, r);
        // 事务完成联动打卡（Epoch 6 联邦规范）
        try {
            const today = new Date().toISOString().slice(0, 10);
            const rowId = r.rowId || r.id || "item";
            const modId = r.moduleId || "general";
            await logCheckinEventSafely({
                itemId: `home_${modId}`,
                externalRef: `home:${modId}:${rowId}:${today}`,
                note: r.title ? `办结家庭事项：${r.title}` : `办结家庭事项（${modId}）`,
            });
        } catch { /* 零强依赖优雅降级 */ }
        await this.notifyHubChanged();
    }
    async snooze(id: string, days: number) { await snooze(this, id, days); await this.notifyHubChanged(); }
    async mute(id: string) { await mute(this, id); await this.notifyHubChanged(); }
    async unmute(id: string) { await unmute(this, id); await this.notifyHubChanged(); }
    /** 恢复已处理/忽略项（H07） */
    async restore(id: string) { await restore(this, id); await this.notifyHubChanged(); }
    /** 续期写回台账行（H10：按规则自己的 field 列，缴费不改保障到期日）→ 增量重扫该模块 */
    renew(r: any, iso: string) {
        const rule = (this.schemaCatalog[r.moduleId]?.reminders ?? []).find((x: any) => x.key === r.ruleKey);
        return renew(this, r, iso, this.settings.dbRefs[r.moduleId] ?? {}, rule?.field ?? "expiry")
            .then(() => this.refreshHub(r.moduleId));
    }
    async addMemo(title: string, due: string) { await addMemo(this, title, due); await this.notifyHubChanged(); }
    async updateMemo(id: string, patch: { title?: string; dueDate?: string }) { await updateMemo(this, id, patch); await this.notifyHubChanged(); }
    /** 删除备忘（显式动作，H03：未处理备忘只经此删除） */
    async removeMemo(id: string) { await removeMemo(this, id); await this.notifyHubChanged(); }
    /** 29 组：今日免打扰快捷开关（todaySilent 存当日 localDateKey，跨天自动失效；闸口在 inSilentHours） */
    async toggleTodaySilent() {
        const { localDateKey } = await import("@/core/hub/rule");
        const today = localDateKey(new Date());
        this.runtime.todaySilent = this.runtime.todaySilent === today ? "" : today;
        await saveRuntime(this, this.runtime);
        showMessage(this.i18nText(this.runtime.todaySilent ? "hub.todaySilentOn" : "hub.todaySilentOff"), 3000, "info");
        await this.notifyHubChanged();
    }
    /** 已处理视图数据（H07） */
    listHandled() { return listHandled(this.runtime, this.runtime.cache?.derived ?? []); }
    async finishOnboarding(household: { roles: string[]; children: number }, moduleIds: string[]) {
        this.settings.household = household as any;
        this.settings.enabledModules = Array.from(new Set([...this.settings.enabledModules, ...moduleIds]));
        // C7c：建库批处理进度提示（31 模块串行需数秒；起止均有反馈，失败落 dbRefs.provisionError 诊断可见）
        showMessage(this.i18nText("wiz.provisioning").replace("${n}", String(moduleIds.length)), 4000, "info");
        const provisioning = await this.ensureCoreLedgers();
        this.settings.onboarded = true;
        await saveSettings(this, this.settings);
        // C7c 收尾：建库失败浮出（此前只进诊断区，向导完成后用户无感）
        const failed = provisioning.issues.map(({ moduleId }) => this.i18nText(`module.${moduleId}`));
        if (failed.length > 0) {
            showMessage(this.i18nText("wiz.provisionIssues")
                .replace("${n}", String(failed.length))
                .replace("${modules}", failed.join("、")), 8000, "error");
        } else {
            showMessage(this.i18nText("wiz.provisioned").replace("${n}", String(moduleIds.length)), 3000, "info");
        }
        // Onboarding provisions ledgers and may add member rows. Force the
        // first post-wizard scan so the overview is built from fresh data.
        await this.refreshHub(undefined, true);
    }

    /** Tab 面板挂载入口（tab callback 由框架调 addTab 注册的 destroy 之外回调） */
    mountPanel(element: HTMLElement) {
        const unmount = mount(TabPanel, {
            target: element,
            props: { plugin: this },
        });
        return unmount;
    }

    openSetting() {
        svelteDialog({
            title: this.i18nText("settingsTitle"),
            component: HomeSettingsPanel,
            props: { plugin: this, settings: this.settings },
            width: "min(920px, calc(100vw - 32px))",
            height: "min(760px, calc(100vh - 96px))",
        });
    }

    onunload() {
        this.isUnloading = true;
        if (this.topBarReviveTimer !== undefined) {
            window.clearTimeout(this.topBarReviveTimer);
            this.topBarReviveTimer = undefined;
        }
        // 309 波：断开顶栏复活观察器，避免卸载后重建条目
        if (this.topBarObserver) {
            this.topBarObserver.disconnect();
            this.topBarObserver = undefined;
        }
        // 显式清理顶栏图标，避免重载时旧实例的 DOM 节点滞留在 toolbar 中导致两个图标
        try {
            this.removeTopBar("siyuan-home-topbar");
        } catch { /* soft cleanup */ }
        this.topBarEl?.remove();
        this.topBarEl = undefined;
        if (typeof document !== "undefined") {
            const staleIcons = document.querySelectorAll('#toolbar [data-id="siyuan-home-topbar"], #toolbar [id*="siyuan-home"], #toolbar [aria-label*="小驴管家"], #toolbar [aria-label*="Lv Home"]');
            staleIcons.forEach((el) => el.remove());
        }
        if (this.heartbeat) window.clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        for (const timer of this.timeoutIds) window.clearTimeout(timer);
        this.timeoutIds.clear();
        if (this.authExpiredHandler) window.removeEventListener("siyuan-home:auth-expired", this.authExpiredHandler);
        this.authExpiredHandler = undefined;
        this.authRedirectScheduled = false;
        if (this.permissionDeniedHandler) window.removeEventListener("siyuan-home:permission-denied", this.permissionDeniedHandler);
        this.permissionDeniedHandler = undefined;
        this.mobileController?.dispose();
        this.mobileController = undefined;
        this.contextMenusController?.dispose();
        this.contextMenusController = undefined;
        this.ecosystemController?.dispose();
        this.ecosystemController = undefined;
        this.statusbarEl?.remove();
        this.statusbarEl = undefined;
        if (typeof document !== "undefined") {
            document.querySelectorAll(".lv-statusbar").forEach((el) => el.remove());
        }
        this.hubListeners.clear();
        this.scanSeq++;
    }
}
