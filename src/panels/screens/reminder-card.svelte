<script lang="ts">
    import { fade } from "svelte/transition";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { lvLaunchpad } from "@/libs/lv-notice-kit";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { memberHue } from "@/core/format";
    import { isStaleTask } from "@/core/micro-decomposition";
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
    let moreToggleBtn = $state<HTMLButtonElement | undefined>(undefined);
    let moreMenuEl = $state<HTMLElement | undefined>(undefined);

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

    async function openReminderDoc() {
        const { openModuleOrJournalDoc } = await import("@/core/doc-sync");
        await openModuleOrJournalDoc(plugin, r.moduleId, r.moduleId === "adhoc" ? undefined : r.rowId);
    }

    const hasTargetDoc = $derived(r.moduleId === "adhoc" || !!plugin.settings?.dbRefs?.[r.moduleId]?.docId);
    const isStale = $derived(isStaleTask(r));

    async function openDecompositionModal() {
        swipeOffset = 0;
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        const { openMicroDecompositionDialog } = await import("@/core/micro-decomposition-dialog");
        openMicroDecompositionDialog({
            plugin,
            reminder: r,
            t,
            showMessageFn: showMessage,
        });
    }

    // 移动端/逾期项左滑手势（Mobile Spec v1: 顺延 1 天 / 顺延 1 周 / 明天再说）
    const isOverdue = $derived(r.level === "overdue" || (typeof r.daysLeft === "number" && r.daysLeft <= 0));
    let swipeOffset = $state(0);
    let isSwiping = $state(false);
    let swipeStartX = 0;
    let swipeStartY = 0;
    let isHorizontalSwipe = false;

    function handleTouchStart(e: TouchEvent) {
        if (!isOverdue) return;
        // 快速连滑防抖锁：该条正在执行顺延（isBusy）时冻结手势，防止动画重叠与重复写入
        if (isBusy) return;
        const touch = e.touches[0];
        if (!touch) return;
        swipeStartX = touch.clientX;
        swipeStartY = touch.clientY;
        isHorizontalSwipe = false;
        isSwiping = false;
    }

    function handleTouchMove(e: TouchEvent) {
        if (!isOverdue) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - swipeStartX;
        const dy = touch.clientY - swipeStartY;

        if (!isHorizontalSwipe && !isSwiping) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                isHorizontalSwipe = true;
                isSwiping = true;
            } else if (Math.abs(dy) > 10) {
                return;
            }
        }

        if (isHorizontalSwipe) {
            if (dx < 0) {
                swipeOffset = Math.max(-210, dx);
            } else if (swipeOffset < 0) {
                swipeOffset = Math.min(0, swipeOffset + dx);
            }
        }
    }

    function handleTouchEnd() {
        if (!isOverdue || !isHorizontalSwipe) return;
        isSwiping = false;
        if (swipeOffset < -60) {
            swipeOffset = -190;
            try {
                lvLaunchpad.haptic(10);
            } catch {
                /* soft */
            }
        } else {
            swipeOffset = 0;
        }
    }

    async function quickSnooze(days: number, label: string) {
        if (isBusy) return;
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        const { localDateKey, addDays } = await import("@/core/hub/rule");
        const targetDate = localDateKey(addDays(new Date(), days));
        swipeOffset = 0;
        onRunAction?.(async () => {
            await plugin.batchSnooze?.([r.id], targetDate);
            showMessage(t("dash.overduePostponed").replace("${n}", "1") + ` (${label})`, 2500, "info");
        }, r.id);
    }

    function handleToggleKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            if (!moreOpen && e.key === "ArrowDown") {
                e.preventDefault();
                moreOpen = true;
                setTimeout(() => {
                    const firstBtn = moreMenuEl?.querySelector<HTMLButtonElement>("button:not([disabled])");
                    firstBtn?.focus();
                }, 0);
            }
        }
    }

    function handleMenuKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            moreOpen = false;
            moreToggleBtn?.focus();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const target = e.target as HTMLElement;
        if (!moreMenuEl) return;
        const buttons = Array.from(moreMenuEl.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
        const idx = buttons.indexOf(target as HTMLButtonElement);
        if (idx === -1) return;

        e.preventDefault();
        if (e.key === "ArrowDown") {
            buttons[(idx + 1) % buttons.length]?.focus();
        } else if (e.key === "ArrowUp") {
            buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
        } else if (e.key === "Home") {
            buttons[0]?.focus();
        } else if (e.key === "End") {
            buttons[buttons.length - 1]?.focus();
        }
    }
