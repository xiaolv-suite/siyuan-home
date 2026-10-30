<script lang="ts">
    import type { Reminder } from "@/types";
    import { fade } from "svelte/transition";
    import { memberHue } from "@/core/format";
    import { moduleUiIcon } from "@/ui/icons";
    import UiIcon from "@/ui/icon.svelte";

    let {
        reminders,
        top,
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
        t,
        onViewAll,
        onClearMemberFilter,
        onRetryScan,
        onOpenStarterRecord,
        onOpenLedger,
        onGoto,
        onCopyTaskBlock,
        onCompleteReminder,
        onSnoozeReminder,
    }: {
        reminders: Reminder[];
        top: Reminder[];
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
        t: (k: string) => string;
        onViewAll: () => void;
        onClearMemberFilter: () => void;
        onRetryScan: () => void;
        onOpenStarterRecord: () => void;
        onOpenLedger: (moduleId: string) => void;
        onGoto: (s: string) => void;
        onCopyTaskBlock: (r: Reminder) => void;
        onCompleteReminder: (r: Reminder) => void;
        onSnoozeReminder: (r: Reminder, days: number) => void;
    } = $props();
</script>

<div class="lv-sec">
    <h2 class="lv-title-sec">{t("dash.upcoming")}</h2>
    <span class="lv-sub">{t("dash.upcomingSub")}</span>
    {#if pulseDateFilter}
        <button type="button" class="lv-badge blue" style="cursor:pointer;border:none;margin-left:8px" onclick={() => { pulseDateFilter = undefined; }} title="清除日期聚焦">
            🗓️ {pulseDateFilter} ✕
        </button>
    {/if}
    <button class="b3-button b3-button--text" onclick={onViewAll}>{t("dash.viewAll")} →</button>
</div>
{#if reminders.length === 0 && (initialScanError || scanErrors.length > 0)}
    <div class="lv-card"><div class="lv-empty" role="alert">
        <div class="eic"><UiIcon name="alert" size={22} /></div><b>{t("dash.scanUnavailable")}</b>
        <span>{initialScanError || t("dash.focusDataErr").replace("${t}", snapshotLabel).replace("${n}", String(scanErrors.length))}</span>
        <button class="b3-button b3-button--outline" disabled={retryingScan} aria-busy={retryingScan} onclick={onRetryScan}>
            {retryingScan ? t("ledger.saving") : t("hub.rescan")}
        </button>
    </div></div>
{:else if reminders.length === 0 && memberFilter}
    <!-- 174 波（对齐原型空态解释）：筛选导致的空 ≠ 无资料，说明并给清除出口 -->
    <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="search" size={22} /></div><b>{t("dash.filteredEmpty")}</b><span>{t("dash.filteredEmptyHint")}</span>
        <button class="b3-button b3-button--outline" onclick={onClearMemberFilter}>{t("dash.clearFilter")}</button>
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
                <button class="b3-button b3-button--outline" onclick={onOpenStarterRecord}>
                    ＋ {t("ledger.newRecord")}
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
                    <b>{r.title}</b><span>{#if memberOf(r.memberId)}{@const member = memberOf(r.memberId)}<span class="lv-miniava" style="background:linear-gradient(135deg, hsl({memberHue(member.id)} 62% 52%), hsl({(memberHue(member.id) + 42) % 360} 62% 40%))" aria-hidden="true">{member.name.slice(0, 1)}</span>{/if}{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : t("adhoc.name")}{#if !r.memberId} · {t("members.unassigned")}{/if}{r.lunar ? " 🌙" : ""}{r.autoRenew ? " 🔄" : ""}</span>
                </div>
                <div class="lv-rem-when"><b class="lv-num">
                    {r.daysLeft < 0 ? t("days.overdue").replace("${n}", String(-r.daysLeft)) : r.daysLeft === 0 ? t("days.today") : t("days.after").replace("${n}", String(r.daysLeft))}
                </b><span class="lv-num">{r.dueDate}</span></div>
                <div class="lv-rem-ops">
                    <button class="b3-button b3-button--text" title={t("hub.copyTaskBlock")} onclick={() => onCopyTaskBlock(r)}>📋</button>
                    <button class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => onCompleteReminder(r)}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.done")}</button>
                    <button class="b3-button b3-button--text" disabled={overviewBusy.has(r.id)} aria-busy={overviewBusy.has(r.id)} onclick={() => onSnoozeReminder(r, 7)}>{overviewBusy.has(r.id) ? t("ledger.saving") : t("act.snooze7")}</button>
                </div>
            </div>
        {/each}
    </div>
{/if}
