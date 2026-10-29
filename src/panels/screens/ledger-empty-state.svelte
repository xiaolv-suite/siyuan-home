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
            <div class="lv-skel" style="width:25%"></div>
            <div class="lv-skel" style="width:20%"></div>
            <div class="lv-skel" style="width:15%"></div>
            <div class="lv-skel" style="width:20%"></div>
        </div>
        {#each [0, 1, 2, 3] as i (i)}
            <div class="lv-table-loading-row">
                <div class="lv-skel lv-skel--idx"></div>
                <div class="lv-skel" style="width:{35 + (i * 7) % 25}%"></div>
                <div class="lv-skel" style="width:18%"></div>
                <div class="lv-skel" style="width:15%"></div>
                <div class="lv-skel" style="width:18%"></div>
            </div>
        {/each}
    </div>
{:else if loadError}
    <div class="lv-card"><div class="lv-empty" role="alert"><div class="eic"><UiIcon name="alert" size={22} /></div><b>{loadError}</b>
        <button class="b3-button b3-button--outline" onclick={onLoad}>{t("ledger.retryRead")}</button>
    </div></div>
{:else if ledgers.length === 0}
    <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="settings" size={22} /></div><b>{t("ledger.noEnabledModules")}</b><span>{t("ledger.noEnabledModulesHint")}</span>
        <button class="lv-btn primary" style="margin-top:4px" onclick={onOpenSettings}>{t("startGuide.openSettings")}</button>
    </div></div>
{:else if !ref?.avId}
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="archive" size={24} /></div>
            <b>{t("ledger.defaultBlankTitle")}</b>
            <span class="lv-blank-desc">{t("ledger.defaultBlankDesc")}</span>
            {#if ref?.provisionError}
                <div class="lv-caption lv-tx-warn lv-blank-warn">
                    ⚠️ {ref.provisionError}
                </div>
            {/if}
            <div class="lv-blank-actions">
                <button class="lv-btn primary" onclick={onRebuildLedger} disabled={rebuilding}>
                    🚀 {rebuilding ? t("diag.rebuilding") : t("ledger.buildNow")}
                </button>
                <button class="b3-button b3-button--outline" onclick={onOpenBindDoc} disabled={rebuilding}>
                    {t("ledger.bindDoc")}
                </button>
                <button class="b3-button b3-button--outline" onclick={onOpenNewRecord} disabled={rebuilding}>
                    + {t("ledger.newRecord")}
                </button>
            </div>
        </div>
    </div>
{:else if rows.length > 0}
    <!-- 搜索或筛选无结果空态 -->
    <div class="lv-card">
        <div class="lv-empty" role="status">
            <div class="eic"><UiIcon name="search" size={22} /></div>
            <b>{t("ledger.searchEmpty")}</b>
            <span>{searchText.trim() ? t("ledger.searchEmptyHint").replace("${q}", searchText.trim()) : (t("ledger.filterEmpty") || "当前筛选条件下暂无匹配记录")}</span>
            <button class="b3-button b3-button--outline" style="margin-top:8px" onclick={onClearSearch}>
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
                <button class="lv-btn primary" onclick={onOpenNewRecord} disabled={rebuilding}>+ {t("ledger.newRecord")}</button>
                {#if active !== "members" && active !== "adhoc"}
                    <button class="b3-button b3-button--outline" onclick={onImportCsv} disabled={rebuilding}>📥 {t("ledger.importCsv")}</button>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .lv-table-loading-card {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .lv-table-loading-head {
        display: flex;
        gap: 12px;
        align-items: center;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--lv-line);
    }
    .lv-table-loading-row {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 4px 0;
    }
    .lv-skel--idx {
        width: 32px;
        height: 12px;
        flex: none;
    }
    .lv-blank-desc {
        max-width: 480px;
        line-height: 1.6;
    }
    .lv-blank-warn {
        margin-top: 4px;
        max-width: 520px;
        line-height: 1.4;
    }
    .lv-blank-actions {
        display: flex;
        gap: 10px;
        margin-top: 10px;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
    }
</style>
