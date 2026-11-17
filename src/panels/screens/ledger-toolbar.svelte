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
        schemaKeys = [] as string[],
        tableKeys = [] as string[],
        fieldLabel,
        t,
        onSwitchLedger,
        onOpenNewRecord,
        onToggleDensity,
        onToggleColumn,
        onResetColumns,
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
        schemaKeys?: string[];
        tableKeys?: string[];
        fieldLabel?: (k: string) => string;
        t: (k: string) => string;
        onSwitchLedger?: (next: string) => void;
        onOpenNewRecord?: () => void;
        onToggleDensity?: () => void;
        onToggleColumn?: (k: string) => void;
        onResetColumns?: () => void;
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
    let colVisDetails: HTMLDetailsElement | undefined = $state();
    let mobileFilterOpen = $state(false);
    const activeLedgerFilterCount = $derived(
        (filterMemberId ? 1 : 0) + (filterCategory ? 1 : 0) + (tableDensity === "compact" ? 1 : 0),
    );

    const resolveFieldLabel = (k: string) => {
        if (fieldLabel) return fieldLabel(k);
        const trans = t(`field.${k}`);
        return trans !== `field.${k}` ? trans : k;
    };

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

    function handleWindowPointerDown(e: PointerEvent) {
        const target = e.target as Node | null;
        if (ledgerMoreDetails?.open && target && !ledgerMoreDetails.contains(target)) {
            ledgerMoreDetails.open = false;
        }
        if (colVisDetails?.open && target && !colVisDetails.contains(target)) {
            colVisDetails.open = false;
        }
    }

    function handleWindowKeydown(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        if (document.querySelector(".b3-dialog")) return;
        if (ledgerMoreDetails?.open) {
            e.preventDefault();
            e.stopPropagation();
            ledgerMoreDetails.open = false;
            ledgerMoreDetails.querySelector<HTMLElement>("summary")?.focus();
        }
        if (colVisDetails?.open) {
            e.preventDefault();
            e.stopPropagation();
            colVisDetails.open = false;
            colVisDetails.querySelector<HTMLElement>("summary")?.focus();
        }
    }

    function handleMoreKeydown(e: KeyboardEvent) {
        if (!ledgerMoreDetails?.open) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            ledgerMoreDetails.open = false;
            ledgerMoreDetails.querySelector<HTMLElement>("summary")?.focus();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const items = Array.from(
            ledgerMoreDetails.querySelectorAll<HTMLButtonElement>('.lv-ledger-more__menu button[role="menuitem"]:not([disabled])'),
        );
        if (items.length === 0) return;
        e.preventDefault();
        const cur = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0
            : e.key === "End" ? items.length - 1
            : e.key === "ArrowDown" ? (cur + 1) % items.length
            : (cur - 1 + items.length) % items.length;
        items[next]?.focus();
    }
</script>

