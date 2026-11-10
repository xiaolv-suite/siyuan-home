<script lang="ts">
    import { onMount } from "svelte";
    import type { Component } from "svelte";
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage, lvLaunchpad } from "@/libs/notice";
    import AvatarSettings from "./avatar-settings.svelte";
    import ErrorBoundary from "./error-boundary.svelte";
    import TabRailNav from "./tab-rail-nav.svelte";
    import TabGuestBanner from "./tab-guest-banner.svelte";
    import UiIcon from "@/ui/icon.svelte";
    import type { UiIconName } from "@/ui/icons";
    import type { HomePluginLike } from "@/types/plugin";
    import type { ActivityTarget } from "@/core/activity";
    import { formatLocalTime } from "@/core/date-display";
    import { panelSession, type PluginScreen } from "./panel-session";

    let { plugin, onMobileClose }: { plugin: HomePluginLike; onMobileClose?: () => void } = $props();
    // i18n 取值统一转 string（1.2.8 起 JSONValue；screens 以 props 接收 string 返回的 t）
    const t = (key: string) => String(plugin.i18n[key] ?? key);

    type ScreenId = PluginScreen;
    type ScreenProps = {
        plugin: HomePluginLike;
        t: (key: string) => string;
        version?: number;
        initialScanError?: string;
        onRetryScan?: () => void;
        onCapture?: (moduleId?: string) => void;
        onGoto?: (screen: ScreenId) => void;
    };
    type CaptureProps = { plugin: HomePluginLike; t: (key: string) => string; version?: number; open?: boolean; onClose?: () => void };
    type ScreenComponent = Component<ScreenProps>;
    // The plugin instance is stable for the lifetime of this panel; the
    // session store is intentionally keyed to that initial instance.
    // svelte-ignore state_referenced_locally
    const session = panelSession(plugin);
    let homeEl: HTMLElement;
    let mainStageEl: HTMLElement;
    let restoreTimers: number[] = [];
    let pointerPreparedScreen: ScreenId | null = null;
    // In Svelte 5 runes mode a capitalized component reference is dynamic by
    // default. Keeping this reference capitalized avoids the deprecated
    // <svelte:component> wrapper while preserving lazy loading behavior.
    let ScreenView = $state<ScreenComponent | null>(null);
    let loadedScreen = $state<ScreenId | null>(null);
    let screenLoadError = $state("");
    let screenLoadRequest = 0;
    let CaptureView = $state<Component<CaptureProps> | null>(null);
    let captureLoadRequest = 0;
    const HISTORY_KEY = "__siyuanHomeScreen";
    function isScreen(value: unknown): value is ScreenId {
        return value === "overview" || value === "reminders" || value === "ledger" || value === "members";
    }
    function historyScreen(state: unknown): ScreenId | undefined {
        if (!state || typeof state !== "object") return undefined;
        const value = (state as Record<string, unknown>)[HISTORY_KEY];
        return isScreen(value) ? value : undefined;
    }
    function writeScreenHistory(target: ScreenId, mode: "push" | "replace") {
        try {
            const current = history.state && typeof history.state === "object" && !Array.isArray(history.state)
                ? history.state as Record<string, unknown> : {};
            const next = { ...current, [HISTORY_KEY]: target };
            if (mode === "push") history.pushState(next, "", window.location.href);
            else history.replaceState(next, "", window.location.href);
            try { sessionStorage.setItem("siyuan-home:last-screen", target); } catch { /* Storage can be disabled by the host. */ }
        } catch (error) {
            // A host may keep a non-cloneable state object. Session restore still
            // works in that case, while plugin navigation itself remains usable.
            try { sessionStorage.setItem("siyuan-home:last-screen", target); } catch { /* Storage can be disabled by the host. */ }
            console.warn("[LvHome] Could not add plugin tab to browser history:", error);
        }
    }
    function saveCurrentScroll() {
        if (!isScreen(screen)) return;
        const stageTop = mainStageEl?.scrollTop ?? 0;
        const homeTop = homeEl?.scrollTop ?? 0;
        session.scrollTop[screen] = stageTop > 0 ? stageTop : homeTop;
    }
    function restoreScroll(target: ScreenId) {
        const top = session.scrollTop[target] ?? 0;
        // The keyed screen is replaced after the event handler returns. A
        // second frame makes the restore resilient to the browser moving the
        // focused tab button into view while the new screen is mounted.
        restoreTimers.forEach((timer) => window.clearTimeout(timer));
        restoreTimers = [];
        const apply = () => {
            if (homeEl) homeEl.scrollTop = top;
            if (mainStageEl) mainStageEl.scrollTop = top;
        };
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(() => {
                apply();
                // Ledger rows arrive asynchronously. Keep the restored
                // position stable through that first render without leaving a
                // long-lived timer or fighting later user scrolling.
                restoreTimers.push(window.setTimeout(apply, 80), window.setTimeout(apply, 260));
            });
        });
    }
    function prepareTabNavigation(target: ScreenId) {
        // Pointer focus can scroll the panel to the tab bar before onclick
        // runs. Capture the user's position before that default focus scroll.
        if (screen !== target) {
            saveCurrentScroll();
            pointerPreparedScreen = target;
        } else pointerPreparedScreen = null;
    }
    let lastScreenSwitchTime = 0;
    let pendingSwitchTimer: number | undefined;

    function gotoScreen(s: ScreenId, historyMode: "push" | "replace" | "none" = "push") {
        if (screen === s) { pointerPreparedScreen = null; return; }
        const now = Date.now();
        if (now - lastScreenSwitchTime < 100) {
            if (pendingSwitchTimer) window.clearTimeout(pendingSwitchTimer);
            pendingSwitchTimer = window.setTimeout(() => {
                pendingSwitchTimer = undefined;
                gotoScreen(s, historyMode);
            }, 100 - (now - lastScreenSwitchTime));
            return;
        }
        lastScreenSwitchTime = now;
        if (pendingSwitchTimer) {
            window.clearTimeout(pendingSwitchTimer);
            pendingSwitchTimer = undefined;
        }
        if (pointerPreparedScreen !== s) saveCurrentScroll();
        pointerPreparedScreen = null;
        if (s !== "ledger") plugin.pendingActivityTarget = undefined;
        screen = s;
        void loadScreen(s);
        if (historyMode !== "none") writeScreenHistory(s, historyMode);
        restoreScroll(s);
    }
    async function loadScreen(target: ScreenId): Promise<void> {
        const request = ++screenLoadRequest;
        screenLoadError = "";
        try {
            const module = target === "overview"
                ? await import("./screens/overview.svelte")
                : target === "reminders"
                    ? await import("./screens/reminders.svelte")
                    : target === "ledger"
                        ? await import("./screens/ledger.svelte")
                        : await import("./screens/members.svelte");
            if (request !== screenLoadRequest) return;
            ScreenView = module.default as unknown as ScreenComponent;
            loadedScreen = target;
            // Browser back/forward changes `screen` through popstate without
            // going through gotoScreen. Re-apply restoration after the lazy
            // component has mounted so its scroll owner and session state are
            // available even when the import resolves after the first frame.
            if (screen === target) restoreScroll(target);
        } catch (error) {
            if (request !== screenLoadRequest) return;
            loadedScreen = null;
            screenLoadError = error instanceof Error ? error.message : String(error);
        }
    }
    async function loadCapture(): Promise<void> {
        if (CaptureView) return;
        const request = ++captureLoadRequest;
        try {
            const module = await import("./quick-capture.svelte");
            if (request === captureLoadRequest) CaptureView = module.default as unknown as Component<CaptureProps>;
        } catch (error) {
            if (request === captureLoadRequest) showMessage(String(error), 5000, "error");
        }
    }
    onMount(() => {
        void loadScreen(screen);
        if (!historyScreen(history.state)) writeScreenHistory(screen, "replace");
        const onPopState = (event: PopStateEvent) => {
            const next = historyScreen(event.state);
            if (!next || next === screen) return;
            saveCurrentScroll();
            if (next !== "ledger") plugin.pendingActivityTarget = undefined;
            screen = next;
            void loadScreen(next);
            restoreScroll(next);
        };
        window.addEventListener("popstate", onPopState);
        return () => {
            window.removeEventListener("popstate", onPopState);
            restoreTimers.forEach((timer) => window.clearTimeout(timer));
            restoreTimers = [];
            if (pendingSwitchTimer) {
                window.clearTimeout(pendingSwitchTimer);
                pendingSwitchTimer = undefined;
            }
        };
    });
    function openActivityTarget(target: Omit<ActivityTarget, "requestId">) {
        if (!plugin.settings.enabledModules.includes(target.moduleId) || !plugin.settings.dbRefs?.[target.moduleId]?.avId) {
            showMessage(t("activity.navigationUnavailable"), 4000, "error");
            return;
        }
        const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        session.scrollTop.ledger = 0;
        if (screen === "ledger") {
            // Recreate Ledger so its local selected module follows activeLedger
            // and its successful load can consume the new one-shot target.
            screen = "overview";
            writeScreenHistory("overview", "replace");
            requestAnimationFrame(() => {
                plugin.pendingActivityTarget = { ...target, requestId };
                plugin.setActiveLedger(target.moduleId);
                gotoScreen("ledger");
            });
            return;
        }
        plugin.pendingActivityTarget = { ...target, requestId };
        plugin.setActiveLedger(target.moduleId);
        gotoScreen("ledger");
    }
    // R6（2026-10-09）：对外入口（状态栏角标/服务桥 openReminders/命令面板）在面板已挂载时
    // 直切页签——pendingScreen 只在挂载时消费，SiYuan 恢复的旧页签路径永远走不到挂载消费
    $effect(() => {
        const switchScreen = (s: string) => {
            if (isScreen(s)) {
                gotoScreen(s);
            } else {
                plugin.setActiveLedger(s);
                gotoScreen("ledger");
            }
        };
        plugin.panelScreenSwitch = switchScreen;
        return () => { if (plugin.panelScreenSwitch === switchScreen) plugin.panelScreenSwitch = undefined; };
    });
    $effect(() => {
        plugin.openActivityTarget = openActivityTarget;
        return () => {
            if (plugin.openActivityTarget === openActivityTarget) {
                plugin.openActivityTarget = undefined;
                plugin.pendingActivityTarget = undefined;
            }
        };
    });
    // 267 波：快速记录弹层（常驻挂载保草稿；任意页签 ⚡ 呼出）
    let captureOpen = $state(false);
    let captureInvoker: HTMLElement | undefined;
    let captureWasOpen = false;
    function openCapture(moduleId?: string, event?: MouseEvent) {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        captureInvoker = event?.currentTarget instanceof HTMLElement
            ? event.currentTarget
            : document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (!moduleId || moduleId === "event" || moduleId.startsWith("event:")) {
            if (plugin.runtime) {
                (plugin.runtime as any).hubQuickMode = "event";
                (plugin.runtime as any).hubQuickEventSub = moduleId?.startsWith("event:") ? moduleId.slice(6) : undefined;
            }
        } else {
            plugin.setActiveLedger(moduleId);
            if (plugin.runtime) {
                plugin.runtime.hubQuickModule = moduleId;
                (plugin.runtime as any).hubQuickMode = "ledger";
                (plugin.runtime as any).hubQuickEventSub = undefined;
            }
        }
        captureOpen = true;
        void loadCapture();
    }
    $effect(() => {
        if (captureOpen) captureWasOpen = true;
        else if (captureWasOpen) {
            captureWasOpen = false;
            requestAnimationFrame(() => captureInvoker?.focus());
        }
    });
    $effect(() => {
        const captureHandler = (e: Event) => {
            const detail = (e as CustomEvent<{ module?: string }>)?.detail;
            openCapture(detail?.module);
        };
        const spotlightHandler = () => void openSpotlight();
        const emergencyHandler = () => void openEmergencyCardFromGuest();
        const lifeIndexHandler = async () => {
            try {
                const { openLifeIndexModal } = await import("@/core/overview-modals");
                const allReminders = plugin.scan?.reminders ?? plugin.runtime?.cache?.reminders ?? [];
                await openLifeIndexModal({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });
            } catch (err) {
                console.error("[siyuan-home] failed to open life index modal", err);
            }
        };
        const storeHandler = () => {
            plugin.setActiveLedger?.("stock");
            gotoScreen("ledger");
        };
        const events = [
            ["siyuan-home:open-capture", captureHandler],
            ["siyuan-home:open-spotlight", spotlightHandler],
            ["siyuan-home:open-emergency", emergencyHandler],
            ["siyuan-home:open-life-index", lifeIndexHandler],
            ["siyuan-home:open-store", storeHandler],
        ] as const;
        for (const [e, fn] of events) window.addEventListener(e, fn as any);
        return () => { for (const [e, fn] of events) window.removeEventListener(e, fn as any); };
    });
    // 268 波（Linear 式键盘优先）：N 键呼出快速记录、Ctrl+K 呼出全景生活检索（仅焦点在管家内有效，防抢编辑器超链接）
    $effect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            // 任意宿主弹窗、插件弹窗或生活检索打开时不响应快捷键，杜绝多层抢键与重复弹窗堆叠
            if (document.querySelector("dialog[open], .b3-dialog, .lv-modal.open, .lv-spotlight-dialog-body")) return;
            if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
                // 仅当焦点落在小驴管家宿主容器内部且非编辑器内部时响应，避免抢占思源官方插入超链接快捷键
                if (homeEl && homeEl.contains(el) && !el?.isContentEditable) {
                    e.preventDefault();
                    void openSpotlight();
                    return;
                }
                return;
            }
            if (captureOpen) return;
            if (e.key !== "n" && e.key !== "N") return;
            if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
            e.preventDefault();
            openCapture();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });
    // 状态栏/通知入口可预选页签（plugin.pendingScreen，消费后清空）——初始快照为设计意图。
    // 单次读取落局部量：快照语义不变，且消除同逻辑两处 state_referenced_locally 警告
    // svelte-ignore state_referenced_locally
    const rawPending = plugin.pendingScreen;
    // svelte-ignore state_referenced_locally
    plugin.pendingScreen = undefined;
    if (rawPending && !isScreen(rawPending)) {
        // svelte-ignore state_referenced_locally
        plugin.setActiveLedger(rawPending);
    }
    const pendingScreen: ScreenId | undefined = isScreen(rawPending)
        ? rawPending
        : (rawPending ? "ledger" : undefined);
    function readLastScreen(): ScreenId | undefined {
        try {
            const value = sessionStorage.getItem("siyuan-home:last-screen");
            return isScreen(value) ? value : undefined;
        } catch { return undefined; }
    }
    let screen: ScreenId = $state(pendingScreen ?? historyScreen(history.state) ?? readLastScreen() ?? "overview");
    // 297 波：家庭协作只读访客模式（必须订阅 version，否则点击盾牌切换后横幅与高亮不即时响应）
    const isGuestMode = $derived.by(() => {
        void version;
        return !!plugin.runtime?.guestModeActive;
    });
    async function toggleGuestMode() {
        const next = !plugin.runtime?.guestModeActive;
        try {
            plugin.runtime.guestModeActive = next;
            const { saveRuntime } = await import("@/core/hub/runtime");
            await saveRuntime(plugin, plugin.runtime);
            version += 1;
            plugin.emitHubChanged?.();
            showMessage(t(next ? "guest.modeActive" : "guest.modeInactive"), 3000, "info");
        } catch {
            showMessage(t("ledger.saveFailed"), 4000, "error");
        }
    }
    async function openEmergencyCardFromGuest() {
        try {
            const { openEmergencyCardDialog } = await import("@/core/emergency-card-dialog");
            const { renderLedgerAll } = await import("@/core/siyuan");
            const { cellContentText } = await import("@/core/avcell");
            await openEmergencyCardDialog({
                t,
                plugin,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                renderLedgerAllFn: renderLedgerAll,
                cellTextFn: cellContentText,
            });
        } catch { /* ignore */ }
    }

    async function openSpotlight() {
        try {
            const { openSpotlightDialog } = await import("@/core/spotlight-dialog");
            const { renderLedgerAll } = await import("@/core/siyuan");
            const { cellContentText } = await import("@/core/avcell");
            await openSpotlightDialog({
                t,
                plugin: plugin as any,
                DialogCls: Dialog as any,
                renderLedgerAllFn: renderLedgerAll,
                cellTextFn: cellContentText,
                onNavigateToTarget: (target) => {
                    openActivityTarget(target);
                },
            });
        } catch (e) {
            console.warn("[LvHome] spotlight open failed:", e);
        }
    }
    // 提醒页签待办红点（version 驱动重算，随扫描更新）
    const pendingTotal = $derived.by(() => {
        void version;
        return plugin.scan?.reminders?.length ?? plugin.runtime?.cache?.reminders?.length ?? 0;
    });
    const screens: { id: ScreenId; key: string; mobileKey: string; icon: UiIconName }[] = [
        { id: "overview", key: "tab.overview", mobileKey: "tab.mobile.today", icon: "home" },
        { id: "reminders", key: "tab.reminders", mobileKey: "tab.mobile.todo", icon: "bell" },
        { id: "ledger", key: "tab.ledger", mobileKey: "tab.mobile.assets", icon: "archive" },
        { id: "members", key: "tab.members", mobileKey: "tab.mobile.mine", icon: "users" },
    ];

    // C1b：滑动胶囊（offsetLeft/width + spring，与原型一致）
    let navEl: HTMLElement;
    let pill = $state({ x: 0, w: 0 });
    function movePill(btn: HTMLElement | undefined) {
        if (!btn) return;
        pill = { x: btn.offsetLeft, w: btn.offsetWidth };
    }
    function onTabKeydown(event: KeyboardEvent, index: number) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? screens.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + screens.length) % screens.length;
        gotoScreen(screens[next].id);
        requestAnimationFrame(() => (navEl?.querySelector(`[data-s="${screens[next].id}"]`) as HTMLButtonElement | undefined)?.focus());
    }
    $effect(() => {
        const activeTab = navEl?.querySelector(`[data-s="${screen}"]`) as HTMLElement | undefined;
        movePill(activeTab);
        if (activeTab && typeof activeTab.scrollIntoView === "function") {
            activeTab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
        }
        // 254 波：窗口 resize 后重新测量（对齐原型的 resize 监听）——否则胶囊停在旧坐标、
        // 与当前页签错位
        const onResize = () => movePill(navEl?.querySelector(`[data-s="${screen}"]`) as HTMLElement | undefined);
        window.addEventListener("resize", onResize, { passive: true });
        return () => window.removeEventListener("resize", onResize);
    });

    // Tab 挂载即注册刷新回调（扫描完成 → version 递增驱动各屏 $derived 重算，H02：
    // 动作/扫描后留在当前页即时更新，不靠切页重挂载；多实例安全）
    let version = $state(0);
    let initialScanError = $state("");
    async function refreshInitialScan(force = false) {
        initialScanError = "";
        try {
            await plugin.refreshHub(undefined, force);
            initialScanError = "";
        } catch (e) {
            initialScanError = e instanceof Error ? e.message : String(e);
        }
    }
    $effect(() => {
        const listener = () => {
            version += 1;
            if (plugin.runtime?.scannedAt && !plugin.scan?.errors?.length) initialScanError = "";
        };
        // Settings pages may be hosted outside this keyed screen tree. Refresh
        // ordinary plugin-object reads immediately after a saved replacement,
        // including first-run completion and resetting the onboarding wizard.
        const onSettingsReplaced = (event: Event) => {
            const detail = (event as CustomEvent<{ plugin?: HomePluginLike }>).detail;
            if (detail?.plugin && detail.plugin !== plugin) return;
            listener();
        };
        (plugin.hubListeners as Set<() => void>).add(listener);
        window.addEventListener("siyuan-home:settings-replaced", onSettingsReplaced);
        // 225 波修复：refreshHub 必须延后到 effect 同步作用域之外——其缓存路径会在本次 flush 内
        // 同步触发 hubListeners（version++），在 effect 依赖跟踪未定型时形成
        // effect_update_depth_exceeded 无限循环（真机首启即崩、页签全冻结）
        const timer = window.setTimeout(() => { void refreshInitialScan(); }, 0);
        return () => {
            window.clearTimeout(timer);
            (plugin.hubListeners as Set<() => void>).delete(listener);
            window.removeEventListener("siyuan-home:settings-replaced", onSettingsReplaced);
        };
    });
