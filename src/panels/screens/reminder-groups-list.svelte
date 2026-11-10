<script lang="ts">
    import type { Reminder, ReminderKind } from "@/types";
    import type { ReminderPlanStatus } from "@/core/hub/runtime";
    import { buildDisplay as display } from "@/core/hub/display";
    import { relativeDue, weekdayKey } from "@/core/hub/rule";
    import ReminderCard from "./reminder-card.svelte";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        t,
        filtered = [],
        displayGroups = [],
        firstScanPending = false,
        rescanning = false,
        filter = "all",
        filterMember,
        filterModule,
        dueWithin = "all",
        batchMode = false,
        viewMode = "list",
        batchBusy = false,
        selected = new Set(),
        expandedReminders = new Set(),
        reminderBusy = new Set(),
        planStatusOf,
        stageOf,
        stageLabelOf,
        isPinned,
        memberOf,
        ruleText,
        kindText,
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
        onRescan,
        onClearFilters,
    }: {
        plugin: any;
        t: (k: string) => string;
        filtered: Reminder[];
        displayGroups: { key: string; label: string; items: Reminder[] }[];
        firstScanPending?: boolean;
        rescanning?: boolean;
        filter?: string;
        filterMember?: string;
        filterModule?: string;
        dueWithin?: string;
        batchMode?: boolean;
        viewMode?: "list" | "calendar";
        batchBusy?: boolean;
        selected?: Set<string>;
        expandedReminders?: Set<string>;
        reminderBusy?: Set<string>;
        planStatusOf: (r: Reminder) => ReminderPlanStatus;
        stageOf: (r: Reminder) => { label: string; isUrgent: boolean; stages: number[] } | null;
        stageLabelOf: (r: Reminder) => string;
        isPinned: (r: Reminder) => boolean;
        memberOf: (id: string | undefined) => { name: string; id: string } | undefined;
        ruleText: (ruleKey: string) => string;
        kindText: (kind?: ReminderKind) => string;
        onToggleSelect: (id: string) => void;
        onToggleExpand: (id: string) => void;
        onRunAction: (action: () => Promise<void>, key?: string) => Promise<void>;
        onRenew: (r: Reminder) => void;
        onSchedulePlan: (r: Reminder) => void;
        onCopyTask: (r: Reminder) => void;
        onTogglePin: (r: Reminder) => void;
        onQuickPlanToday: (r: Reminder) => void;
        onSnooze: (r: Reminder, ev: MouseEvent) => void;
        onEditMemo: (r: Reminder) => void;
        onDeleteMemo: (r: Reminder) => void;
        onTriage: (r: Reminder) => void;
        onRescan: () => void;
        onClearFilters: () => void;
    } = $props();

    const REMINDER_PAGE_SIZE = 120;
    let renderLimit = $state(REMINDER_PAGE_SIZE);

    $effect(() => {
        void filter;
        void filterMember;
        void filterModule;
        void dueWithin;
        renderLimit = REMINDER_PAGE_SIZE;
    });

    const renderedGroups = $derived.by(() => {
        let remaining = renderLimit;
        return displayGroups
            .map((group) => {
                const items = remaining > 0 ? group.items.slice(0, remaining) : [];
                remaining -= items.length;
                return { ...group, items, total: group.items.length };
            })
            .filter((group) => group.items.length > 0);
    });

    let expandedMerges = $state<Set<string>>(new Set());
    function toggleMerge(key: string) {
        const next = new Set(expandedMerges);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        expandedMerges = next;
    }

    function memberName(id: string): string {
        return (plugin.settings?.members ?? []).find((m: any) => m.id === id)?.name ?? t("members.unassigned");
    }

    function relDue(daysLeft: number, fallback: string): string {
        const rel = relativeDue(daysLeft);
        if (!rel) {
            if (daysLeft >= 7 && daysLeft <= 30) return t("days.after").replace("${n}", String(Math.floor(daysLeft)));
            return fallback;
        }
        const base = rel.n === undefined ? t(rel.key) : t(rel.key).replace("${n}", String(rel.n));
        if (rel.key === "days.after" && daysLeft <= 6) {
            const wk = weekdayKey(fallback);
            if (wk) return `${base} · ${t(wk)}`;
        }
        return base;
    }
