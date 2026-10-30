<script lang="ts">
    import type { Reminder } from "@/types";
    import Onboarding from "../onboarding.svelte";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { formatLocalTime } from "@/core/date-display";
    import { memberHue } from "@/core/format";
    import { showMessage, Dialog } from "siyuan";
    import { moduleTone } from "@/core/modules";
    import UiIcon from "@/ui/icon.svelte";
    import ActivityFeed from "../activity-feed.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { getWeeklyPulse, getFamilyAchievements } from "@/core/pulse-and-achievements";
    import { formatAsTaskBlock } from "@/core/block-capture";
    import OverviewPulseStrip from "../overview-pulse-strip.svelte";
    import OverviewStartGuide from "./overview-start-guide.svelte";
    import OverviewQuickMemo from "./overview-quick-memo.svelte";
    import {
        openLifeIndexModal as showLifeIndex,
        openEmergencyCardModal as showEmergencyCard,
        openYearlyShareCardModal as showShareCard,
    } from "@/core/overview-modals";
    import OverviewModuleGrid from "./overview-module-grid.svelte";
    import OverviewBentoGrid from "./overview-bento-grid.svelte";
    import OverviewUpcomingList from "./overview-upcoming-list.svelte";

    let { plugin, t, onGoto, onCapture, version, initialScanError = "", onRetryScan }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        onGoto: (s: string) => void;
        onCapture?: (moduleId?: string) => void;
        version?: number;
        initialScanError?: string;
        onRetryScan?: () => Promise<void>;
    } = $props();

    function openQuickCapture(moduleId: string) {
        plugin.setActiveLedger(moduleId);
        // The capture sheet is mounted once at tab-panel level. Set the target
        // before opening it so the shortcut always opens the module the user
        // just chose, even when a previous capture used another module.
        if (plugin.runtime) plugin.runtime.hubQuickModule = moduleId;
        if (onCapture) onCapture(moduleId);
        else onGoto("ledger");
    }

    const onboarded = $derived.by(() => {
        void version;
        return !!plugin.settings.onboarded;
    });

    // version（H02）：hubListeners 触发时递增，驱动以下 $derived 重算（plugin.* 为普通对象引用，本身不追踪）
    const allReminders = $derived.by(() => {
        void version;
        return plugin.scan?.reminders ?? [];
    });
    const weeklyPulse = $derived.by(() => {
        void version;
        return getWeeklyPulse(new Date(), allReminders);
    });
    const achievements = $derived.by(() => {
        void version;
        return getFamilyAchievements(plugin.settings, allReminders);
    });
    const members = $derived.by(() => {
        void version;
        return plugin.settings.members ?? [];
    });
    // C2e：成员过滤——本地 $state 驱动（runtime.filterMemberId 只作持久化；普通对象属性读不追踪）
    // svelte-ignore state_referenced_locally
    let memberFilter = $state<string | undefined>(plugin.runtime.filterMemberId);
    let pulseDateFilter = $state<string | undefined>(undefined);
    // C2e：成员过滤与周律动日期联动筛选
    const reminders = $derived(
        (memberFilter
            ? allReminders.filter((r: Reminder) => !r.memberId || r.memberId === memberFilter)
            : allReminders
        ).filter((r: Reminder) => !pulseDateFilter || r.dueDate === pulseDateFilter)
    );
    const top = $derived(reminders.slice(0, 4));
    // 260 波：首扫 loading 态——runtime 无快照时间且无错误时，"最近没有要紧事"是撒谎
    // （未知 ≠ 0，13 §3.4）；骨架屏表达"正在读取"
    const firstScanPending = $derived.by(() => {
        void version;
        return !initialScanError && !plugin.runtime?.scannedAt && !(plugin.scan?.errors?.length) && allReminders.length === 0;
    });
    // 218 波性能（176 波 alertsByMember 同款）：模块卡 pending 计数预分组——
    // 模板每卡 filter 全量提醒 O(模块×提醒)，预分组后单遍 O(提醒)。
    const pendingByModule = $derived.by(() => {
        const map = new Map<string, number>();
        for (const r of reminders) map.set(r.moduleId, (map.get(r.moduleId) ?? 0) + 1);
        return map;
    });
    // EC09（D20）：打卡绑定 × 强度摘要求交——只展示有数据的绑定（成员名·习惯名·强度）；derived 免模板双重求值
    const healthBound = $derived.by(() => {
        void version;
        const items = plugin.runtime?.lastCheckinSummary?.items ?? [];
        const byId = new Map(items.map((it: { itemId: string; score: number }) => [it.itemId, it.score]));
        const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
        return (plugin.settings.checkinBindings ?? [])
            .filter((b) => byId.has(b.itemId))
            .map((b) => ({ label: `${memberName(b.memberId)} · ${b.itemName}`, score: byId.get(b.itemId)! }));
    });
    // 29 组月度完成率：当月完成数 / 当月应到基数（从 runtime.monthlyCompletions / monthlyDueTotals 读取）
    const monthlyDone = $derived.by(() => {
        const now = new Date();
        const monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
        return plugin.runtime?.monthlyCompletions?.[monthKey] ?? 0;
    });
    const monthlyDueTotal = $derived.by(() => {
        const now = new Date();
        const monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
        return plugin.runtime?.monthlyDueTotals?.[monthKey] ?? 0;
    });

    // 快捷录入只展示当前已启用的模块。固定展示未启用模块会把用户带到
    // 不存在的台账页，随后点击“重建”也不会真正创建该模块。
    const quickModuleIds = ["vehicles", "certs", "medicine", "memberships", "favors", "media", "health", "insurance", "stock", "parenting", "members"];
    const quickModules = $derived.by(() => {
        void version;
        const enabled = new Set(plugin.settings.enabledModules);
        const prioritized = quickModuleIds.filter((id) => enabled.has(id));
        const additional = plugin.settings.enabledModules.filter((id) => enabled.has(id) && !quickModuleIds.includes(id) && id !== "adhoc");
        return [...prioritized, ...additional].filter((id) => id === "members" || !!plugin.schemaCatalog?.[id]?.capture?.length);
    });
    let quickExpanded = $state(false);
    const quickVisibleModules = $derived(quickExpanded ? quickModules : quickModules.slice(0, 6));
    // A user may have disabled every optional module. Keep the first-record
    // guide actionable in that state instead of routing to a non-existent
    // `certs` ledger. The CTA then opens module settings where one can be
    // enabled and provisioned.
    const starterModule = $derived(
        quickModules.find((id) => id !== "members")
        ?? plugin.settings.enabledModules.find((id) => id !== "members" && id !== "adhoc")
        ?? undefined,
    );

    function openStarterRecord() {
        if (starterModule) openLedgerFor(starterModule);
        else plugin.openSetting();
    }

    // 266 波（模块卡趋势条）：近 5 日待办计数序列（数据源 moduleHistory，refreshHub 每日记录）。
    // 已知天数 ≥3 才出趋势条（新装不足两日无趋势语义）；条高按窗口内最大值归一（保底 15%）。
    const moduleHistory = $derived.by(() => {
        void version;
        return plugin.runtime?.moduleHistory ?? {};
    });

    // 170/171 波（对齐原型质感，不低于）：context-strip 状态条 + focus-row 三重点卡
    const reminderSummary = $derived.by(() => {
        void version;
        let overdue = 0;
        let soon7 = 0;
        let urgent: Reminder | undefined = undefined;
        for (const r of allReminders) {
            if (r.level === "overdue") overdue++;
            if (r.daysLeft >= 0 && r.daysLeft <= 7) soon7++;
            if (!urgent || r.daysLeft < urgent.daysLeft) urgent = r;
        }
        return { overdue, soon7, urgent };
    });
    const overdueCount = $derived(reminderSummary.overdue);
    const soon7Count = $derived(reminderSummary.soon7);
    const urgentDueReminder = $derived(reminderSummary.urgent);
    const syncErrCount = $derived.by(() => { void version; return members.filter((m) => m.syncError).length; });
    const scanErrors = $derived.by(() => { void version; return plugin.scan?.errors ?? []; });
    const permissionDenied = $derived(scanErrors.some((error) => error.moduleId === "permission"));
    const scanStale = $derived.by(() => { void version; return plugin.scan?.stale === true; });
    const snapshotLabel = $derived.by(() => {
        const at = plugin.runtime?.scannedAt;
        return formatLocalTime(at, { hour: "2-digit", minute: "2-digit" }) ?? "—";
    });
    const scopeLabel = $derived(memberFilter ? (members.find((m) => m.id === memberFilter)?.name ?? "?") : t("dash.scopeAll"));

    // 264 波：行数口径（cache.byModule 随扫描快照；version 驱动重算）——模块卡主数字与成员卡统计格
    const statsByModule = $derived.by(() => {
        void version;
        return plugin.runtime?.cache?.byModule ?? {};
    });
    const rowCountOf = (mid: string): number | undefined => statsByModule[mid]?.rowCount;
    const hasLedgerRows = $derived.by(() => Object.values(statsByModule).some((stats: any) => typeof stats?.rowCount === "number" && stats.rowCount > 0));
    const showStartGuide = $derived(onboarded && (members.length === 0 || !hasLedgerRows));

    // 262 波（Todoist/Linear assignee avatar 语言）：行级成员微头像——"这是谁的事"一眼可辨
    const memberOf = (id: string | undefined) => (id ? members.find((m) => m.id === id) : undefined);
    // 对齐原型 hero：按本地时段问候 + 日期·快照说明行（纯展示，随挂载取值）
    const greet = $derived.by(() => {
        const h = new Date().getHours();
        return h < 11 ? t("dash.greet.morning") : h < 18 ? t("dash.greet.afternoon") : t("dash.greet.evening");
    });
    const dateLine = $derived(`${new Date().toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" })} · ${t("dash.stripSnapshot")} ${snapshotLabel}`);

    // 17 组/196 波：统计卡下钻——待办徽章点击 → 提醒页并预筛选该模块（runtime.hubModuleId 为提醒页筛选持久态）
    function drillReminders(mid: string) {
        plugin.runtime.hubModuleId = mid;
        onGoto("reminders");
    }

    async function copyAsTaskBlock(r: Reminder) {
        const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
        const text = formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("hub.taskBlockCopied"), 2500, "info");
        } catch {
            showMessage(t("ledger.copyAsImageFail"), 4000, "error");
        }
    }

    function openLedgerFor(moduleId: string) {
        plugin.setActiveLedger(moduleId);
        onGoto("ledger");
    }

    // 261 波：「查看全部」= 新意图——清掉上次会话遗留的筛选（逾期/某成员/某模块）再进入；
    // 与模块卡下钻（预筛该模块）语义相反，各自成立
    async function viewAllReminders() {
        plugin.runtime.hubFilter = "all";
        plugin.runtime.hubMemberId = undefined;
        plugin.runtime.hubModuleId = undefined;
        plugin.runtime.hubDueWithin = "all";
        onGoto("reminders");
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch (e) {
            showMessage(t("dash.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }

    async function setMemberFilter(id: string | undefined) {
        memberFilter = id;
        plugin.runtime.filterMemberId = id;
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch (e) {
            showMessage(t("dash.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }

    let retryingScan = $state(false);
    async function retryScan() {
        if (retryingScan) return;
        retryingScan = true;
        try {
            if (onRetryScan) await onRetryScan();
            else await plugin.refreshHub(undefined, true);
        } catch (e) {
            showMessage(t("hub.rescanFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            retryingScan = false;
        }
    }

    // 每条提醒独立锁定写操作，避免双击把同一条完成/延后写入两次。
    let overviewBusy = $state<Set<string>>(new Set());
    async function runOverviewAction(key: string, action: () => Promise<void>) {
        if (overviewBusy.has(key)) return;
        overviewBusy = new Set([...overviewBusy, key]);
        try { await action(); }
        catch (e) { showMessage(t("hub.actionFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error"); }
        finally {
            const next = new Set(overviewBusy);
            next.delete(key);
            overviewBusy = next;
        }
    }

    // 300波里程碑：家庭年度生活指数与幸福资产盘点
    const openLifeIndexModal = () => showLifeIndex({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });

    // 318波：家庭急救与应急联络卡
    const openEmergencyCardModal = () => showEmergencyCard({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });

    // 320波：家庭生活年度回顾长图与里程碑卡片
    const openShareCardModal = () => showShareCard({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });

    // 322波：总览主屏一键直达全模块「📍 东西放哪了」存放位置速查
    function openLocationIndexModal() {
        onGoto("ledger");
        setTimeout(() => window.dispatchEvent(new CustomEvent("siyuan-home:open-location")), 60);
    }
</script>

{#if !onboarded}
    <Onboarding {plugin} {t} onGoto={onGoto} {onCapture} />
{:else}
<div class="lv-hero">
    <div class="lv-hero-copy">
        <div class="lv-hero-meta" role="status" aria-label={t("dash.stripLabel")}>
            <span>{dateLine}{scanStale ? ` · ${t("dash.stale")}` : ""}</span>
            {#if memberFilter}
                <span><strong>{t("dash.stripScope")}</strong> {scopeLabel}</span>
            {/if}
            {#if scanErrors.length > 0}
                <span class="lv-badge red"><strong>{t("dash.stripErrors")}</strong> {scanErrors.length}</span>
            {/if}
        </div>
        <h1>{greet}，{t("dash.heroTitle")}</h1>
        <p class="lv-hero-lead">
            {#if reminders.length > 0}
                {reminders.length} {reminders.length === 1 ? t("dash.needAttentionOne") : t("dash.needAttention")} · {t("dash.focusTodayBody").replace("${od}", String(overdueCount)).replace("${s}", String(soon7Count))}
            {:else}
                {t("dash.heroLead")}
            {/if}
        </p>
        <div class="lv-hero-actions">
            <button class="lv-btn primary lv-hero-open" onclick={() => onGoto("reminders")}><UiIcon name="clock" size={16} />{t("dash.heroOpen")}</button>
            {#if onCapture}
                <button class="lv-btn lv-hero-action-btn lv-hero-capture-btn" onclick={() => onCapture()}><UiIcon name="add" size={15} />{t("dash.quickRecord")}</button>
            {/if}
            <div class="lv-hero-tools-group" role="group" aria-label="快捷工具">
                <button class="lv-btn ghost sm" onclick={openLocationIndexModal} title={t("ledger.locSearch")}><UiIcon name="mapPin" size={14} />{t("ledger.locSearch")}</button>
                <button class="lv-btn ghost sm" onclick={openLifeIndexModal} title={t("overview.lifeIndex")}><UiIcon name="shield" size={14} />{t("overview.lifeIndex")}</button>
                <button class="lv-btn ghost sm" onclick={openEmergencyCardModal} title={t("overview.emergencyCard")}><UiIcon name="alert" size={14} />{t("overview.emergencyCard")}</button>
                <button class="lv-btn ghost sm" onclick={openShareCardModal} title={t("overview.shareCard")}><UiIcon name="camera" size={14} />{t("overview.shareCard")}</button>
            </div>
        </div>
        {#if monthlyDone > 0}<p><span class="lv-badge green"><UiIcon name="check" size={12} /> {t("dash.monthlyDone").replace("${n}", monthlyDueTotal > 0 ? `${monthlyDone}/${monthlyDueTotal}` : String(monthlyDone))}</span></p>{/if}
    </div>
    <div class="lv-hero-tools">
        <div class="lv-hero-stat-card" title={t("dash.statScope").replace("${t}", snapshotLabel)}>
            <div class="lv-hero-stat-header">
                <span class="lv-hero-stat-icon" aria-hidden="true"><UiIcon name="clock" size={16} /></span>
                <span class="lv-hero-stat-label">{reminders.length === 1 ? t("dash.needAttentionOne") : t("dash.needAttention")}</span>
            </div>
            <div class="lv-hero-stat-body">
                <b class="lv-num lv-hero-stat-num">{reminders.length}</b>
            </div>
            <div class="lv-hero-stat-footer">
                <span class="lv-badge {reminders.length > 0 ? 'orange' : 'green'}">
                    {reminders.length > 0 ? `${reminders.length} 项需留意` : '全家就绪 · 暂无到期'}
                </span>
            </div>
        </div>
    </div>
</div>

{#if permissionDenied}
    <div class="lv-card lv-alert-banner" role="alert">
        <UiIcon name="alert" size={18} />
        <span class="lv-alert-text">{t("permission.body")}</span>
        <button class="b3-button b3-button--outline" disabled={retryingScan} aria-busy={retryingScan} onclick={retryScan}>
            {retryingScan ? t("ledger.saving") : t("hub.rescan")}
        </button>
    </div>
{/if}

{#if showStartGuide}
    <OverviewStartGuide
        {t}
        {starterModule}
        {onGoto}
        onOpenStarterRecord={openStarterRecord}
        onOpenSettings={() => plugin.openSetting()}
    />
{/if}

<OverviewBentoGrid
    {urgentDueReminder}
    {overdueCount}
    {soon7Count}
    {syncErrCount}
    {memberOf}
    {t}
    {onGoto}
    onOpenLedger={openLedgerFor}
/>

<OverviewPulseStrip {weeklyPulse} {achievements} bind:pulseDateFilter />

<div class="lv-members">
    <button class="lv-chip {!memberFilter ? 'on' : ''}" aria-pressed={!memberFilter} onclick={() => setMemberFilter(undefined)}>{t("members.all")}</button>
    {#each members as m (m.id)}
        <button class="lv-chip {memberFilter === m.id ? 'on' : ''}" aria-pressed={memberFilter === m.id} onclick={() => setMemberFilter(m.id)}>
            <span class="lv-avatar" aria-hidden="true" style="background:linear-gradient(135deg, hsl({memberHue(m.id)} 62% 52%), hsl({(memberHue(m.id) + 42) % 360} 62% 40%))">{m.name.slice(0, 1)}</span>{m.name}
        </button>
    {/each}
    <button class="lv-chip" aria-label={t("add")} title={t("add")} onclick={() => onGoto("members")}><UiIcon name="add" size={15} /></button>
</div>

<OverviewUpcomingList
    {reminders}
    {top}
    {memberFilter}
    bind:pulseDateFilter
    {initialScanError}
    {scanErrors}
    {snapshotLabel}
    {firstScanPending}
    {starterModule}
    {retryingScan}
    {overviewBusy}
    {memberOf}
    {t}
    onViewAll={viewAllReminders}
    onClearMemberFilter={() => void setMemberFilter(undefined)}
    onRetryScan={retryScan}
    onOpenStarterRecord={openStarterRecord}
    onOpenLedger={openLedgerFor}
    {onGoto}
    onCopyTaskBlock={copyAsTaskBlock}
    onCompleteReminder={(r) => void runOverviewAction(r.id, () => plugin.complete(r))}
    onSnoozeReminder={(r, days) => void runOverviewAction(r.id, () => plugin.snooze(r.id, days))}
/>

<ActivityFeed {plugin} {t} {version} compact={true} />

<div class="lv-sec"><h2 class="lv-title-sec">{t("dash.quickRecord")}</h2><span class="lv-sub">{t("dash.quickRecordSub")}</span>
    {#if onCapture}<button class="b3-button b3-button--text" onclick={() => onCapture()}>{t("capture.openFull")}</button>{/if}
</div>
<div id="lv-quick-modules" class="lv-quick">
    {#each quickVisibleModules as mid (mid)}
        {@const tone = moduleTone(mid)}
        <button class="lv-qbtn {tone}" onclick={() => mid === "members" ? onGoto("members") : openQuickCapture(mid)}>
            <span class="qi"><UiIcon name={moduleUiIcon(mid)} size={18} /></span>
            <span class="ql">{mid === "members" ? t("tab.members") : t(`module.${mid}`)}</span>
        </button>
    {/each}
    {#if quickModules.length > 6}
        <button class="lv-qbtn lv-qbtn--toggle" aria-expanded={quickExpanded}
            onclick={() => (quickExpanded = !quickExpanded)}>
            <span class="qi lv-quick-expand-icon" aria-hidden="true">{quickExpanded ? "⌃" : "⌄"}</span>
            <span class="ql">{quickExpanded ? t("dash.quickModulesLess") : t("dash.quickModulesMore").replace("${n}", String(quickModules.length - 6))}</span>
        </button>
    {/if}
</div>
<OverviewQuickMemo {plugin} {t} />

<OverviewModuleGrid
    {plugin}
    {version}
    {t}
    {firstScanPending}
    {snapshotLabel}
    {pendingByModule}
    {moduleHistory}
    {healthBound}
    {rowCountOf}
    {moduleTone}
    {moduleUiIcon}
    onOpenSetting={() => plugin.openSetting()}
    onGotoLedger={(mid) => { plugin.setActiveLedger(mid); onGoto("ledger"); }}
    onDrillReminders={drillReminders}
/>
{/if}

<style>
    .lv-alert-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
    }
    .lv-alert-text {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .lv-quick-expand-icon {
        font-size: 15px;
        font-weight: 600;
    }
</style>
