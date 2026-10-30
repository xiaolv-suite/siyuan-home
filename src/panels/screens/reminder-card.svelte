<script lang="ts">
    import { fade } from "svelte/transition";
    import { showMessage } from "siyuan";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { memberHue } from "@/core/format";
    import type { Reminder } from "@/types";

    let {
        r,
        plugin,
        t,
        batchMode = false,
        viewMode = "list",
        filter = "all",
        batchBusy = false,
        selected = new Set<string>(),
        expandedReminders = new Set<string>(),
        planStatusOf,
        stageOf,
        stageLabelOf,
        isPinned,
        memberOf,
        relDue,
        ruleText,
        kindText,
        reminderBusy = new Set<string>(),
        onToggleSelect,
        onToggleExpand,
        onRunAction,
        onRenew,
        onSchedulePlan,
        onCopyTask,
        onTogglePin,
        onQuickPlanToday,
        onSnooze,
        onEditMemo,
        onDeleteMemo,
        onTriage,
    }: {
        r: Reminder;
        plugin: any;
        t: (k: string) => string;
        batchMode?: boolean;
        viewMode?: "list" | "calendar" | string;
        filter?: string;
        batchBusy?: boolean;
        selected?: Set<string>;
        expandedReminders?: Set<string>;
        planStatusOf: (r: Reminder) => any;
        stageOf: (r: Reminder) => any;
        stageLabelOf: (r: Reminder) => string;
        isPinned: (r: Reminder) => boolean;
        memberOf: (id: string | undefined) => any;
        relDue: (daysLeft: number, fallback: string) => string;
        ruleText: (ruleKey: string) => string;
        kindText: (kind?: string) => string;
        reminderBusy?: Set<string>;
        onToggleSelect?: (id: string) => void;
        onToggleExpand?: (id: string) => void;
        onRunAction?: (action: () => Promise<void>, id: string) => void;
        onRenew?: (r: Reminder) => void;
        onSchedulePlan?: (r: Reminder) => void;
        onCopyTask?: (r: Reminder) => void;
        onTogglePin?: (r: Reminder) => void;
        onQuickPlanToday?: (r: Reminder) => void;
        onSnooze?: (r: Reminder, ev: MouseEvent) => void;
        onEditMemo?: (r: Reminder) => void;
        onDeleteMemo?: (r: Reminder) => void;
        onTriage?: (r: Reminder) => void;
    } = $props();

    let moreOpen = $state(false);

    const plan = $derived(planStatusOf(r));
    const member = $derived(memberOf(r.memberId));
    const stage = $derived(stageOf(r));
    const stageLabel = $derived(stageLabelOf(r));
    const isItemPinned = $derived(isPinned(r));
    const isBusy = $derived(reminderBusy.has(r.id));
    const isExpanded = $derived(expandedReminders.has(r.id));
    const isSelected = $derived(selected.has(r.id));

    function handleMoreAction(action: () => void) {
        moreOpen = false;
        action();
    }
</script>

<svelte:window onclick={() => { if (moreOpen) moreOpen = false; }} />

