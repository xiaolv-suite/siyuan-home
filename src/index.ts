import { Plugin, openTab, openMobileFileById, getFrontend, type TProtyleAction } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import TabPanel from "@/panels/tab-panel.svelte";
import HomeSettingsPanel from "@/panels/settings.svelte";
import { svelteDialog } from "@/libs/dialog";
import { loadSettings, saveSettings } from "@/core/settings";
import { loadRuntime, saveRuntime, purgeHandled, listHandled, type HubRuntime } from "@/core/hub/runtime";
import { localDateKey } from "@/core/hub/rule";
import { runScan, deriveVisible, type ScanResult } from "@/core/hub/scanner";
import { buildScanProviders } from "@/core/hub/registry";
import { dailyDigest, markNotified, inSilentHours, weeklyPreview, markWeeklyNotified } from "@/core/hub/notify";
import { complete, snooze, mute, unmute, renew, restore, addMemo, removeMemo, updateMemo } from "@/core/hub/actions";
import { getProvisioningReport, provisionModule, type ProvisioningReport } from "@/core/provisioner";
import { createSingleFlightUntilStable } from "@/core/single-flight";
import { loadRowLogs } from "@/core/rowlog";
import { logCheckinEventSafely } from "@/libs/ecosystem-bridge-kit";
import { initEcosystemIntegration, type EcosystemController } from "@/core/ecosystem-integration";
import { registerPluginContextMenus, type PluginContextMenusController } from "@/core/plugin-context-menus";
import { registerPluginEntrypoints, type PluginEntrypointsController, TAB_TYPE } from "@/core/plugin-entrypoints";
import { initPluginAuthGuard, type PluginAuthGuardController } from "@/core/plugin-auth-guard";
import { SCHEMA_CATALOG } from "@/core/schema";
import type { HomeSettings } from "@/types";
import { lvNotify, lvTicker, lvActivity, lvBackup, lvLaunchpad, lvOmnisearch, lvAutomation, type LvSearchResultItem } from "@/libs/lv-notice-kit";
import { homeNotify, homeSilent } from "@/libs/notice";
import { deliverPriorityReminderCard } from "@/core/hub/priority-reminder-delivery";
import { searchMatch } from "@/core/pinyin";

/** 版本显示（诊断/关于）：构建时由 vite define 从 plugin.json 注入（REL-01 版本单源，勿写字面量） */
const PLUGIN_VERSION = typeof __PLUGIN_VERSION__ !== "undefined" ? __PLUGIN_VERSION__ : "0.5.195";

/**
 * 小驴管家（Lv Home）
 * 家庭与生活管家：成员档案 · 资产 · 育儿上学 · 病历社保 · 影音书库 · 出行旅行
 */
