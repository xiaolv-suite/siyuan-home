<script lang="ts">
    import { renderLedgerAll, addDetachedRow, setCell } from "@/core/siyuan";
    import { selectCellContent } from "@/core/avcell";
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { localDateKey, parseDate } from "@/core/hub/rule";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveSettings } from "@/core/settings";
    import { ensurePinyin, pinyinReady } from "@/core/pinyin";
    import type { ActivityTarget } from "@/core/activity";
    import LedgerRecordModal from "./ledger-record-modal.svelte";
    import LedgerToolbar from "./ledger-toolbar.svelte";
    import LedgerBatchBar from "./ledger-batch-bar.svelte";
    import LedgerVehicleGrid from "./ledger-vehicle-grid.svelte";
    import LedgerTable from "./ledger-table.svelte";
    import LedgerEmptyState from "./ledger-empty-state.svelte";
    import LedgerSaveStatus from "./ledger-save-status.svelte";
    import LedgerMissingColsBanner from "./ledger-missing-cols-banner.svelte";
    import { fetchLedgerDataset } from "@/core/ledger-data-loader";
    import { executeLedgerExportAction } from "@/core/ledger-export";
    import { dispatchLedgerModal } from "@/core/ledger-modals";
    import { openLedgerDetailDrawer } from "@/core/ledger-detail-drawer";
    import { openBindExistingDocDialog } from "@/core/bind-dialog";
    import { quickAdjustRowQty } from "@/core/inline-edit";
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
    import { onDestroy, untrack } from "svelte";
    import { panelSession, type TableDensity } from "../panel-session";
    import { getGroupedModules } from "@/core/modules";
    import { createDefaultGuestConfig, filterGuestVisibleModules } from "@/core/guest-mode";
    import { getQuickTemplates } from "@/core/quick-templates";

    let { plugin, t, version }: { plugin: HomePluginLike; t: (k: string) => string; version?: number } = $props();
    const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

    // Ledger module selector includes provisioned and enabled-but-unprovisioned modules.
    // 263 波（262 波同款缺陷类）：enabledModules 无响应性——设置保存新启用模块后，
    // 已挂载台账页的下拉不出现新模块；version 驱动重算修复
    const ledgers = $derived.by(() => {
        void version;
        const raw = (plugin.settings.enabledModules ?? []).filter((id: string) => id !== "members");
        const visible = plugin.runtime?.guestModeActive
            ? filterGuestVisibleModules(raw, createDefaultGuestConfig(true))
            : raw;
        return visible.map((id: string) => ({ id, ref: plugin.settings.dbRefs[id] }));
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
    let savedDismissTimer: ReturnType<typeof setTimeout> | undefined;
    onDestroy(() => {
        loadRequest++;
        loadController?.abort();
        loadController = undefined;
        if (savedDismissTimer) clearTimeout(savedDismissTimer);
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
    // POOL-FEAT-11 / CAND-13：台账模块独立排序列与正反序偏好记忆（持久化至 settings.ledgerSort[active]）
    let sortKey = $state<string>("");
    let sortAsc = $state<boolean>(true);

    const ref = $derived(ledgers.find((entry) => entry.id === active)?.ref);

    $effect(() => {
        const saved = plugin.settings?.ledgerSort?.[active];
        if (saved && saved.key && (!ref?.columns || ref.columns[saved.key])) {
            sortKey = saved.key;
            sortAsc = saved.asc;
        } else if (!saved) {
            sortKey = "";
            sortAsc = true;
        }
    });

    async function toggleSort(k: string) {
        const previousKey = sortKey;
        const previousAsc = sortAsc;
        if (sortKey === k) sortAsc = !sortAsc;
        else { sortKey = k; sortAsc = true; }

        if (!plugin.settings) return;
        if (!plugin.settings.ledgerSort) plugin.settings.ledgerSort = {};
        plugin.settings.ledgerSort[active] = { key: sortKey, asc: sortAsc };

        try {
            await saveSettings(plugin, plugin.settings);
        } catch (e) {
            sortKey = previousKey;
            sortAsc = previousAsc;
            showMessage(t("ledger.sortSaveFailed").replace("${msg}", errText(e)), 5000, "error");
        }
    }
    // svelte-ignore state_referenced_locally
    const session = panelSession(plugin);
    let filterMemberId = $state(session.ledgerFilterMemberId ?? "");
    let filterCategory = $state(session.ledgerFilterCategory ?? "");
    let selectedItemIds = $state<string[]>([]);

    $effect(() => {
        session.ledgerFilterMemberId = filterMemberId;
        session.ledgerFilterCategory = filterCategory;
    });

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
            openBindExistingDocDialog({
                active,
                schema,
                plugin,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onSuccess: async () => { await load(); },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    const adjustRowQty = (row: any, fieldKey: string, delta: number) =>
        quickAdjustRowQty({ row, fieldKey, delta, ref, active, plugin, showMessageFn: showMessage });

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
    const defaultTableKeys = $derived(computeTableKeys(schemaKeys, plugin.schemaCatalog?.[active]?.columns));
    const tableKeys = $derived.by(() => {
        const custom = plugin.settings?.columnVisibility?.[active];
        if (Array.isArray(custom) && custom.length > 0) {
            const filtered = custom.filter((k) => schemaKeys.includes(k));
            if (filtered.length > 0) return filtered;
        }
        return defaultTableKeys;
    });

    async function handleToggleColumn(k: string) {
        if (!plugin.settings) return;
        if (!plugin.settings.columnVisibility) plugin.settings.columnVisibility = {};
        const current = [...tableKeys];
        let next: string[];
        if (current.includes(k)) {
            if (current.length <= 1) {
                showMessage(t("ledger.atLeastOneCol"), 3000, "info");
                return;
            }
            next = current.filter((x) => x !== k);
        } else {
            next = [...current, k];
        }
        plugin.settings.columnVisibility[active] = next;
        await saveSettings(plugin, plugin.settings);
    }

    async function handleResetColumns() {
        if (plugin.settings?.columnVisibility?.[active]) {
            delete plugin.settings.columnVisibility[active];
            await saveSettings(plugin, plugin.settings);
            showMessage(t("ledger.columnResetSuccess"), 2000, "info");
        }
    }

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

    async function runExport(action: "csv" | "archive" | "print" | "ics") {
        if (!ref?.columns || exporting || printing) return;
        if (action === "print") {
            if (!ref.avId || !ref.docId) return;
            printing = true;
        } else {
            if (filteredRows.length === 0) return;
            exporting = true;
        }
        try {
            await executeLedgerExportAction(action, {
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
            });
        } finally {
            exporting = false;
            printing = false;
        }
    }

    const handleToolbarModal = (action: string) =>
        dispatchLedgerModal(action, {
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
        });

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
            showMessage(t("ledger.rebuildFailed").replace("${msg}", errText(e)), 6000, "error");
        } finally {
            rebuilding = false;
        }
    }

    async function load(isModuleSwitch = false) {
        const avID = ref?.avId;
        const request = ++loadRequest;
        loadController?.abort();
        const controller = new AbortController();
        loadController = controller;
        loadError = "";
        if (isModuleSwitch) {
            rows = [];
            avCols = [];
            loading = true;
        } else if (rows.length === 0) {
            loading = true;
        }
        try {
            const res = await fetchLedgerDataset({
                avId: avID,
                moduleId: active,
                signal: controller.signal,
                pendingTarget: plugin.pendingActivityTarget,
                t,
                onTargetResolved: (targetRow, target) => {
                    plugin.pendingActivityTarget = undefined;
                    if (targetRow) openDetail(targetRow, undefined, target);
                    else showMessage(t("activity.recordNotFound"), 4500, "error");
                },
                onNavigationError: () => {
                    plugin.pendingActivityTarget = undefined;
                    showMessage(t("activity.navigationUnavailable"), 4000, "error");
                },
            });
            if (request !== loadRequest || avID !== ref?.avId) return;
            rows = res.rows;
            avCols = res.columns;
            if (res.error) {
                loadError = res.error;
                if (plugin.pendingActivityTarget?.moduleId === active) {
                    plugin.pendingActivityTarget = undefined;
                    showMessage(t("activity.recordNotFound"), 4500, "error");
                }
            }
        } catch (e) {
            if (controller.signal.aborted || (e instanceof Error && (e.name === "RequestSupersededError" || e.name === "RequestAbortedError"))) return;
            if (request === loadRequest && avID === ref?.avId) {
                loadError = t("ledger.readFailed").replace("${msg}", errText(e));
                if (plugin.pendingActivityTarget?.moduleId === active) {
                    plugin.pendingActivityTarget = undefined;
                    showMessage(t("ledger.readFailed").replace("${msg}", errText(e)), 6000, "error");
                }
            }
        } finally {
            if (request === loadRequest) {
                loadController = undefined;
                loading = false;
            }
        }
    }
    let lastLoadedActive = "";
    $effect(() => {
        void version;
        void plugin.scan?.scannedAt;
        void ref?.avId;
        const currentActive = active;
        const isSwitch = currentActive !== lastLoadedActive;
        lastLoadedActive = currentActive;
        // 严禁在 $effect 同步帧内直接追踪 load() 内部的 rows/loading 读写，
        // 否则切换到空台账或未建库模块时 rows=[] 写回会触发 effect_update_depth_exceeded 崩溃！
        untrack(() => {
            void load(isSwitch);
        });
    });
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

    function handleDuplicateRow(r: any) {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const nameCol = ref?.columns?.name;
        const rowName = (nameCol && cellText(r.cells?.[nameCol])) || "";
        const cloneName = rowName ? `${rowName} (副本)` : "";
        const copiedValues: Record<string, any> = { name: cloneName };
        const schemaCols = plugin.schemaCatalog?.[active]?.columns ?? [];
        for (const col of schemaCols) {
            if (col.key === "name" || ["asset", "mAsset"].includes(col.type)) continue;
            const keyID = ref?.columns?.[col.key];
            const v = keyID ? r.cells?.[keyID] : undefined;
            if (v) {
                if (col.type === "select") copiedValues[col.key] = selectCellContent(v);
                else if (col.type === "number") {
                    const raw = v.number?.content ?? v.content ?? v;
                    const num = Number(raw);
                    copiedValues[col.key] = Number.isFinite(num) ? num : undefined;
                } else if (col.type === "date") {
                    const raw = v.date?.content ?? v.content;
                    if (typeof raw === "number") copiedValues[col.key] = localDateKey(new Date(raw));
                    else if (typeof raw === "string" && raw.trim()) {
                        const parsed = parseDate(raw.trim());
                        copiedValues[col.key] = parsed ? localDateKey(parsed) : raw.trim();
                    }
                } else if (col.type === "checkbox") {
                    copiedValues[col.key] = v.checkbox?.checked ?? v.checked;
                } else if (col.type === "relation") {
                    copiedValues[col.key] = selectCellContent(v) || cellText(v, col.key);
                } else {
                    copiedValues[col.key] = cellText(v, col.key);
                }
            }
        }
        openNewRecord(copiedValues);
        showMessage(t("ledger.duplicateSuccess").replace("${name}", cloneName || rowName), 3000, "info");
    }

    async function handleCopyRowMarkdown(r: any) {
        const cols = (plugin.schemaCatalog?.[active]?.columns ?? []).filter((c: any) => ref?.columns?.[c.key]);
        const headers = cols.map((c: any) => t(`field.${c.key}`) !== `field.${c.key}` ? t(`field.${c.key}`) : c.key);
        const values = cols.map((c: any) => cellText(r.cells?.[ref?.columns?.[c.key]], c.key));
        const md = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n| ${values.join(" | ")} |`;
        try {
            await navigator.clipboard.writeText(md);
            showMessage(t("ledger.copyMarkdownOk"), 2500, "info");
        } catch {
            showMessage(t("ledger.copyAsImageFail"), 4000, "error");
        }
    }

    function handleDeleteRow(r: any) {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        const nameCol = ref?.columns?.name;
        const rowTitle = (nameCol && cellText(r.cells?.[nameCol])) || t("ledger.detail");
        confirm(t("ledger.delTitle"), t("ledger.delBody").replace("${name}", rowTitle), async () => {
            try {
                if (plugin.runtime) {
                    const trashList = plugin.runtime.trash ?? [];
                    trashList.unshift({
                        id: r.itemID,
                        moduleId: active,
                        title: rowTitle,
                        deletedAt: new Date().toISOString(),
                        rowSnapshot: JSON.parse(JSON.stringify(r)),
                    });
                    if (trashList.length > 50) trashList.length = 50;
                    plugin.runtime.trash = trashList;
                }
                const { removeLedgerRows } = await import("@/core/siyuan");
                const { cleanupRowRuntimeData, saveRuntime } = await import("@/core/hub/runtime");
                await removeLedgerRows(ref!.avId!, [r.itemID], {
                    idempotencyKey: `ledger:delete:${ref!.avId!}:${r.itemID}`,
                    retries: 1,
                });
                cleanupRowRuntimeData(plugin.runtime, r.itemID);
                await saveRuntime(plugin, plugin.runtime);
                showMessage(t("ledger.delDone"), 2500, "info");
                await load();
                try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
            } catch (e) {
                showMessage(t("ledger.delFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
            }
        });
    }

    const isGuestMode = $derived.by(() => {
        void version;
        return Boolean(plugin.runtime?.guestModeActive);
    });

    /** Format a cell for both the table and the detail drawer. */
    function cellText(v: any, colKey?: string, revealSensitive = false): string {
        return formatLedgerCellText(v, colKey, t, isGuestMode, revealSensitive, plugin.settings.members);
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
    {schemaKeys}
    {tableKeys}
    {fieldLabel}
    {t}
    onSwitchLedger={switchLedgerTo}
    onOpenNewRecord={openNewRecord}
    onToggleDensity={toggleDensity}
    onToggleColumn={handleToggleColumn}
    onResetColumns={handleResetColumns}
    onSearchInput={(val) => { panelMemory.ledgerSearch = val; }}
    onSearchClear={() => { panelMemory.ledgerSearch = ""; }}
    onRebuildLedger={rebuildLedger}
    onExportCsv={() => runExport("csv")}
    onExportIcs={() => runExport("ics")}
    onExportArchiveManifest={() => runExport("archive")}
    onPrintLabels={() => runExport("print")}
    onOpenModal={handleToolbarModal}
/>
{#if savedModule}
    <LedgerSaveStatus
        {savedRecordName}
        {savedModule}
        {savedDocId}
        {t}
        onOpenDoc={(id) => plugin.showTabDocs(id)}
    />
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
        if (savedDismissTimer) clearTimeout(savedDismissTimer);
        savedDismissTimer = setTimeout(() => { savedModule = ""; }, 8000);
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
        <LedgerMissingColsBanner
            {missingSchemaCols}
            {rebuilding}
            {t}
            {fieldLabel}
            onRebuild={rebuildLedger}
        />
    {/if}
    <LedgerTable
        {tableDensity}
        {tableKeys}
        {visibleRows}
        {filteredRows}
        {ref}
        activeModuleId={active}
        {sortKey}
        {sortAsc}
        bind:selectedItemIds
        {t}
        {fieldLabel}
        {cellText}
        {ledgerTone}
        {toneCls}
        {toneColor}
        {plugin}
        onToggleSort={toggleSort}
        onOpenDetail={openDetail}
        onAdjustQty={adjustRowQty}
        onDuplicateRow={handleDuplicateRow}
        onDeleteRow={handleDeleteRow}
        onCopyRowMarkdown={handleCopyRowMarkdown}
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
        {cellText}
        {t}
        onReload={load}
    />
{/if}