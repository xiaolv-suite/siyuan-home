<script lang="ts">
    import type { Reminder } from "@/types";
    import { fade } from "svelte/transition";
    import { memberHue } from "@/core/format";
    import { moduleUiIcon } from "@/ui/icons";
    import UiIcon from "@/ui/icon.svelte";

    let {
        reminders,
        top,
        overdueCount = 0,
        memberFilter,
        pulseDateFilter = $bindable(undefined),
        initialScanError = "",
        scanErrors = [],
        snapshotLabel,
        firstScanPending,
        starterModule,
        retryingScan = false,
        overviewBusy = new Set(),
        memberOf,
        plugin,
        t,
        onViewAll,
        onClearMemberFilter,
        onRetryScan,
        onOpenStarterRecord,
        onOpenLedger,
        onOpenDoc,
        onGoto,
        onCopyTaskBlock,
        onCompleteReminder,
        onSnoozeReminder,
        onBatchPostponeOverdue,
        onUndoPostpone,
        canUndoPostpone = false,
    }: {
        reminders: Reminder[];
        top: Reminder[];
        overdueCount?: number;
        memberFilter?: string;
        pulseDateFilter?: string;
        initialScanError?: string;
        scanErrors?: any[];
        snapshotLabel: string;
        firstScanPending: boolean;
        starterModule?: string;
        retryingScan?: boolean;
        overviewBusy?: Set<string>;
        memberOf: (id: string | undefined) => { name: string; id: string } | undefined;
        plugin?: any;
        t: (k: string) => string;
        onViewAll: () => void;
        onClearMemberFilter: () => void;
        onRetryScan: () => void;
        onOpenStarterRecord: () => void;
        onOpenLedger: (moduleId: string) => void;
        onOpenDoc?: (r: Reminder) => void;
        onGoto: (s: string) => void;
        onCopyTaskBlock: (r: Reminder) => void;
        onCompleteReminder: (r: Reminder) => void;
        onSnoozeReminder: (r: Reminder, days: number) => void;
        onBatchPostponeOverdue?: () => void;
        onUndoPostpone?: () => void;
        canUndoPostpone?: boolean;
    } = $props();

    let showCompletedDetails = $state(false);

    const completedOnPulseDate = $derived.by(() => {
        if (!pulseDateFilter || !plugin?.listHandled) return [];
        const targetDate = pulseDateFilter;
        return (plugin.listHandled() ?? []).filter((h: any) => {
            if (!h.at) return false;
            const datePrefix = h.at.slice(0, 10);
            return datePrefix === targetDate;
        });
    });
</script>