export default class LvHomePlugin extends Plugin {
    settings: HomeSettings;
    runtime: HubRuntime;
    scan: ScanResult;
    /** 小驴生态全局后台心跳订阅清理器 (Epoch 7 Phase 2: lvTicker 统一节拍) */
    private tickerUnsubscribe?: () => void;
    /** 零点跨日刷新订阅清理器 */
    private dateCrossUnsubscribe?: () => void;
    /** 所有延迟回调统一登记，确保卸载时没有匿名计时器继续访问插件实例。 */
    private readonly timeoutIds = new Set<number>();
    /** 小驴全生态统一通知注销回调 (Epoch 7) */
    private noticeHubCleaner?: () => void;
    /** 全生态联合灾备切面注销器 (Epoch 7 Phase 4) */
    private backupCleaner?: () => void;
    /** 小驴罗盘注销回调 (Epoch 7 Phase 5: lvLaunchpad) */
    private launchpadCleaner?: () => void;
    /** 全生态万物穿透检索注销器 (Epoch 7 Phase 7: lvOmnisearch) */
    private omnisearchCleaner?: () => void;
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
    private isUnloading = false;
    /** 思源 UI 同步入口控制器（顶栏、页签、命令面板、状态栏、斜杠指令及存活守护） */
    private entrypointsController?: PluginEntrypointsController;
    /** 移动端统一罗盘与悬浮球入口清理器 */
    private mobileEntryCleaner?: () => void;
    /** 全局遮罩点击即关清理器 */
    private scrimClickCleaner?: () => void;
    /** 内核鉴权失效、权限拦截与会话恢复守护控制器 */
    private authGuardController?: PluginAuthGuardController;
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
        this.entrypointsController?.updateStatusbar(count);
    }

    /** i18n 取值（1.2.8 起 i18n 为 JSONValue，字符串位置统一转 string） */
    i18nText(key: string): string {
        return String(this.i18n[key] ?? key);
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
                const inst = mount(TabPanel, { target: element, props: { plugin: this } });
                return () => {
                    if (typeof inst === "function") (inst as () => void)();
                    else if (inst) void unmount(inst);
                };
            },
        });

        this.settings = await loadSettings(this);
        this.runtime = await loadRuntime(this);

        this.authGuardController = initPluginAuthGuard({
            plugin: this,
            t: (k) => this.i18nText(k),
            emitHubChanged: () => this.emitHubChanged(),
            scheduleTimeout: (fn, delay) => this.scheduleTimeout(fn, delay),
            showTab: () => this.showTab(),
        });
        this.authGuardController.checkRestoredAuth();

        // 全端入口接入小驴罗盘统一管理（Protocol v1.7.5 Unified Entry 顶栏+悬浮球收敛）
        try {
            this.mobileEntryCleaner = lvLaunchpad.ensureUnifiedEntry();
        } catch { /* 容错降级 */ }

        // 全局遮罩点击即关（Backdrop Scrim Click-to-Dismiss · 对齐管家全弹窗人体工程学）
        const onHomeScrimClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && target.classList?.contains("b3-dialog__scrim")) {
                const dialogEl = target.closest(".b3-dialog");
                if (dialogEl && dialogEl.querySelector('[id^="lv-"], .lv-home, .dialog-content')) {
                    const closeBtn = dialogEl.querySelector<HTMLElement>(".b3-dialog__close, [data-action='close'], .b3-button--cancel");
                    if (closeBtn) closeBtn.click();
                }
            }
        };
        window.addEventListener("click", onHomeScrimClick, true);
        this.scrimClickCleaner = () => window.removeEventListener("click", onHomeScrimClick, true);

        // 309 波：页签/顶栏/命令/图标的注册已全部移到 registerEntrypoints()，
        // 在 onload 的首个 await 之前同步完成（宿主装配窗口内）——此处不再重复登记。

        // schema 契约门禁（33.2；193 波收口 SCHEMA_CATALOG 单源）：开发期发现违规立即暴露
        if (process.env.DEV_MODE) {
            import("@/core/schema").then(({ validateSchema }) => {
                for (const [id, schema] of Object.entries(SCHEMA_CATALOG)) {
                    const errors = validateSchema(id, schema);
                    if (errors.length) console.error("[LvHome] schema contract violations:", errors);
                }
            }).catch(() => undefined);
        }

        // 欢迎提示与初次引导优化：
        // 1. 仅在全新空白安装且从未提示过时给出温馨提示；
        // 2. 凡已有成员、已有台账、已完成向导、或当前会话已提示过的，坚决不弹，彻底杜绝重复弹窗打扰
        const isFreshInstall = !this.settings.onboarded && this.settings.members.length === 0 && Object.keys(this.settings.dbRefs).length === 0;
        if (isFreshInstall && !this.runtime?.firstRunWelcomed) {
            if (this.runtime) this.runtime.firstRunWelcomed = true;
            homeNotify(this.i18nText("firstRun"), 5000, "info");
        }

        // 15 组：settings.json 损坏已回退默认 → 明确警告（诊断区可见 settings.json.corrupted.json 标记）
        if (this.settings.corruptedSettings) {
            // 269 波：损坏原因就地显示（用户不必翻 marker 文件）；时长 8s→10s 给足阅读时间
            const reason = this.settings.corruptedSettings;
            const detail = typeof reason === "string" ? `（${reason}）` : "";
            homeNotify(this.i18nText("settings.corrupted") + detail, 10000, "error");
        }

        // 接入小驴生态全局后台心跳主时钟 (lvTicker)：失焦自动降频至 60s 节电，对齐后台节拍
        this.tickerUnsubscribe = lvTicker.subscribe("siyuan-home", 30 * 60 * 1000, () => {
            this.refreshHub()
                .then(() => homeSilent("heartbeat-scan", "管家定时心跳后台巡检完成"))
                .catch((e) => console.warn("[LvHome] heartbeat scan failed:", e));
        });

        // 零点跨日精准广播刷新：00:00 准点重算到期事项与待办，免去轮询日期
        this.dateCrossUnsubscribe = lvTicker.onDateCross("siyuan-home", (todayKey) => {
            this.refreshHub(undefined, true)
                .then(() => homeSilent("date-cross-refresh", `管家零点跨日自动重算完成：${todayKey}`))
                .catch((e) => console.warn("[LvHome] date cross refresh failed:", e));
        });

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

        // 注册小驴全生态统一通知中心 (Epoch 7 Protocol v1.0.0)
        try {
            this.noticeHubCleaner = lvNotify.registerPlugin("siyuan-home");
        } catch { /* 容错 */ }

        // 注册全生态一键联合灾备切面 (Epoch 7 Phase 4: lvBackup)
        try {
            this.backupCleaner = lvBackup.register(
                "siyuan-home",
                async () => this.dumpEcosystemBackupData(),
                async (data) => this.restoreEcosystemBackupData(data)
            );
        } catch { /* 容错 */ }

        // 注册小驴罗盘极速弹射坞入口与二级行动 (Epoch 7 Phase 5: lvLaunchpad)
        this.registerLaunchpadEntry();

        // 注册全生态万物穿透检索切面 (Epoch 7 Phase 7: lvOmnisearch)
        try {
            this.omnisearchCleaner = lvOmnisearch.registerProvider(
                "siyuan-home",
                (keyword) => this.searchHomeItems(keyword)
            );
        } catch { /* 容错 */ }
    }

    /** 布局就绪后：首次引导数据准备 + 智能找回历史台账 + 扫描（不阻塞启动，不强制全量建库） */
    async onLayoutReady() {
        try {
            await this.adoptHistoryLedgers();
            await this.refreshHub(undefined, true);
            if (this.settings?.onboarded && this.app) {
                import("@/core/doc-sync").then(({ syncRowLogsToSiYuanDocs }) => {
                    syncRowLogsToSiYuanDocs(this);
                    homeSilent("journal-sync", "后台流水与日记文档增量同步完成");
                }).catch(() => undefined);
            }
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
                homeSilent("ledger-adopt", `后台已智能对齐并找回 ${report.adoptedCount} 个历史台账`);
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
            // 重点到期事项（证件/保单/药品/关键合同）卡片化派发 (lvNotify.card)
            let priorityCardDelivered = false;
            try {
                const priorityRes = deliverPriorityReminderCard({
                    reminders: scan.reminders,
                    settings: this.settings,
                    runtime: this.runtime,
                    t: (k) => this.i18nText(k),
                    onOpenReminders: () => this.openRemindersScreen(),
                    onOpenModule: (m) => this.openModuleTab(m),
                });
                priorityCardDelivered = priorityRes.delivered;
            } catch { /* 优雅降级 */ }

            const digest = dailyDigest(scan, this.settings, this.runtime);
            if (digest.shouldNotify) {
                markNotified(this.runtime);
                if (priorityCardDelivered) {
                    // 若已弹出重点到期交互卡片，常规摘要自动降级为静默记录入库，彻底杜绝双重弹窗打扰
                    homeSilent("hub-digest", `每日生活摘要：${digest.overdue} 项逾期，${digest.soon} 项临期`);
                } else {
                    const text = this.i18nText("notify.digest")
                        .replace("${overdue}", String(digest.overdue))
                        .replace("${soon}", String(digest.soon));
                    homeNotify(text, 6000, "info");
                }
            }
            // B3b：逾期事项每日首次发现立即提示（H12：与摘要共用静默判断）
            const { localDateKey } = await import("@/core/hub/rule");
            const today = localDateKey(new Date());
            let pushedOverdueAlert = false;
            if (scan.counts.overdue > 0 && !inSilentHours(this.settings, this.runtime) && this.runtime.lastOverdueAlertDate !== today) {
                this.runtime.lastOverdueAlertDate = today;
                if (!priorityCardDelivered) {
                    homeNotify(this.i18nText("notify.overdue").replace("${n}", String(scan.counts.overdue)), 6000, "error");
                }
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
                homeNotify(this.i18nText("notify.weekly").replace("${n}", String(weekly.upcoming)), 6000, "info");
            }
        }
        // H03：显式清理已完成运行态记录（未处理项永不自动删），清理结果随本次落盘
        purgeHandled(this.runtime, new Date());
        // 29 组月度应到基数：全量扫描时统计当月到期总数（已办结数 + 当前逾期/未办数，基数保持单调不小于已办数）
        if (!onlySet) {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const dueNowCount = scan.reminders.filter((r) => r.daysLeft <= 0).length;
            const completedCount = this.runtime.monthlyCompletions?.[monthKey] ?? 0;
            const safeDueTotal = Math.max(dueNowCount + completedCount, this.runtime.monthlyDueTotals?.[monthKey] ?? 0);
            this.runtime.monthlyDueTotals = { ...(this.runtime.monthlyDueTotals ?? {}), [monthKey]: safeDueTotal };
            // 266 波模块趋势条：记录当日各模块待办计数（滚动 14 天，同日覆盖），供总览模块卡 spark 渲染
            const { recordModuleHistory } = await import("@/core/hub/runtime");
            recordModuleHistory(this.runtime, scan.reminders, now);
        }
        await saveRuntime(this, this.runtime);
        this.lastScanAt = Date.now();
        // 后台扫描全面静默化：常规扫描结果静默入库，不弹窗打扰用户
        homeSilent("hub-scan", `管家扫描完成：${scan.counts.overdue} 项逾期，${scan.counts.soon} 项临期（共 ${scan.reminders.length} 项）`);
        performance.mark(`${perfMark}-end`);
        try { performance.measure(perfMark, `${perfMark}-start`, `${perfMark}-end`); } catch { /* PF01 测量标记 */ }
        const todayDue = scan.reminders.filter((r) => r.daysLeft <= 0).length;
        this.updateStatusbar(todayDue);

        // 跨插件智能自动化联动 (Epoch 7 Phase 7: lvAutomation)
        // 扫描到剩余天数 <= 3 天的到期事项时，触发联动
        const expiringItems = (scan.reminders ?? []).filter((r) => typeof r.daysLeft === "number" && r.daysLeft <= 3);
        if (expiringItems.length > 0) {
            for (const item of expiringItems) {
                try {
                    await lvAutomation.trigger("siyuan-home", "expiring-item", {
                        id: item.id,
                        title: item.title,
                        dueDate: item.dueDate,
                    });
                } catch { /* 容错降级 */ }
            }
        }

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
            homeNotify(message, 6500, "error");
        }
        this.updateStatusbar(reminders.filter((r) => r.daysLeft <= 0).length);
        this.emitHubChanged();
        this.registerLaunchpadEntry();
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

    private isMobileView(): boolean {
        if (typeof getFrontend === "function") {
            const fe = getFrontend();
            if (fe === "mobile" || fe === "browser-mobile") return true;
        }
        return Boolean(typeof lvLaunchpad?.isMobileFrontend === "function" && lvLaunchpad.isMobileFrontend());
    }

    showTab() {
        if (this.isMobileView()) {
            this.entrypointsController?.getMobileController()?.openMobilePanel();
            return;
        }
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
        if (this.isMobileView()) {
            this.entrypointsController?.getMobileController()?.openMobilePanel("reminders");
            return;
        }
        this.showTab();
        this.panelScreenSwitch?.("reminders");
    }

    /** 导航并打开指定台账模块（如 "assets" | "members" | "medicine" | "vehicle" 等） */
    openModuleTab(moduleId: string) {
        this.pendingScreen = moduleId;
        if (this.isMobileView()) {
            this.entrypointsController?.getMobileController()?.openMobilePanel(moduleId);
            return;
        }
        this.showTab();
        this.panelScreenSwitch?.(moduleId);
    }

    /** 打开台账文档或定位具体块（B4e/R5 定案：detached 行 itemID 不在 blocks 表，必须优先打开台账文档 docId；若 blockId 实为真实绑定文档块则再聚焦高亮） */
    showTabDocs(docId?: string, blockId?: string) {
        const resolvedDocId = docId ?? (blockId ? undefined : this.settings.dbRefs[this.activeLedger]?.docId);
        const primaryTarget = resolvedDocId ?? blockId;
        if (!primaryTarget) return;

        // 手机端：分流调用 openMobileFileById 并主动收起全屏管家面板，露出底层文档
        if (this.isMobileView()) {
            const action: TProtyleAction[] | undefined = primaryTarget === blockId && blockId ? ["cb-get-focus", "cb-get-hl"] : undefined;
            if (typeof openMobileFileById === "function") {
                openMobileFileById(this.app, primaryTarget, action);
            }
            if (blockId && resolvedDocId && blockId !== resolvedDocId && typeof openMobileFileById === "function") {
                import("@/core/siyuan").then(({ sql }) =>
                    sql<{ id: string }>(`SELECT id FROM blocks WHERE id='${blockId.replace(/'/g, "''")}' LIMIT 1`)
                ).then((rows) => {
                    if (rows && rows.length > 0) {
                        openMobileFileById(this.app, blockId, ["cb-get-focus", "cb-get-hl"]);
                    }
                }).catch(() => undefined);
            }
            try {
                this.entrypointsController?.getMobileController()?.closeMobilePanel();
            } catch { /* soft close */ }
            return;
        }

        openTab({
            app: this.app,
            doc: {
                id: primaryTarget,
                action: primaryTarget === blockId && blockId ? ["cb-get-focus", "cb-get-hl"] : ["cb-get-focus"],
            },
            keepCursor: false,
        });
        if (blockId && resolvedDocId && blockId !== resolvedDocId) {
            import("@/core/siyuan").then(({ sql }) =>
                sql<{ id: string }>(`SELECT id FROM blocks WHERE id='${blockId.replace(/'/g, "''")}' LIMIT 1`)
            ).then((rows) => {
                if (rows && rows.length > 0) {
                    openTab({
                        app: this.app,
                        doc: { id: blockId, action: ["cb-get-focus", "cb-get-hl"] },
                        keepCursor: false,
                    });
                }
            }).catch(() => undefined);
        }
    }

    private async syncJournalSafely(): Promise<void> {
        if (!this.app) return;
        try {
            const { syncDailyJournalDoc } = await import("@/core/doc-sync");
            await syncDailyJournalDoc(this);
        } catch { /* soft */ }
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
            contracts: [],
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

        // 手机端触感反馈 (Mobile Spec v1: 完成待办调 lvLaunchpad.haptic(10))
        try {
            lvLaunchpad.haptic(10);
        } catch { /* 零强依赖优雅降级 */ }

        // 待办完成活动广播 (Epoch 7 Phase 3: lvActivity)
        try {
            const taskTitle = r?.title || (r?.moduleId ? `事项（${r.moduleId}）` : "家庭事项");
            lvActivity.record({
                source: "管家",
                category: "task",
                title: `完成待办: ${taskTitle}`,
                detail: r?.dueDate ? `到期日: ${r.dueDate}` : undefined,
                linkBlockId: r?.rowId || r?.id,
            });
        } catch { /* 零强依赖优雅降级 */ }

        // 事务完成联动打卡（Epoch 6 联邦规范）
        try {
            const today = localDateKey(new Date());
            const rowId = r.rowId || r.id || "item";
            const modId = r.moduleId || "general";
            // 优先匹配用户在设置中自定义配置的成员打卡习惯绑定
            const matchedBinding = (this.settings.checkinBindings ?? []).find(
                (b) => (!b.memberId || b.memberId === r.memberId)
            );
            const targetItemId = matchedBinding?.itemId || `home_${modId}`;
            await logCheckinEventSafely({
                itemId: targetItemId,
                externalRef: `home:${modId}:${rowId}:${today}`,
                note: r.title ? `办结家庭事项：${r.title}` : `办结家庭事项（${modId}）`,
            });
        } catch { /* 零强依赖优雅降级 */ }
        await this.notifyHubChanged();
        if (r?.moduleId === "adhoc") await this.syncJournalSafely();
    }
    async snooze(id: string, days: number) { await snooze(this, id, days); await this.notifyHubChanged(); }
    async snoozeToDate(id: string, targetDate: string) {
        const { snoozeToDate } = await import("@/core/hub/actions");
        await snoozeToDate(this, id, targetDate);
        await this.notifyHubChanged();
    }
    async batchSnooze(ids: string[], targetDate: string): Promise<Record<string, string | undefined>> {
        const { batchSnooze } = await import("@/core/hub/actions");
        const prev = await batchSnooze(this, ids, targetDate);
        // 手机端触感反馈 (Mobile Spec v1: 逾期一键批延成功)
        try {
            lvLaunchpad.haptic(10);
        } catch { /* 零强依赖优雅降级 */ }
        await this.notifyHubChanged();
        return prev;
    }
    async undoBatchSnooze(previousMap: Record<string, string | undefined>): Promise<void> {
        const { undoBatchSnooze } = await import("@/core/hub/actions");
        await undoBatchSnooze(this, previousMap);
        await this.notifyHubChanged();
    }
    async mute(id: string) { await mute(this, id); await this.notifyHubChanged(); }
    async unmute(id: string) { await unmute(this, id); await this.notifyHubChanged(); }
    /** 恢复已处理/忽略项（H07） */
    async restore(id: string) {
        await restore(this, id);
        await this.notifyHubChanged();
        await this.syncJournalSafely();
    }
    /** 续期写回台账行（H10：按规则自己的 field 列，缴费不改保障到期日）→ 增量重扫该模块 */
    renew(r: any, iso: string) {
        const rule = (this.schemaCatalog[r.moduleId]?.reminders ?? []).find((x: any) => x.key === r.ruleKey);
        return renew(this, r, iso, this.settings.dbRefs[r.moduleId] ?? {}, rule?.field ?? "expiry")
            .then(async () => {
                if (this.app && r?.moduleId) {
                    try {
                        const { syncModuleDocSection } = await import("@/core/doc-sync");
                        await syncModuleDocSection(this, r.moduleId);
                    } catch { /* soft */ }
                }
                return this.refreshHub(r.moduleId);
            });
    }
    async addMemo(title: string, due: string, options?: any) {
        await addMemo(this, title, due, options);
        await this.notifyHubChanged();
        await this.syncJournalSafely();
    }
    async updateMemo(id: string, patch: { title?: string; dueDate?: string }) {
        await updateMemo(this, id, patch);
        await this.notifyHubChanged();
        await this.syncJournalSafely();
    }
    /** 删除备忘（显式动作，H03：未处理备忘只经此删除） */
    async removeMemo(id: string) {
        await removeMemo(this, id);
        await this.notifyHubChanged();
        await this.syncJournalSafely();
    }
    /** 29 组：今日免打扰快捷开关（todaySilent 存当日 localDateKey，跨天自动失效；闸口在 inSilentHours） */
    async toggleTodaySilent() {
        const { localDateKey } = await import("@/core/hub/rule");
        const today = localDateKey(new Date());
        const previous = this.runtime.todaySilent;
        this.runtime.todaySilent = this.runtime.todaySilent === today ? "" : today;
        try {
            await saveRuntime(this, this.runtime);
            homeNotify(this.i18nText(this.runtime.todaySilent ? "hub.todaySilentOn" : "hub.todaySilentOff"), 3000, "info");
            await this.notifyHubChanged();
        } catch (e) {
            this.runtime.todaySilent = previous;
            throw e;
        }
    }
    /** 已处理视图数据（H07） */
    listHandled() { return listHandled(this.runtime, this.runtime.cache?.derived ?? []); }
    async finishOnboarding(household: { roles: string[]; children: number }, moduleIds: string[]) {
        this.settings.household = household as any;
        this.settings.enabledModules = Array.from(new Set([...this.settings.enabledModules, ...moduleIds]));
        const shouldInitMembers = !this.settings.members || this.settings.members.length === 0;
        // C7c：建库批处理进度提示（先完成 members 等台账建库，再创建初始成员行，确保 avItemId 真实写入不悬空）
        homeNotify(this.i18nText("wiz.provisioning").replace("${n}", String(moduleIds.length)), 4000, "info");
        const provisioning = await this.ensureCoreLedgers();
        if (!this.settings.dbRefs?.members?.avId) {
            try { await this.repairModule("members"); } catch { /* soft */ }
        }
        if (shouldInitMembers) {
            const roleLabels: Record<string, string> = {
                self: "我 (本人)",
                spouse: "配偶",
                partner: "伴侣",
                elder: "长辈",
                parent: "长辈",
                child: "孩子",
                kin: "亲属",
                relative: "亲属",
                pet: "宠物",
            };
            const initMembers: any[] = [];
            for (const r of household.roles ?? ["self"]) {
                if (r === "child" && household.children > 1) {
                    for (let c = 1; c <= household.children; c++) {
                        initMembers.push({ id: `mem-${Date.now()}-${c}`, name: `孩子${c}`, role: "child" });
                    }
                } else {
                    initMembers.push({ id: `mem-${Date.now()}-${initMembers.length + 1}`, name: roleLabels[r] || r, role: r });
                }
            }
            if (this.settings.dbRefs?.members?.avId) {
                const { addMember } = await import("@/core/members");
                for (const m of initMembers) {
                    await addMember(this, this.settings, m);
                }
            } else {
                this.settings.members = initMembers;
            }
        }
        this.settings.onboarded = true;
        try {
            const { syncDailyJournalDoc } = await import("@/core/doc-sync");
            await syncDailyJournalDoc(this);
        } catch { /* soft */ }
        await saveSettings(this, this.settings);
        // C7c 收尾：建库失败浮出（此前只进诊断区，向导完成后用户无感）
        const failed = provisioning.issues.map(({ moduleId }) => this.i18nText(`module.${moduleId}`));
        if (failed.length > 0) {
            homeNotify(this.i18nText("wiz.provisionIssues")
                .replace("${n}", String(failed.length))
                .replace("${modules}", failed.join("、")), 8000, "error");
        } else {
            homeNotify(this.i18nText("wiz.provisioned").replace("${n}", String(moduleIds.length)), 3000, "info");
        }
        // Onboarding provisions ledgers and may add member rows. Force the
        // first post-wizard scan so the overview is built from fresh data.
        await this.refreshHub(undefined, true);
    }

    /**
     * 导出管家核心灾备数据切面（供 lvBackup 联合灾备调度）
     * 涵盖：家庭成员档案、启用的模块配置、台账文档/视图/列绑定、日常待办/备忘流水、办结记录等
     */
    async dumpEcosystemBackupData(): Promise<Record<string, unknown>> {
        return {
            version: PLUGIN_VERSION,
            exportedAt: new Date().toISOString(),
            settings: this.settings ? JSON.parse(JSON.stringify(this.settings)) : {},
            runtime: {
                memos: this.runtime?.memos ? JSON.parse(JSON.stringify(this.runtime.memos)) : [],
                handled: this.runtime?.handled ? JSON.parse(JSON.stringify(this.runtime.handled)) : {},
                handledYear: this.runtime?.handledYear ? JSON.parse(JSON.stringify(this.runtime.handledYear)) : {},
                handledUntil: this.runtime?.handledUntil ? JSON.parse(JSON.stringify(this.runtime.handledUntil)) : {},
                monthlyCompletions: this.runtime?.monthlyCompletions ? JSON.parse(JSON.stringify(this.runtime.monthlyCompletions)) : {},
            },
            coreLedgers: {
                members: this.settings?.members ?? [],
                enabledModules: this.settings?.enabledModules ?? [],
                dbRefs: this.settings?.dbRefs ?? {},
            },
        };
    }

    /**
     * 恢复管家灾备切面数据
     */
    async restoreEcosystemBackupData(data: Record<string, unknown>): Promise<boolean> {
        try {
            if (!data || typeof data !== "object") return false;
            if (data.settings && typeof data.settings === "object") {
                const incoming = data.settings as Partial<HomeSettings>;
                this.settings = { ...this.settings, ...incoming };
                await saveSettings(this, this.settings);
            }
            if (data.runtime && typeof data.runtime === "object") {
                const rt = data.runtime as any;
                if (!this.runtime) {
                    this.runtime = await loadRuntime(this);
                }
                if (Array.isArray(rt.memos)) this.runtime.memos = rt.memos;
                if (rt.handled && typeof rt.handled === "object") {
                    this.runtime.handled = { ...(this.runtime.handled ?? {}), ...rt.handled };
                }
                if (rt.handledYear && typeof rt.handledYear === "object") {
                    this.runtime.handledYear = { ...(this.runtime.handledYear ?? {}), ...rt.handledYear };
                }
                if (rt.handledUntil && typeof rt.handledUntil === "object") {
                    this.runtime.handledUntil = { ...(this.runtime.handledUntil ?? {}), ...rt.handledUntil };
                }
                await saveRuntime(this, this.runtime);
            }
            this.emitHubChanged();
            this.refreshHub(undefined, true).catch(() => undefined);
            return true;
        } catch (err) {
            console.error("[LvHome] restoreEcosystemBackupData failed:", err);
            return false;
        }
    }

    /**
     * 小驴罗盘主入口：唤起管家仪表盘
     */
    openDashboard() {
        this.showTab();
    }

    /**
     * 获取当前临期/逾期事项总数（7 天内临期与逾期）
     */
    getExpiringCount(): number {
        if (!this.scan?.reminders) return 0;
        return this.scan.reminders.filter((r: any) => typeof r.daysLeft === "number" && r.daysLeft <= 7).length;
    }

    /**
     * 处理小驴罗盘二级快捷行动直达（Mobile Spec v1: 手机直办动作）
     */
    async handleQuickAction(action: string): Promise<void> {
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        switch (action) {
            case "记一笔备忘":
            case "快速记录生活备忘事项":
                if (this.isMobileView()) {
                    this.entrypointsController?.getMobileController()?.openMobilePanel("overview");
                } else {
                    this.showTab();
                }
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                }
                break;
            case "今日清单":
                this.openRemindersScreen();
                break;
            case "逾期扫描":
            case "扫描即将到期证件与药品":
                await this.refreshHub(undefined, true);
                this.runtime.hubFilter = "overdue";
                this.openRemindersScreen();
                break;
            case "证件到期速览":
                this.runtime.hubModuleId = "certs";
                this.openRemindersScreen();
                break;
            case "批量归档已完成待办项": {
                const { syncDailyJournalDoc } = await import("@/core/doc-sync");
                await syncDailyJournalDoc(this);
                homeNotify("已完成待办项批量归档与流水同步", 2500, "info");
                break;
            }
            case "AI生活效期智能体检":
            case "全生态数据健康体检与清理": {
                await this.runLifeHealthAudit();
                break;
            }
            default:
                this.showTab();
                break;
        }
    }

    /**
     * 运行证件、药品、保单效期全局智能体检洞察 (Epoch 7 Phase 6)
     */
    async runLifeHealthAudit(): Promise<void> {
        await this.refreshHub(undefined, true);
        const { auditLifeHealthWithAi } = await import("@/core/ai-nlp");
        const audit = await auditLifeHealthWithAi(this);

        try {
            const { Dialog } = await import("siyuan");
            const { bindDialogA11y } = await import("@/core/dialog-a11y");
            const dlg = new Dialog({
                title: `🐴 ${this.i18nText("overview.aiAuditTitle")}`,
                content: `<div class="b3-dialog__content lv-dialog-scroll-body"><pre class="lv-caption lv-report-pre" style="white-space:pre-wrap; line-height:1.6; font-size:12.5px; margin:0;"></pre></div>
<div class="b3-dialog__action">
  <button type="button" class="b3-button b3-button--cancel">${this.i18nText("cancel") || "关闭"}</button>
  <button type="button" class="b3-button" id="lv-audit-copy">${this.i18nText("overview.aiAuditCopyBtn")}</button>
  <button type="button" class="b3-button b3-button--outline" id="lv-audit-journal">${this.i18nText("overview.aiAuditJournalBtn")}</button>
</div>`,
                width: "640px",
            });

            bindDialogA11y({ dlg });

            const pre = dlg.element.querySelector("pre");
            if (pre) pre.textContent = audit.reportText;

            const cancelBtn = dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement | null;
            if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();

            const copyBtn = dlg.element.querySelector("#lv-audit-copy") as HTMLButtonElement | null;
            if (copyBtn) {
                copyBtn.onclick = async () => {
                    try {
                        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
                        await navigator.clipboard.writeText(audit.reportText);
                        homeNotify(this.i18nText("overview.aiAuditCopyOk"), 2500, "info");
                    } catch (err) {
                        console.warn("[siyuan-home] audit copy failed", err);
                        homeNotify(this.i18nText("overview.aiAuditCopyFail"), 3200, "error");
                    }
                };
            }

            const journalBtn = dlg.element.querySelector("#lv-audit-journal") as HTMLButtonElement | null;
            if (journalBtn) {
                journalBtn.onclick = async () => {
                    const docId = this.settings?.dbRefs?.adhoc?.docId;
                    if (docId) {
                        const { upsertDocSection } = await import("@/core/doc-sync");
                        const { withDocLock } = await import("@/libs/notice");
                        await withDocLock(docId, async () => {
                            await upsertDocSection(docId, "life-health-audit", audit.reportText);
                        });
                        homeNotify(this.i18nText("overview.aiAuditJournalOk"), 2500, "info");
                    } else {
                        homeNotify(this.i18nText("overview.aiAuditJournalNotFound"), 3000, "info");
                    }
                };
            }
        } catch {
            homeNotify(audit.reportText.slice(0, 100), 5000, "info");
        }
    }

    /**
     * 向小驴罗盘登记注册或刷新本插件入口切面（Mobile Spec v1: 4 个手机直办动作）
     */
    registerLaunchpadEntry(): void {
        try {
            this.launchpadCleaner?.();
            const expiring = this.getExpiringCount();
            this.launchpadCleaner = lvLaunchpad.register({
                id: "siyuan-home",
                name: "管家",
                fullName: "小驴管家",
                svgIcon: "iconLvHome",
                color: "#10b981",
                desc: "事项归档 · 效期预警",
                digit: 3,
                badge: expiring > 0 ? `${expiring} 到期` : undefined,
                badgeType: "warn",
                actions: ["记一笔备忘", "今日清单", "逾期扫描", "证件到期速览"],
                topBarElement: (this as any).topBarElement,
                onClick: () => this.openDashboard(),
                onAction: (action) => this.handleQuickAction(action),
            });
        } catch { /* 容错降级 */ }
    }

    /**
     * 全生态万物穿透检索切面实现 (Epoch 7 Phase 7: lvOmnisearch)
     * 支持跨插件全文检索待办事项、证件有效期限、常备药品效期、保险合同保单、家庭成员等手机高频实体
     */
    searchHomeItems(keyword: string): LvSearchResultItem[] {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return [];
        const results: LvSearchResultItem[] = [];

        // 1. 待办与快速备忘项
        const memos = this.runtime?.memos ?? [];
        for (const m of memos) {
            const hit = m.title?.toLowerCase().includes(kw) ||
                (m.category && m.category.toLowerCase().includes(kw)) ||
                searchMatch(m.title, kw);
            if (hit) {
                const isDone = Boolean(m.doneAt);
                results.push({
                    id: `home:memo:${m.id}`,
                    source: "管家",
                    category: "待办",
                    title: m.title,
                    snippet: m.dueDate ? `到期日: ${m.dueDate}${m.category ? ` · #${m.category}` : ""}` : (m.category ? `#${m.category}` : "生活备忘"),
                    badge: isDone ? "已办结" : (m.priority === "high" ? "高优" : undefined),
                    onClick: () => {
                        this.showTab();
                    },
                });
            }
        }

        // 2. 证件、药品、保单效期提醒项
        const reminders = this.scan?.reminders ?? [];
        const categoryMap: Record<string, string> = {
            certs: "证件",
            medicine: "药品",
            insurance: "保单",
            contracts: "合同",
            vehicles: "车辆",
            adhoc: "待办",
        };

        for (const r of reminders) {
            if (r.moduleId === "adhoc" && results.some((item) => item.id.includes(r.id))) continue;
            const hit = r.title?.toLowerCase().includes(kw) ||
                r.moduleId?.toLowerCase().includes(kw) ||
                searchMatch(r.title, kw);
            if (hit) {
                const cat = categoryMap[r.moduleId] || "效期";
                const badge = r.daysLeft <= 0 ? "已逾期" : `剩余 ${r.daysLeft} 天`;
                results.push({
                    id: `home:rem:${r.id}`,
                    source: "管家",
                    category: cat,
                    title: r.title,
                    snippet: `到期效期: ${r.dueDate} · ${cat}`,
                    badge,
                    linkBlockId: r.rowId || r.id,
                    onClick: () => {
                        this.openRemindersScreen();
                    },
                });
            }
        }

        // 3. 家庭成员档案实体 (Mobile Spec v1: 手机高频检索)
        const members = this.settings?.members ?? [];
        for (const mem of members) {
            const hit = mem.name?.toLowerCase().includes(kw) ||
                (mem.role && mem.role.toLowerCase().includes(kw)) ||
                searchMatch(mem.name, kw);
            if (hit) {
                results.push({
                    id: `home:member:${mem.id}`,
                    source: "管家",
                    category: "成员",
                    title: mem.name,
                    snippet: `家庭成员 · ${mem.role || "成员"}${mem.birthday ? ` · 生日 ${mem.birthday}` : ""}`,
                    badge: "档案",
                    onClick: () => {
                        this.openModuleTab("members");
                    },
                });
            }
        }

        return results;
    }

    /** Tab 面板挂载入口（tab callback 由框架调 addTab 注册的 destroy 之外回调） */
    mountPanel(element: HTMLElement) {
        const inst = mount(TabPanel, {
            target: element,
            props: { plugin: this },
        });
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
        this.scrimClickCleaner?.();
        this.scrimClickCleaner = undefined;
        this.mobileEntryCleaner?.();
        this.mobileEntryCleaner = undefined;
        this.omnisearchCleaner?.();
        this.omnisearchCleaner = undefined;
        this.launchpadCleaner?.();
        this.launchpadCleaner = undefined;
        this.backupCleaner?.();
        this.backupCleaner = undefined;
        this.noticeHubCleaner?.();
        this.noticeHubCleaner = undefined;
        this.tickerUnsubscribe?.();
        this.tickerUnsubscribe = undefined;
        this.dateCrossUnsubscribe?.();
        this.dateCrossUnsubscribe = undefined;
        this.isUnloading = true;
        this.entrypointsController?.dispose();
        this.entrypointsController = undefined;
        this.authGuardController?.dispose();
        this.authGuardController = undefined;
        for (const timer of this.timeoutIds) window.clearTimeout(timer);
        this.timeoutIds.clear();
        this.contextMenusController?.dispose();
        this.contextMenusController = undefined;
        this.ecosystemController?.dispose();
        this.ecosystemController = undefined;
        this.hubListeners.clear();
        this.scanSeq++;
    }
}