<svelte:window onpointerdowncapture={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<div class="lv-toolbar lv-ledger-toolbar" class:is-mobile-filter-open={mobileFilterOpen}>
    {#if ledgers.length > 0}
        <select class="b3-select lv-ledger-mod-select" value={active} onchange={handleSwitchLedger} aria-label={t("ledger.switchLedger")}>
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
            <button type="button" class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
        </div>
    {/if}
    <span class="fn__flex-1"></span>
    {#if rebuilding}
        <span class="lv-caption">{t("diag.rebuilding")}</span>
    {:else if ledgers.length === 0}
        <span class="lv-caption">{t("ledger.noEnabledModulesHint")}</span>
    {:else if !ref?.avId}
        <button type="button" class="b3-button" onclick={onRebuildLedger}>{t("ledger.rebuild")}</button>
    {:else}
        <div class="lv-search-box">
            <input bind:this={searchInputEl} class="b3-text-field lv-search-input" type="search" placeholder={t("ledger.search")}
                aria-label={t("ledger.search")}
                value={searchText}
                oninput={handleSearchInput}
                onkeydown={(event) => { if (event.key === "Escape") handleSearchClear(); }}
                title={t("ledger.search")} />
            {#if searchText}
                <span class="lv-badge lv-search-badge {filteredRowsCount > 0 ? 'blue' : 'orange'}">
                    {filteredRowsCount}
                </span>
                <button type="button" class="b3-button b3-button--text lv-search-clear"
                    title={t("clear")} aria-label={t("clear")} onclick={handleSearchClear}><UiIcon name="close" size={12} /></button>
            {/if}
        </div>
        <button type="button" class="b3-button b3-button--outline lv-density-btn"
            title={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            aria-label={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            onclick={onToggleDensity}>
            {tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
        </button>
        {#if schemaKeys.length > 0}
            <details class="lv-col-vis-details" bind:this={colVisDetails}>
                <summary class="b3-button b3-button--outline lv-col-vis-btn" title={t("ledger.columnVisibility")}>
                    <UiIcon name="layout" size={13} /> <span>{t("ledger.columnVisibility")}</span>
                </summary>
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div class="lv-col-vis__menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
                    <div class="lv-col-vis__header">{t("ledger.columnSelect")}</div>
                    <div class="lv-col-vis__list">
                        {#each schemaKeys as k (k)}
                            <label class="lv-col-vis__item">
                                <input type="checkbox" class="b3-checkbox" checked={tableKeys.includes(k)} aria-label={resolveFieldLabel(k)} onchange={() => onToggleColumn?.(k)} />
                                <span>{resolveFieldLabel(k)}</span>
                            </label>
                        {/each}
                    </div>
                    <div class="lv-col-vis__footer">
                        <button type="button" class="b3-button b3-button--text b3-button--small" onclick={() => { onResetColumns?.(); if (colVisDetails) colVisDetails.open = false; }}>
                            {t("ledger.columnReset")}
                        </button>
                    </div>
                </div>
            </details>
        {/if}
        <button type="button" class="b3-button b3-button--outline lv-open-doc-btn" disabled={!ref?.docId}
            title={t("ledger.openDoc")} onclick={() => plugin.showTabDocs(ref?.docId)}>
            <UiIcon name="folder" size={13} /> <span>{t("ledger.openDoc")}</span>
        </button>
        <button type="button" class="lv-btn primary lv-ledger-new-btn" onclick={onOpenNewRecord} disabled={rebuilding}><UiIcon name="add" size={13} /> {t("ledger.newRecord")}</button>
        <button
            type="button"
            class="b3-button b3-button--outline lv-ledger-mobile-filter-btn"
            class:is-active={mobileFilterOpen || activeLedgerFilterCount > 0}
            aria-expanded={mobileFilterOpen}
            onclick={() => (mobileFilterOpen = !mobileFilterOpen)}
        >
            <UiIcon name="filter" size={13} />
            <span>{t("hub.mobileFilter") !== "hub.mobileFilter" ? t("hub.mobileFilter") : "筛选"}</span>
            {#if activeLedgerFilterCount > 0}
                <span class="lv-badge blue lv-badge--xs">{activeLedgerFilterCount}</span>
            {/if}
            <UiIcon name={mobileFilterOpen ? "chevronUp" : "chevronDown"} size={12} />
        </button>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <details class="lv-ledger-more" bind:this={ledgerMoreDetails} onkeydown={handleMoreKeydown}>
            <summary class="b3-button b3-button--outline">{t("ledger.moreActions")}</summary>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="lv-ledger-more__menu" role="menu" tabindex="-1" onclick={() => { if (ledgerMoreDetails) ledgerMoreDetails.open = false; }}>
                <button type="button" role="menuitem" class="b3-button b3-button--outline" title={t("ledger.exportCsvTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportCsv}>{exporting ? t("ledger.saving") : t("ledger.exportCsv")}</button>
                <button type="button" role="menuitem" class="b3-button b3-button--outline" title={t("ledger.exportIcsTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportIcs}>{exporting ? t("ledger.saving") : t("ledger.exportIcs")}</button>
                <button type="button" role="menuitem" class="b3-button b3-button--outline" title={t("ledger.exportArchiveTip")}
                    disabled={filteredRowsEmpty || exporting || printing} aria-busy={exporting} onclick={onExportArchiveManifest}>{exporting ? t("ledger.saving") : t("ledger.exportArchive")}</button>
                <button type="button" role="menuitem" class="b3-button b3-button--outline" title={t("ledger.printLabels")}
                    disabled={filteredRowsEmpty || printing || exporting} aria-busy={printing} onclick={onPrintLabels}>{printing ? t("ledger.saving") : t("ledger.printLabels")}</button>
                {#if active === "vehicles"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("energy")}>{t("fuel.dashboardButton")}</button>{/if}
                {#if active === "parenting"}
                    <button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("growth")}>{t("ledger.growthChart")}</button>
                    <button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("vaccine")}>{t("ledger.vaccineSchedule")}</button>
                {/if}
                {#if active === "stock"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("shopping")}>{t("ledger.shoppingList")}</button>{/if}
                {#if active === "stock"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("emergency-kit")}>{t("ledger.emergencyKit")}</button>{/if}
                {#if active === "shopping"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("store-mode")}>{t("ledger.storeMode")}</button>{/if}
                <button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("location-index")}>{t("ledger.locSearch")}</button>
                <button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("block-ingest")}>{t("capture.ingestAction")}</button>
                {#if ref?.columns?.amount}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("expense-trend")}>{t("ledger.expenseTrend")}</button>{/if}
                {#if active === "favors"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("favors-report")}>{t("ledger.favorsReport")}</button>{/if}
                {#if active === "bookmarks"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("bookmarks-check")}>{t("ledger.checkBookmarks")}</button>{/if}
                {#if active === "memberships"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("subscription-stats")}>{t("ledger.subscriptionStats")}</button>{/if}
                {#if active === "assets-real"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("asset-valuation")}>{t("ledger.assetValuationReport")}</button>{/if}
                {#if active === "media"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("media-report")}>{t("ledger.mediaReport")}</button>{/if}
                {#if active === "food"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("meal-plan")}>{t("ledger.mealPlan")}</button>{/if}
                {#if active === "medicine"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("medicine-supply")}>{t("ledger.medicineSupply")}</button>{/if}
                {#if active === "house"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("utility-tiers")}>{t("ledger.utilityTiers")}</button>{/if}
                {#if active === "house" || active === "chores"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("waste-schedule")}>{t("ledger.wasteSchedule")}</button>{/if}
                {#if active === "chores"}<button type="button" role="menuitem" class="b3-button b3-button--outline" onclick={() => onOpenModal?.("rewards-settle")}>{t("ledger.rewardsSettle")}</button>{/if}
                {#if active !== "members" && active !== "adhoc"}<button type="button" role="menuitem" class="b3-button b3-button--outline" disabled={printing || exporting} onclick={() => onOpenModal?.("csv-import")}>{t("ledger.importCsv")}</button>{/if}
                <button type="button" role="menuitem" class="b3-button b3-button--outline" disabled={!ref?.docId}
                    onclick={() => plugin.showTabDocs(ref?.docId)}><span>{t("ledger.openDoc")}</span> <UiIcon name="forward" size={12} /></button>
            </div>
        </details>
    {/if}
</div>

{#if pinnedLedgers.length > 1 || (memberCol && (plugin.settings.members?.length ?? 0) > 0) || (categoryCol && availableCategories.length > 0)}
    <div class="lv-filter-bar" class:is-mobile-filter-open={mobileFilterOpen}>
        {#if pinnedLedgers.length > 1}
            <div class="lv-ledger-pinned-bar lv-filter-pill-group">
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