<div class="lv-sec">
    <h2 class="lv-title-sec">{t("dash.upcoming")}</h2>
    <span class="lv-sub">{t("dash.upcomingSub")}</span>
    {#if pulseDateFilter}
        <button type="button" class="lv-badge blue lv-filter-clear-badge" onclick={() => { pulseDateFilter = undefined; }} title={t("overview.clearDateFilter")} aria-label={t("overview.clearDateFilter")}>
            <UiIcon name="calendar" size={12} /> {pulseDateFilter} <UiIcon name="close" size={10} />
        </button>
    {/if}
    {#if overdueCount > 0 && onBatchPostponeOverdue}
        <button type="button" class="b3-button b3-button--outline lv-overdue-postpone-btn" disabled={overviewBusy.has("batch-postpone")} aria-busy={overviewBusy.has("batch-postpone")} onclick={onBatchPostponeOverdue} title={t("dash.postponeOverdueToToday").replace("${n}", String(overdueCount))}>
            <UiIcon name="calendar" size={12} /> {t("dash.postponeOverdueToToday").replace("${n}", String(overdueCount))}
        </button>
    {/if}
    {#if canUndoPostpone && onUndoPostpone}
        <button type="button" class="b3-button b3-button--text lv-tx-accent lv-undo-btn" disabled={overviewBusy.has("batch-postpone")} aria-busy={overviewBusy.has("batch-postpone")} onclick={onUndoPostpone} title={t("dash.undoPostpone")}>
            <UiIcon name="back" size={12} /> {t("dash.undoPostpone")}
        </button>
    {/if}
    <button type="button" class="b3-button b3-button--text" onclick={onViewAll}><span>{t("dash.viewAll")}</span> <UiIcon name="forward" size={12} /></button>
</div>
{#if reminders.length === 0 && (initialScanError || scanErrors.length > 0)}
    <div class="lv-card"><div class="lv-empty" role="alert">
        <div class="eic"><UiIcon name="alert" size={22} /></div><b>{t("dash.scanUnavailable")}</b>
        <span>{initialScanError || t("dash.focusDataErr").replace("${t}", snapshotLabel).replace("${n}", String(scanErrors.length))}</span>
        <button type="button" class="b3-button b3-button--outline" disabled={retryingScan} aria-busy={retryingScan} onclick={onRetryScan}>
            {retryingScan ? t("ledger.saving") : t("hub.rescan")}
        </button>
    </div></div>
{:else if reminders.length === 0 && memberFilter}
    <!-- 174 波（对齐原型空态解释）：筛选导致的空 ≠ 无资料，说明并给清除出口 -->
    <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="search" size={22} /></div><b>{t("dash.filteredEmpty")}</b><span>{t("dash.filteredEmptyHint")}</span>
        <button type="button" class="b3-button b3-button--outline" onclick={onClearMemberFilter}>{t("dash.clearFilter")}</button>
    </div></div>
{:else if reminders.length === 0}
    {#if firstScanPending}
        <!-- 260 波：首扫骨架（未知 ≠ 全部完成） -->
        <div class="lv-card lv-rems" aria-busy="true" role="status">
            {#each [0, 1, 2] as i (i)}
                <div class="lv-rem">
                    <div class="lv-skel lv-skel--icon"></div>
                    <div class="lv-skel-col">
                        <div class="lv-skel lv-skel--w42"></div>
                        <div class="lv-skel lv-skel--w26"></div>
                    </div>
                </div>
            {/each}
        </div>
        <p class="lv-caption lv-scan-hint">{t("hub.firstScan")}</p>
    {:else if pulseDateFilter}
        {#if completedOnPulseDate.length > 0}
            <div class="lv-card lv-pulse-completed-card">
                <div class="lv-pulse-completed-head">
                    <span class="lv-pulse-completed-title">
                        <UiIcon name="checkCircle" size={15} />
                        <b>{t("overview.completedOnDate").replace("${date}", pulseDateFilter).replace("${n}", String(completedOnPulseDate.length))}</b>
                    </span>
                    <button type="button" class="b3-button b3-button--text b3-button--small" onclick={() => onGoto("reminders")}>
                        <span>{t("overview.viewHandledHistory")}</span> <UiIcon name="forward" size={12} />
                    </button>
                </div>
                <div class="lv-pulse-completed-list">
                    {#each completedOnPulseDate as item (item.id)}
                        <div class="lv-pulse-completed-item">
                            <span class="lv-pulse-completed-dot"></span>
                            <span class="lv-pulse-completed-item-title">{item.title}</span>
                            <span class="lv-badge gray lv-badge--xs">{t(`module.${item.moduleId}`) !== `module.${item.moduleId}` ? t(`module.${item.moduleId}`) : item.moduleId}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {:else}
            <div class="lv-card lv-empty-compact" role="status">
                <div class="eic-sm"><UiIcon name="check" size={18} /></div>
                <div class="lv-empty-compact__text">
                    <b>{t("dash.allClear")}</b>
                    <span>{t("overview.noTasksOnDate").replace("${date}", pulseDateFilter)}</span>
                </div>
                <button type="button" class="b3-button b3-button--text b3-button--small" onclick={() => onGoto("reminders")}>
                    <span>{t("overview.viewAllHandled")}</span> <UiIcon name="forward" size={12} />
                </button>
            </div>
        {/if}
    {:else}
        <div class="lv-card lv-empty-compact" role="status">
            <div class="eic-sm"><UiIcon name="check" size={18} /></div>
            <div class="lv-empty-compact__text">
                <b>{t("dash.allClear")}</b>
                <span>{t("hub.emptyHint")}</span>
            </div>
            {#if starterModule}
                <button type="button" class="b3-button b3-button--outline" onclick={onOpenStarterRecord}>
                    <UiIcon name="add" size={13} /> {t("ledger.newRecord")}
                </button>
            {/if}
        </div>
    {/if}
{:else}
    <div class="lv-card lv-rems">
        {#each top as r (r.id)}
            <div class="lv-rem {r.level}" out:fade={{ duration: 150 }}>
                <div class="lv-rem-ic" aria-hidden="true"><UiIcon name={moduleUiIcon(r.moduleId)} size={18} /></div>
                <div class="lv-rem-t" role="button" tabindex="0"
                    onclick={() => { if (r.moduleId !== 'adhoc') onOpenLedger(r.moduleId); else onGoto('reminders'); }}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (r.moduleId !== 'adhoc') onOpenLedger(r.moduleId); else onGoto('reminders'); } }}
                    title={t("dash.heroOpen")}>
                    <b>
                        <span class="lv-rem-badges">
                            {#if (r.snoozeCount ?? 0) >= 3}
                                <span class="lv-plan-badge is-snooze-heavy" title={t("hub.snoozeHeavyHint").replace("${n}", String(r.snoozeCount))}>
                                    <UiIcon name="alert" size={11} /> {t("hub.snoozeHeavyBadge")}
                                </span>
                            {/if}
                            {#if r.priority}
                                <span class="lv-plan-badge lv-priority-badge--{r.priority}" title={r.priority === "high" ? t("hub.priorityHigh") : r.priority === "medium" ? t("hub.priorityMedium") : t("hub.priorityLow")}>
                                    <UiIcon name="alert" size={11} /> {r.priority === "high" ? t("hub.priorityHigh") : r.priority === "medium" ? t("hub.priorityMedium") : t("hub.priorityLow")}
                                </span>
                            {/if}
                            {#if r.tag}
                                <span class="lv-plan-badge lv-tag-badge" title={`#${r.tag}`}>
                                    <UiIcon name="bookmark" size={11} /> #{r.tag}
                                </span>
                            {/if}
                        </span>
                        <span class="lv-rem-title-text">{r.title}</span>
                    </b><span>{#if memberOf(r.memberId)}{@const member = memberOf(r.memberId)}<span class="lv-miniava" style="background:linear-gradient(135deg, hsl({memberHue(member.id)} 62% 52%), hsl({(memberHue(member.id) + 42) % 360} 62% 40%))" aria-hidden="true">{member.name.slice(0, 1)}</span>{/if}{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : t("adhoc.name")}{#if !r.memberId} · {t("members.unassigned")}{/if}{#if r.lunar} · <span class="lv-plan-badge" title={t("members.lunar")}><UiIcon name="moon" size={10} /></span>{/if}{#if r.autoRenew} · <span class="lv-plan-badge" title={t("hub.autoRenew")}><UiIcon name="repeat" size={10} /></span>{/if}</span>
                </div>
                <div class="lv-rem-when"><b class="lv-num">
                    {r.daysLeft < 0 ? t("days.overdue").replace("${n}", String(-r.daysLeft)) : r.daysLeft === 0 ? t("days.today") : t("days.after").replace("${n}", String(r.daysLeft))}
                </b><span class="lv-num">{r.dueDate}</span></div>
                <div class="lv-rem-ops">
                    {#if onOpenDoc}
                        <button type="button" class="b3-button b3-button--text" title={t("act.locate")} aria-label={t("act.locate")} onclick={() => onOpenDoc(r)}><UiIcon name="folder" size={13} /></button>
                    {/if}
                    <button type="button" class="b3-button b3-button--text" title={t("hub.copyTaskBlock")} aria-label={t("hub.copyTaskBlock")} onclick={() => onCopyTaskBlock(r)}><UiIcon name="note" size={13} /></button>
                    <button type="button" class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => onCompleteReminder(r)}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.done")}</button>
                    <button type="button" class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => onSnoozeReminder(r, 7)}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.snooze7")}</button>
                </div>
            </div>
        {/each}
        {#if pulseDateFilter && completedOnPulseDate.length > 0}
            <div class="lv-pulse-completed-bar">
                <button type="button" class="b3-button b3-button--text lv-pulse-completed-toggle" onclick={() => { showCompletedDetails = !showCompletedDetails; }}>
                    <UiIcon name={showCompletedDetails ? "chevronUp" : "chevronDown"} size={12} />
                    <span>{t("overview.hasCompletedBadge").replace("${n}", String(completedOnPulseDate.length))}</span>
                </button>
                {#if showCompletedDetails}
                    <div class="lv-pulse-completed-list lv-mt-6">
                        {#each completedOnPulseDate as item (item.id)}
                            <div class="lv-pulse-completed-item">
                                <span class="lv-pulse-completed-dot"></span>
                                <span class="lv-pulse-completed-item-title">{item.title}</span>
                                <span class="lv-badge gray lv-badge--xs">{t(`module.${item.moduleId}`) !== `module.${item.moduleId}` ? t(`module.${item.moduleId}`) : item.moduleId}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
