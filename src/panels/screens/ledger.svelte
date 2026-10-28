<script lang="ts">
    import { renderLedgerAll, addDetachedRow, setCell } from "@/core/siyuan";
    import { optLabel, optLabelText } from "@/core/format";
    import { maskCredentialNumber, maskIdNumber } from "@/core/idcard";
    import { selectCellValue, selectCellContent, cellContentText } from "@/core/avcell";
    import { localDateKey } from "@/core/hub/rule";
    import { showMessage, Dialog } from "siyuan";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { ensurePinyin, pinyinReady, searchMatch } from "@/core/pinyin";
    import type { ColumnDef } from "@/core/schema";
    import type { ActivityTarget } from "@/core/activity";
    import LedgerRecordModal from "./ledger-record-modal.svelte";
    import LedgerToolbar from "./ledger-toolbar.svelte";
    import LedgerBatchBar from "./ledger-batch-bar.svelte";
    import LedgerVehicleGrid from "./ledger-vehicle-grid.svelte";
    import LedgerTable from "./ledger-table.svelte";
    import { onDestroy } from "svelte";
    import UiIcon from "@/ui/icon.svelte";
    import { panelSession, type TableDensity } from "../panel-session";
    import { maskValueForGuest, createDefaultGuestConfig } from "@/core/guest-mode";
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

    const columnSuggestions = $derived.by(() => {
        const map: Record<string, string[]> = {};
        if (!ref?.columns) return map;
        for (const [colKey, colId] of Object.entries(ref.columns)) {
            if (["name", "location", "store_place", "copy_location", "brand_model", "channel", "hospital", "doctor", "party", "unit"].includes(colKey)) {
                const valuesSet = new Set<string>();
                for (const r of rows) {
                    const txt = String(cellText(r.cells?.[colId], colKey) ?? "").trim();
                    if (txt && txt !== "—" && txt.length <= 40) {
                        valuesSet.add(txt);
                    }
                }
                if (valuesSet.size > 0) {
                    map[colKey] = Array.from(valuesSet).slice(0, 15);
                }
            }
        }
        return map;
    });

    const dynamicLocations = $derived.by(() => {
        const set = new Set<string>();
        for (const l of ["主卧抽屉", "客厅药箱", "玄关柜", "书房书架", "储藏室", "冰箱冷藏", "厨房吊柜"]) {
            set.add(l);
        }
        const locCols = [ref?.columns?.location, ref?.columns?.store_place, ref?.columns?.copy_location].filter(Boolean);
        for (const colId of locCols) {
            for (const r of rows) {
                const txt = String(cellText(r.cells?.[colId as string]) ?? "").trim();
                if (txt && txt !== "—" && txt.length <= 20) {
                    set.add(txt);
                }
            }
        }
        return Array.from(set).slice(0, 12);
    });

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
        if (!keyID) return list;
        return [...list].sort((a, b) => {
            const av = cellText(a.cells?.[keyID]);
            const bv = cellText(b.cells?.[keyID]);
            const an = Number(av);
            const bn = Number(bv);
            // Only numeric schema columns use numeric comparison. Date strings
            // such as 2026-10-11 must compare as dates, not as the year 2026.
            const cmp = keyType === "number" && Number.isFinite(an) && Number.isFinite(bn) && av !== "—" && bv !== "—"
                ? an - bn
                : av.localeCompare(bv, undefined, { numeric: true });
            return ascending ? cmp : -cmp;
        });
    }
    // 普通台账表格使用完整结果集配合窗口化渲染；车辆卡片保留渐进加载，
    // 以便图片卡片按批次进入 DOM，避免首次进入触发大量资源解码。
    const visibleRows = $derived(active === "vehicles" ? filteredRows.slice(0, renderLimit) : filteredRows);

    function rowMatchesSearch(row: any, q: string, columns?: Record<string, string>) {
        // Search every scalar column so plate numbers, categories, dates and
        // certificate numbers are discoverable without opening each row.
        const searchable = Object.values(columns ?? {})
            .map((columnId) => cellText(row.cells?.[columnId as string]))
            .join(" ");
        return searchMatch(searchable, q);
    }

    // Resolve only enabled modules. A disabled module may still have an old
    // dbRef in settings; exposing that ref here would show stale rows after a
    // settings change and make the empty-state actions misleading.
    const schemaKeys = $derived<string[]>(ref?.columns ? Object.keys(ref.columns) : []);
    // Keep the list useful across all modules. A fixed expiry/status list made
    // travel, shopping and other ledgers render only an empty severity column.
    const tableKeys = $derived.by(() => {
        const preferred = ["name", "category", "status", "date", "expiry", "due", "amount", "brand_model", "plate", "energy_type", "mileage", "note"];
        const keys = preferred.filter((key) => schemaKeys.includes(key));
        const columns = plugin.schemaCatalog?.[active]?.columns ?? [];
        for (const column of columns) {
            if (keys.length >= 5) break;
            if (schemaKeys.includes(column.key) && !keys.includes(column.key) && !["asset", "mAsset", "mSelect", "relation"].includes(column.type)) keys.push(column.key);
        }
        return keys.length > 0 ? keys : schemaKeys.slice(0, 5);
    });
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
            cellValueFn: cellValue,
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

    // Keep the fast path small, while exposing every supported schema field in
    // the expandable section below. Writes still follow the declared cell type.
    const missingSchemaCols = $derived.by(() => {
        if (!ref?.columns || avCols.length === 0) return [] as ColumnDef[];
        const existingIds = new Set(avCols.map((c: any) => c?.id));
        const schemaCols = plugin.schemaCatalog?.[active]?.columns ?? [];
        return schemaCols.filter((sc: any) => {
            const registeredId = ref.columns?.[sc.key];
            return !registeredId || !existingIds.has(registeredId);
        });
    });

    let recordModalRef: any;
    let newRecordOpen = $state(false);
    let savedDocId = $state("");
    let savedRecordName = $state("");
    let savedModule = $state("");

    const fieldLabel = (key: string): string => t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key;

    function openNewRecord(initialForm?: Record<string, any>) {
        recordModalRef?.openNewRecordModal(initialForm);
    }

    function cellValue(type: string, v: any): unknown | null {
        switch (type) {
            case "select": return selectCellValue(v);
            case "relation": {
                const relationID = typeof v === "string" ? v.trim() : "";
                const linked = relationID && (plugin.settings.members ?? []).some((m) => m.avItemId === relationID);
                return linked ? { type: "relation", relation: { blockIDs: [relationID], contents: null } } : null;
            }
            case "date": return v === "" ? { type: "date", date: { isNotEmpty: false } } : { type: "date", date: { content: new Date(`${v}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } };
            case "number": return v === "" || v === null ? { type: "number", number: { isNotEmpty: false } } : { type: "number", number: { content: Number(v), isNotEmpty: true } };
            case "url": return { type: "url", url: { content: v } };
            case "checkbox": return { type: "checkbox", checkbox: { checked: !!v } };
            default: return { type: "text", text: { content: String(v) } };
        }
    }

    /** Format a cell for both the table and the detail drawer. */
    function cellText(v: any, colKey?: string, revealSensitive = false): string {
        if (!v) return "—";
        // 297 波：访客模式下对敏感财务金额与代码做受控脱敏遮蔽
        if (plugin.runtime?.guestModeActive) {
            const guestConfig = createDefaultGuestConfig(true);
            const rawVal = v.type === "number" && v.number?.isNotEmpty ? v.number.content : (v.text?.content ?? "");
            const masked = maskValueForGuest(rawVal, colKey ?? "", guestConfig);
            if (masked !== rawVal) return String(masked);
        }
        switch (v.type) {
            case "text": {
                const content = v.text?.content ?? "—";
                // 完整证件号在表格默认掩码（防侧窥）；详情抽屉内可显文明本
                if (!revealSensitive && colKey === "x_cert_id_number" && content !== "—") return maskIdNumber(content);
                if (!revealSensitive && ["holder_no", "x_cert_birth_registration_no_last4", "x_cert_vocational_registration_last4", "x_cert_professional_registration_last4", "x_cert_graduation_no_last4", "x_cert_degree_no_last4"].includes(colKey ?? "") && content !== "—") return maskCredentialNumber(content);
                return content;
            }
            case "date": {
                if (v.date?.content === undefined || v.date.content === null) return "—";
                const raw = v.date.content;
                const num = Number(raw);
                const d = !isNaN(num) && num > 100000000 ? new Date(num) : new Date(String(raw));
                return isNaN(d.getTime()) ? "—" : localDateKey(d);
            }
            case "select": {
                // Select values can be stored as either scalar or mSelect cells.
                const s = selectCellContent(v) ?? "—";
                return colKey && s !== "—" ? optLabel(t, colKey, s) : s;
            }
            case "mSelect": {
                const list = v.mSelect?.length ? v.mSelect.map((o: any) => o?.content).filter(Boolean).join(", ") : "—";
                return colKey && list !== "—" ? optLabelText(t, colKey, list) : list;
            }
            case "number": return typeof v.number?.content === "number" && !isNaN(v.number.content) ? String(v.number.content) : (v.number?.content !== undefined && !isNaN(Number(v.number.content)) ? String(Number(v.number.content)) : "—");
            case "url": return v.url?.content ?? "—";
            case "checkbox": return v.checkbox?.checked ? "是" : "—";
            case "block": return v.block?.content ?? "—";
            case "relation": return (v.relation?.contents ?? []).map((c: any) => c.block?.content ?? "").join(", ") || "—";
            case "mAsset": return (v.mAsset ?? []).map((asset: any) => asset?.name ?? asset?.content ?? "").filter(Boolean).join(", ") || "—";
            default: {
                const fallback = cellContentText(v);
                return fallback || "—";
            }
        }
    }

    // 252 波（对齐原型台账状态语义）：由到期日推导展示级色调——只读日期比较，
    // 不写数据、不参与提醒派生
    type LedgerTone = "danger" | "warn" | "ok" | "none";
    // Warning thresholds follow each module's reminder lead time.
    const warnDays = $derived.by(() => {
        void version;
        const rules = (plugin.schemaCatalog?.[active]?.reminders ?? []) as { key: string; leadDays: number }[];
        let max = 0;
        for (const rule of rules) {
            const lead = plugin.settings.leadOverrides?.[`${active}.${rule.key}`] ?? rule.leadDays;
            if (typeof lead === "number" && lead > max) max = lead;
        }
        return max > 0 ? max : 30;
    });
    function ledgerTone(r: any): LedgerTone {
        const col = ref?.columns?.expiry ?? ref?.columns?.due;
        if (!col) return "none";
        const v = r.cells?.[col];
        const s = v?.type === "date" && v.date?.isNotEmpty ? localDateKey(new Date(v.date.content)) : "";
        if (!s) return "none";
        const today = localDateKey(new Date());
        if (s < today) return "danger";
        const end = localDateKey(new Date(Date.now() + warnDays * 86400000));
        return s <= end ? "warn" : "ok";
    }
    function toneCls(tone: LedgerTone): string {
        return tone === "danger" ? "red" : tone === "warn" ? "orange" : tone === "ok" ? "green" : "gray";
    }
    function toneColor(tone: LedgerTone): string {
        return tone === "danger" ? "var(--lv-danger)" : tone === "warn" ? "var(--lv-warn)" : "";
    }

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

{#if loading}
    <div class="lv-card" style="padding:20px"><div class="lv-skel" style="height:16px;width:60%"></div></div>
{:else if loadError}
    <div class="lv-card"><div class="lv-empty" role="alert"><div class="eic"><UiIcon name="alert" size={22} /></div><b>{loadError}</b>
        <button class="b3-button b3-button--outline" onclick={() => void load()}>{t("ledger.retryRead")}</button>
    </div></div>
{:else if filteredRows.length === 0}
    {#if ledgers.length === 0}
        <div class="lv-card"><div class="lv-empty" role="status"><div class="eic"><UiIcon name="settings" size={22} /></div><b>{t("ledger.noEnabledModules")}</b><span>{t("ledger.noEnabledModulesHint")}</span>
            <button class="lv-btn primary" style="margin-top:4px" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
        </div></div>
    {:else if !ref?.avId}
        <div class="lv-card">
            <div class="lv-empty" role="status">
                <div class="eic"><UiIcon name="archive" size={24} /></div>
                <b>{t("ledger.defaultBlankTitle")}</b>
                <span style="max-width:480px;line-height:1.6">{t("ledger.defaultBlankDesc")}</span>
                {#if ref?.provisionError}
                    <div class="lv-caption" style="color:var(--lv-warn);margin-top:4px;max-width:520px;line-height:1.4">
                        ⚠️ {ref.provisionError}
                    </div>
                {/if}
                <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;justify-content:center">
                    <button class="b3-button b3-button--outline" onclick={rebuildLedger} disabled={rebuilding}>
                        🚀 {rebuilding ? t("diag.rebuilding") : t("ledger.buildNow")}
                    </button>
                    <button class="b3-button b3-button--outline" onclick={openBindExistingDocModal} disabled={rebuilding}>
                        {t("ledger.bindDoc")}
                    </button>
                    <button class="lv-btn primary" onclick={openNewRecord} disabled={rebuilding}>
                        + {t("ledger.newRecord")}
                    </button>
                </div>
            </div>
        </div>
    {:else if rows.length > 0}
        <!-- Empty state for a search with no matches. -->
        <div class="lv-card">
            <div class="lv-empty" role="status">
                <div class="eic"><UiIcon name="search" size={22} /></div>
                <b>{t("ledger.searchEmpty")}</b>
                <span>{t("ledger.searchEmptyHint").replace("${q}", searchText.trim())}</span>
                <button class="b3-button b3-button--outline" style="margin-top:8px" onclick={() => { searchText = ""; panelMemory.ledgerSearch = ""; }}>
                    {t("clear")} (Esc)
                </button>
            </div>
        </div>
    {:else}
        <div class="lv-card">
            <div class="lv-empty" role="status">
                <div class="eic"><UiIcon name="folder" size={22} /></div>
                <b>{t("ledger.empty")}</b>
                <span>{t("ledger.emptyHint")}</span>
                <div style="display:flex;gap:8px;margin-top:6px;align-items:center;justify-content:center;flex-wrap:wrap">
                    <button class="lv-btn primary" onclick={openNewRecord} disabled={rebuilding}>+ {t("ledger.newRecord")}</button>
                    {#if active !== "members" && active !== "adhoc"}
                        <button class="b3-button b3-button--outline" onclick={() => handleToolbarModal("csv-import")} disabled={rebuilding}>📥 {t("ledger.importCsv")}</button>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
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