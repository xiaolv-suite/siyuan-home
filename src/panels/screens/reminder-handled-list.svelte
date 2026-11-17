<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        handledFiltered = [] as any[],
        handledEntries = [] as any[],
        reminderBusy = new Set<string>(),
        t,
        onClearFilters,
        onRestore,
        onDeleteMemo,
    }: {
        handledFiltered?: any[];
        handledEntries?: any[];
        reminderBusy?: Set<string>;
        t: (k: string) => string;
        onClearFilters?: () => void;
        onRestore?: (id: string) => void;
        onDeleteMemo?: (id: string, title: string) => void;
    } = $props();

    type HandledKindFilter = "all" | "done" | "muted" | "period" | "memo";
    let kindFilter = $state<HandledKindFilter>("all");

    const PAGE_SIZE = 20;
    let renderLimit = $state(PAGE_SIZE);

    const counts = $derived({
        all: handledFiltered.length,
        done: handledFiltered.filter((h) => h.kind === "done").length,
        muted: handledFiltered.filter((h) => h.kind === "muted").length,
        period: handledFiltered.filter((h) => h.kind === "period" || h.kind === "year").length,
        memo: handledFiltered.filter((h) => h.kind === "memo").length,
    });

    const filteredByKind = $derived.by(() => {
        if (kindFilter === "all") return handledFiltered;
        if (kindFilter === "done") return handledFiltered.filter((h) => h.kind === "done");
        if (kindFilter === "muted") return handledFiltered.filter((h) => h.kind === "muted");
        if (kindFilter === "period") return handledFiltered.filter((h) => h.kind === "period" || h.kind === "year");
        if (kindFilter === "memo") return handledFiltered.filter((h) => h.kind === "memo");
        return handledFiltered;
    });

    const handledVisible = $derived(filteredByKind.slice(0, renderLimit));

    const kindLabel: Record<string, string> = {
        done: "hub.handledDone",
        muted: "hub.handledMuted",
        year: "hub.handledYear",
        period: "hub.handledPeriod",
        memo: "hub.handledMemo",
    };
</script>

{#if handledFiltered.length > 0}
    <div class="lv-handled-filter-bar" role="tablist" aria-label={t("hub.handledTitle")}>
        <button type="button" class="lv-handled-filter-btn" class:active={kindFilter === "all"} onclick={() => { kindFilter = "all"; renderLimit = PAGE_SIZE; }}>
            {t("hub.filterAll")} <span class="lv-badge gray lv-badge--xs">{counts.all}</span>
        </button>
        {#if counts.done > 0}
            <button type="button" class="lv-handled-filter-btn" class:active={kindFilter === "done"} onclick={() => { kindFilter = "done"; renderLimit = PAGE_SIZE; }}>
                {t("hub.handledDone")} <span class="lv-badge gray lv-badge--xs">{counts.done}</span>
            </button>
        {/if}
        {#if counts.muted > 0}
            <button type="button" class="lv-handled-filter-btn" class:active={kindFilter === "muted"} onclick={() => { kindFilter = "muted"; renderLimit = PAGE_SIZE; }}>
                {t("hub.handledMuted")} <span class="lv-badge gray lv-badge--xs">{counts.muted}</span>
            </button>
        {/if}
        {#if counts.period > 0}
            <button type="button" class="lv-handled-filter-btn" class:active={kindFilter === "period"} onclick={() => { kindFilter = "period"; renderLimit = PAGE_SIZE; }}>
                {t("hub.handledPeriod")} <span class="lv-badge gray lv-badge--xs">{counts.period}</span>
            </button>
        {/if}
        {#if counts.memo > 0}
            <button type="button" class="lv-handled-filter-btn" class:active={kindFilter === "memo"} onclick={() => { kindFilter = "memo"; renderLimit = PAGE_SIZE; }}>
                {t("hub.handledMemo")} <span class="lv-badge gray lv-badge--xs">{counts.memo}</span>
            </button>
        {/if}
    </div>
{/if}

{#if handledFiltered.length === 0 && handledEntries.length > 0}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="search" size={22} /></div>
            <b>{t("hub.filteredEmpty")}</b>
            <span>{t("hub.filteredEmptyHint")}</span>
            <button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={onClearFilters}>
                {t("hub.clearFilters")}
            </button>
        </div>
    </div>
{:else if handledFiltered.length === 0}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="check" size={22} /></div>
            <b>{t("hub.handledTitle")}</b>
            <span>{t("hub.handledHint")}</span>
        </div>
    </div>
{:else if filteredByKind.length === 0}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="search" size={22} /></div>
            <b>{t("hub.filteredEmpty")}</b>
            <span>{t("hub.filteredEmptyHint")}</span>
            <button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={() => { kindFilter = "all"; }}>
                {t("hub.clearFilters")}
            </button>
        </div>
    </div>
{:else}
    <div class="lv-card lv-rems">
        {#each handledVisible as h (h.id + h.kind)}
            <div class="lv-rem lead">
                <div class="lv-rem-ic">
                    <UiIcon name={h.kind === "memo" ? "note" : h.kind === "muted" ? "mute" : "check"} size={18} />
                </div>
                <div class="lv-rem-t">
                    <b>{h.title || t("hub.handledUnknown")}</b>
                    <span class="lv-caption">
                        {t(kindLabel[h.kind] ?? "hub.handledDone")}{h.dueDate ? ` · ${h.dueDate}` : ""}{h.moduleId && h.moduleId !== "adhoc" ? ` · ${t(`module.${h.moduleId}`)}` : ""}
                    </span>
                </div>
                <div class="lv-rem-ops">
                    <button type="button" class="b3-button b3-button--text" disabled={reminderBusy.has(h.id)} aria-busy={reminderBusy.has(h.id)} onclick={() => onRestore?.(h.id)}>
                        <UiIcon name="repeat" size={12} /> {reminderBusy.has(h.id) ? t("ledger.saving") : t("hub.restore")}
                    </button>
                    {#if h.kind === "memo"}
                        <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger" disabled={reminderBusy.has(h.id)} onclick={() => onDeleteMemo?.(h.id, h.title || t("hub.handledUnknown"))}>
                            <UiIcon name="close" size={12} /> {t("delete")}
                        </button>
                    {/if}
                </div>
            </div>
        {/each}
        {#if filteredByKind.length > handledVisible.length}
            <div class="lv-card-center-pad">
                <button type="button" class="b3-button b3-button--outline" onclick={() => (renderLimit += PAGE_SIZE)}>
                    {t("ledger.loadMore").replace("${n}", String(filteredByKind.length - handledVisible.length))}
                </button>
            </div>
        {/if}
    </div>
{/if}
