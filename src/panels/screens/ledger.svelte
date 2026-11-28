<script lang="ts">
    import { renderLedgerAll, addDetachedRow, setCell } from "@/core/siyuan";
    import { selectCellContent } from "@/core/avcell";
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
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
    import { createNonDestructiveTypedColumn } from "@/core/provision-common";
    import type { SchemaColumnIssue } from "@/types";
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
        buildDuplicateRowValues,
        type LedgerTone,
    } from "@/core/ledger-view-model";
    import { onDestroy, untrack } from "svelte";
    import { panelSession, type TableDensity } from "../panel-session";
    import { getGroupedModules } from "@/core/modules";
    import { resolvePinnedLedgers } from "@/core/navigation-prefs";
    import { createDefaultGuestConfig, filterGuestVisibleModules } from "@/core/guest-mode";
    import { getQuickTemplates } from "@/core/quick-templates";

    let { plugin, t, version, activeLedger: propActiveLedger, onActiveLedgerChange }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        version?: number;
        activeLedger?: string;
        onActiveLedgerChange?: (moduleId: string) => void;
    } = $props();
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
    let active = $state(propActiveLedger ?? plugin.activeLedger ?? "certs");
    // svelte-ignore state_referenced_locally
    let lastPropActiveLedger = propActiveLedger;
    // svelte-ignore state_referenced_locally
    let lastPluginActiveLedger = plugin.activeLedger;
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
            lastPluginActiveLedger = active;
            onActiveLedgerChange?.(active);
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

    const ref = $derived.by(() => {
        void version;
        return plugin.settings?.dbRefs?.[active] ?? ledgers.find((entry) => entry.id === active)?.ref;
    });

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
    let filterStatus = $state<"all" | "soon" | "ok">("all");
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
        if (filterStatus !== "all") {
            list = list.filter((r) => {
                const tone = calculateLedgerTone(r, ref?.columns, warnDays);
                const isSoon = tone === "warn" || tone === "danger";
                return filterStatus === "soon" ? isSoon : !isSoon;
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

    // 筛选/搜索/重载后同步按当前可见结果集裁剪已勾选 ID，杜绝隐藏行被批量误删
    $effect(() => {
        const visibleIds = new Set(filteredRows.map((r) => r.itemID));
        untrack(() => {
            if (selectedItemIds.length === 0) return;
            const pruned = selectedItemIds.filter((id) => visibleIds.has(id));
            if (pruned.length !== selectedItemIds.length) {
                selectedItemIds = pruned;
            }
        });
    });

    function rowMatchesSearch(row: any, q: string, columns?: Record<string, string>) {
        return matchLedgerRowSearch(row, q, columns, cellText);
    }

    // Resolve only enabled modules. A disabled module may still have an old
    // dbRef in settings; exposing that ref here would show stale rows after a
    // settings change and make the empty-state actions misleading.
    let colVisTick = $state(0);
    const schemaKeys = $derived<string[]>(ref?.columns ? Object.keys(ref.columns) : []);
    const defaultTableKeys = $derived(computeTableKeys(schemaKeys, plugin.schemaCatalog?.[active]?.columns));
    const tableKeys = $derived.by(() => {
        void version;
        void colVisTick;
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
        colVisTick += 1;
        await saveSettings(plugin, plugin.settings);
    }

    async function handleResetColumns() {
        if (plugin.settings?.columnVisibility?.[active]) {
            delete plugin.settings.columnVisibility[active];
            colVisTick += 1;
            await saveSettings(plugin, plugin.settings);
            showMessage(t("ledger.columnResetSuccess"), 2000, "info");
        }
    }

    const pinnedLedgers = $derived.by(() => {
        void version;
        return resolvePinnedLedgers(plugin.settings, ledgers.map((l) => l.id)).slice(0, 5);
    });

    function switchLedgerTo(next: string, notifyHost = true) {
        if (next !== active && newRecordOpen) {
            showMessage(t("ledger.draftModuleSwitchBlocked"), 5000, "info");
            return;
        }
        if (next !== active && plugin.pendingActivityTarget?.moduleId !== next) plugin.pendingActivityTarget = undefined;
        active = next;
        filterMemberId = "";
        filterCategory = "";
        filterStatus = "all";
        selectedItemIds = [];
        plugin.activeLedger = active;
        lastPluginActiveLedger = active;
        searchText = "";
        if (notifyHost) {
            onActiveLedgerChange?.(active);
            plugin.emitHubChanged?.();
        }
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
            let provisionErr = "";
            if (typeof plugin.repairModule === "function") {
                const res = await plugin.repairModule(active);
                provisionErr = res?.dbRef?.provisionError || plugin.settings?.dbRefs?.[active]?.provisionError || "";
            } else {
                await plugin.adoptHistoryLedgers?.();
                const report = await plugin.ensureCoreLedgers();
                const modIssue = report?.issues?.find?.((it: any) => it.moduleId === active);
                provisionErr = modIssue?.message || plugin.settings?.dbRefs?.[active]?.provisionError || "";
                try {
                    await plugin.refreshHub(undefined, true);
                } catch { /* soft */ }
            }
            await load(); // 立即重新拉取当前模块的数据
            if (provisionErr) {
                showMessage(t("ledger.rebuildFailed").replace("${msg}", provisionErr), 6000, "error");
            } else {
                showMessage(t("ledger.rebuildDone"), 3000, "info");
            }
        } catch (e) {
            showMessage(t("ledger.rebuildFailed").replace("${msg}", errText(e)), 6000, "error");
        } finally {
            rebuilding = false;
        }
    }

    async function load(isModuleSwitch = false) {
        const avID = ref?.avId ?? plugin.settings?.dbRefs?.[active]?.avId;
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
            if (request !== loadRequest) return;
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
        const propChanged = propActiveLedger !== lastPropActiveLedger;
        const pluginChanged = plugin.activeLedger !== lastPluginActiveLedger;
        if (propChanged && !propActiveLedger) lastPropActiveLedger = propActiveLedger;
        if (pluginChanged && !plugin.activeLedger) lastPluginActiveLedger = plugin.activeLedger;
        const externalTarget = propChanged && propActiveLedger
            ? propActiveLedger
            : (pluginChanged && plugin.activeLedger ? plugin.activeLedger : undefined);
        if (externalTarget && ledgers.some((entry) => entry.id === externalTarget)) {
            if (propChanged) lastPropActiveLedger = propActiveLedger;
            if (pluginChanged) lastPluginActiveLedger = plugin.activeLedger;
            if (externalTarget !== active) {
                untrack(() => switchLedgerTo(externalTarget, false));
            }
        }
    });
    $effect(() => {
        void version;
        void plugin.scan?.scannedAt;
        void ref?.avId;
        void plugin.pendingActivityTarget?.requestId;
        const currentActive = active;
        const isSwitch = currentActive !== lastLoadedActive;
        lastLoadedActive = currentActive;
        // 严禁在 $effect 同步帧内直接追踪 load() 内部的 rows/loading 读写，
        // 否则切换到空台账或未建库模块时 rows=[] 写回会触发 effect_update_depth_exceeded 崩溃！
        untrack(() => {
            void load(isSwitch);
        });
    });

    const missingSchemaCols = $derived(computeMissingSchemaColumns(ref?.columns, avCols, plugin.schemaCatalog?.[active]?.columns));
    const schemaIssues = $derived.by(() => {
        void version;
        return (ref?.schemaIssues ?? []).filter((issue: SchemaColumnIssue) => !issue?.moduleId || issue.moduleId === active);
    });
    let fixingIssueKey = $state("");

    async function handleFixSchemaIssue(issue: SchemaColumnIssue) {
        if (isGuestMode) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        if (!ref?.avId || fixingIssueKey) return;
        const schemaCol = plugin.schemaCatalog?.[active]?.columns?.find((c: any) => c.key === issue.colKey);
        if (!schemaCol) {
            showMessage(issue.guidance || t("ledger.rebuildFailed").replace("${msg}", issue.colKey), 5000, "error");
            return;
        }
        fixingIssueKey = issue.colKey;
        try {
            const res = await createNonDestructiveTypedColumn({
                avId: ref.avId,
                moduleId: active,
                schemaCol,
                ref: ref as any,
                memberAvId: plugin.settings?.dbRefs?.members?.avId,
                resolveName: fieldLabel,
            });
            await saveSettings(plugin, plugin.settings);
            showMessage(res.guidance, 5000, "info");
            await load();
            try { await plugin.refreshHub?.([active], true); } catch { /* soft */ }
        } catch (e) {
            showMessage(t("ledger.rebuildFailed").replace("${msg}", errText(e)), 5000, "error");
        } finally {
            fixingIssueKey = "";
        }
    }

    let recordModalRef: any;
    let newRecordOpen = $state(false);
    let savedDocId = $state("");
    let savedRecordName = $state("");
    let savedModule = $state("");

    const fieldLabel = (key: string): string => t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key;

    async function openNewRecord(initialForm?: Record<string, any>) {
        if (!ref?.avId && typeof plugin.repairModule === "function") {
            try {
                await plugin.repairModule(active);
                await load();
            } catch { /* soft */ }
        }
        recordModalRef?.openNewRecordModal(initialForm);
    }

    function handleDuplicateRow(r: any) {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const nameCol = ref?.columns?.name;
        const rowName = (nameCol && cellText(r.cells?.[nameCol])) || "";
        const schemaCols = plugin.schemaCatalog?.[active]?.columns ?? [];
        const copiedValues = buildDuplicateRowValues({
            row: r,
            columns: ref?.columns,
            schemaCols,
            cellTextFn: cellText,
        });
        openNewRecord(copiedValues);
        showMessage(t("ledger.duplicateSuccess").replace("${name}", copiedValues.name || rowName), 3000, "info");
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
                const { removeLedgerRows } = await import("@/core/siyuan");
                const { cleanupRowRuntimeData } = await import("@/core/hub/runtime");
                const { withRuntime } = await import("@/core/hub/actions");
                const { updateRowLogs, removeRowLog } = await import("@/core/rowlog");
                await removeLedgerRows(ref!.avId!, [r.itemID], {
                    idempotencyKey: `ledger:delete:${ref!.avId!}:${r.itemID}:${Date.now()}`,
                    retries: 1,
                });
                const rowSnapshot = JSON.parse(JSON.stringify(r));
                await withRuntime(plugin as any, (rt) => {
                    const trashList = rt.trash ?? [];
                    trashList.unshift({
                        id: r.itemID,
                        moduleId: active,
                        title: rowTitle,
                        deletedAt: new Date().toISOString(),
                        rowSnapshot,
                    });
                    if (trashList.length > 200) trashList.length = 200;
                    rt.trash = trashList;
                    cleanupRowRuntimeData(rt, r.itemID);
                });
                await updateRowLogs(plugin, (logs) => removeRowLog(logs, ref!.avId!, r.itemID)).catch(() => undefined);
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
            rows,
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
    bind:filterStatus
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
    onRecordSaved={async ({ docId, name, module, discarded }) => {
        if (!discarded) {
            savedRecordName = name;
            savedDocId = docId ?? "";
            savedModule = module;
            if (savedDismissTimer) clearTimeout(savedDismissTimer);
            savedDismissTimer = setTimeout(() => { savedModule = ""; }, 8000);
        }
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
    {#if schemaIssues.length > 0 && ref?.avId}
        <LedgerMissingColsBanner
            missingSchemaCols={[]}
            {schemaIssues}
            {rebuilding}
            {fixingIssueKey}
            {t}
            {fieldLabel}
            onRebuild={rebuildLedger}
            onFixSchemaIssue={handleFixSchemaIssue}
        />
    {/if}
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
    {#if (missingSchemaCols.length > 0 || schemaIssues.length > 0) && ref?.avId}
        <LedgerMissingColsBanner
            {missingSchemaCols}
            {schemaIssues}
            {rebuilding}
            {fixingIssueKey}
            {t}
            {fieldLabel}
            onRebuild={rebuildLedger}
            onFixSchemaIssue={handleFixSchemaIssue}
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
        {filteredRows}
        {dynamicLocations}
        {memberCol}
        {cellText}
        {t}
        onReload={load}
    />
{/if}