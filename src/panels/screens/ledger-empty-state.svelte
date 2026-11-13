<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        loading = false,
        loadError = "",
        ledgers = [],
        ref,
        rows = [],
        active,
        searchText = "",
        rebuilding = false,
        t,
        onLoad,
        onOpenSettings,
        onRebuildLedger,
        onOpenBindDoc,
        onOpenNewRecord,
        onClearSearch,
        onImportCsv,
    }: {
        loading?: boolean;
        loadError?: string;
        ledgers?: any[];
        ref?: any;
        rows?: any[];
        active: string;
        searchText?: string;
        rebuilding?: boolean;
        t: (k: string) => string;
        onLoad: () => void;
        onOpenSettings: () => void;
        onRebuildLedger: () => void;
        onOpenBindDoc: () => void;
        onOpenNewRecord: () => void;
        onClearSearch: () => void;
        onImportCsv: () => void;
    } = $props();
</script>

{#if loading}
    <div class="lv-card lv-table-loading-card" aria-busy="true" role="status">
        <div class="lv-table-loading-head">
            <div class="lv-skel lv-skel--idx"></div>
            <div class="lv-skel lv-skel--w25"></div>
            <div class="lv-skel lv-skel--w20"></div>
            <div class="lv-skel lv-skel--w15"></div>
            <div class="lv-skel lv-skel--w20"></div>
        </div>
        {#each [0, 1, 2, 3] as i (i)}
            <div class="lv-table-loading-row">
                <div class="lv-skel lv-skel--idx"></div>
                <div class="lv-skel lv-skel--vary-{i}"></div>
                <div class="lv-skel lv-skel--w18"></div>
                <div class="lv-skel lv-skel--w15"></div>
                <div class="lv-skel lv-skel--w18"></div>
            </div>
        {/each}
    </div>
{:else if loadError}
    <div class="lv-card"><div class="lv-empty" role="alert"><div class="eic"><UiIcon name="alert" size={22} /></div><b>{loadError}</b>
        <button type="button" class="b3-button b3-button--outline" onclick={onLoad}>{t("ledger.retryRead")}</button>
    </div></div>
{:else if ledgers.length === 0}
    <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="settings" size={22} /></div><b>{t("ledger.noEnabledModules")}</b><span>{t("ledger.noEnabledModulesHint")}</span>
        <button type="button" class="lv-btn primary lv-mt-4" onclick={onOpenSettings}>{t("startGuide.openSettings")}</button>
    </div></div>
{:else if !ref?.avId}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="archive" size={24} /></div>
            <b>{t("ledger.defaultBlankTitle")}</b>
            <span class="lv-blank-desc">{t("ledger.defaultBlankDesc")}</span>
            {#if ref?.provisionError}
                <div class="lv-caption lv-tx-warn lv-blank-warn">
                    <UiIcon name="alert" size={13} /> {ref.provisionError}
                </div>
            {/if}
            <div class="lv-blank-actions">
                <button type="button" class="lv-btn primary" onclick={onRebuildLedger} disabled={rebuilding}>
                    <UiIcon name="bolt" size={13} /> {rebuilding ? t("diag.rebuilding") : t("ledger.buildNow")}
                </button>
                <button type="button" class="b3-button b3-button--outline" onclick={onOpenBindDoc} disabled={rebuilding}>
                    <UiIcon name="link" size={13} /> {t("ledger.bindDoc")}
                </button>
                {#if ref?.avId}
                    <button type="button" class="b3-button b3-button--outline" onclick={onOpenNewRecord} disabled={rebuilding}>
                        <UiIcon name="add" size={13} /> {t("ledger.newRecord")}
                    </button>
                {/if}
            </div>
        </div>
    </div>
{:else if rows.length > 0}
    <!-- 搜索或筛选无结果空态 -->
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="search" size={22} /></div>
            <b>{t("ledger.searchEmpty")}</b>
            <span>{searchText.trim() ? t("ledger.searchEmptyHint").replace("${q}", searchText.trim()) : t("ledger.filterEmpty")}</span>
            <button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={onClearSearch}>
                {t("clear")}
            </button>
        </div>
    </div>
{:else}
    <!-- 普通默认空态 -->
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="folder" size={22} /></div>
            <b>{t("ledger.empty")}</b>
            <span>{t("ledger.emptyHint")}</span>
            <div class="lv-blank-actions">
                <button type="button" class="lv-btn primary" onclick={onOpenNewRecord} disabled={rebuilding}><UiIcon name="add" size={13} /> {t("ledger.newRecord")}</button>
                {#if active !== "members" && active !== "adhoc"}
                    <button type="button" class="b3-button b3-button--outline" onclick={onImportCsv} disabled={rebuilding}><UiIcon name="archive" size={13} /> {t("ledger.importCsv")}</button>
                {/if}
            </div>
        </div>
    </div>
{/if}