</script>

{#snippet remRow(r: Reminder)}
    <ReminderCard
        {r}
        {plugin}
        {t}
        {batchMode}
        {viewMode}
        {filter}
        {batchBusy}
        {selected}
        {expandedReminders}
        {planStatusOf}
        {stageOf}
        {stageLabelOf}
        {isPinned}
        {memberOf}
        {relDue}
        {ruleText}
        {kindText}
        {reminderBusy}
        {onToggleSelect}
        {onToggleExpand}
        {onRunAction}
        {onRenew}
        {onSchedulePlan}
        {onCopyTask}
        {onTogglePin}
        {onQuickPlanToday}
        {onSnooze}
        {onEditMemo}
        {onDeleteMemo}
        {onTriage}
    />
{/snippet}

{#if filtered.length === 0}
    {#if firstScanPending}
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
    {:else if plugin.scan?.errors?.length}
        <div class="lv-card"><div class="lv-empty" role="alert"><div class="eic"><UiIcon name="alert" size={22} /></div><b>{t("hub.partialScanTitle")}</b><span>{t("hub.partialScanBody").replace("${n}", String(plugin.scan.errors.length))}</span>
            <button type="button" class="b3-button b3-button--outline lv-mt-8" disabled={rescanning} onclick={onRescan}>{rescanning ? t("diag.rebuilding") : t("hub.rescan")}</button>
        </div></div>
    {:else if filter !== "all" || filterMember || filterModule || dueWithin !== "all"}
        <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="search" size={22} /></div><b>{t("hub.filteredEmpty")}</b><span>{t("hub.filteredEmptyHint")}</span>
            <button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={onClearFilters}>{t("hub.clearFilters")}</button>
        </div></div>
    {:else}
        <div class="lv-card"><div class="lv-empty"><div class="eic"><UiIcon name="checkCircle" size={22} /></div><b>{t("dash.allClear")}</b><span>{t("hub.emptyHint")}</span></div></div>
    {/if}
{:else}
    {#each renderedGroups as g (g.key)}
        {#if g.label}<div class="lv-group-label">{g.label} · {g.total}</div>{/if}
        <div class="lv-card lv-rems">
            {#each display(g.items) as entry (entry.key)}
                {#if entry.merged}
                    <div class="lv-rem lead" role="button" tabindex="0"
                        aria-expanded={expandedMerges.has(entry.key)}
                        onkeydown={(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleMerge(entry.key))}
                        onclick={() => toggleMerge(entry.key)}>
                        <div class="lv-rem-ic" aria-hidden="true"><UiIcon name="users" size={18} /></div>
                        <div class="lv-rem-t" title={`${memberName(entry.memberId)} · ${entry.dueDate}`}><b>{memberName(entry.memberId)} · {relDue(entry.row.daysLeft, entry.dueDate)}</b><span class="lv-caption">{t("hub.mergeHint")}</span></div>
                        <span class="lv-badge orange">{entry.items.length}</span>
                        <div class="lv-rem-ops"><span class="lv-caption" aria-hidden="true"><UiIcon name={expandedMerges.has(entry.key) ? "chevronDown" : "forward"} size={13} /></span></div>
                    </div>
                    {#if expandedMerges.has(entry.key)}
                        {#each entry.items as sub (sub.id)}
                            {@render remRow(sub)}
                        {/each}
                    {/if}
                {:else}
                    {@render remRow(entry.row)}
                {/if}
            {/each}
        </div>
    {/each}
    {#if filtered.length > renderLimit}
        <div class="lv-card lv-card-center-pad">
            <button type="button" class="b3-button b3-button--outline" onclick={() => (renderLimit += REMINDER_PAGE_SIZE)}>
                {t("ledger.loadMore").replace("${n}", String(filtered.length - renderLimit))}
            </button>
        </div>
    {/if}
{/if}

