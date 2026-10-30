<script lang="ts">
    import type { HomePluginLike } from "@/types/plugin";
    import type { TableDensity } from "../panel-session";
    import { optLabel } from "@/core/format";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        active = $bindable(""),
        ledgers = [],
        groupedLedgers = [],
        pinnedLedgers = [],
        ref,
        rebuilding = false,
        filteredRowsCount = 0,
        filteredRowsEmpty = false,
        searchText = $bindable(""),
        tableDensity = $bindable<TableDensity>("comfortable"),
        memberCol,
        filterMemberId = $bindable(""),
        categoryCol,
        availableCategories = [],
        filterCategory = $bindable(""),
        exporting = false,
        printing = false,
        t,
        onSwitchLedger,
        onOpenNewRecord,
        onToggleDensity,
        onSearchInput,
        onSearchClear,
        onRebuildLedger,
        onExportCsv,
        onExportIcs,
        onExportArchiveManifest,
        onPrintLabels,
        onOpenModal,
    }: {
        plugin: HomePluginLike;
        active: string;
        ledgers?: Array<{ id: string; ref?: any }>;
        groupedLedgers?: Array<{ groupId: string; groupLabel: string; modules: any[] }>;
        pinnedLedgers?: string[];
        ref?: { avId?: string; docId?: string; columns?: Record<string, string> };
        rebuilding?: boolean;
        filteredRowsCount?: number;
        filteredRowsEmpty?: boolean;
        searchText: string;
        tableDensity: TableDensity;
        memberCol?: string;
        filterMemberId: string;
        categoryCol?: string;
        availableCategories?: string[];
        filterCategory: string;
        exporting?: boolean;
        printing?: boolean;
        t: (k: string) => string;
        onSwitchLedger?: (next: string) => void;
        onOpenNewRecord?: () => void;
        onToggleDensity?: () => void;
        onSearchInput?: (val: string) => void;
        onSearchClear?: () => void;
        onRebuildLedger?: () => void;
        onExportCsv?: () => void;
        onExportIcs?: () => void;
        onExportArchiveManifest?: () => void;
        onPrintLabels?: () => void;
        onOpenModal?: (actionName: string) => void;
    } = $props();

    let ledgerMoreDetails: HTMLDetailsElement | undefined = $state();

    function handleSwitchLedger(e: Event) {
        const next = (e.currentTarget as HTMLSelectElement).value;
        if (onSwitchLedger) onSwitchLedger(next);
        else active = next;
    }

    let searchTimer: number | undefined;

    function handleSearchInput(e: Event) {
        const val = (e.currentTarget as HTMLInputElement).value;
        if (searchTimer !== undefined) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            searchText = val;
            onSearchInput?.(val);
        }, 120);
    }

    let searchInputEl = $state<HTMLInputElement | undefined>(undefined);

    function handleSearchClear() {
        if (searchTimer !== undefined) window.clearTimeout(searchTimer);
        searchText = "";
        onSearchClear?.();
        requestAnimationFrame(() => searchInputEl?.focus());
    }
</script>

