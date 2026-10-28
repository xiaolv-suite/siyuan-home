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

    const PAGE_SIZE = 20;
    let renderLimit = $state(PAGE_SIZE);
    const handledVisible = $derived(handledFiltered.slice(0, renderLimit));

    const kindLabel: Record<string, string> = {
        done: "hub.handledDone",
        muted: "hub.handledMuted",
        year: "hub.handledYear",
        period: "hub.handledPeriod",
        memo: "hub.handledMemo",
    };
</script>

{#if handledFiltered.length === 0 && handledEntries.length > 0}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="search" size={22} /></div>
            <b>{t("hub.filteredEmpty")}</b>
            <span>{t("hub.filteredEmptyHint")}</span>
            <button type="button" class="b3-button b3-button--outline" style="margin-top:8px" onclick={onClearFilters}>
                {t("hub.clearFilters")}
            </button>
        </div>
    </div>
{:else if handledFiltered.length === 0}
    <div class="lv-card">
        <div class="lv-empty">
            <div class="eic"><UiIcon name="check" size={22} /></div>
            <b>{t("hub.handledTitle")}</b>
            <span>{t("hub.handledHint")}</span>
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
                        {reminderBusy.has(h.id) ? t("ledger.saving") : t("hub.restore")}
                    </button>
                    {#if h.kind === "memo"}
                        <button type="button" class="b3-button b3-button--text ft__error" style="color:var(--lv-danger)" disabled={reminderBusy.has(h.id)} onclick={() => onDeleteMemo?.(h.id, h.title || t("hub.handledUnknown"))}>
                            {t("delete")}
                        </button>
                    {/if}
                </div>
            </div>
        {/each}
        {#if handledFiltered.length > handledVisible.length}
            <div style="display:flex;justify-content:center;padding:12px">
                <button type="button" class="b3-button b3-button--outline" onclick={() => (renderLimit += PAGE_SIZE)}>
                    {t("ledger.loadMore").replace("${n}", String(handledFiltered.length - handledVisible.length))}
                </button>
            </div>
        {/if}
    </div>
{/if}
