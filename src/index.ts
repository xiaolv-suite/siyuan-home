import { Plugin } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import TabPanel from "@/panels/tab-panel.svelte";
import HomeSettingsPanel from "@/panels/settings.svelte";
import { svelteDialog } from "@/libs/dialog";
import { loadSettings } from "@/core/settings";
import { loadRuntime, type HubRuntime } from "@/core/hub/runtime";
import { type ProvisioningReport } from "@/core/provisioner";
import { type ScanResult } from "@/core/hub/scanner";
import type { EcosystemController } from "@/core/ecosystem-integration";
import type { PluginContextMenusController } from "@/core/plugin-context-menus";
import { registerPluginEntrypoints, type PluginEntrypointsController } from "@/core/plugin-entrypoints";
import { initPluginAuthGuard, type PluginAuthGuardController } from "@/core/plugin-auth-guard";
import { SCHEMA_CATALOG } from "@/core/schema";
import type { HomeSettings } from "@/types";
import type { LvSearchResultItem } from "@/libs/lv-notice-kit";
import { homeNotify } from "@/libs/notice";
import { CompositeDisposer } from "@/core/disposer";
import { DeferredWarmupScheduler } from "@/core/hub/deferred-warmup-scheduler";
import { restoreScanFromCache, applyRuntimeActionToSnapshot } from "@/core/hub/runtime-snapshot";
import { RemindersController } from "@/core/hub/reminders-controller";
import { ScannerOrchestrator } from "@/core/hub/scanner-orchestrator";
import { NavigationController } from "@/core/hub/navigation-controller";
import { LaunchpadController } from "@/core/hub/launchpad-controller";
import { setRowLogSyncLoader } from "@/core/rowlog";
import { saveRuntime } from "@/core/hub/runtime-store";
import { createSingleFlightUntilStable } from "@/core/single-flight";
import { initPluginBootstrap } from "@/core/hub/plugin-bootstrap";

/**
 * 小驴管家（Lv Home）微内核装配器
 */
export default class LvHomePlugin extends Plugin {
    settings!: HomeSettings;
    runtime!: HubRuntime;
    scan: ScanResult = {
        reminders: [],
        counts: { overdue: 0, soon: 0, lead: 0 },
        scannedAt: new Date().toISOString(),
        errors: [],
        stale: false,
        derived: [],
        byModule: {},
    };

    /** 树状幂等生命周期管理 (CompositeDisposer) */
    disposer = new CompositeDisposer();
    launchpadScope?: CompositeDisposer;
    readonly timeoutIds = new Set<number>();
    schemaCatalog: Record<string, any> = SCHEMA_CATALOG;
    hubListeners = new Set<() => void>();
    scanSeq = 0;
    activeLedger = "certs";
    pendingScreen?: string;
    panelScreenSwitch?: (screen: string) => void;
    pendingActivityTarget?: any;
    openActivityTarget?: (target: any) => void;
    isUnloading = false;

    // 领域与编排控制器
    private readonly remindersController = new RemindersController(this);
    private readonly scannerOrchestrator = new ScannerOrchestrator(this);
    private readonly navigationController = new NavigationController(this);
    private readonly launchpadController = new LaunchpadController(this);

    /** 45s 静默期延迟预热调度器 */
    private readonly warmupScheduler = new DeferredWarmupScheduler({
        isUnloading: () => this.isUnloading,
        scheduleTimeout: (cb, delay) => this.scheduleTimeout(cb, delay),
        clearTimeout: (timer) => {
            window.clearTimeout(timer);
            this.timeoutIds.delete(timer);
        },
        trigger: () => this.triggerDeferredWarmup(),
        runWarmupTasks: async () => {
            await this.adoptHistoryLedgers();
            if (this.isUnloading) return;
            await this.cleanupLegacyJournalDocs();
            if (this.isUnloading) return;
            await this.refreshHub(undefined, true, { internalWarmup: true });
            if (this.isUnloading) return;
            if (this.settings?.onboarded && this.app) {
                const { autoHealMemosFromDailyNote } = await import("@/core/doc-sync");
                if (this.isUnloading) return;
                // v4：停用旧 doc-sync 尾部 ## 历史记录与流水 追写，改为日记 dom 原子信封写
                autoHealMemosFromDailyNote(this);
            }
        },
    });