<div class="lv-toolbar lv-ledger-toolbar">
    {#if ledgers.length > 0}
        <select class="b3-select" value={active} onchange={handleSwitchLedger} aria-label={t("ledger.switchLedger") || "切换台账"}>
            {#each groupedLedgers as g (g.groupId)}
                <optgroup label={g.groupLabel}>
                    {#each g.modules as l (l.id)}
                        <option value={l.id}>{t(`module.${l.id}`)}{plugin.settings.dbRefs?.[l.id]?.avId ? "" : ` (${t("diag.missing")})`}</option>
                    {/each}
                </optgroup>
            {/each}
        </select>
    {:else}
        <div class="lv-ledger-no-modules" role="status">
            <span>{t("ledger.noEnabledModules")}</span>
            <button class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
        </div>
    {/if}
    <span class="fn__flex-1"></span>
    {#if rebuilding}
        <span class="lv-caption">{t("diag.rebuilding")}</span>
    {:else if ledgers.length === 0}
        <span class="lv-caption">{t("ledger.noEnabledModulesHint")}</span>
    {:else if !ref?.avId}
        <button class="b3-button" onclick={onRebuildLedger}>{t("ledger.rebuild")}</button>
    {:else}
        <div class="lv-search-box">
            <input bind:this={searchInputEl} class="b3-text-field lv-search-input" type="search" placeholder={t("ledger.search")}
                value={searchText}
                oninput={handleSearchInput}
                onkeydown={(event) => { if (event.key === "Escape") handleSearchClear(); }}
                title={t("ledger.search")} />
            {#if searchText}
                <span class="lv-badge lv-search-badge {filteredRowsCount > 0 ? 'blue' : 'orange'}">
                    {filteredRowsCount}
                </span>
                <button type="button" class="b3-button b3-button--text lv-search-clear"
                    title={t("clear")} aria-label={t("clear")} onclick={handleSearchClear}>✕</button>
            {/if}
        </div>
        <button class="b3-button b3-button--outline lv-density-btn"
            title={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            aria-label={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            onclick={onToggleDensity}>
            {tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
        </button>
        <button class="lv-btn primary" onclick={onOpenNewRecord} disabled={rebuilding}>＋ {t("ledger.newRecord")}</button>
        <details class="lv-ledger-more" bind:this={ledgerMoreDetails}>
            <summary class="b3-button b3-button--outline">{t("ledger.moreActions")}</summary>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="lv-ledger-more__menu" role="menu" tabindex="-1" onclick={() => { if (ledgerMoreDetails) ledgerMoreDetails.open = false; }}>
                <button class="b3-button b3-button--outline" title={t("ledger.exportCsvTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportCsv}>{exporting ? t("ledger.saving") : t("ledger.exportCsv")}</button>
                <button class="b3-button b3-button--outline" title={t("ledger.exportIcsTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportIcs}>{exporting ? t("ledger.saving") : t("ledger.exportIcs")}</button>
                <button class="b3-button b3-button--outline" title={t("ledger.exportArchiveTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportArchiveManifest}>{exporting ? t("ledger.saving") : t("ledger.exportArchive")}</button>
                <button class="b3-button b3-button--outline" title={t("ledger.printLabels")}
                    disabled={filteredRowsEmpty || printing || exporting} aria-busy={printing} onclick={onPrintLabels}>{printing ? t("ledger.saving") : t("ledger.printLabels")}</button>
                {#if active === "vehicles"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("energy")}>{t("fuel.dashboardButton")}</button>{/if}
                {#if active === "parenting"}
                    <button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("growth")}>{t("ledger.growthChart")}</button>
                    <button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("vaccine")}>{t("ledger.vaccineSchedule")}</button>
                {/if}
                {#if active === "stock"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("shopping")}>{t("ledger.shoppingList")}</button>{/if}
                {#if active === "stock"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("emergency-kit")}>{t("ledger.emergencyKit")}</button>{/if}
                {#if active === "shopping"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("store-mode")}>{t("ledger.storeMode")}</button>{/if}
                <button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("location-index")}>{t("ledger.locSearch")}</button>
                <button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("block-ingest")}>{t("capture.ingestAction")}</button>
                {#if ref?.columns?.amount}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("expense-trend")}>{t("ledger.expenseTrend")}</button>{/if}
                {#if active === "favors"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("favors-report")}>{t("ledger.favorsReport")}</button>{/if}
                {#if active === "bookmarks"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("bookmarks-check")}>{t("ledger.checkBookmarks")}</button>{/if}
                {#if active === "memberships"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("subscription-stats")}>{t("ledger.subscriptionStats")}</button>{/if}
                {#if active === "assets-real"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("asset-valuation")}>{t("ledger.assetValuationReport")}</button>{/if}
                {#if active === "media"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("media-report")}>{t("ledger.mediaReport")}</button>{/if}
                {#if active === "food"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("meal-plan")}>{t("ledger.mealPlan")}</button>{/if}
                {#if active === "medicine"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("medicine-supply")}>{t("ledger.medicineSupply")}</button>{/if}
                {#if active === "house"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("utility-tiers")}>{t("ledger.utilityTiers")}</button>{/if}
                {#if active === "house" || active === "chores"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("waste-schedule")}>{t("ledger.wasteSchedule")}</button>{/if}
                {#if active === "chores"}<button class="b3-button b3-button--outline" onclick={() => onOpenModal?.("rewards-settle")}>{t("ledger.rewardsSettle")}</button>{/if}
                {#if active !== "members" && active !== "adhoc"}<button class="b3-button b3-button--outline" disabled={printing || exporting} onclick={() => onOpenModal?.("csv-import")}>{t("ledger.importCsv")}</button>{/if}
                <button class="b3-button b3-button--outline" disabled={!ref?.docId}
                    onclick={() => plugin.showTabDocs(ref?.docId)}>{t("ledger.openDoc")} →</button>
            </div>
        </details>
    {/if}
</div>

{#if pinnedLedgers.length > 1}
    <div class="lv-ledger-pinned-bar">
        <span class="lv-caption lv-pinned-icon"><UiIcon name="bookmark" size={13} /></span>
        {#each pinnedLedgers as pid (pid)}
            <button type="button" class="lv-preset-tag" class:active={active === pid}
                aria-pressed={active === pid}
                onclick={() => onSwitchLedger ? onSwitchLedger(pid) : (active = pid)}>
                {t(`module.${pid}`)}
            </button>
        {/each}
    </div>
{/if}

{#if (memberCol && (plugin.settings.members?.length ?? 0) > 0) || (categoryCol && availableCategories.length > 0)}
    <div class="lv-filter-bar">
        {#if memberCol && (plugin.settings.members?.length ?? 0) > 0}
            <div class="lv-filter-pill-group">
                <span class="lv-caption lv-filter-pill-icon"><UiIcon name="users" size={13} /></span>
                <button type="button" class="lv-preset-tag" class:active={!filterMemberId} aria-pressed={!filterMemberId} onclick={() => { filterMemberId = ""; }}>{t("ledger.allMembers")}</button>
                {#each plugin.settings.members ?? [] as m (m.id)}
                    {#if m.avItemId}
                        <button type="button" class="lv-preset-tag" class:active={filterMemberId === m.avItemId} aria-pressed={filterMemberId === m.avItemId} onclick={() => { filterMemberId = filterMemberId === m.avItemId ? "" : m.avItemId; }}>
                            {m.name}
                        </button>
                    {/if}
                {/each}
            </div>
        {/if}
        {#if categoryCol && availableCategories.length > 0}
            <div class="lv-filter-pill-group">
                <span class="lv-caption lv-filter-pill-icon"><UiIcon name="note" size={13} /></span>
                <button type="button" class="lv-preset-tag" class:active={!filterCategory} aria-pressed={!filterCategory} onclick={() => { filterCategory = ""; }}>{t("ledger.allCategories")}</button>
                {#each availableCategories as catVal (catVal)}
                    <button type="button" class="lv-preset-tag" class:active={filterCategory === catVal} aria-pressed={filterCategory === catVal} onclick={() => { filterCategory = filterCategory === catVal ? "" : catVal; }}>
                        {optLabel(t, "category", catVal)}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .lv-ledger-toolbar {
        margin: 0 0 14px;
    }
    .lv-ledger-pinned-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
        margin: -6px 0 10px;
    }
    .lv-pinned-icon {
        font-size: 11px;
        color: var(--lv-tx-3);
        margin-right: 2px;
    }
    .lv-filter-bar {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        align-items: center;
        margin: 0 0 10px;
        font-size: 12px;
    }
    .lv-filter-pill-group {
        display: inline-flex;
        gap: 3px;
        align-items: center;
        padding: 2px 6px;
        background: var(--lv-surface-2);
        border-radius: var(--lv-r-full, 12px);
        border: 1px solid var(--lv-line);
    }
    .lv-filter-pill-icon {
        font-size: 11px;
        margin-right: 2px;
    }
    .lv-search-box {
        position: relative;
        display: inline-flex;
        align-items: center;
    }
    .lv-search-input {
        width: min(240px, 100%);
        padding-right: 48px;
    }
    .lv-search-badge {
        position: absolute;
        right: 22px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 11px;
        padding: 1px 5px;
        pointer-events: none;
        opacity: 0.85;
    }
    .lv-search-clear {
        position: absolute;
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
        padding: 2px 5px;
        font-size: 11px;
        color: var(--lv-tx-3);
        cursor: pointer;
    }
</style>
