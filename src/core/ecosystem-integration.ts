import { mountLvHomeBridge } from "@/bridge/external-bridge";
import { registerRaikiriModuleSafely } from "@/libs/ecosystem-bridge-kit";

const PLUGIN_VERSION = typeof __PLUGIN_VERSION__ !== "undefined" ? __PLUGIN_VERSION__ : "0.5.195";

export interface EcosystemIntegrationOptions {
    plugin: any;
    t: (k: string) => string;
    showTab: () => void;
    openRemindersScreen: () => void;
    openModuleTab: (moduleId: string) => void;
    addMemo: (title: string, due: string) => Promise<void>;
    complete: (reminder: any) => Promise<void>;
    markReminderDoneByBlockId: (blockId: string) => Promise<boolean>;
    emitHubChanged: () => void;
}

export interface EcosystemController {
    pullCheckinSummary(): Promise<void>;
    buildHomeSummarySnapshot(): Record<string, unknown>;
    ensureSpeedSwitchActions(attempt?: number): void;
    dispose(): void;
}

export function initEcosystemIntegration(options: EcosystemIntegrationOptions): EcosystemController {
    const {
        plugin,
        t,
        showTab,
        openRemindersScreen,
        openModuleTab,
        addMemo,
        complete,
        markReminderDoneByBlockId,
        emitHubChanged,
    } = options;

    let disposeLvHomeBridge: (() => void) | undefined;
    let examStatsHandler: ((e: Event) => void) | undefined;
    let cardsReviewedHandler: ((e: Event) => void) | undefined;
    let checkinEventHandler: (() => void) | undefined;
    let checkinOccasionCompletedHandler: ((e: Event) => void) | undefined;
    let taskHorizonCompletedHandler: ((e: Event) => void) | undefined;
    const speedSwitchDisposers: Array<() => void> = [];
    let speedSwitchRetry: number | undefined;
    let homeModuleDisposer: (() => void) | undefined;
    let lastCheckinPull = 0;
    const WS_RESCAN_MIN_MS = 60 * 1000;

    const pullCheckinSummary = async (): Promise<void> => {
        try {
            const w = (typeof window !== "undefined" ? window : {}) as Record<string, unknown>;
            const checkin = (w.siyuanCheckin || w.LvCheckin || w.xiaolvCheckin || w.lvCheckin) as {
                whenReady: () => Promise<boolean>;
                getStrengthSummary: (o?: { windowDays?: number }) => { items: { itemId: string; name: string; score: number }[]; windowDays: number };
            } | undefined;
            if (!checkin?.whenReady || !checkin.getStrengthSummary) return;
            const ready = await checkin.whenReady();
            if (!ready) return;
            const summary = checkin.getStrengthSummary({ windowDays: 30 });
            if (!summary?.items?.length) return;
            plugin.runtime.lastCheckinSummary = {
                items: summary.items.slice(0, 5), // 有界：top 5
                windowDays: summary.windowDays,
                pulledAt: Date.now(),
            };
            const { saveRuntime } = await import("@/core/hub/runtime");
            await saveRuntime(plugin, plugin.runtime);
            emitHubChanged();
        } catch (e) {
            console.warn("[LvHome] checkin summary pull failed:", e instanceof Error ? e.message : e);
        }
    };

    const buildHomeSummarySnapshot = (): Record<string, unknown> => {
        try {
            const rems = plugin.scan?.reminders ?? [];
            const overdue = rems.filter((r: any) => r.level === "overdue").length;
            const soon = rems.filter((r: any) => r.level === "soon").length;
            const today = rems.filter((r: any) => r.daysLeft <= 0).length;
            const stale = plugin.scan?.stale ?? false;
            return {
                title: t("butler"),
                stat: { value: String(today), label: t("hub.groupOverdue") },
                items: [
                    { label: t("hub.groupOverdue"), value: String(overdue), command: "siyuan-home::openButler" },
                    { label: t("hub.groupSoon"), value: String(soon), command: "siyuan-home::openButler" },
                ],
                updatedAt: Date.now(),
                sourceHealth: stale ? "stale" : "fresh",
                emptyHint: rems.length === 0 ? t("dash.allClear") : undefined,
            };
        } catch (e) {
            console.warn("[LvHome] summary snapshot failed:", e instanceof Error ? e.message : e);
            return { title: t("butler"), items: [], emptyHint: t("hub.stale") };
        }
    };

    const ensureSpeedSwitchActions = (attempt = 0): void => {
        if (speedSwitchDisposers.length > 0) return;
        const plugins = (plugin.app as { plugins?: unknown } | undefined)?.plugins;
        const candidates = Array.isArray(plugins)
            ? plugins
            : plugins && typeof plugins === "object" ? Object.values(plugins as Record<string, unknown>) : [];
        const speedSwitch = candidates.find((candidate) => {
            if (!candidate || typeof candidate !== "object") return false;
            const p = candidate as { name?: unknown; registerQuickAction?: unknown };
            return typeof p.registerQuickAction === "function"
                && (p.name === "siyuan-speed-switch" || p.name === "小驴速切" || p.name === "siyuanSpeedSwitch");
        }) as { registerQuickAction?: (options: unknown) => (() => void) | void } | undefined;
        if (!speedSwitch?.registerQuickAction) {
            if (attempt < 10 && speedSwitchRetry === undefined && typeof window !== "undefined") {
                speedSwitchRetry = window.setTimeout(() => {
                    speedSwitchRetry = undefined;
                    ensureSpeedSwitchActions(attempt + 1);
                }, 1200);
            }
            return;
        }
        const register = speedSwitch.registerQuickAction.bind(speedSwitch);
        const actions: { id: string; label: string; icon?: string; handler: () => void }[] = [
            { id: "lvhome.open-overview", label: t("butler"), icon: "iconHome", handler: () => showTab() },
            { id: "lvhome.open-reminders", label: t("tab.reminders"), icon: "iconClock", handler: () => openRemindersScreen() },
            { id: "lvhome.open-capture", label: t("capture.tabEvent") || "快速记一笔", icon: "iconZap", handler: () => {
                showTab();
                if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
            }},
        ];
        for (const action of actions) {
            const dispose = register({
                id: action.id,
                label: action.label,
                icon: action.icon || "iconHome",
                value: "open",
                targets: ["desktop", "sidebar", "mobile"],
                handler: () => action.handler(),
            });
            if (typeof dispose === "function") speedSwitchDisposers.push(dispose);
        }
        const homeCapable = speedSwitch as { registerHomeModule?: (options: unknown) => (() => void) | void };
        if (typeof homeCapable.registerHomeModule === "function" && !homeModuleDisposer) {
            const dispose = homeCapable.registerHomeModule({
                moduleId: "lvhome.summary",
                title: t("butler"),
                icon: "iconHome",
                supportedDevices: ["desktop", "sidebar", "mobile"],
                sizes: ["xs", "small", "medium"],
                protocolVersion: 1,
                readOnly: true,
                clickCommand: "siyuan-home::openButler",
                read: () => buildHomeSummarySnapshot(),
            });
            if (typeof dispose === "function") homeModuleDisposer = dispose;
        }
    };

    // 注册雷切到期提醒小组件
    const unregRaikiri = registerRaikiriModuleSafely({
        moduleId: "home-expiry-reminders",
        title: "家庭到期提醒",
        icon: "iconLvHome",
        category: "life",
        description: "展示小驴管家汇总的家庭各类证件、合同、账单、药品到期与超期事项",
        source: { pluginId: "siyuan-home", name: "小驴管家", version: PLUGIN_VERSION },
        read: async () => {
            const rems = plugin.scan?.reminders ?? [];
            const overdue = rems.filter((r: any) => r.daysLeft < 0);
            const soon = rems.filter((r: any) => r.daysLeft >= 0 && r.daysLeft <= 7);
            const items = [...overdue, ...soon].slice(0, 5).map((r: any) => ({
                label: r.title || "待办事项",
                value: r.daysLeft < 0 ? `逾期 ${Math.abs(r.daysLeft)} 天` : r.daysLeft === 0 ? "今天到期" : `${r.daysLeft} 天后到期`,
            }));
            return {
                title: `家庭提醒 (${overdue.length} 项逾期 · ${soon.length} 项临期)`,
                items: items.length > 0 ? items : [{ label: "近期无紧急到期事项", value: "✓" }],
            };
        },
        open: () => openRemindersScreen(),
    });
    if (unregRaikiri) speedSwitchDisposers.push(unregRaikiri);

    // 服务桥挂载
    disposeLvHomeBridge = mountLvHomeBridge({
        settings: plugin.settings,
        get scan() { return plugin.scan; },
        showTab: () => showTab(),
        openRemindersTab: () => openRemindersScreen(),
        openModuleTab: (m) => openModuleTab(m),
        addMemo: (title, due) => addMemo(title, due),
        completeReminder: async (id: string) => {
            const target = plugin.scan?.reminders.find((r: any) => r.id === id);
            if (target) {
                await complete(target);
                return true;
            }
            return false;
        },
        onBridgeDisposed: () => { disposeLvHomeBridge = undefined; },
    });

    const checkinPullTimers: number[] = [];

    if (typeof window !== "undefined") {
        // EC21：消费 lv-exam:stats 聚合
        examStatsHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { streak?: unknown; accuracy?: unknown; attempts?: unknown; generatedAt?: unknown } | undefined;
            if (!detail || typeof detail !== "object") return;
            const streak = Number(detail.streak);
            const accuracy = Number(detail.accuracy);
            const attempts = Number(detail.attempts);
            const generatedAt = Number(detail.generatedAt);
            if (![streak, accuracy, attempts, generatedAt].every((n) => Number.isFinite(n))) return;
            plugin.runtime.lastExamStats = { streak, accuracy, attempts, generatedAt };
            import("@/core/hub/runtime").then((m) => m.saveRuntime(plugin, plugin.runtime)).catch(() => undefined);
            emitHubChanged();
        };
        window.addEventListener("lv-exam:stats", examStatsHandler);

        // Epoch 6：消费 lv-cards:reviewed 闪卡复习事件
        cardsReviewedHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
            if (!detail || typeof detail !== "object") return;
            emitHubChanged();
        };
        window.addEventListener("lv-cards:reviewed", cardsReviewedHandler);

        // EC09/EC10：打卡集成事件（checkin:*）
        checkinEventHandler = () => {
            if (Date.now() - lastCheckinPull < WS_RESCAN_MIN_MS) return;
            lastCheckinPull = Date.now();
            void pullCheckinSummary();
        };
        for (const evt of ["checkin:event-recorded", "checkin:event-deleted", "checkin:item-updated"]) {
            window.addEventListener(evt, checkinEventHandler);
        }

        // 联动小驴打卡：纪念日/事项打卡完成双向同步
        checkinOccasionCompletedHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
            if (!detail) return;
            const targetBlockId = detail.blockId || detail.contextBlockId || detail.id;
            if (targetBlockId) {
                void markReminderDoneByBlockId(String(targetBlockId));
            }
            if (Date.now() - lastCheckinPull >= WS_RESCAN_MIN_MS) {
                lastCheckinPull = Date.now();
                void pullCheckinSummary();
            }
            emitHubChanged();
        };
        window.addEventListener("checkin:occasion-completed", checkinOccasionCompletedHandler);

        // 联动 Task Horizon：监听任务完成事件
        taskHorizonCompletedHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
            if (!detail) return;
            const targetBlockId = detail.blockId || detail.id || detail.taskBlockId;
            if (targetBlockId) {
                void markReminderDoneByBlockId(String(targetBlockId));
            }
            emitHubChanged();
        };
        window.addEventListener("tm:task-completed", taskHorizonCompletedHandler);

        // 启动时拉取一次
        checkinPullTimers.push(window.setTimeout(() => void pullCheckinSummary(), 3000));
        checkinPullTimers.push(window.setTimeout(() => void pullCheckinSummary(), 5000));

        ensureSpeedSwitchActions();
    }

    return {
        pullCheckinSummary,
        buildHomeSummarySnapshot,
        ensureSpeedSwitchActions,
        dispose: () => {
            for (const t of checkinPullTimers) window.clearTimeout(t);
            checkinPullTimers.length = 0;
            if (typeof window !== "undefined") {
                if (examStatsHandler) window.removeEventListener("lv-exam:stats", examStatsHandler);
                if (cardsReviewedHandler) window.removeEventListener("lv-cards:reviewed", cardsReviewedHandler);
                if (checkinEventHandler) {
                    for (const evt of ["checkin:event-recorded", "checkin:event-deleted", "checkin:item-updated"]) {
                        window.removeEventListener(evt, checkinEventHandler);
                    }
                }
                if (checkinOccasionCompletedHandler) window.removeEventListener("checkin:occasion-completed", checkinOccasionCompletedHandler);
                if (taskHorizonCompletedHandler) window.removeEventListener("tm:task-completed", taskHorizonCompletedHandler);
                if (speedSwitchRetry !== undefined) {
                    window.clearTimeout(speedSwitchRetry);
                    speedSwitchRetry = undefined;
                }
            }
            if (disposeLvHomeBridge) {
                disposeLvHomeBridge();
                disposeLvHomeBridge = undefined;
            }
            for (const d of speedSwitchDisposers) {
                try { d(); } catch { /* ignore */ }
            }
            speedSwitchDisposers.length = 0;
            if (homeModuleDisposer) {
                try { homeModuleDisposer(); } catch { /* ignore */ }
                homeModuleDisposer = undefined;
            }
        },
    };
}