    get deferredWarmupTimer(): number | undefined { return this.warmupScheduler.timerId; }
    set deferredWarmupTimer(v: number | undefined) { this.warmupScheduler.timerId = v; }
    get deferredWarmupIdleId(): number | undefined { return this.warmupScheduler.idleId; }
    set deferredWarmupIdleId(v: number | undefined) { this.warmupScheduler.idleId = v; }
    get deferredWarmupPromise(): Promise<void> | null { return this.warmupScheduler.inFlightPromise; }
    set deferredWarmupPromise(v: Promise<void> | null) { this.warmupScheduler.inFlightPromise = v; }
    get deferredWarmupCompleted(): boolean { return this.warmupScheduler.isCompleted; }
    set deferredWarmupCompleted(v: boolean) { this.warmupScheduler.isCompleted = v; }

    static readonly DEFERRED_WARMUP_DELAY_MS = DeferredWarmupScheduler.DEFAULT_DELAY_MS;

    private readonly provisionLedgersSingleFlight = createSingleFlightUntilStable(
        () => [...new Set(this.settings.enabledModules)].sort().join("\0"),
        () => this.scannerOrchestrator.provisionLedgers(),
    );

    entrypointsController?: PluginEntrypointsController;
    authGuardController?: PluginAuthGuardController;
    contextMenusController?: PluginContextMenusController;
    ecosystemController?: EcosystemController;

    i18nText(key: string): string { return String(this.i18n?.[key] ?? key); }

    scheduleTimeout(callback: () => void, delay: number): number {
        let timer = 0;
        timer = window.setTimeout(() => {
            this.timeoutIds.delete(timer);
            callback();
        }, delay);
        this.timeoutIds.add(timer);
        return timer;
    }

    private hubChangedScheduled = false;
    emitHubChanged(): void {
        if (this.hubChangedScheduled) return;
        this.hubChangedScheduled = true;
        queueMicrotask(() => {
            this.hubChangedScheduled = false;
            this.hubListeners.forEach((fn) => fn());
        });
    }

    initScanFromCache(): void {
        const { scan, todayDueCount } = restoreScanFromCache(this.runtime?.cache, this.settings, this.runtime);
        this.scan = scan;
        this.updateStatusbar(todayDueCount);
    }

    updateStatusbar(count: number): void { this.entrypointsController?.updateStatusbar(count); }

    async onload() {
        this.isUnloading = false;
        this.disposer.dispose();
        this.disposer = new CompositeDisposer();
        this.launchpadScope = undefined;
        this.warmupScheduler.cancel();
        this.warmupScheduler.isCompleted = false;

        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark("lvhome-onload-start");
        }

        this.entrypointsController = registerPluginEntrypoints({
            plugin: this,
            t: (k) => this.i18nText(k),
            i18n: this.i18n,
            showTab: () => this.showTab(),
            openRemindersScreen: () => this.openRemindersScreen(),
            openModuleTab: (m) => this.openModuleTab(m),
            openSetting: () => this.openSetting(),
            getActiveLedger: () => this.activeLedger,
            setPendingScreen: (s) => { this.pendingScreen = s; },
            getPanelScreenSwitch: () => this.panelScreenSwitch,
            scheduleTimeout: (fn, delay) => this.scheduleTimeout(fn, delay),
            mountTab: (element) => {
                void this.triggerDeferredWarmup();
                const inst = mount(TabPanel, { target: element, props: { plugin: this } });
                return () => {
                    if (typeof inst === "function") (inst as () => void)();
                    else if (inst) void unmount(inst);
                };
            },
        });
        this.disposer.add(this.entrypointsController);
        this.disposer.add(this.warmupScheduler);

        setRowLogSyncLoader(() => import("@/core/doc-sync"));
        this.disposer.add(() => setRowLogSyncLoader(null));

        this.settings = await loadSettings(this);
        this.runtime = await loadRuntime(this);
        this.initScanFromCache();

        this.authGuardController = initPluginAuthGuard({
            plugin: this,
            t: (k) => this.i18nText(k),
            emitHubChanged: () => this.emitHubChanged(),
            scheduleTimeout: (fn, delay) => this.scheduleTimeout(fn, delay),
            showTab: () => this.showTab(),
        });
        this.disposer.add(this.authGuardController);
        this.authGuardController.checkRestoredAuth();