<div class="lv-rem {r.level}" class:lv-rem--batch={batchMode && viewMode === "list" && filter !== "handled"} out:fade={{ duration: 150 }}>
    {#if batchMode && viewMode === "list" && filter !== "handled"}
        <input type="checkbox" class="b3-checkbox lv-batch-chk" aria-label={`${t("hub.select")}: ${r.title}`}
            checked={isSelected} disabled={batchBusy} onchange={() => onToggleSelect?.(r.id)} />
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="lv-rem-ic" aria-hidden="true"
        title={t("hub.dblClickPlanToday") !== "hub.dblClickPlanToday" ? t("hub.dblClickPlanToday") : "双击快速标记/取消今日待办，右键切换置顶"}
        ondblclick={(e) => { e.stopPropagation(); onQuickPlanToday?.(r); }}
        oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin?.(r); }}
    ><UiIcon name={moduleUiIcon(r.moduleId)} size={18} /></div>
    <div class="lv-rem-t" title={(r.autoRenew ? `${t("hub.autoRenew")} · ` : "") + r.dueDate}>
        <b>
            {#if isItemPinned}
                <span class="lv-plan-badge is-planned-now is-pinned" title={t("hub.pinned")}>
                    <UiIcon name="bookmark" size={11} /> {t("hub.pinned")}
                </span>
            {/if}
            {#if stageLabel}
                <span class="lv-plan-badge" class:is-planned-now={stage?.isUrgent} title={t("hub.stageDesc").replace("${stages}", (stage?.stages ?? []).join(" / "))}>
                    <UiIcon name="clock" size={11} /> {stageLabel}
                </span>
            {/if}
            {r.title}{r.ruleKey === "reciprocate" ? ` · ${t("rule.reciprocate")}` : ""}
            {#if plan.hasPlan}
                <button type="button" class="lv-plan-badge lv-plan-badge-btn" class:is-planned-now={plan.isPlannedNow}
                    title={`${t("hub.planDateLabel")}: ${plan.planDate} (${t("hub.editPlanDate")})`}
                    aria-label={`${t("hub.planDateLabel")}: ${plan.planDate} (${t("hub.editPlanDate")})`}
                    onclick={(e) => { e.stopPropagation(); onSchedulePlan?.(r); }}>
                    <UiIcon name="calendar" size={11} /> {plan.planDate}{#if plan.isPlannedNow} · <UiIcon name="check" size={11} /> {t("hub.planActive")}{/if}
                </button>
            {:else}
                <button type="button" class="lv-plan-tag-add"
                    title={t("hub.setPlanDate")}
                    aria-label={t("hub.setPlanDate")}
                    onclick={(e) => { e.stopPropagation(); onSchedulePlan?.(r); }}>
                    <UiIcon name="calendar" size={12} />
                </button>
            {/if}
            <button class="lv-rem-expand-btn" type="button"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? t("hub.collapseSummary") : t("hub.expandSummary")}
                title={isExpanded ? t("hub.collapseSummary") : t("hub.expandSummary")}
                onclick={() => onToggleExpand?.(r.id)}>
                <UiIcon name={isExpanded ? "chevronUp" : "chevronDown"} size={12} />
            </button>
        </b>
        <span class="lv-num">
            {#if member}
                <span class="lv-miniava" style="background:linear-gradient(135deg, hsl({memberHue(member.id)} 62% 52%), hsl({(memberHue(member.id) + 42) % 360} 62% 40%))" aria-hidden="true">{member.name.slice(0, 1)}</span>
            {/if}
            {r.moduleId !== "adhoc" ? (t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId) + " · " : ""}{r.dueDate}{#if !r.memberId} · {t("members.unassigned")}{/if}{#if r.lunar} · <span class="lv-plan-badge" title={t("members.lunar")}><UiIcon name="moon" size={10} /></span>{/if}{#if r.autoRenew} · <span class="lv-plan-badge" title={t("hub.autoRenew")}><UiIcon name="repeat" size={10} /></span>{/if}
        </span>
    </div>
    <div class="lv-rem-when">
        <b class="lv-num">{relDue(r.daysLeft, r.dueDate)}</b>
    </div>
    <div class="lv-rem-ops">
        <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={() => {
            onRunAction?.(async () => {
                await plugin.complete(r);
                showMessage(t("hub.batchDone").replace("${n}", "1"), 2500, "info");
            }, r.id);
        }}>{isBusy ? t("ledger.saving") : t("act.done")}</button>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lv-rem-more" onclick={(e) => e.stopPropagation()}>
            <button class="b3-button b3-button--text lv-rem-more-toggle" type="button" aria-expanded={moreOpen} aria-haspopup="true" aria-controls={`lv-rem-more-${r.id}`}
                onclick={() => { moreOpen = !moreOpen; }}>{t("ledger.detailMore")} <UiIcon name={moreOpen ? "chevronUp" : "chevronDown"} size={11} /></button>
            <div id={`lv-rem-more-${r.id}`} class="lv-rem-more-menu" role="group" aria-label={t("ledger.detailMore")} data-open={moreOpen ? "true" : "false"}>
                {#if ["certs", "insurance", "contracts"].includes(r.moduleId)}
                    <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onRenew?.(r))}>{t("act.renew")}</button>
                {/if}
                {#if r.moduleId !== "adhoc" && plugin.settings.dbRefs[r.moduleId]?.docId}
                    <button class="b3-button b3-button--text" disabled={batchBusy} title={t("act.locate")} onclick={() => handleMoreAction(() => plugin.showTabDocs(plugin.settings.dbRefs[r.moduleId]?.docId, r.rowId))}>{t("act.locate")}</button>
                {/if}
                <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onSchedulePlan?.(r))}>{plan.hasPlan ? t("hub.editPlanDate") : t("hub.setPlanDate")}</button>
                <button class="b3-button b3-button--text" disabled={batchBusy} onclick={() => handleMoreAction(() => onCopyTask?.(r))}>{t("hub.copyTaskBlock")}</button>
                <button class="b3-button b3-button--text" title={isItemPinned ? t("act.unpin") : t("act.pin")}
                    disabled={batchBusy || isBusy} aria-busy={isBusy}
                    onclick={() => handleMoreAction(() => onTogglePin?.(r))}>{isBusy ? t("ledger.saving") : (isItemPinned ? t("act.unpin") : t("act.pin"))}</button>
                <button class="b3-button b3-button--text" aria-haspopup="menu" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={(e) => handleMoreAction(() => onSnooze?.(r, e))}>{isBusy ? t("ledger.saving") : t("act.snooze")} <UiIcon name="chevronDown" size={11} /></button>
                <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={() => handleMoreAction(() => onRunAction?.(() => plugin.mute(r.id), r.id))}>{isBusy ? t("ledger.saving") : t("act.mute")}</button>
                {#if r.moduleId === "adhoc"}
                    <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onEditMemo?.(r))}>{t("memo.edit")}</button>
                    <button class="b3-button b3-button--text ft__error lv-tx-danger" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onDeleteMemo?.(r))}>{t("delete")}</button>
                    <button class="b3-button b3-button--text" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onTriage?.(r))}>{t("triage.title")}</button>
                {/if}
            </div>
        </div>
    </div>
    {#if isExpanded}
        <div class="lv-rem-summary" role="region" aria-label={t("hub.summary")}>
            <div class="lv-rem-summary__item">
                <span class="label">{t("hub.summaryRule")}:</span>
                <span>{r.moduleId !== "adhoc" ? (t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId) + " · " : ""}{ruleText(r.ruleKey)}{r.kind ? `（${kindText(r.kind)}）` : ""}{#if r.lunar} · <span class="lv-plan-badge" title={t("members.lunar")}><UiIcon name="moon" size={10} /></span>{/if}{#if r.autoRenew} · <span class="lv-plan-badge" title={t("hub.autoRenew")}><UiIcon name="repeat" size={10} /></span>{/if}</span>
            </div>
            <div class="lv-rem-summary__item">
                <span class="label">{t("hub.summaryMember")}:</span>
                <span>{#if member}{member.name}{member.role ? `（${member.role}）` : ""}{:else}{t("members.unassigned")}{/if}</span>
            </div>
            <div class="lv-rem-summary__item">
                <span class="label">{t("hub.summaryDue")}:</span>
                <span>{r.dueDate} · {relDue(r.daysLeft, r.dueDate)}</span>
            </div>
            {#if plan.hasPlan}
                <div class="lv-rem-summary__item">
                    <span class="label">{t("hub.planDateLabel")}:</span>
                    <span>{plan.planDate}{#if plan.isPlannedNow}（<UiIcon name="check" size={11} /> {t("hub.planActive")}）{/if}</span>
                </div>
            {/if}
            {#if r.moduleId !== "adhoc" && plugin.settings.dbRefs[r.moduleId]?.docId}
                <div class="lv-rem-summary__item">
                    <button class="b3-button b3-button--text lv-tx-accent lv-btn-text-sm"
                        onclick={() => plugin.showTabDocs(plugin.settings.dbRefs[r.moduleId]?.docId, r.rowId)}>
                        <span>{t("act.locate")}</span> <UiIcon name="forward" size={11} />
                    </button>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .lv-batch-chk {
        flex-shrink: 0;
    }
</style>
