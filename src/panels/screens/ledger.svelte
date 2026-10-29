<script lang="ts">
    import { renderLedgerAll, addDetachedRow, setCell } from "@/core/siyuan";
    import { selectCellContent } from "@/core/avcell";
    import { showMessage, Dialog } from "siyuan";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { ensurePinyin, pinyinReady } from "@/core/pinyin";
    import type { ActivityTarget } from "@/core/activity";
    import LedgerRecordModal from "./ledger-record-modal.svelte";
    import LedgerToolbar from "./ledger-toolbar.svelte";
    import LedgerBatchBar from "./ledger-batch-bar.svelte";
    import LedgerVehicleGrid from "./ledger-vehicle-grid.svelte";
    import LedgerTable from "./ledger-table.svelte";
    import LedgerEmptyState from "./ledger-empty-state.svelte";
    import {
        formatLedgerCellText,
        calculateLedgerTone,
        toneCls,
        toneColor,
        computeColumnSuggestions,
        computeDynamicLocations,
        sortLedgerRows,
        matchLedgerRowSearch,
        computeMissingSchemaColumns,
        computeTableKeys,
        computeModuleWarnDays,
        buildLedgerCellPayload,
        type LedgerTone,
    } from "@/core/ledger-view-model";
    import { onDestroy } from "svelte";
    import { panelSession, type TableDensity } from "../panel-session";
    import { getGroupedModules } from "@/core/modules";
    import { getQuickTemplates } from "@/core/quick-templates";

    let { plugin, t, version }: { plugin: HomePluginLike; t: (k: string) => string; version?: number } = $props();

    // Ledger module selector includes provisioned and enabled-but-unprovisioned modules.
    // 263 波（262 波同款缺陷类）：enabledModules 无响应性——设置保存新启用模块后，
    // 已挂载台账页的下拉不出现新模块；version 驱动重算修复
    const ledgers = $derived.by(() => {
        void version;
        return plugin.settings.enabledModules
            .filter((id: string) => id !== "members")
            .map((id: string) => ({ id, ref: plugin.settings.dbRefs[id] }));
    });
    // 初始快照为设计意图（activeLedger 由模块卡/快速记录预选）
    // svelte-ignore state_referenced_locally
    let active = $state(plugin.activeLedger ?? "certs");
    let rows: any[] = $state([]);
    // Preserve raw columns created directly in the host database view.
    let avCols: any[] = $state([]);
    let loading = $state(false);
    let loadError = $state("");
    let loadRequest = 0;
    let loadController: AbortController | undefined;
    let rebuilding = $state(false);
    let exporting = $state(false);
    let printing = $state(false);
    // The panel session belongs to the stable plugin instance mounted here.
    // svelte-ignore state_referenced_locally
    const panelMemory = panelSession(plugin);
    // Search matches title/note and pinyin; it is independent from member filtering.
    let searchText = $state(panelMemory.ledgerSearch);
    onDestroy(() => {
        loadRequest++;
        loadController?.abort();
        loadController = undefined;
        if (plugin.pendingActivityTarget?.moduleId === active) plugin.pendingActivityTarget = undefined;
    });

    // Settings can disable the currently open module while this screen stays
    // mounted. Keep the selector and form aligned with the enabled set instead
    // of leaving the user on a blank, unselectable ledger.
    const groupedLedgers = $derived(getGroupedModules(ledgers.map((l) => l.id)));
    $effect(() => {
        const available = ledgers;
        if (available.length > 0 && !available.some((entry) => entry.id === active)) {
            active = available[0].id;
            plugin.activeLedger = active;
            searchText = "";
            if (plugin.pendingActivityTarget) {
                plugin.pendingActivityTarget = undefined;
                showMessage(t("activity.navigationUnavailable"), 4000, "error");
            }
        }
    });
    // Progressive rendering keeps the initial table responsive.
    const RENDER_PAGE = 200;
    let renderLimit = $state(RENDER_PAGE);
    // 密度模式（§17）：舒适与紧凑两档
    let tableDensity = $state<TableDensity>(panelMemory.tableDensity ?? "comfortable");
    function toggleDensity() {
        tableDensity = tableDensity === "compact" ? "comfortable" : "compact";
        panelMemory.tableDensity = tableDensity;
    }
    // Load the pinyin dictionary lazily and recompute once it is ready.
    let pyTick = $state(0);
    $effect(() => {
        void active;
        void searchText;
        renderLimit = RENDER_PAGE;
    });
    $effect(() => {
        ensurePinyin().then(() => {
            if (pinyinReady()) pyTick += 1;
        });
    });
    // 17 组：排序偏好记忆（表头点击切换列/方向，跨会话持久化）
    // svelte-ignore state_referenced_locally
    let sortKey = $state<string>(plugin.runtime.ledgerSortKey ?? "");
    // svelte-ignore state_referenced_locally
    let sortAsc = $state<boolean>(plugin.runtime.ledgerSortAsc ?? true);
    async function toggleSort(k: string) {
        const previousKey = sortKey;
        const previousAsc = sortAsc;
        if (sortKey === k) sortAsc = !sortAsc;
        else { sortKey = k; sortAsc = true; }
        plugin.runtime.ledgerSortKey = sortKey;
        plugin.runtime.ledgerSortAsc = sortAsc;
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch (e) {
            sortKey = previousKey;
            sortAsc = previousAsc;
            plugin.runtime.ledgerSortKey = previousKey;
            plugin.runtime.ledgerSortAsc = previousAsc;
            showMessage(t("ledger.sortSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }
    const ref = $derived(ledgers.find((entry) => entry.id === active)?.ref);
    let filterMemberId = $state("");
    let filterCategory = $state("");
    let selectedItemIds = $state<string[]>([]);

    const columnSuggestions = $derived(computeColumnSuggestions(rows, ref?.columns, cellText));
    const dynamicLocations = $derived(computeDynamicLocations(rows, ref?.columns, cellText));

    const memberCol = $derived(ref?.columns?.member);
    const categoryCol = $derived(ref?.columns?.category);

    const availableCategories = $derived.by(() => {
        if (!categoryCol) return [] as string[];
        const set = new Set<string>();
        for (const r of rows) {
            const c = selectCellContent(r.cells?.[categoryCol]);
            if (c && c !== "—") set.add(c);
        }
        return [...set];
    });

    const currentLedgerTemplates = $derived(getQuickTemplates(active));

    async function openBindExistingDocModal() {
        const schema = plugin.schemaCatalog?.[active];
        if (!schema) return;
        try {
            const { openBindExistingDocDialog } = await import("@/core/bind-dialog");
            openBindExistingDocDialog({
                active,
                schema,
                plugin,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onSuccess: async () => {
                    await load();
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    async function adjustRowQty(row: any, fieldKey: string, delta: number) {
        const { quickAdjustRowQty } = await import("@/core/inline-edit");
        await quickAdjustRowQty({ row, fieldKey, delta, ref, active, plugin, showMessageFn: showMessage });
    }

    const filteredRows = $derived.by(() => {
        const q = searchText.trim().toLowerCase();
        let list = rows;
        if (filterMemberId && memberCol) {
            list = list.filter((r) => {
                const bIds = r.cells?.[memberCol]?.relation?.blockIDs;
                return Array.isArray(bIds) && bIds.includes(filterMemberId);
            });
        }
        if (filterCategory && categoryCol) {
            list = list.filter((r) => {
                const c = selectCellContent(r.cells?.[categoryCol]);
                return c === filterCategory;
            });
        }
        if (q) {
            // Search by full pinyin or initials once the dictionary is ready.
            void pyTick;
            list = list.filter((r) => rowMatchesSearch(r, q, ref?.columns));
        }
        const keyID = sortKey ? ref?.columns?.[sortKey] : undefined;
        const keyType = sortKey ? plugin.schemaCatalog?.[active]?.columns?.find((column: any) => column.key === sortKey)?.type : undefined;
        return sortRows(list, keyID, sortAsc, keyType);
    });

    function sortRows(list: any[], keyID?: string, ascending = true, keyType?: string) {
        return sortLedgerRows(list, keyID, ascending, keyType, cellText);
    }
    // 普通台账表格使用完整结果集配合窗口化渲染；车辆卡片保留渐进加载，
    // 以便图片卡片按批次进入 DOM，避免首次进入触发大量资源解码。
    const visibleRows = $derived(active === "vehicles" ? filteredRows.slice(0, renderLimit) : filteredRows);

    function rowMatchesSearch(row: any, q: string, columns?: Record<string, string>) {
        return matchLedgerRowSearch(row, q, columns, cellText);
    }

    // Resolve only enabled modules. A disabled module may still have an old
    // dbRef in settings; exposing that ref here would show stale rows after a
    // settings change and make the empty-state actions misleading.
    const schemaKeys = $derived<string[]>(ref?.columns ? Object.keys(ref.columns) : []);
    const tableKeys = $derived(computeTableKeys(schemaKeys, plugin.schemaCatalog?.[active]?.columns));
    const PINNED_MODULES = ["certs", "medicine", "vehicles", "stock", "shopping", "house", "contracts", "health"];
    const pinnedLedgers = $derived(PINNED_MODULES.filter((id) => ledgers.some((l) => l.id === id)).slice(0, 5));

    function switchLedgerTo(next: string) {
        if (next !== active && newRecordOpen) {
            showMessage(t("ledger.draftModuleSwitchBlocked"), 5000, "info");
            return;
        }
        if (next !== active && plugin.pendingActivityTarget?.moduleId !== next) plugin.pendingActivityTarget = undefined;
        active = next;
        filterMemberId = "";
        filterCategory = "";
        selectedItemIds = [];
        plugin.activeLedger = active;
        searchText = "";
    }

    function getExportContext(): import("@/core/ledger-export").LedgerExportContext {
        return {
            sourceRef: ref,
            moduleId: active,
            searchText,
            sortKey,
            sortAsc,
            schemaCatalog: plugin.schemaCatalog,
            members: plugin.settings.members,
            guestModeActive: Boolean(plugin.runtime?.guestModeActive),
            t,
            showMessageFn: showMessage,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellText,
            rowMatchesSearchFn: rowMatchesSearch,
            sortRowsFn: sortRows,
        };
    }

    // CSV export, archive manifest & QR labels print (326波：解耦至 core/ledger-export.ts)
    async function printLabels() {
        if (!ref?.avId || !ref.docId || printing) return;
        printing = true;
        try {
            const { executeLedgerExportAction } = await import("@/core/ledger-export");
            await executeLedgerExportAction("print", getExportContext());
        } finally {
            printing = false;
        }
    }

    async function runExport(action: "csv" | "archive" | "ics") {
        if (!ref?.columns || filteredRows.length === 0 || exporting) return;
        exporting = true;
        try {
            const { executeLedgerExportAction } = await import("@/core/ledger-export");
            await executeLedgerExportAction(action, getExportContext());
        } finally {
            exporting = false;
        }
    }
    const exportCsv = () => runExport("csv");
    const exportArchiveManifest = () => runExport("archive");
    const exportIcs = () => runExport("ics");

    function getModalContext(): import("@/core/ledger-modals").LedgerModalContext {
        return {
            active,
            ref,
            rows,
            plugin,
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellText,
            selectContentFn: selectCellContent,
            addDetachedRowFn: addDetachedRow,
            setCellFn: setCell,
            cellValueFn: (type: string, val: any) => buildLedgerCellPayload(type, val, plugin.settings.members),
            onOpenNewRecord: openNewRecord,
            onOpenDetail: openDetail,
            onReload: load,
        };
    }

    function handleToolbarModal(action: string) {
        import("@/core/ledger-modals").then((m) => m.dispatchLedgerModal(action, getModalContext()));
    }

    async function rebuildLedger() {
        rebuilding = true;
        try {
            if (typeof plugin.repairModule === "function") {
                await plugin.repairModule(active);
            } else {
                await plugin.adoptHistoryLedgers?.();
                await plugin.ensureCoreLedgers();
                try {
                    await plugin.refreshHub(undefined, true);
                } catch { /* soft */ }
            }
            await load(); // 立即重新拉取当前模块的数据
            showMessage(t("ledger.rebuildDone"), 3000, "info");
        } catch (e) {
            showMessage(t("ledger.rebuildFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
        } finally {
            rebuilding = false;
        }
    }

    async function load() {
        const avID = ref?.avId;
        const request = ++loadRequest;
        loadController?.abort();
        const controller = new AbortController();
        loadController = controller;
        loadError = "";
        rows = [];
        avCols = [];
        if (!avID) {
            if (plugin.pendingActivityTarget?.moduleId === active) {
                plugin.pendingActivityTarget = undefined;
                showMessage(t("activity.navigationUnavailable"), 4000, "error");
            }
            loading = false;
            if (loadController === controller) loadController = undefined;
            return;
        }
        loading = true;
        try {
            // Bound each render request to the kernel page size.
            // 表格永远只显示前 50 行——改用分页聚合的 renderLedgerAll
            const res = await renderLedgerAll(avID, 200, {
                signal: controller.signal,
                latestKey: `ledger:${active}`,
            });
            if (request !== loadRequest || avID !== ref?.avId) return;
            if (!res.complete) {
                loadError = t("ledger.loadIncomplete");
                if (plugin.pendingActivityTarget?.moduleId === active) {
                    plugin.pendingActivityTarget = undefined;
                    showMessage(t("activity.recordNotFound"), 4500, "error");
                }
                return;
            }
            rows = res.rows;
            avCols = res.columns ?? [];
            const pendingTarget = plugin.pendingActivityTarget;
            if (pendingTarget && pendingTarget.moduleId === active) {
                const targetRow = rows.find((row) => row.itemID === pendingTarget.rowId);
                requestAnimationFrame(() => {
                    if (plugin.pendingActivityTarget?.requestId !== pendingTarget.requestId) return;
                    plugin.pendingActivityTarget = undefined;
                    if (!targetRow) {
                        showMessage(t("activity.recordNotFound"), 4500, "error");
                        return;
                    }
                    if (active !== pendingTarget.moduleId) return;
                    openDetail(targetRow, undefined, pendingTarget);
                });
            }
        } catch (e) {
            if (controller.signal.aborted || (e instanceof Error && (e.name === "RequestSupersededError" || e.name === "RequestAbortedError"))) return;
            if (request === loadRequest && avID === ref?.avId) {
                loadError = t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
                if (plugin.pendingActivityTarget?.moduleId === active) {
                    plugin.pendingActivityTarget = undefined;
                    showMessage(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                }
            }
        } finally {
            if (request === loadRequest) {
                loadController = undefined;
                loading = false;
            }
        }
    }
    $effect(() => { void version; void active; void plugin.scan?.scannedAt; load(); });
    $effect(() => {
        const handler = () => void handleToolbarModal("location-index");
        window.addEventListener("siyuan-home:open-location", handler);
        return () => window.removeEventListener("siyuan-home:open-location", handler);
    });

    const missingSchemaCols = $derived(computeMissingSchemaColumns(ref?.columns, avCols, plugin.schemaCatalog?.[active]?.columns));

    let recordModalRef: any;
    let newRecordOpen = $state(false);
    let savedDocId = $state("");
    let savedRecordName = $state("");
    let savedModule = $state("");

    const fieldLabel = (key: string): string => t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key;

    function openNewRecord(initialForm?: Record<string, any>) {
        recordModalRef?.openNewRecordModal(initialForm);
    }

    /** Format a cell for both the table and the detail drawer. */
    function cellText(v: any, colKey?: string, revealSensitive = false): string {
        return formatLedgerCellText(v, colKey, t, Boolean(plugin.runtime?.guestModeActive), revealSensitive);
    }

    // Warning thresholds follow each module's reminder lead time.
    const warnDays = $derived.by(() => {
        void version;
        return computeModuleWarnDays(plugin.schemaCatalog?.[active]?.reminders, plugin.settings.leadOverrides, active);
    });
    const ledgerTone = (r: any): LedgerTone => calculateLedgerTone(r, ref?.columns, warnDays);

    // Row click opens a detail drawer; user content is assigned through DOM APIs (327波抽离减负).
    async function openDetail(row: any, vehicleAction?: "fuel" | "charging" | "maintenance" | "edit", activityTarget?: ActivityTarget) {
        if (!ref?.columns) return;
        const { openLedgerDetailDrawer } = await import("@/core/ledger-detail-drawer");
        await openLedgerDetailDrawer({
            row,
            vehicleAction,
            activityTarget,
            ref: ref!,
            active,
            plugin,
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellText,
            avCols,
            openNewRecordFn: openNewRecord,
            onReload: load,
        });
    }

</script>

<LedgerToolbar
    {plugin}
    bind:active
    {ledgers}
    {groupedLedgers}
    {pinnedLedgers}
    {ref}
    {rebuilding}
    filteredRowsCount={filteredRows.length}
    filteredRowsEmpty={filteredRows.length === 0}
    bind:searchText
    bind:tableDensity
    {memberCol}
    bind:filterMemberId
    {categoryCol}
    {availableCategories}
    bind:filterCategory
    {exporting}
    {printing}
    {t}
    onSwitchLedger={switchLedgerTo}
    onOpenNewRecord={openNewRecord}
    onToggleDensity={toggleDensity}
    onSearchInput={(val) => { panelMemory.ledgerSearch = val; }}
    onSearchClear={() => { panelMemory.ledgerSearch = ""; }}
    onRebuildLedger={rebuildLedger}
    onExportCsv={exportCsv}
    onExportIcs={exportIcs}
    onExportArchiveManifest={exportArchiveManifest}
    onPrintLabels={printLabels}
    onOpenModal={handleToolbarModal}
/>
{#if savedModule}
    <div class="lv-record-save-status" role="status">
        {t("ledger.newRecordSaved").replace("${name}", savedRecordName)} · {t("ledger.savedTo").replace("${module}", t(`module.${savedModule}`) !== `module.${savedModule}` ? t(`module.${savedModule}`) : savedModule)}
        <button class="b3-button b3-button--text" onclick={() => plugin.showTabDocs(savedDocId || undefined)}>{t("ledger.openDoc")} →</button>
    </div>
{/if}

<LedgerRecordModal
    bind:this={recordModalRef}
    bind:open={newRecordOpen}
    {plugin}
    {active}
    {ref}
    {rows}
    {avCols}
    {dynamicLocations}
    {columnSuggestions}
    {currentLedgerTemplates}
    {t}
    onRecordSaved={async ({ docId, name, module }) => {
        savedRecordName = name;
        savedDocId = docId ?? "";
        savedModule = module;
        setTimeout(() => { savedModule = ""; }, 8000);
        await load();
        try { await plugin.refreshHub([active]); } catch { /* soft */ }
    }}
/>

{#if loading || loadError || filteredRows.length === 0}
    <LedgerEmptyState
        {loading}
        {loadError}
        {ledgers}
        {ref}
        {rows}
        {active}
        {searchText}
        {rebuilding}
        {t}
        onLoad={() => void load()}
        onOpenSettings={() => plugin.openSetting()}
        onRebuildLedger={rebuildLedger}
        onOpenBindDoc={openBindExistingDocModal}
        onOpenNewRecord={openNewRecord}
        onClearSearch={() => { searchText = ""; panelMemory.ledgerSearch = ""; }}
        onImportCsv={() => handleToolbarModal("csv-import")}
    />
{:else if active === "vehicles"}
    <LedgerVehicleGrid
        {visibleRows}
        {filteredRows}
        bind:renderLimit
        {RENDER_PAGE}
        {ref}
        {avCols}
        {t}
        {ledgerTone}
        {toneCls}
        {cellText}
        onOpenDetail={openDetail}
    />
{:else}
    {#if missingSchemaCols.length > 0 && ref?.avId}
        <div class="lv-card" style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--lv-amber-soft);border:1px solid var(--lv-accent-line);border-radius:var(--lv-r-2);margin:8px 0;font-size:12px">
            <span style="color:var(--lv-amber)">⚠️</span>
            <span style="color:var(--lv-tx-2);flex:1">
                {t("ledger.missingColumnsPrompt")} <b>{missingSchemaCols.map((c) => fieldLabel(c.key)).join("、")}</b>
            </span>
            <button class="b3-button b3-button--outline" style="font-size:11.5px;padding:2px 8px" disabled={rebuilding} onclick={rebuildLedger}>
                {rebuilding ? t("diag.rebuilding") : t("ledger.autoFixColumns")}
            </button>
        </div>
    {/if}
    <LedgerTable
        {tableDensity}
        {tableKeys}
        {visibleRows}
        {filteredRows}
        {ref}
        {sortKey}
        {sortAsc}
        bind:selectedItemIds
        {t}
        {fieldLabel}
        {cellText}
        {ledgerTone}
        {toneCls}
        {toneColor}
        onToggleSort={toggleSort}
        onOpenDetail={openDetail}
        onAdjustQty={adjustRowQty}
        onLoadMore={() => (renderLimit += RENDER_PAGE)}
    />
    <LedgerBatchBar
        {plugin}
        {active}
        {ref}
        bind:selectedItemIds
        {rows}
        {dynamicLocations}
        {memberCol}
        {t}
        onReload={load}
    />
{/if}