</script>

<div class="lv-home lv-tab" bind:this={homeEl}>
    <div class="lv-shell-frame">
        <!-- 1. 左侧极窄导航栏（Rail Navigation） -->
        <TabRailNav
            {screens}
            {screen}
            {pendingTotal}
            {t}
            onGotoScreen={gotoScreen}
            onOpenCapture={(e) => openCapture(undefined, e)}
            onOpenSpotlight={openSpotlight}
            onOpenSetting={() => plugin.openSetting()}
        />

        <!-- 2. 中间主工作台 -->
        <div class="lv-main-stage" bind:this={mainStageEl}>
            <header class="lv-tabbar">
                <div class="lv-appbrand">
                    <span class="lv-logo" aria-hidden="true"><UiIcon name="home" size={19} className="lv-logo-mark" /></span>
                    <div class="lv-appbrand-t">
                        <b>{t("butler")}</b>
                        <span>LV HOME</span>
                    </div>
                    <span class="lv-appbrand-sep" aria-hidden="true"></span>
                    <div class="lv-avatar-wrap">
                        <AvatarSettings {plugin} {t} />
                    </div>
                </div>
                <span class="fn__flex-1" aria-hidden="true"></span>
                <div class="lv-tabs" bind:this={navEl} role="tablist" aria-label={t("tab.title")}>
                    <!-- 252 波：首次定位不带过渡（pill.w===0 时挂 init），避免挂载瞬间胶囊从左滑入 -->
                    <span class="lv-nav-pill" class:init={pill.w === 0} style="transform:translateX({pill.x}px);width:{pill.w}px"></span>
                    {#each screens as s, i (s.id)}
                        <button type="button" id={`lv-tab-${s.id}`} data-s={s.id} class="lv-tabs__item" class:on={screen === s.id}
                            role="tab" aria-selected={screen === s.id} aria-current={screen === s.id ? "page" : undefined} aria-controls={`lv-panel-${s.id}`}
                            aria-label={s.id === "reminders" && pendingTotal > 0 ? t("tab.remindersPending").replace("${label}", t(s.key)).replace("${n}", String(pendingTotal)) : t(s.key)}
                            tabindex={screen === s.id ? 0 : -1} onpointerdown={() => prepareTabNavigation(s.id)} onkeydown={(e) => onTabKeydown(e, i)} onclick={() => gotoScreen(s.id)}>
                            {t(s.key)}
                            {#if s.id === "reminders" && pendingTotal > 0}<i class="lv-dot" aria-hidden="true"></i>{/if}
                        </button>
                    {/each}
                </div>
                <span class="fn__flex-1"></span>
                <!-- 259 波：呼吸状态点 + mono 扫描时间，支持点击一键触发重新扫描 -->
                <button type="button" class="lv-hubstatus lv-caption"
                    title={`${t("hub.scannedAt")} ${formatLocalTime(plugin.runtime?.scannedAt) ?? "—"} · ${t("hub.rescan")}`}
                    aria-label={`${t("hub.scannedAt")} ${formatLocalTime(plugin.runtime?.scannedAt) ?? "—"}${plugin.scan?.errors?.length ? ` · ${t("dash.stripErrors")} ${plugin.scan.errors.length}` : ""}`}
                    onclick={() => void refreshInitialScan(true)}>
                    <i class="lv-pulse" class:orange={plugin.scan?.stale && !plugin.scan?.errors?.length}
                        class:red={(plugin.scan?.errors?.length ?? 0) > 0} aria-hidden="true"></i>
                    <span class="lv-num">{formatLocalTime(plugin.runtime?.scannedAt, { hour: "2-digit", minute: "2-digit" }) ?? "—"}</span>
                    {#if plugin.scan?.stale}<span class="lv-badge orange" title={plugin.scan.errors.map((e) => e.moduleId).join(", ")}>{t("hub.stale")}</span>{/if}
                </button>
                <!-- 267 波：⚡ 快速记录（原型 top-actions 主入口；268 波支持 N 键呼出） -->
                <div class="lv-tabbar-actions">
                    <!-- 搜索/快速记录/设置在宽屏由左侧导航栏承担，顶栏同名按钮只在窄屏（无侧栏）出现 -->
                    <button type="button" class="lv-iconbtn lv-rail-dup" aria-label={t("spotlight.title")} title={`${t("spotlight.title")} (Ctrl+K)`} onclick={openSpotlight}><UiIcon name="search" size={16} /></button>
                    <button type="button" class="lv-iconbtn" class:orange={isGuestMode} aria-label={t("guest.modeToggle")} title={t("guest.modeToggle")} onclick={toggleGuestMode}><UiIcon name="shield" size={16} /></button>
                    <button type="button" class="lv-iconbtn lv-rail-dup" aria-label={t("capture.title")} title={`${t("capture.title")} (N)`} onclick={(event) => openCapture(undefined, event)}><UiIcon name="bolt" size={16} /></button>
                    <button type="button" class="lv-iconbtn lv-rail-dup" aria-label={t("tab.settings")} title={t("tab.settings")} onclick={() => plugin.openSetting()}><UiIcon name="settings" size={16} /></button>
                    {#if onMobileClose}
                        <button type="button" class="lv-iconbtn lv-mobile-close" aria-label={t("close")} title={t("close")} onclick={onMobileClose}><UiIcon name="close" size={16} /></button>
                    {/if}
                </div>
            </header>

            {#if isGuestMode}
                <TabGuestBanner
                    {t}
                    onOpenEmergencyCard={openEmergencyCardFromGuest}
                    onToggleGuestMode={toggleGuestMode}
                />
            {/if}

            {#key `${screen}:${version}`}
                <div id={`lv-panel-${screen}`} class="lv-screen lv-anim" role="tabpanel" tabindex="0" aria-labelledby={`lv-tab-${screen}`}>
                    <ErrorBoundary {t} onretry={() => { /* screen switch resets naturally via {#key} */ }}>
                        {#if screenLoadError}
                            <div class="lv-card lv-empty" role="alert"><b>{t("error.unknown")}</b><span>{screenLoadError}</span><button type="button" class="b3-button b3-button--outline" onclick={() => void loadScreen(screen)}>{t("error.retry")}</button></div>
                        {:else if loadedScreen !== screen || !ScreenView}
                            <div class="lv-card lv-screen-loading" role="status" aria-live="polite" aria-busy="true" aria-label={t("activity.loading")}>
                                <span class="lv-skel lv-skel--w42-h16" aria-hidden="true"></span>
                                <span class="lv-skel lv-skel--w78-h12" aria-hidden="true"></span>
                                <span class="lv-skel lv-skel--w64-h12" aria-hidden="true"></span>
                            </div>
                        {:else}
                            <ScreenView {plugin} {t} {version} {initialScanError} onRetryScan={() => refreshInitialScan(true)} onCapture={(moduleId?: string) => openCapture(moduleId)} onGoto={(s: ScreenId) => gotoScreen(s)} />
                        {/if}
                    </ErrorBoundary>
                </div>
            {/key}
        </div>

    </div>

    <!-- 移动端统一底部主导航 (Mobile Spec v1: ≤4项 今日/清单/资产/我的，触控高度 ≥44px) -->
    <nav class="lv-mobile-bottom-nav" aria-label={t("tab.title")}>
        {#each screens as s (s.id)}
            <button
                type="button"
                id={`lv-mob-tab-${s.id}`}
                class="lv-mob-nav-item"
                class:on={screen === s.id}
                role="tab"
                aria-selected={screen === s.id}
                aria-controls={`lv-panel-${s.id}`}
                onclick={() => {
                    try { lvLaunchpad.haptic(10); } catch { /* soft */ }
                    gotoScreen(s.id);
                }}
            >
                <span class="lv-mob-nav-icon">
                    <UiIcon name={s.icon} size={20} />
                    {#if s.id === "reminders" && pendingTotal > 0}
                        <span class="lv-mob-badge">{pendingTotal > 99 ? "99+" : pendingTotal}</span>
                    {/if}
                </span>
                <span class="lv-mob-nav-label">{t(s.mobileKey)}</span>
            </button>
        {/each}
    </nav>

    <!-- 267 波：快速记录弹层（常驻挂载——关闭仅收起，草稿保留） -->
    {#if CaptureView}
        <CaptureView {plugin} {t} {version} bind:open={captureOpen} />
    {/if}
</div>