        initPluginBootstrap(this);

        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark("lvhome-onload-end");
            try { performance.measure("lvhome-onload", "lvhome-onload-start", "lvhome-onload-end"); } catch { /* measure */ }
        }
    }

    onLayoutReady() {
        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark("lvhome-layout-ready-start");
        }
        try {
            this.scheduleDeferredWarmup();
        } catch (e) {
            console.warn("[LvHome] scheduling deferred warmup failed:", e instanceof Error ? e.message : e);
        } finally {
            if (typeof performance !== "undefined" && typeof performance.mark === "function") {
                performance.mark("lvhome-layout-ready-end");
                try {
                    performance.measure("lvhome-layout-ready", "lvhome-layout-ready-start", "lvhome-layout-ready-end");
                    performance.measure("lvhome-startup-critical-path", "lvhome-onload-start", "lvhome-layout-ready-end");
                } catch { /* measure */ }
            }
        }
    }

    private cancelDeferredWarmupSchedule(): void { this.warmupScheduler.cancel(); }
    scheduleDeferredWarmup(delayMs = DeferredWarmupScheduler.DEFAULT_DELAY_MS): void { this.warmupScheduler.schedule(delayMs); }
    triggerDeferredWarmup(): Promise<void> { return this.warmupScheduler.trigger(); }

    async adoptHistoryLedgers() {
        const resolveName = (key: string) =>
            key.startsWith("module.")
                ? this.i18nText(key)
                : String(this.i18n?.[`field.${key}`] ?? key);
        const resolveModuleTitle = (moduleId: string) => this.i18nText(`module.${moduleId}`);
        const { discoverAndAdoptAllLedgers } = await import("@/core/provision-adoption");
        return discoverAndAdoptAllLedgers(this.settings, this.schemaCatalog, resolveName, resolveModuleTitle);
    }

    async cleanupLegacyJournalDocs() {
        const { cleanupLegacyJournalDocs } = await import("@/core/doc-sync");
        return cleanupLegacyJournalDocs(this);
    }

    async onDataChanged(reason?: string) {
        const prev = this.settings;
        try {
            // B4：读取前主动清除 this.data 内存缓存，避免思源远端删文件或同步后仍读旧内存
            if (this.data && typeof this.data === "object") {
                for (const key of Object.keys(this.data)) {
                    delete this.data[key];
                }
            }
            const next = await loadSettings(this);
            const changed = JSON.stringify(prev) !== JSON.stringify(next);
            if (changed) {
                this.settings = next;
                this.emitHubChanged();
            }
            if (reason === "overwrite") {
                // overwrite 仅清本地缓存刷界面，绝不反向补写日记
                if (changed) await this.refreshHub(undefined, true);
                return;
            }
            if (reason === "sync") {
                // sync 模式下检查设备写月分片自愈对账（仅当存在当前写月分片时按水位对账）
                try {
                    const {
                        createReconcileEngineState,
                        createSiyuanDiaryTransport,
                        getOrCreateDeviceId,
                        HOME_STORAGE_PREFIX,
                        reconcileDeviceShard,
                        resolveTargetDailyNoteDoc,
                    } = await import("@/core/diary-envelope");
                    const now = new Date();
                    const shardMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                    const transport = createSiyuanDiaryTransport(this);
                    const state = createReconcileEngineState({ autoBackfillOnMissing: false });
                    await reconcileDeviceShard(state, transport, {
                        storagePrefix: HOME_STORAGE_PREFIX,
                        deviceId: getOrCreateDeviceId(),
                        shardMonth,
                        ensureDiaryDoc: async (bizDate) => {
                            const { docId } = await resolveTargetDailyNoteDoc(bizDate, { transport });
                            return docId;
                        },
                    }).catch(() => undefined);
                } catch { /* soft sync reconcile */ }
            }
            if (changed) {
                await this.refreshHub(undefined, true);
            }
        } catch (e) {
            console.warn("[LvHome] onDataChanged reload settings failed:", e);
        }
    }

    async ensureCoreLedgers(): Promise<ProvisioningReport> {
        await this.provisionLedgersSingleFlight();
        const { getProvisioningReport } = await import("@/core/provisioner");
        return getProvisioningReport(this.settings);
    }
    repairModule(moduleId: string) { return this.scannerOrchestrator.repairModule(moduleId); }
    refreshHub(only?: string | string[], force = false, options?: { internalWarmup?: boolean }) {
        return this.scannerOrchestrator.refreshHub(only, force, options);
    }

    async notifyHubChanged(): Promise<void> {
        const { scan, nextCache, todayDueCount } = applyRuntimeActionToSnapshot(this.runtime.cache, this.settings, this.runtime, this.scan);
        this.scan = scan;
        this.runtime.cache = nextCache;
        try {
            await saveRuntime(this, this.runtime);
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            const message = this.i18nText("hub.cacheSaveFailed").replace("${msg}", detail);
            this.scan = { ...this.scan, stale: true, errors: [...(this.scan.errors ?? []), { moduleId: "runtime", message: detail }] };
            homeNotify(message, 6500, "error");
        }
        this.updateStatusbar(todayDueCount);
        this.emitHubChanged();
        this.registerLaunchpadEntry();
    }

    quickCapture(text: string) { return this.navigationController.quickCapture(text); }
    captureTo(moduleId: "bookmarks" | "address" | "snippets", text: string) { return this.navigationController.captureTo(moduleId, text); }
    isMobileView(): boolean { return this.navigationController.isMobileView(); }
    showTab() { this.navigationController.showTab(); }
    openRemindersScreen() { this.navigationController.openRemindersScreen(); }
    openModuleTab(moduleId: string) { this.navigationController.openModuleTab(moduleId); }
    showTabDocs(docId?: string, blockId?: string) { this.navigationController.showTabDocs(docId, blockId); }
    setActiveLedger(id: string) { this.activeLedger = id; }

    markReminderDoneByBlockId(blockId: string) { return this.remindersController.markReminderDoneByBlockId(blockId); }
    complete(r: any) { return this.remindersController.complete(r); }
    snooze(id: string, days: number) { return this.remindersController.snooze(id, days); }
    snoozeToDate(id: string, targetDate: string) { return this.remindersController.snoozeToDate(id, targetDate); }
    batchSnooze(ids: string[], targetDate: string) { return this.remindersController.batchSnooze(ids, targetDate); }
    undoBatchSnooze(previousMap: Record<string, string | undefined>) { return this.remindersController.undoBatchSnooze(previousMap); }
    mute(id: string) { return this.remindersController.mute(id); }
    unmute(id: string) { return this.remindersController.unmute(id); }
    restore(id: string) { return this.remindersController.restore(id); }
    renew(r: any, iso: string) { return this.remindersController.renew(r, iso); }
    addMemo(title: string, due: string, options?: any) { return this.remindersController.addMemo(title, due, options); }
    updateMemo(id: string, patch: any) { return this.remindersController.updateMemo(id, patch); }
    removeMemo(id: string) { return this.remindersController.removeMemo(id); }
    toggleTodaySilent() { return this.remindersController.toggleTodaySilent(); }
    listHandled() { return this.remindersController.listHandled(); }

    finishOnboarding(household: { roles: string[]; children: number }, moduleIds: string[]) {
        return this.launchpadController.finishOnboarding(household, moduleIds);
    }
    dumpEcosystemBackupData() { return this.launchpadController.dumpEcosystemBackupData(); }
    restoreEcosystemBackupData(data: Record<string, unknown>) { return this.launchpadController.restoreEcosystemBackupData(data); }
    openDashboard() { this.launchpadController.openDashboard(); }
    getExpiringCount() { return this.launchpadController.getExpiringCount(); }
    handleQuickAction(action: string) { return this.launchpadController.handleQuickAction(action); }
    runLifeHealthAudit() { return this.launchpadController.runLifeHealthAudit(); }
    registerLaunchpadEntry() { this.launchpadController.registerLaunchpadEntry(); }
    searchHomeItems(keyword: string): LvSearchResultItem[] { return this.launchpadController.searchHomeItems(keyword); }
    getDiagnostics() { return this.launchpadController.getDiagnostics(); }

    mountPanel(element: HTMLElement) {
        const inst = mount(TabPanel, { target: element, props: { plugin: this } });
        return () => { void unmount(inst); };
    }

    openSetting() {
        svelteDialog({
            title: this.i18nText("settingsTitle"),
            component: HomeSettingsPanel,
            props: { plugin: this, settings: this.settings },
            width: "min(920px, calc(100vw - 32px))",
            height: "min(760px, calc(100dvh - 96px))",
        });
    }

    onunload() {
        this.isUnloading = true;
        this.cancelDeferredWarmupSchedule();
        for (const timer of this.timeoutIds) window.clearTimeout(timer);
        this.timeoutIds.clear();
        this.launchpadScope?.dispose();
        this.launchpadScope = undefined;
        this.disposer.dispose();
        this.entrypointsController?.dispose();
        this.entrypointsController = undefined;
        this.authGuardController?.dispose();
        this.authGuardController = undefined;
        this.contextMenusController?.dispose();
        this.contextMenusController = undefined;
        this.ecosystemController?.dispose();
        this.ecosystemController = undefined;
        this.hubListeners.clear();
        this.scanSeq++;
    }

    async uninstall(): Promise<void> {
        this.onunload();
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.removeItem("lv_home_device_id_v1");
                localStorage.removeItem("siyuan_home_quick_defaults");
            }
        } catch {
            /* soft cleanup */
        }
    }
}
