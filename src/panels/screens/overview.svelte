<script lang="ts">
    import type { Reminder } from "@/types";
    import Onboarding from "../onboarding.svelte";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { fade } from "svelte/transition";
    import { localDateKey } from "@/core/hub/rule";
    import { parseNaturalDate } from "@/core/dateparse";
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
    import {
        openLifeIndexModal as showLifeIndex,
        openEmergencyCardModal as showEmergencyCard,
        openYearlyShareCardModal as showShareCard,
    } from "@/core/overview-modals";
    import OverviewModuleGrid from "./overview-module-grid.svelte";

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
    const overdueCount = $derived.by(() => { void version; return allReminders.filter((r: Reminder) => r.level === "overdue").length; });
    const soon7Count = $derived.by(() => { void version; return allReminders.filter((r: Reminder) => r.daysLeft >= 0 && r.daysLeft <= 7).length; });
    const urgentDueReminder = $derived.by(() => {
        void version;
        if (!allReminders.length) return undefined;
        return allReminders.slice().sort((a, b) => a.daysLeft - b.daysLeft)[0];
    });
    const syncErrCount = $derived.by(() => { void version; return members.filter((m) => m.syncError).length; });
    const scanErrors = $derived.by(() => { void version; return plugin.scan?.errors ?? []; });
    const permissionDenied = $derived(scanErrors.some((error) => error.moduleId === "permission"));
    const scanStale = $derived.by(() => { void version; return plugin.scan?.stale === true; });
    const snapshotLabel = $derived.by(() => {
        const at = plugin.runtime?.scannedAt;
        return formatLocalTime(at, { hour: "2-digit", minute: "2-digit" }) ?? "—";
    });
    const scopeLabel = $derived(memberFilter ? (members.find((m) => m.id === memberFilter)?.name ?? "?") : t("dash.scopeAll"));

    // 262 波（Todoist quick add 灵感）：自然语言日期即时预览——输入即解析，
    // 命中且未显式选日期时在输入行内亮出 chip，比"提交后才 toast"早一步反馈
    const memoParsed = $derived.by(() => {
        const raw = memoTitle.trim();
        if (!raw || memoDue) return null;
        return parseNaturalDate(raw);
    });

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

    let memoTitle = $state("");
    let memoDue = $state("");
    let memoInput: HTMLInputElement | undefined = $state();
    let savingMemo = $state(false);
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
    async function addMemo() {
        if (savingMemo) return;
        if (!memoTitle.trim()) {
            memoInput?.focus();
            showMessage(t("memo.titleRequired"), 4000, "info");
            return;
        }
        // 16 组/214 波：智能日期解析（滴答清单规格）——标题命中日期表达式则剥离进到期日；
        // 显式选择的日期优先于解析（用户选了日期选择器即为明确意图）。
        const parsed = parseNaturalDate(memoTitle);
        let title = memoTitle.trim();
        let due = memoDue;
        if (parsed && parsed.rest) {
            if (!due) due = parsed.date;
            title = parsed.rest;
            showMessage(t("memo.dateParsed").replace("${d}", parsed.date), 2500, "info");
        }
        if (!title) return;
        // 默认到期日走本地时区（33.3：禁 toISOString，UTC+8 夜间会偏一天）
        const d = due || localDateKey(new Date(Date.now() + 3 * 86400000));
        savingMemo = true;
        try {
            await plugin.addMemo(title, d);
            memoTitle = ""; memoDue = "";
        } catch (e) {
            showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            savingMemo = false;
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
            <button class="b3-button lv-hero-open" onclick={() => onGoto("reminders")}><UiIcon name="clock" size={16} />{t("dash.heroOpen")}</button>
            <button class="b3-button b3-button--outline lv-hero-action-btn" onclick={openLocationIndexModal}><UiIcon name="mapPin" size={15} />{t("ledger.locSearch")}</button>
            <button class="b3-button b3-button--outline lv-hero-action-btn" onclick={openLifeIndexModal}><UiIcon name="shield" size={15} />{t("overview.lifeIndex")}</button>
            <button class="b3-button b3-button--outline lv-hero-action-btn" onclick={openEmergencyCardModal}><UiIcon name="alert" size={15} />{t("overview.emergencyCard")}</button>
            <button class="b3-button b3-button--outline lv-hero-action-btn" onclick={openShareCardModal}><UiIcon name="camera" size={15} />{t("overview.shareCard")}</button>
            {#if onCapture}
                <button class="b3-button b3-button--outline lv-hero-action-btn lv-hero-capture-btn" onclick={() => onCapture()}><UiIcon name="add" size={15} />{t("dash.quickRecord")}</button>
            {/if}
        </div>
        {#if monthlyDone > 0}<p><span class="lv-badge green">✓ {t("dash.monthlyDone").replace("${n}", monthlyDueTotal > 0 ? `${monthlyDone}/${monthlyDueTotal}` : String(monthlyDone))}</span></p>{/if}
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
                <span class="lv-badge {reminders.length > 0 ? 'orange' : 'green'}" style="font-size:11px">
                    {reminders.length > 0 ? `${reminders.length} 项需留意` : '全家就绪 · 暂无到期'}
                </span>
            </div>
        </div>
    </div>
</div>

{#if permissionDenied}
    <div class="lv-card" role="alert" style="display:flex;align-items:center;gap:12px;padding:12px 16px">
        <UiIcon name="alert" size={18} />
        <span style="flex:1;min-width:0;overflow-wrap:anywhere">{t("permission.body")}</span>
        <button class="b3-button b3-button--outline" disabled={retryingScan} aria-busy={retryingScan} onclick={retryScan}>
            {retryingScan ? t("ledger.saving") : t("hub.rescan")}
        </button>
    </div>
{/if}

{#if showStartGuide}
    <details class="lv-start-guide" aria-labelledby="lv-start-guide-title">
        <summary class="lv-start-guide__summary">
            <span class="lv-start-guide__copy">
                <span class="lv-kicker">{t("startGuide.kicker")}</span>
                <span id="lv-start-guide-title" class="lv-start-guide__title">{t("startGuide.title")}</span>
                <span class="lv-start-guide__intro">{t("startGuide.intro")}</span>
            </span>
            <span class="lv-start-guide__mark" aria-hidden="true">⌄</span>
        </summary>
        <div class="lv-start-guide__steps">
            <div class="lv-start-guide__step">
                <span class="lv-start-guide__num">1</span>
                <div><b>{t("startGuide.stepMembers")}</b><span>{t("startGuide.stepMembersHint")}</span></div>
                <button class="b3-button b3-button--outline" onclick={() => onGoto("members")}>{t("startGuide.openMembers")}</button>
            </div>
            <div class="lv-start-guide__step">
                <span class="lv-start-guide__num">2</span>
                <div><b>{t("startGuide.stepRecord")}</b><span>{starterModule ? t("startGuide.stepRecordHint") : t("startGuide.stepRecordNoModule")}</span></div>
                <button class="b3-button b3-button--outline" onclick={openStarterRecord}>{starterModule ? t("startGuide.openLedger") : t("startGuide.openSettings")}</button>
            </div>
            <div class="lv-start-guide__step">
                <span class="lv-start-guide__num">3</span>
                <div><b>{t("startGuide.stepModules")}</b><span>{t("startGuide.stepModulesHint")}</span></div>
                <button class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
            </div>
            <div class="lv-start-guide__step">
                <span class="lv-start-guide__num">4</span>
                <div><b>{t("startGuide.stepReminders")}</b><span>{t("startGuide.stepRemindersHint")}</span></div>
                <button class="b3-button b3-button--outline" onclick={() => onGoto("reminders")}>{t("startGuide.openReminders")}</button>
            </div>
        </div>
    </details>
{/if}

<div class="lv-focus lv-bento-grid" aria-label={t("dash.focusLabel")}>
    <!-- 324波：中枢规范大方块 Bento 特征卡（最近到期与倒计时核心看板） -->
    <button type="button" class="lv-bento-card lv-bento-card--hero" onclick={() => { if (urgentDueReminder) { if (urgentDueReminder.moduleId !== 'adhoc') openLedgerFor(urgentDueReminder.moduleId); else onGoto('reminders'); } else { onGoto('reminders'); } }} aria-label={urgentDueReminder ? `${urgentDueReminder.title}：${urgentDueReminder.daysLeft}天` : t("dash.bentoAllGood")}>
        <div class="lv-bento-hero-header">
            <span class="lv-badge {urgentDueReminder && urgentDueReminder.daysLeft <= 0 ? 'red' : urgentDueReminder && urgentDueReminder.daysLeft <= 7 ? 'orange' : 'amber'}">
                {#if urgentDueReminder}
                    ⏱️ {t("dash.bentoUrgentTitle")} · {t(`module.${urgentDueReminder.moduleId}`) !== `module.${urgentDueReminder.moduleId}` ? t(`module.${urgentDueReminder.moduleId}`) : t("adhoc.name")}
                {:else}
                    🛡️ {t("dash.bentoAllGood")}
                {/if}
            </span>
            {#if urgentDueReminder}
                <span class="lv-bento-hero-badge lv-num">
                    {urgentDueReminder.daysLeft < 0 ? t("days.overdue").replace("${n}", String(-urgentDueReminder.daysLeft)) : urgentDueReminder.daysLeft === 0 ? t("days.today") : t("days.after").replace("${n}", String(urgentDueReminder.daysLeft))}
                </span>
            {/if}
        </div>
        <div class="lv-bento-hero-body">
            {#if urgentDueReminder}
                <h3 class="lv-bento-hero-title">{urgentDueReminder.title}</h3>
                <p class="lv-bento-hero-sub">
                    {#if memberOf(urgentDueReminder.memberId)}
                        <span class="lv-caption">👤 {memberOf(urgentDueReminder.memberId)?.name} · </span>
                    {/if}
                    <span class="lv-caption">📅 {urgentDueReminder.dueDate}</span>
                </p>
            {:else}
                <h3 class="lv-bento-hero-title" style="font-size:16px;color:var(--lv-ok)">{t("dash.bentoAllGood")}</h3>
                <p class="lv-bento-hero-sub">{t("dash.bentoAllGoodSub")}</p>
            {/if}
        </div>
        <div class="lv-bento-hero-footer">
            <span class="lv-link" style="font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px">
                {t("dash.handleNow")} →
            </span>
        </div>
    </button>

    <!-- 双小方块 Bento 副卡：今日待办与资料核对 -->
    <div class="lv-bento-side">
        <button type="button" class="lv-focus-card lv-focus-card--today" onclick={() => onGoto("reminders")} aria-label={`${t("dash.focusToday")}：${overdueCount + soon7Count}`}>
            <div class="lv-focus-copy">
                <span class="lv-focus-label">{t("dash.focusToday")}</span>
                <strong class="lv-focus-num lv-num">{overdueCount + soon7Count}</strong>
                <span class="lv-focus-sub">{t("dash.focusTodayBody").replace("${od}", String(overdueCount)).replace("${s}", String(soon7Count))}</span>
            </div>
            <span class="lv-focus-icon" aria-hidden="true"><UiIcon name="clock" size={20} /></span>
        </button>
        <button type="button" class="lv-focus-card lv-focus-card--review" onclick={() => onGoto("members")} aria-label={`${t("dash.focusReview")}：${syncErrCount}`}>
            <div class="lv-focus-copy">
                <span class="lv-focus-label">{t("dash.focusReview")}</span>
                <strong class="lv-focus-num lv-num">{syncErrCount}</strong>
                <span class="lv-focus-sub">{syncErrCount > 0 ? t("dash.focusReviewBody").replace("${n}", String(syncErrCount)) : t("dash.focusReviewOk")}</span>
            </div>
            <span class="lv-focus-icon" aria-hidden="true"><UiIcon name="users" size={20} /></span>
        </button>
    </div>
</div>

<OverviewPulseStrip {weeklyPulse} {achievements} bind:pulseDateFilter />

<div class="lv-members" style="margin-bottom:4px">
    <button class="lv-chip {!memberFilter ? 'on' : ''}" aria-pressed={!memberFilter} onclick={() => setMemberFilter(undefined)}>{t("members.all")}</button>
    {#each members as m (m.id)}
        <button class="lv-chip {memberFilter === m.id ? 'on' : ''}" aria-pressed={memberFilter === m.id} onclick={() => setMemberFilter(m.id)}>
            <span class="lv-avatar" aria-hidden="true" style="background:linear-gradient(135deg, hsl({memberHue(m.id)} 62% 52%), hsl({(memberHue(m.id) + 42) % 360} 62% 40%))">{m.name.slice(0, 1)}</span>{m.name}
        </button>
    {/each}
    <button class="lv-chip" aria-label={t("add")} title={t("add")} onclick={() => onGoto("members")}><UiIcon name="add" size={15} /></button>
</div>

<div class="lv-sec">
    <h2 class="lv-title-sec">{t("dash.upcoming")}</h2>
    <span class="lv-sub">{t("dash.upcomingSub")}</span>
    {#if pulseDateFilter}
        <button type="button" class="lv-badge blue" style="cursor:pointer;border:none;margin-left:8px" onclick={() => { pulseDateFilter = undefined; }} title="清除日期聚焦">
            🗓️ {pulseDateFilter} ✕
        </button>
    {/if}
    <button class="b3-button b3-button--text" onclick={viewAllReminders}>{t("dash.viewAll")} →</button>
</div>
{#if reminders.length === 0 && (initialScanError || scanErrors.length > 0)}
    <div class="lv-card"><div class="lv-empty" role="alert">
        <div class="eic"><UiIcon name="alert" size={22} /></div><b>{t("dash.scanUnavailable")}</b>
        <span>{initialScanError || t("dash.focusDataErr").replace("${t}", snapshotLabel).replace("${n}", String(scanErrors.length))}</span>
        <button class="b3-button b3-button--outline" style="margin-top:8px" disabled={retryingScan} aria-busy={retryingScan} onclick={retryScan}>
            {retryingScan ? t("ledger.saving") : t("hub.rescan")}
        </button>
    </div></div>
{:else if reminders.length === 0 && memberFilter}
    <!-- 174 波（对齐原型空态解释）：筛选导致的空 ≠ 无资料，说明并给清除出口 -->
    <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="search" size={22} /></div><b>{t("dash.filteredEmpty")}</b><span>{t("dash.filteredEmptyHint")}</span>
        <button class="b3-button b3-button--outline" style="margin-top:8px" onclick={() => setMemberFilter(undefined)}>{t("dash.clearFilter")}</button>
    </div></div>
{:else if reminders.length === 0}
    {#if firstScanPending}
        <!-- 260 波：首扫骨架（未知 ≠ 全部完成） -->
        <div class="lv-card lv-rems" aria-busy="true" role="status">
            {#each [0, 1, 2] as i (i)}
                <div class="lv-rem">
                    <div class="lv-skel" style="width:38px;height:38px;border-radius:11px;flex:none"></div>
                    <div style="flex:1;display:flex;flex-direction:column;gap:7px;min-width:0">
                        <div class="lv-skel" style="height:13px;width:42%"></div>
                        <div class="lv-skel" style="height:11px;width:26%"></div>
                    </div>
                </div>
            {/each}
        </div>
        <p class="lv-caption" style="margin:8px 2px">{t("hub.firstScan")}</p>
    {:else}
        <div class="lv-card lv-empty-compact" role="status">
            <div class="eic-sm"><UiIcon name="check" size={18} /></div>
            <div class="lv-empty-compact__text">
                <b>{t("dash.allClear")}</b>
                <span>{t("hub.emptyHint")}</span>
            </div>
            {#if starterModule}
                <button class="b3-button b3-button--outline" onclick={openStarterRecord}>
                    ＋ {t("ledger.newRecord")}
                </button>
            {/if}
        </div>
    {/if}
{:else}
    <div class="lv-card lv-rems">
        {#each top as r (r.id)}
            <!-- 261 波：离场淡出（对齐提醒页；完成/延后不再瞬消失） -->
            <div class="lv-rem {r.level}" out:fade={{ duration: 150 }}>
                <!-- 259 波：图标砖收回中性（对齐原型 .rem .ic = surface-2）——级别语义由色轨+
                     右侧相对时间大字承载，彩色砖让整列提醒过度用色 -->
                <div class="lv-rem-ic" aria-hidden="true"><UiIcon name={moduleUiIcon(r.moduleId)} size={18} /></div>
                <div class="lv-rem-t" role="button" tabindex="0" style="cursor:pointer"
                    onclick={() => { if (r.moduleId !== 'adhoc') openLedgerFor(r.moduleId); else onGoto('reminders'); }}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (r.moduleId !== 'adhoc') openLedgerFor(r.moduleId); else onGoto('reminders'); } }}
                    title={t("dash.heroOpen")}>
                    <b>{r.title}</b><span>{#if memberOf(r.memberId)}{@const member = memberOf(r.memberId)}<span class="lv-miniava" style="background:linear-gradient(135deg, hsl({memberHue(member.id)} 62% 52%), hsl({(memberHue(member.id) + 42) % 360} 62% 40%))" aria-hidden="true">{member.name.slice(0, 1)}</span>{/if}{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : t("adhoc.name")}{#if !r.memberId} · {t("members.unassigned")}{/if}{r.lunar ? " 🌙" : ""}{r.autoRenew ? " 🔄" : ""}</span>
                </div>
                <div class="lv-rem-when"><b class="lv-num" style="color:var(--lv-{r.level === 'overdue' ? 'danger' : r.level === 'soon' ? 'warn' : 'amber'})">
                    {r.daysLeft < 0 ? t("days.overdue").replace("${n}", String(-r.daysLeft)) : r.daysLeft === 0 ? t("days.today") : t("days.after").replace("${n}", String(r.daysLeft))}
                </b><span class="lv-num">{r.dueDate}</span></div>
                <div class="lv-rem-ops">
                    <button class="b3-button b3-button--text" title={t("hub.copyTaskBlock")} onclick={() => copyAsTaskBlock(r)}>📋</button>
                    <button class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => void runOverviewAction(r.id, () => plugin.complete(r))}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.done")}</button>
                    <button class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => void runOverviewAction(r.id, () => plugin.snooze(r.id, 7))}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.snooze7")}</button>
                </div>
            </div>
        {/each}
    </div>
{/if}

<ActivityFeed {plugin} {t} {version} compact={true} />

<div class="lv-sec"><h2 class="lv-title-sec">{t("dash.quickRecord")}</h2><span class="lv-sub">{t("dash.quickRecordSub")}</span>
    {#if onCapture}<button class="b3-button b3-button--text" onclick={() => onCapture()}>{t("capture.openFull")}</button>{/if}
</div>
<div id="lv-quick-modules" class="lv-quick" style="margin-bottom:8px">
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
            <span class="qi" aria-hidden="true" style="font-size:15px;font-weight:600">{quickExpanded ? "⌃" : "⌄"}</span>
            <span class="ql">{quickExpanded ? t("dash.quickModulesLess") : t("dash.quickModulesMore").replace("${n}", String(quickModules.length - 6))}</span>
        </button>
    {/if}
</div>
<div class="lv-sec"><h2 class="lv-title-sec">{t("memo.quick")}</h2><span class="lv-sub">{t("memo.quickSub")}</span></div>
<div class="lv-card lv-memo" style="margin-top:0">
    <!-- 261 波：回车提交（isComposing 守卫——中文输入法选词的 Enter 不算提交） -->
    <input bind:this={memoInput} class="b3-text-field fn__flex-1" style="min-width:180px" placeholder={t("memo.placeholder")} bind:value={memoTitle}
        disabled={savingMemo} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <!-- 262 波（Todoist 式即时预览）：解析命中即亮 chip，提交前就知道日期去哪了 -->
    {#if memoParsed}
        <span class="lv-parsechip" role="status"><UiIcon name="calendar" size={13} /> <span class="lv-num">{memoParsed.date}</span></span>
    {/if}
    <input class="b3-text-field" type="date" bind:value={memoDue} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <button class="lv-btn primary sm" disabled={savingMemo} aria-busy={savingMemo} onclick={addMemo} title={t("memo.add")}>{savingMemo ? t("ledger.saving") : `＋ ${t("memo.add")}`}</button>
</div>

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