</script>

<svelte:window onclick={() => { if (moreOpen) moreOpen = false; }} />

<div class="lv-rem-swipe-container" class:has-swipe={isOverdue}>
    {#if isOverdue}
        <div class="lv-rem-swipe-actions" class:is-revealed={swipeOffset < 0} aria-label="快捷顺延操作" aria-hidden={swipeOffset === 0 ? "true" : undefined}>
            {#if isStale}
                <button type="button" class="lv-swipe-chip stale" disabled={isBusy} onclick={() => void openDecompositionModal()}>🧩 拆解</button>
            {/if}
            <button type="button" class="lv-swipe-chip day1" disabled={isBusy} onclick={() => quickSnooze(1, "顺延1天")}>顺延 1 天</button>
            <button type="button" class="lv-swipe-chip week1" disabled={isBusy} onclick={() => quickSnooze(7, "顺延1周")}>顺延 1 周</button>
            <button type="button" class="lv-swipe-chip tmrw" disabled={isBusy} onclick={() => quickSnooze(1, "明天再说")}>明天再说</button>
        </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="lv-rem {r.level}"
        class:lv-rem--batch={batchMode && viewMode === "list" && filter !== "handled"}
        class:is-swiping={isSwiping}
        style={isOverdue && swipeOffset !== 0 ? `transform: translateX(${swipeOffset}px); transition: ${isSwiping ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)'};` : undefined}
        ontouchstart={handleTouchStart}
        ontouchmove={handleTouchMove}
        ontouchend={handleTouchEnd}
        ontouchcancel={handleTouchEnd}
        out:fade={{ duration: 150 }}
    >
    {#if batchMode && viewMode === "list" && filter !== "handled"}
        <input type="checkbox" class="b3-checkbox lv-batch-chk" aria-label={`${t("hub.select")}: ${r.title}`}
            checked={isSelected} disabled={batchBusy} onchange={() => onToggleSelect?.(r.id)} />
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="lv-rem-ic" aria-hidden="true"
        title={t("hub.dblClickPlanToday")}
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
            {#if (r.snoozeCount ?? 0) >= 3}
                <span class="lv-plan-badge is-snooze-heavy" title={t("hub.snoozeHeavyHint").replace("${n}", String(r.snoozeCount))}>
                    <UiIcon name="alert" size={11} /> {t("hub.snoozeHeavyBadge")}
                </span>
            {/if}
            {#if r.recurrenceAnchor}
                <span class="lv-plan-badge lv-recurrence-badge" title={r.recurrenceAnchor === "completion" ? t("hub.recurrenceAnchorCompletion") : t("hub.recurrenceAnchorDue")}>
                    <UiIcon name="repeat" size={11} /> {r.recurrenceAnchor === "completion" ? t("hub.recurrenceAnchorCompletion") : t("hub.recurrenceAnchorDue")}
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
            {r.title}{r.ruleKey === "reciprocate" ? ` · ${t("rule.reciprocate")}` : ""}
            {#if isStale}
                <button
                    type="button"
                    class="lv-plan-badge lv-stale-decompose-badge"
                    title={t("stale.badgeTooltip")}
                    aria-label={t("stale.badgeTooltip")}
                    onclick={(e) => { e.stopPropagation(); void openDecompositionModal(); }}
                >
                    🧩 {t("stale.badgeLabel")}
                </button>
            {/if}
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
        {#if hasTargetDoc}
            <button type="button" class="b3-button b3-button--text" disabled={batchBusy} title={t("act.locate")} aria-label={t("act.locate")} onclick={() => void openReminderDoc()}>
                <UiIcon name="folder" size={13} />
            </button>
        {/if}
        <button type="button" class="b3-button b3-button--text" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={() => {
            onRunAction?.(async () => {
                await plugin.complete(r);
                try {
                    lvLaunchpad.haptic(10);
                } catch {
                    /* soft */
                }
                showMessage(t("hub.batchDone").replace("${n}", "1"), 2500, "info");
            }, r.id);
        }}>{isBusy ? t("ledger.saving") : t("act.done")}</button>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lv-rem-more" onclick={(e) => e.stopPropagation()}>
            <button bind:this={moreToggleBtn} class="b3-button b3-button--text lv-rem-more-toggle" type="button" aria-expanded={moreOpen} aria-haspopup="true" aria-controls={`lv-rem-more-${r.id}`}
                onkeydown={handleToggleKeydown}
                onclick={() => { moreOpen = !moreOpen; }}>{t("ledger.detailMore")} <UiIcon name={moreOpen ? "chevronUp" : "chevronDown"} size={11} /></button>
            <div bind:this={moreMenuEl} id={`lv-rem-more-${r.id}`} class="lv-rem-more-menu" role="menu" tabindex="-1" aria-label={t("ledger.detailMore")} data-open={moreOpen ? "true" : "false"} onkeydown={handleMenuKeydown}>
                {#if ["certs", "insurance", "contracts"].includes(r.moduleId)}
                    <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onRenew?.(r))}>{t("act.renew")}</button>
                {/if}
                {#if hasTargetDoc}
                    <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy} title={t("act.locate")} onclick={() => handleMoreAction(() => void openReminderDoc())}>{t("act.locate")}</button>
                {/if}
                <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onSchedulePlan?.(r))}>{plan.hasPlan ? t("hub.editPlanDate") : t("hub.setPlanDate")}</button>
                <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy} onclick={() => handleMoreAction(() => onCopyTask?.(r))}>{t("hub.copyTaskBlock")}</button>
                <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy} onclick={(e) => handleMoreAction(async () => {
                    const { copyReminderFamilyNotice } = await import("@/core/reminders-view-model");
                    await copyReminderFamilyNotice(r, t, showMessage, { memberName: member?.name, targetEl: e.currentTarget as HTMLElement });
                })}>{t("hub.copyFamilyNotice")}</button>
                <button type="button" class="b3-button b3-button--text" role="menuitem" title={isItemPinned ? t("act.unpin") : t("act.pin")}
                    disabled={batchBusy || isBusy} aria-busy={isBusy}
                    onclick={() => handleMoreAction(() => onTogglePin?.(r))}>{isBusy ? t("ledger.saving") : (isItemPinned ? t("act.unpin") : t("act.pin"))}</button>
                <button type="button" class="b3-button b3-button--text" role="menuitem" aria-haspopup="menu" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={(e) => handleMoreAction(() => onSnooze?.(r, e))}>{isBusy ? t("ledger.saving") : t("act.snooze")} <UiIcon name="chevronDown" size={11} /></button>
                <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy || isBusy} aria-busy={isBusy} onclick={() => handleMoreAction(() => onRunAction?.(() => plugin.mute(r.id), r.id))}>{isBusy ? t("ledger.saving") : t("act.mute")}</button>
                {#if r.moduleId === "adhoc"}
                    <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onEditMemo?.(r))}>{t("memo.edit")}</button>
                    <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger" role="menuitem" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onDeleteMemo?.(r))}>{t("delete")}</button>
                    <button type="button" class="b3-button b3-button--text" role="menuitem" disabled={batchBusy || isBusy} onclick={() => handleMoreAction(() => onTriage?.(r))}>{t("triage.title")}</button>
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
            {#if r.recurrenceAnchor}
                <div class="lv-rem-summary__item">
                    <span class="label">{t("hub.kindRecurring")}:</span>
                    <span>{r.recurrenceAnchor === "completion" ? t("hub.recurrenceAnchorCompletion") : t("hub.recurrenceAnchorDue")}</span>
                </div>
            {/if}
            {#if (r.snoozeCount ?? 0) >= 3}
                <div class="lv-rem-summary__item">
                    <span class="label">{t("hub.snoozeHeavyBadge")}:</span>
                    <span class="lv-tx-warn" style="display: inline-flex; align-items: center; gap: 8px;">
                        {t("hub.snoozeHeavyHint").replace("${n}", String(r.snoozeCount))}
                        {#if isStale}
                            <button type="button" class="b3-button b3-button--outline lv-btn-text-sm" onclick={() => void openDecompositionModal()}>
                                🧩 {t("stale.badgeLabel") || "待拆解"}
                            </button>
                        {/if}
                    </span>
                </div>
            {/if}
            {#if hasTargetDoc}
                <div class="lv-rem-summary__item">
                    <button type="button" class="b3-button b3-button--text lv-tx-accent lv-btn-text-sm"
                        onclick={() => void openReminderDoc()}>
                        <span>{t("act.locate")}</span> <UiIcon name="forward" size={11} />
                    </button>
                </div>
            {/if}
        </div>
    {/if}
</div>
</div>
