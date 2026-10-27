<script lang="ts">
    import { renderLedgerAll, addDetachedRow, setCell, RowIdentityPendingError } from "@/core/siyuan";
    import { generateQRDataUrl, blockDeepLink } from "@/core/qr";
    import { AMOUNT_KEYS, formatAmount, optLabel, optLabelText } from "@/core/format";
    import { renderEditableFormFields } from "@/core/record-form";
    import { buildCsv } from "@/core/csv";
    import { maskCredentialNumber, maskIdNumber, parseIdNumber } from "@/core/idcard";
    import { selectCellValue, selectCellContent, cellContentText } from "@/core/avcell";
    import { localDateKey, parseDate } from "@/core/hub/rule";
    import { showMessage, Dialog } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { saveSettings } from "@/core/settings";
    import { ensurePinyin, pinyinReady, searchMatch } from "@/core/pinyin";
    import { openContactPicker, getContactsBridge } from "@/libs/contact-picker";
    import { COMMON_COLUMN_ALIASES } from "@/core/provisioner";
    import { getCertificateProfile, getCertificateReminderField } from "@/core/schema";
    import type { ColumnDef } from "@/core/schema";
    import { getCaptureFields, getFormFields, validateCaptureInput, getFieldPlaceholder, type CaptureInputError } from "@/core/capture";
    import { assetHref, isImageAsset } from "@/core/assets";
    import { createVehicleActionQueue, type VehicleQuickAction } from "@/core/vehicle";
    import type { LogKind } from "@/core/rowlog";
    import { rowLogActivityId, type ActivityTarget } from "@/core/activity";
    /** 312 波：抽屉内子记录行样式（原 4 处重复字面量收敛） */
    const substRowCss = "padding:2px 0;font-size:12.5px";
    const sectionBorderCss = "margin-top:14px;padding-top:10px;border-top:1px solid var(--lv-line)";
    const flexBetweenCenterGap8Css = "display:flex;align-items:center;justify-content:space-between;gap:8px";
    const sectionHeaderCss = `${flexBetweenCenterGap8Css};margin-bottom:8px`;
    const sectionTitleCss = "font-weight:600;font-size:12px";
    const lineBadgeCss = "display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line)";
    const sectionHeadBorderCss = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px";
    const linkBtnCss = "font-size:11.5px;padding:0 4px;color:var(--lv-accent)";
    const btnSmCss = "margin-top:8px;font-size:12px";
    const boxContentCss = "padding:10px 12px;background:var(--lv-surface-2);border-radius:8px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:6px;font-size:12px";
    const wrapBorderCss = "margin-top:12px;padding-top:10px;border-top:1px solid var(--lv-line)";
    const actionRowEndCss = "display:flex;align-items:center;justify-content:flex-end;margin-top:2px";
    const flexCenterGap6Css = "display:flex;align-items:center;gap:6px";
    const flexColGap6Css = "display:flex;flex-direction:column;gap:6px";
    const dangerAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-danger-soft);border-radius:6px;border:1px solid var(--lv-danger);color:var(--lv-danger);font-size:12px";
    const warnAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line);color:var(--lv-warn);font-size:12px";
    const pad06Fs12Css = "padding:0 6px;font-size:12px";
    const pad36Fs12Css = "padding:3px 6px;font-size:12px";
    const minW96Shrink0Css = "min-width:96px;flex-shrink:0";
    const wordBreakAllCss = "word-break:break-all";
    const fs125Css = "font-size:12.5px";
    const pad6BorderSurfaceCss = "padding:6px 8px;background:var(--lv-surface);border-radius:6px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:3px";
    const fs12Pad38Css = "font-size:12px;padding:3px 8px";
    const fs12Pad310Css = "font-size:12px;padding:3px 10px";
    import { onDestroy } from "svelte";
    import UiIcon from "@/ui/icon.svelte";
    import { panelSession, type TableDensity } from "../panel-session";
    import { maskValueForGuest, createDefaultGuestConfig } from "@/core/guest-mode";
    import { getGroupedModules } from "@/core/modules";
    import { getQuickTemplates, type QuickRecordTemplate } from "@/core/quick-templates";
    import { smartExtractFieldsFromTitle } from "@/core/block-capture";

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
    let ledgerMoreDetails: HTMLDetailsElement | undefined = $state();
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
    // 台账窗口化：数据仍完整保留在内存中，DOM 只保留视口附近的行。
    // 密度模式（§17）：舒适（48px）与紧凑（34px）两档，滚动轨道高度随密度自适应。
    const VIRTUAL_ROW_HEIGHT_COMFORTABLE = 48;
    const VIRTUAL_ROW_HEIGHT_COMPACT = 34;
    let tableDensity = $state<TableDensity>(panelMemory.tableDensity ?? "comfortable");
    let virtualRowHeight = $derived(tableDensity === "compact" ? VIRTUAL_ROW_HEIGHT_COMPACT : VIRTUAL_ROW_HEIGHT_COMFORTABLE);
    function toggleDensity() {
        tableDensity = tableDensity === "compact" ? "comfortable" : "compact";
        panelMemory.tableDensity = tableDensity;
    }
    const VIRTUAL_OVERSCAN = 8;
    let ledgerScrollTop = $state(0);
    let ledgerViewportHeight = $state(640);
    let ledgerTableEl = $state<HTMLTableElement | undefined>(undefined);
    // The scroll owner is an imperative DOM handle; keeping it non-reactive
    // prevents the ResizeObserver setup effect from re-running itself.
    let virtualRoot: HTMLElement | undefined;
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
    let batchBusy = $state(false);

    function toggleRowSelect(id: string) {
        if (selectedItemIds.includes(id)) {
            selectedItemIds = selectedItemIds.filter((x) => x !== id);
        } else {
            selectedItemIds = [...selectedItemIds, id];
        }
    }

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

    function applyLedgerTemplate(tpl: QuickRecordTemplate) {
        for (const [k, v] of Object.entries(tpl.values)) {
            form[k] = v;
        }
        if (active === "certs" && tpl.values.category) {
            handleCertificateCategoryChange(String(tpl.values.category));
        }
    }

    function handleNewRecordNameBlur() {
        if (!form.name || typeof form.name !== "string") return;
        const res = smartExtractFieldsFromTitle(form.name);
        if (res.cleanTitle !== form.name) {
            form.name = res.cleanTitle;
            const dateCol = schemaCols.find((c) => c.type === "date" && ["expiry", "due", "date"].includes(c.key));
            if (dateCol && res.extractedDate && !form[dateCol.key]) {
                form[dateCol.key] = res.extractedDate;
            }
            const numCol = schemaCols.find((c) => c.type === "number" && ["amount", "price", "deposit"].includes(c.key));
            if (numCol && res.extractedAmount !== undefined && !form[numCol.key]) {
                form[numCol.key] = res.extractedAmount;
            }
        }
    }

    async function openBatchMemberModal() {
        if (!selectedItemIds.length || !ref?.avId || !memberCol || batchBusy) return;
        const membersList = (plugin.settings.members ?? []).filter((m) => !!m.avItemId);
        if (!membersList.length) {
            showMessage(t("members.notLinked"), 4000, "info");
            return;
        }
        try {
            const { openBatchMemberDialog } = await import("@/core/batch-dialog");
            openBatchMemberDialog({
                targetCol: memberCol,
                membersList,
                selectedItemIds,
                avId: ref.avId,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onBatchSuccess: async () => {
                    selectedItemIds = [];
                    await load();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    async function openBatchLocationModal() {
        if (!selectedItemIds.length || !ref?.avId || !ref?.columns?.location || batchBusy) return;
        try {
            const { openBatchLocationDialog } = await import("@/core/batch-dialog");
            openBatchLocationDialog({
                targetCol: ref.columns.location,
                selectedItemIds,
                locOptions: dynamicLocations,
                avId: ref.avId,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onBatchSuccess: async () => {
                    selectedItemIds = [];
                    await load();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    function batchDelete() {
        if (!selectedItemIds.length || !ref?.avId || batchBusy) return;
        const count = selectedItemIds.length;
        confirm(
            t("ledger.batchDelete"),
            t("ledger.batchDeleteConfirm").replace("${n}", String(count)),
            async () => {
                batchBusy = true;
                try {
                    const { removeLedgerRows } = await import("@/core/siyuan");
                    const { cleanupRowRuntimeData, saveRuntime } = await import("@/core/hub/runtime");
                    await removeLedgerRows(ref!.avId!, selectedItemIds, {
                        idempotencyKey: `ledger:batch-del:${ref!.avId!}:${Date.now()}`,
                        retries: 1,
                    });
                    for (const id of selectedItemIds) {
                        cleanupRowRuntimeData(plugin.runtime, id);
                    }
                    await saveRuntime(plugin, plugin.runtime);
                    selectedItemIds = [];
                    showMessage(t("ledger.delDone") + ` (${count})`, 3000, "info");
                    await load();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                } catch (e) {
                    showMessage(t("ledger.delFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                } finally {
                    batchBusy = false;
                }
            }
        );
    }

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
        if (!ref?.avId || !ref.columns?.[fieldKey]) return;
        const colId = ref.columns[fieldKey];
        const cell = row.cells?.[colId];
        let cur = 0;
        if (typeof cell?.number?.content === "number" && !isNaN(cell.number.content)) {
            cur = cell.number.content;
        } else if (cell?.text?.content) {
            const parsed = parseFloat(cell.text.content);
            if (!isNaN(parsed)) cur = parsed;
        }
        const next = Math.max(0, cur + delta);
        try {
            const { setCell } = await import("@/core/siyuan");
            await setCell(ref.avId, colId, row.itemID, { type: "number", number: { content: next } });
            if (!row.cells[colId]) row.cells[colId] = { type: "number", number: {} };
            row.cells[colId].number = { content: next, isNotEmpty: true };
            showMessage(`${delta > 0 ? "+1" : "-1"} (${next})`, 1500, "info");
            // 库存变动后轻量触发单模块重扫，自动更新/解除到期与低库存提醒
            void plugin.refreshHub?.(active);
        } catch (e) {
            showMessage(String(e), 3000, "error");
        }
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

    const allSelected = $derived(filteredRows.length > 0 && selectedItemIds.length === filteredRows.length);

    function toggleSelectAll() {
        if (allSelected) selectedItemIds = [];
        else selectedItemIds = filteredRows.map((r) => r.itemID);
    }
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
    const virtualRange = $derived.by(() => {
        void ledgerScrollTop;
        void ledgerViewportHeight;
        const total = visibleRows.length;
        if (total <= 80) return { start: 0, end: total };
        const tableTop = ledgerTableEl && virtualRoot
            ? ledgerTableEl.getBoundingClientRect().top - virtualRoot.getBoundingClientRect().top + virtualRoot.scrollTop
            : 0;
        const first = Math.max(0, Math.floor((ledgerScrollTop - tableTop) / virtualRowHeight) - VIRTUAL_OVERSCAN);
        const count = Math.ceil(ledgerViewportHeight / virtualRowHeight) + VIRTUAL_OVERSCAN * 2;
        const start = Math.max(0, Math.min(first, Math.max(0, total - count)));
        const end = Math.min(total, start + count);
        return { start, end };
    });
    const virtualRows = $derived(visibleRows.slice(virtualRange.start, virtualRange.end));

    function measureLedgerViewport() {
        if (!virtualRoot) return;
        ledgerViewportHeight = virtualRoot.clientHeight || 640;
        ledgerScrollTop = virtualRoot.scrollTop;
    }

    $effect(() => {
        const table = ledgerTableEl;
        if (!table) return;
        const root = table.closest<HTMLElement>(".lv-home");
        if (!root) return;
        virtualRoot = root;
        const onScroll = () => { ledgerScrollTop = root.scrollTop; };
        root.addEventListener("scroll", onScroll, { passive: true });
        const resize = new ResizeObserver(measureLedgerViewport);
        resize.observe(root);
        measureLedgerViewport();
        return () => {
            root.removeEventListener("scroll", onScroll);
            resize.disconnect();
            if (virtualRoot === root) virtualRoot = undefined;
        };
    });

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
        const hasDraft = hasAnyInput
            || !!pendingItemID
            || identityPending
            || Object.values(certificateFiles).some((files) => files.length > 0)
            || Object.values(uploadedCertificateFiles).some((files) => files.length > 0);
        if (next !== active && hasDraft) {
            showMessage(t("ledger.draftModuleSwitchBlocked"), 5000, "info");
            return;
        }
        if (next !== active && plugin.pendingActivityTarget?.moduleId !== next) plugin.pendingActivityTarget = undefined;
        active = next;
        filterMemberId = "";
        filterCategory = "";
        selectedItemIds = [];
        validationAttempted = false;
        saveError = "";
        plugin.activeLedger = active;
        searchText = "";
    }

    function switchLedger(event: Event) {
        const next = (event.currentTarget as HTMLSelectElement).value;
        switchLedgerTo(next);
    }

    // CSV export uses schema columns and a BOM for spreadsheet compatibility.
    // Sensitive modules require an explicit confirmation before export.
    const HIGH_CONSEQUENCE_MODULES = new Set(["health", "parenting", "certs", "insurance", "assets-real", "assets-virtual", "contracts", "medicine", "schooling"]);

    // Print QR labels for all rows in the current module.
    async function printLabels() {
        const sourceRef = ref;
        const query = searchText.trim().toLowerCase();
        if (!sourceRef?.avId || !sourceRef.docId || printing) return;
        printing = true;
        try {
            const all = await renderLedgerAll(sourceRef.avId);
            if (!all.complete) { showMessage(t("ledger.loadIncomplete"), 5000, "error"); return; }
            let list = all.rows;
            if (query) list = list.filter((r) => rowMatchesSearch(r, query, sourceRef.columns));
            if (list.length === 0) { showMessage(t("ledger.printNoRows"), 3000, "info"); return; }
            const labels = await Promise.all(list.map(async (r) => {
                const nameCol = sourceRef.columns?.name;
                const nameVal = nameCol ? r.cells?.[nameCol] : undefined;
                const blockId = nameVal?.type === "block" ? nameVal.block?.id : undefined;
                const name = cellText(nameVal, "name");
                const link = blockDeepLink(blockId || sourceRef.docId!);
                let qr = "";
                try { qr = await generateQRDataUrl(link, 160); } catch { qr = ""; }
                return { name, qr };
            }));
            const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            // 259 波：打印页对齐设计语言（纸面固定色板，独立于屏幕主题——同 index.scss 打印豁免边界）
            const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${t("ledger.printTitle")}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:20px;color:#1f2328;background:#fff}
.head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid #d0d7de;padding-bottom:10px;margin-bottom:16px}
.head b{font-size:16px;font-weight:600}
.head .sub{font-size:11px;color:#57606a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.label{border:1px solid #d0d7de;border-radius:10px;padding:14px 12px;text-align:center;page-break-inside:avoid}
.label img{width:132px;height:132px}
.label .nm{font-size:13px;font-weight:600;margin-top:8px;word-break:break-all}
.label .tip{font-size:10px;color:#57606a;margin-top:3px}
.printbtn{padding:7px 18px;border:none;border-radius:8px;background:#0969da;color:#fff;font-size:13px;cursor:pointer}
.printbtn:hover{background:#0860c4}
@media print{.noprint{display:none}body{padding:0}}</style></head><body>
<div class="head"><b>${t("ledger.printTitle")}</b><span class="sub">${t("ledger.printScanTip")} · ${new Date().toLocaleString()}</span></div>
<div class="noprint" style="text-align:center;margin-bottom:14px"><button class="printbtn" onclick="window.print()">${t("ledger.printButton")}</button></div>
<div class="grid">${labels.map((l) => `<div class="label"><img src="${l.qr}" alt="QR" width="132" height="132" decoding="async">${l.name ? `<div class="nm">${esc(l.name)}</div>` : ""}<div class="tip">${t("ledger.printScanTip")}</div></div>`).join("")}</div>
<script>window.print()<\/script></body></html>`;
            const w = window.open("", "_blank");
            if (!w) { showMessage(t("ledger.printBlocked"), 4000, "error"); return; }
            w.document.write(html);
            w.document.close();
        } catch (e) {
            showMessage(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            printing = false;
        }
    }

    function exportCsv() {
        const sourceRef = ref;
        const moduleId = active;
        const query = searchText.trim().toLowerCase();
        const sortField = sortKey ? sourceRef?.columns?.[sortKey] : undefined;
        const ascending = sortAsc;
        if (!sourceRef?.columns || filteredRows.length === 0 || exporting) return;
        const download = async () => {
            exporting = true;
            // N7/E13：导出走全量读（UI 列表仍单页，PF11）；搜索词对全量行复用同一过滤语义
            try {
                let all;
                try {
                    all = await renderLedgerAll(sourceRef.avId!);
                } catch (e) {
                    showMessage(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                    return;
                }
                if (!all.complete) { showMessage(t("ledger.loadIncomplete"), 5000, "error"); return; }
                let list = all.rows;
                if (query) list = list.filter((r) => rowMatchesSearch(r, query, sourceRef.columns));
                const sortType = sortKey ? plugin.schemaCatalog?.[moduleId]?.columns?.find((column: any) => column.key === sortKey)?.type : undefined;
                list = sortRows(list, sortField, ascending, sortType);
                const cols = (plugin.schemaCatalog?.[moduleId]?.columns ?? []).filter((c: any) => sourceRef.columns?.[c.key]);
                const label = (c: any) => (t(`field.${c.key}`) !== `field.${c.key}` ? t(`field.${c.key}`) : c.key);
                const csv = buildCsv(cols.map(label), list.map((r) => cols.map((c: any) => cellText(r.cells?.[sourceRef.columns![c.key]], c.key, true))));
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                const moduleTitle = t(`module.${moduleId}`) !== `module.${moduleId}` ? t(`module.${moduleId}`) : moduleId;
                a.download = `小驴管家-${moduleTitle}-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
            } finally {
                exporting = false;
            }
        };
        if (HIGH_CONSEQUENCE_MODULES.has(moduleId)) {
            confirm(t("ledger.exportSensitiveTitle"), t("ledger.exportSensitiveBody").replace("${module}", t(`module.${moduleId}`)), () => { void download(); });
            return;
        }
        void download();
    }

    // Export Attachments & Certificates Archive Manifest (.md) (303波)
    async function exportArchiveManifest() {
        const sourceRef = ref;
        const moduleId = active;
        if (!sourceRef?.columns || filteredRows.length === 0 || exporting) return;
        const attCol = sourceRef.columns.attachments;
        if (!attCol) {
            showMessage(t("ledger.exportArchiveNoAttCol"), 4000, "info");
            return;
        }

        exporting = true;
        try {
            const all = await renderLedgerAll(sourceRef.avId!);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }

            const { buildArchiveManifest, formatArchiveManifestMarkdown } = await import("@/core/archive");
            const memberMap = new Map((plugin.settings.members ?? []).map((m: any) => [m.avItemId, m.name]));

            const records = all.rows.map((row) => {
                const title = sourceRef.columns?.name ? cellText(row.cells?.[sourceRef.columns.name]) : "未命名记录";
                const memId = sourceRef.columns?.member ? String(row.cells?.[sourceRef.columns.member]?.relation?.blockIDs?.[0] ?? "") : "";
                const memberName = memId ? (memberMap.get(memId) ?? "") : "";
                const attList = row.cells?.[attCol]?.mAsset ?? [];
                return {
                    id: row.itemID,
                    module: moduleId,
                    title,
                    memberName,
                    date: sourceRef.columns?.date ? cellText(row.cells?.[sourceRef.columns.date]) : undefined,
                    expiry: sourceRef.columns?.expiry ? cellText(row.cells?.[sourceRef.columns.expiry]) : undefined,
                    attachments: attList,
                };
            }).filter((r) => r.attachments.length > 0);

            if (records.length === 0) {
                showMessage(t("ledger.exportArchiveEmpty"), 4000, "info");
                return;
            }

            const manifest = buildArchiveManifest(records, {
                maskSensitive: Boolean(plugin.runtime?.guestModeActive),
            });
            const md = formatArchiveManifestMarkdown(manifest, t);
            const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lv-archive-${moduleId}-${new Date().toISOString().slice(0, 10)}.md`;
            a.click();
            URL.revokeObjectURL(a.href);
            showMessage(t("ledger.exportArchiveSuccess").replace("${n}", String(manifest.totalFiles)), 3500, "info");
        } catch (e) {
            showMessage(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            exporting = false;
        }
    }

    /** Show fuel and charging usage per vehicle without combining hybrid energy types. */
    async function openEnergyDashboard() {
        const sourceRef = ref;
        if (!sourceRef?.avId || active !== "vehicles") return;
        try {
            const { openEnergyDashboardDialog } = await import("@/core/fuel");
            await openEnergyDashboardDialog({
                sourceRef,
                t,
                plugin,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                renderLedgerAllFn: renderLedgerAll,
                cellTextFn: cellText,
                selectContentFn: selectCellContent,
                onOpenNewRecord: openNewRecord,
                onOpenVehicleDetail: openDetail,
            });
        } catch (error) {
            showMessage(t("ledger.readFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error");
        }
    }

    // Growth chart for parenting records, including an optional WHO reference band.
    async function openGrowthChart() {
        try {
            const { openGrowthChartDialog } = await import("@/core/growth-dialog");
            openGrowthChartDialog({
                t,
                rows,
                columns: (ref?.columns ?? {}) as Record<string, string | undefined>,
                members: plugin.settings.members ?? [],
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.growthFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
        }
    }

    // Vaccine schedule (given, overdue, due soon, upcoming) for children in parenting records.
    async function openVaccineScheduleModal() {
        if (!ref?.avId || !ref.columns) return;
        try {
            const { openVaccineScheduleDialog } = await import("@/core/growth-dialog");
            await openVaccineScheduleDialog({
                t,
                members: plugin.settings.members ?? [],
                avId: ref.avId,
                columns: ref.columns,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                cellTextFn: cellText,
                onRecordSaved: async () => {
                    await load();
                },
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
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

    // Shopping suggestions aggregate low-stock items and support copying the list.
    async function openShoppingList() {
        if (!ref?.avId || !ref.columns?.name || !ref.columns.qty || !ref.columns.low_stock_at) {
            if (!ref?.avId) showMessage(t("diag.missing"), 3000, "info");
            else showMessage(t("ledger.missingColumnsPrompt") + " " + (t("field.low_stock_at") || "low_stock_at"), 3000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(ref.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            const { openLowStockShoppingDialog } = await import("@/core/shopping");
            openLowStockShoppingDialog({
                ref: ref as any,
                allRows: all.rows,
                t,
                plugin,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.shoppingFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
        }
    }

    // Favors annual summary report and relationship balance analysis (317波抽离减负).
    async function openFavorsReport() {
        if (!ref?.avId || !ref.columns) return;
        const { openFavorsReportDialog } = await import("@/core/favors-dialog");
        return openFavorsReportDialog({
            ref,
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            loadRows: () => renderLedgerAll(ref!.avId!),
        });
    }

    // Check validity of URLs in bookmarks ledger and highlight broken links.
    async function openBookmarksCheck() {
        if (!ref?.avId || !ref.columns?.url) {
            if (!ref?.avId) showMessage(t("diag.missing"), 3000, "info");
            else showMessage(t("ledger.missingColumnsPrompt") + " " + (t("field.url") || "url"), 3000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(ref.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            const { openBookmarksCheckDialog } = await import("@/core/bookmarks");
            await openBookmarksCheckDialog({
                rows: all.rows,
                columns: ref.columns,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
    }

    // Calculate subscription expenses normalized to monthly and annual projections.
    async function openSubscriptionStats() {
        if (!ref?.avId || !ref.columns?.amount) {
            if (!ref?.avId) showMessage(t("diag.missing"), 3000, "info");
            else showMessage(t("ledger.expenseTrendNoCol"), 4000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(ref.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            const { openSubscriptionStatsDialog } = await import("@/core/subscriptions");
            openSubscriptionStatsDialog({
                rows: all.rows,
                columns: ref.columns,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
    }

    // Asset valuation report summarizing initial costs and current appraised values.
    async function openAssetValuationModal() {
        if (!ref?.avId || !ref.columns?.amount) {
            if (!ref?.avId) showMessage(t("diag.missing"), 3000, "info");
            else showMessage(t("ledger.expenseTrendNoCol"), 4000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(ref.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            const { loadRowLogs } = await import("@/core/rowlog");
            const logs = await loadRowLogs(plugin as any);
            const { openAssetValuationDialog } = await import("@/core/valuation");
            openAssetValuationDialog({
                rows: all.rows,
                columns: ref.columns,
                logs,
                avId: ref.avId,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
    }

    // Media reading/viewing annual report and status analysis.
    async function openMediaReport() {
        if (!ref?.avId || !ref.columns) {
            showMessage(t("diag.missing"), 3000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(ref.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            const { openMediaReportDialog } = await import("@/core/media");
            openMediaReportDialog({
                rows: all.rows,
                columns: ref.columns,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
    }

    // Weekly Meal Plan & Grocery Deficit Analysis (295波):
    // Select recipes from food ledger, aggregate ingredients, compare against stock, and generate shopping list.
    async function openMealPlanModal() {
        if (!ref?.avId || !ref.columns?.name) {
            showMessage(t("diag.missing"), 3000, "info");
            return;
        }
        try {
            const allFood = await renderLedgerAll(ref.avId);
            if (!allFood.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            if (allFood.rows.length === 0) {
                showMessage(t("ledger.mealPlanEmptyFood"), 4000, "info");
                return;
            }

            let stockItems: import("@/core/meal-plan").StockItemInfo[] = [];
            const stockRef = plugin.settings.dbRefs?.stock;
            if (stockRef?.avId && stockRef.columns?.name) {
                try {
                    const allStock = await renderLedgerAll(stockRef.avId);
                    if (allStock.complete) {
                        const { extractStockItemsFromRows } = await import("@/core/meal-plan");
                        stockItems = extractStockItemsFromRows(allStock.rows, {
                            nameCol: stockRef.columns.name,
                            qtyCol: stockRef.columns.qty,
                        });
                    }
                } catch {
                    // stock 异常时优雅降级为空库存
                }
            }

            const { openMealPlanDialog } = await import("@/core/meal-plan");
            openMealPlanDialog({
                allFoodRows: allFood.rows,
                stockItems,
                ref,
                plugin,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                cellTextFn: cellText,
                addDetachedRowFn: addDetachedRow,
                setCellFn: setCell,
                cellValueFn: cellValue,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        }
    }

    // Medicine Supply & Runout Estimation (298波):
    // Analyze dosing instructions, estimate days of supply, predict runout date, and check expiry inversion.
    async function openMedicineSupplyModal() {
        if (!ref?.avId || !ref.columns?.name) {
            showMessage(t("diag.missing"), 3000, "info");
            return;
        }
        try {
            const allMed = await renderLedgerAll(ref.avId);
            if (!allMed.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            if (allMed.rows.length === 0) {
                showMessage(t("ledger.medicineSupplyEmpty"), 4000, "info");
                return;
            }

            const { evaluateMedicineSupplyReport, openMedicineSupplyDialog } = await import("@/core/medicine-dosing");
            const report = evaluateMedicineSupplyReport(allMed.rows, ref.columns);

            openMedicineSupplyDialog({
                report,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
        }
    }

    // Municipal Waste Schedule & Recycling (316波):
    async function openWasteScheduleModal() {
        const { openWasteScheduleDialog } = await import("@/core/waste-dialog");
        openWasteScheduleDialog({
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
        });
    }

    // Chores Rewards & Allowance Settlement (317波):
    async function openRewardsLedgerModal() {
        const { openRewardsDialog } = await import("@/core/rewards-dialog");
        openRewardsDialog({
            t,
            plugin,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellText,
            addDetachedRowFn: addDetachedRow,
            setCellFn: setCell,
        });
    }

    // Expense Trend & Spikes Analysis (305波):
    // Aggregate all rows with an amount + date field into monthly totals, compute MoM and detect spikes.
    async function openExpenseTrendModal() {
        const sourceRef = ref;
        if (!sourceRef?.avId) return;
        const amountCol = sourceRef.columns?.amount;
        const dateCol = sourceRef.columns?.date ?? sourceRef.columns?.expiry;
        if (!amountCol || !dateCol) {
            showMessage(t("ledger.expenseTrendNoCol"), 4000, "info");
            return;
        }
        try {
            const all = await renderLedgerAll(sourceRef.avId);
            if (!all.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }

            const entries = all.rows
                .map((row) => ({
                    date: cellText(row.cells?.[dateCol]),
                    amount: Number(cellText(row.cells?.[amountCol]).replace(/[^\d.-]/g, "")),
                    category: sourceRef.columns?.category ? cellText(row.cells?.[sourceRef.columns.category]) : undefined,
                }))
                .filter((e) => e.date && Number.isFinite(e.amount) && e.amount > 0);

            if (entries.length === 0) {
                showMessage(t("ledger.expenseTrendEmpty"), 4000, "info");
                return;
            }

            const { openExpenseTrendDialog } = await import("@/core/expense-dialog");
            openExpenseTrendDialog({
                entries,
                budgetLimits: plugin.settings.budgetLimits,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
        }
    }

    // Household Utility Tiers & Stepped Pricing Calculation (299波):
    // Analyze meter readings (electricity, water, gas), calculate tiered costs, and issue high-tier warnings.
    async function openUtilityTiersModal() {
        if (!ref?.avId || !ref.columns?.name) return;
        try {
            const allHouse = await renderLedgerAll(ref.avId);
            if (!allHouse.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            if (allHouse.rows.length === 0) {
                showMessage(t("ledger.utilityEmptyReadings"), 4000, "info");
                return;
            }

            const { loadRowLogs, getEntries } = await import("@/core/rowlog");
            const currentLogs = await loadRowLogs(plugin as any);

            const { openUtilityTiersDialog } = await import("@/core/utility-tiers");
            openUtilityTiersDialog({
                allHouseRows: allHouse.rows,
                currentLogs,
                ref,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                cellTextFn: cellText,
                getEntriesFn: getEntries,
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
        }
    }

    // 313 波（G4）：存放位置全局检索（动态加载 core/location-dialog.ts 减轻初始 bundle）
    async function openLocationIndexModal() {
        const { openLocationIndexDialog } = await import("@/core/location-dialog");
        return openLocationIndexDialog({
            t,
            plugin,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellText,
        });
    }

    // 319 波：思源块收录入台账（动态加载 core/block-ingest-dialog.ts）
    async function openBlockIngestModal() {
        const { openBlockIngestDialog } = await import("@/core/block-ingest-dialog");
        return openBlockIngestDialog({
            t,
            currentModule: active,
            plugin,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            addDetachedRowFn: addDetachedRow,
            setCellFn: setCell,
            onSuccessCallback: async () => {
                await load();
                try { await plugin.refreshHub([active]); } catch { /* ignore */ }
            },
        });
    }

    // 312 波（G3）：扫货模式（动态加载 core/store-dialog.ts）
    async function openStoreModeModal() {
        const sourceRef = ref;
        if (!sourceRef?.avId || !sourceRef.columns?.name) {
            showMessage(t("diag.missing"), 3000, "info");
            return;
        }
        const { openStoreModeDialog } = await import("@/core/store-dialog");
        return openStoreModeDialog({
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            loadRows: () => renderLedgerAll(sourceRef.avId!),
            columns: {
                name: sourceRef.columns.name,
                category: sourceRef.columns.category,
                qty: sourceRef.columns.qty,
                note: sourceRef.columns.note,
            },
        });
    }

    // Emergency Kit Checklist & Stock Linking (302波):
    // Compare standard emergency kit items with current stock ledger and import missing rows.
    async function openEmergencyKitModal() {
        if (!ref?.avId || !ref.columns?.name) {
            showMessage(t("diag.missing"), 3000, "info");
            return;
        }
        try {
            const allStock = await renderLedgerAll(ref.avId);
            if (!allStock.complete) {
                showMessage(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }

            const { openEmergencyKitDialog } = await import("@/core/emergency-kit");
            openEmergencyKitDialog({
                stockRows: allStock.rows,
                ref: ref as { avId: string; columns?: Record<string, string> },
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                cellTextFn: cellText,
                addDetachedRowFn: addDetachedRow,
                setCellFn: setCell,
                isGuestReadOnly: Boolean(plugin.runtime?.guestModeActive),
                onCreatedCallback: async () => {
                    await load();
                    try { await plugin.refreshHub([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
        }
    }

    // CSV import uses a schema-driven mapping wizard; core owns the planning logic.
    async function openCsvImport() {
        if (!ref?.avId) return;
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        try {
            const importableTypes = new Set(["text", "number", "date", "checkbox", "select"]);
            const schemaCols = (plugin.schemaCatalog?.[active]?.columns ?? []).filter((c: any) => importableTypes.has(c.type));
            const { openCsvImportDialog } = await import("@/core/csv-import-dialog");
            openCsvImportDialog({
                active,
                ref: ref as any,
                schemaCols,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onImportSuccess: async () => {
                    await load();
                    try { await plugin.refreshHub([active]); } catch { /* soft */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
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
        const handler = () => void openLocationIndexModal();
        window.addEventListener("siyuan-home:open-location", handler);
        return () => window.removeEventListener("siyuan-home:open-location", handler);
    });

    // Keep the fast path small, while exposing every supported schema field in
    // the expandable section below. Writes still follow the declared cell type.
    const captureCols = $derived.by(() => {
        return getCaptureFields(plugin.schemaCatalog?.[active]);
    });
    const schemaCols = $derived(plugin.schemaCatalog?.[active]?.columns ?? []);
    const missingSchemaCols = $derived.by(() => {
        if (!ref?.columns || avCols.length === 0) return [] as ColumnDef[];
        const existingIds = new Set(avCols.map((c: any) => c?.id));
        return schemaCols.filter((sc) => {
            const registeredId = ref.columns?.[sc.key];
            return !registeredId || !existingIds.has(registeredId);
        });
    });
    const supportableCols = $derived(getFormFields(plugin.schemaCatalog?.[active]).filter((field) =>
        !(active === "certs" && field.key.startsWith("x_cert_"))
        && !(field.type === "relation" && field.key !== "member")));
    const captureKeys = $derived(new Set(captureCols.map((field) => field.key)));
    const additionalCols = $derived(supportableCols.filter((field) =>
        !captureKeys.has(field.key)
        && !(active === "certs" && (field.key.startsWith("x_cert_")
            || ["holder_no", "issue_date", "issuance_rule", "store_place", "location", "copy_location", "note", "due"].includes(field.key)))));
    const unsupportedCols = $derived(schemaCols.filter((field) =>
        ["asset", "mSelect"].includes(field.type)
        || (field.type === "relation" && field.key !== "member")));
    const unsupportedCount = $derived(unsupportedCols.length);
    // Form values are keyed by schema key.
    let form: Record<string, any> = $state({});
    let nameInput: HTMLInputElement | undefined = $state();
    let newRecordOpen = $state(false);
    let closeAfterSave = $state(true);
    let newRecordTrigger: HTMLElement | null = null;
    let savedDocId = $state("");
    let savedRecordName = $state("");
    const certificateProfile = $derived(active === "certs" && form.category ? getCertificateProfile(String(form.category)) : null);
    const certificateScalarCols = $derived.by(() => {
        if (!certificateProfile) return [] as { key: string; type: string; options?: string[] }[];
        const schemaCols: any[] = plugin.schemaCatalog?.certs?.columns ?? [];
        const keys = new Set(["x_cert_holder_name", "holder_no", "x_cert_id_number", "issue_date", "x_cert_valid_from", "issuance_rule", "store_place", "location", "copy_location", "note", ...certificateProfile.fieldKeys]);
        if (!getCertificateReminderField(certificateProfile.category)) keys.add("due");
        if (certificateProfile.category === "id") keys.delete("holder_no");
        return schemaCols.filter((col: any) => keys.has(col.key) && col.type !== "mAsset")
            .map((col: any) => ({ key: col.key, type: col.type, options: col.options }));
    });
    // R7 资料强化：身份证号实时校验（输入非空才解析；校验通过且性别未填时自动回填）
    const idcardCheck = $derived.by(() => {
        const v = String(form.x_cert_id_number ?? "").trim();
        return v ? parseIdNumber(v) : null;
    });
    $effect(() => {
        const check = idcardCheck;
        if (check?.ok && check.sex && !form.x_cert_id_gender) form.x_cert_id_gender = check.sex;
    });
    const certificateAssetCols = $derived.by(() => active === "certs"
        ? [
            ...schemaCols.filter((col) => col.key === "attachments" && col.type === "mAsset"),
            ...(certificateProfile?.columns.filter((col) => col.type === "mAsset") ?? []),
        ]
        : []);
    const quickAssetCols = $derived.by(() => {
        const seen = new Set<string>();
        const out: { key: string; type: string; labelKey?: string }[] = [];
        const genericAssetCols = schemaCols.filter((entry) => entry.type === "mAsset" && !entry.key.startsWith("x_cert_"));
        for (const col of [...genericAssetCols, ...certificateAssetCols]) {
            if (seen.has(col.key)) continue;
            seen.add(col.key);
            out.push({ key: col.key, type: "mAsset", labelKey: col.labelKey });
        }
        return out;
    });
    // Keep local files across partial failures; successful uploads are cached by asset path.
    let certificateFiles: Record<string, File[]> = $state({});
    let uploadedCertificateFiles: Record<string, { name: string; content: string }[]> = $state({});
    const attachmentWriteKeys = new Map<string, { signature: string; key: string }>();
    let lastCertificateCategory = $state("");
    function fileFingerprint(file: File): string {
        return `${file.name}:${file.size}:${file.lastModified}`;
    }
    /** Generate one stable operation id for a user action and its retries. */
    function newOperationKey(prefix: string): string {
        try { return `${prefix}:${crypto.randomUUID()}`; }
        catch { return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    }
    function setCertificateFiles(key: string, files: File[]) {
        const vehiclePhoto = active === "vehicles" && key === "attachments";
        if (vehiclePhoto) {
            const invalid = files.filter((file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024);
            if (invalid.length) showMessage(t("vehicle.photoInvalid"), 4500, "error");
            files = files.filter((file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024).slice(0, 1);
        }
        const previous = certificateFiles[key] ?? [];
        const seen = new Set(previous.map(fileFingerprint));
        const unique = files.filter((file) => {
            const fingerprint = fileFingerprint(file);
            if (seen.has(fingerprint)) return false;
            seen.add(fingerprint);
            return true;
        });
        certificateFiles = { ...certificateFiles, [key]: [...previous, ...unique] };
    }
    async function removeCertificateFile(key: string, source: "local" | "uploaded", index: number, confirmed = false) {
        // Removing an already-uploaded asset writes immediately to the kernel;
        // require an explicit confirmation so a misclick cannot lose it.
        if (source === "uploaded" && !confirmed) {
            confirm(t("ledger.removeAttachment"), t("ledger.removeAttachmentConfirm"), () => {
                void removeCertificateFile(key, source, index, true);
            });
            return;
        }
        if (source === "local") {
            certificateFiles = { ...certificateFiles, [key]: (certificateFiles[key] ?? []).filter((_, i) => i !== index) };
        } else {
            const next = (uploadedCertificateFiles[key] ?? []).filter((_, i) => i !== index);
            if (pendingItemID && ref?.avId && ref.columns?.[key]) {
                try {
                    const signature = JSON.stringify(next.map(({ name, content }) => ({ name, content })));
                    const slot = `${pendingItemID}:${key}`;
                    let operation = attachmentWriteKeys.get(slot);
                    if (!operation || operation.signature !== signature) {
                        operation = { signature, key: newOperationKey(`ledger:${pendingItemID}:attachment:${key}`) };
                        attachmentWriteKeys.set(slot, operation);
                    }
                    await setCell(ref.avId, ref.columns[key], pendingItemID, {
                        type: "mAsset",
                        mAsset: next.map(({ name, content }) => ({ name, content })),
                    }, { idempotencyKey: operation.key, retries: 1 });
                    attachmentWriteKeys.delete(slot);
                } catch (e) {
                    showMessage(t("ledger.attachmentRemoveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                    return;
                }
            }
            uploadedCertificateFiles = { ...uploadedCertificateFiles, [key]: next };
        }
    }
    function selectedFileText(key: string): string {
        const count = (certificateFiles[key]?.length ?? 0) + (uploadedCertificateFiles[key]?.length ?? 0);
        return count > 0 ? t("ledger.selectedFiles").replace("${n}", String(count)) : t("ledger.chooseAttachment");
    }
    function handleCertificateCategoryChange(category: string) {
        const hasDraft = active === "certs" && (
            Object.entries(form).some(([key, value]) => key !== "category" && value !== undefined && value !== "" && value !== false)
            || Object.values(certificateFiles).some((files) => files.length > 0)
            || Object.values(uploadedCertificateFiles).some((files) => files.length > 0)
            || !!pendingItemID
        );
        if (lastCertificateCategory && category !== lastCertificateCategory && hasDraft) {
            showMessage(t("ledger.categoryChangeBlocked"), 5000, "error");
            form = { ...form, category: lastCertificateCategory };
            return;
        }
        lastCertificateCategory = category;
        const keep = new Set(["name", "member", "expiry", "status", "x_cert_holder_name", "holder_no", "issue_date", "x_cert_valid_from", "issuance_rule", "store_place", "location", "copy_location", "note"]);
        form = { ...Object.fromEntries(Object.entries(form).filter(([key]) => keep.has(key))), category };
        certificateFiles = Object.fromEntries(Object.entries(certificateFiles).filter(([key]) => key === "attachments"));
        uploadedCertificateFiles = Object.fromEntries(Object.entries(uploadedCertificateFiles).filter(([key]) => key === "attachments"));
    }
            // Saving prevents double submits; retries preserve the item ID and form values.
    let saving = $state(false);
    let saveError = $state("");
    let validationAttempted = $state(false);
    let identityPending = $state(false); // 行已提交但身份未确认（D02）：禁止自动重试，防重复建行
    let savedModule = $state(""); // Brief save confirmation state.
    let pendingItemID = $state<string | null>(null);
    /** Stable key for one new-row submission. Retries after a timeout reuse it
     * so addAttributeViewBlocks cannot create a second detached row. */
    let recordOperationKey = $state<string | null>(null);
    // Keep the duplicate-name confirmation single-flight.  The host confirm
    // dialog is asynchronous while the form remains mounted, so without this
    // guard a rapid double click could open multiple dialogs and create rows
    // more than once after each confirmation.
    let duplicateConfirmPending = $state(false);

    function onNewRecordKeydown(event: KeyboardEvent) {
        if (!newRecordOpen) {
            if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const target = event.target as HTMLElement | null;
                const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
                if (!isInput) {
                    event.preventDefault();
                    const searchEl = document.querySelector<HTMLInputElement>(".lv-ledger-toolbar input[type='search']");
                    searchEl?.focus();
                }
            }
            return;
        }
        // The host duplicate-confirm dialog owns keyboard focus while it is open.
        if (duplicateConfirmPending) return;
        if (event.key === "Tab" && saving) {
            // The form controls are disabled while saving. Keep keyboard focus
            // inside the modal instead of allowing Tab to escape to the page.
            event.preventDefault();
            document.querySelector<HTMLElement>(".lv-record-modal.open[role='dialog']")?.focus();
            return;
        }
        if (saving) return;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (canSubmitNewRecord) void saveNewRecord(event.altKey);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeNewRecord();
            return;
        }
        if (event.key !== "Tab") return;
        const sheet = document.querySelector(".lv-record-modal.open .lv-record-sheet");
        if (!sheet) return;
        const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function fieldLabel(key: string): string {
        return t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key;
    }
    function fieldMetaText(key: string | undefined): string {
        if (!key) return "";
        const value = t(key);
        return value === key ? "" : value;
    }
    function fieldMetaPlaceholder(field: ColumnDef): string {
        return getFieldPlaceholder(field, active, t);
    }
    function captureValidationMessage(field: ColumnDef, issue: CaptureInputError): string {
        return t(`capture.validation.${issue}`)
            .replace("${field}", fieldLabel(field.key))
            .replace("${min}", String(field.min ?? ""))
            .replace("${max}", String(field.max ?? ""));
    }
    function formFieldError(field: ColumnDef): string {
        if (!validationAttempted) return "";
        const issue = validateCaptureInput(field, form[field.key]);
        if (issue) return captureValidationMessage(field, issue);
        if (field.type === "relation") {
            const relationID = String(form[field.key] ?? "").trim();
            if (relationID && !(plugin.settings.members ?? []).some((member) => member.avItemId === relationID)) return t("members.notLinked");
        }
        return "";
    }
    function focusCaptureField(key: string) {
        const control = document.getElementById(`lv-new-${key}`);
        const collapsed = control?.closest("details");
        if (collapsed instanceof HTMLDetailsElement) collapsed.open = true;
        requestAnimationFrame(() => control?.focus());
    }

    function openNewRecord() {
        if (!ref?.avId) {
            showMessage(t("ledger.notProvisionedHint"), 4500, "info");
            return;
        }
        newRecordTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        validationAttempted = false;
        saveError = "";
        newRecordOpen = true;
        requestAnimationFrame(() => nameInput?.focus());
    }

    function restoreNewRecordFocus() {
        const trigger = newRecordTrigger;
        newRecordTrigger = null;
        requestAnimationFrame(() => {
            if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus();
        });
    }

    function closeNewRecord() {
        if (saving) return;
        newRecordOpen = false;
        restoreNewRecordFocus();
    }

    function openPendingLedger() {
        if (!ref?.docId) return;
        closeNewRecord();
        plugin.showTabDocs(ref.docId);
    }

    function discardUncertainDraft() {
        resetForm();
        showMessage(t("ledger.uncertainDraftDiscarded"), 6000, "error");
    }

    function clearNewRecord() {
        if (pendingItemID) {
            void discardPartialRecord();
            return;
        }
        if (!hasAnyInput) {
            resetForm();
            return;
        }
        confirm(t("ledger.clearDraft"), t("ledger.clearDraftConfirm"), () => resetForm());
    }

    async function discardPartialRecord() {
        if (!pendingItemID || !ref?.avId || saving || identityPending) return;
        confirm(t("ledger.discardPartial"), t("ledger.discardPartialConfirm"), async () => {
            saving = true;
            try {
                const { removeLedgerRows } = await import("@/core/siyuan");
                await removeLedgerRows(ref!.avId!, [pendingItemID!], { idempotencyKey: `ledger:discard:${pendingItemID}` });
                resetForm();
                await load();
                try { await plugin.refreshHub([active]); } catch { /* cleanup succeeded; refresh is best effort */ }
                showMessage(t("ledger.discardPartialDone"), 3000, "info");
            } catch (e) {
                showMessage(t("ledger.discardPartialFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            } finally {
                saving = false;
            }
        });
    }

    function saveNewRecord(continueAfter: boolean) {
        if (saving) return;
        identityPending = false;
        closeAfterSave = !continueAfter;
        void createRow();
    }

    function cellValue(type: string, v: any): unknown | null {
        switch (type) {
            case "select": return selectCellValue(v);
            case "relation": {
                // Relations currently target the members ledger. Disabled options may still exist in stale drafts.
                // Validate the selected row ID again before writing it.
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
    const hasAnyInput = $derived(supportableCols.some((e) => {
        const v = form[e.key];
        return e.key === "name" ? !!(v && String(v).trim()) : v !== undefined && v !== "" && v !== false;
    }) || certificateScalarCols.some((e) => form[e.key] !== undefined && form[e.key] !== "" && form[e.key] !== false)
        || quickAssetCols.some((e) => (certificateFiles[e.key]?.length ?? 0) > 0 || (uploadedCertificateFiles[e.key]?.length ?? 0) > 0));
    // A name is required whenever any other field has been entered.
    const nameMissing = $derived(hasAnyInput && !(form.name && String(form.name).trim()));
    const canSubmitNewRecord = $derived(!saving && !nameMissing && !(active === "certs" && !form.category));

    function resetForm() {
        form = {};
        lastCertificateCategory = "";
        certificateFiles = {};
        uploadedCertificateFiles = {};
        saveError = ""; validationAttempted = false; identityPending = false; pendingItemID = null; recordOperationKey = null;
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

    // Detail drawer view/edit state is kept at the UI layer.
    function rawFromValue(type: string, v: any): any {
        switch (type) {
            case "number": return v?.number?.isNotEmpty && typeof v.number.content === "number" ? v.number.content : "";
            case "date": return v?.date?.isNotEmpty ? localDateKey(new Date(v.date.content)) : "";
            case "checkbox": return !!v?.checkbox?.checked;
            case "select": return selectCellContent(v) ?? "";
            case "url": return v?.url?.content ?? "";
            default: return v?.text?.content ?? "";
        }
    }

    // Select a person from the shared contacts picker.
    function pickFromContacts(onPicked: (snapshot: string) => void) {
        openContactPicker({
            t: (key, vars) => {
                let out = t(key);
                if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`\${${k}}`, v);
                return out;
            },
            showMessage: (msg, timeout, type) => showMessage(msg, timeout, type),
        }, onPicked);
    }

    // Row click opens a detail drawer; user content is assigned through DOM APIs.
    function openDetail(row: any, vehicleAction?: "fuel" | "charging" | "maintenance" | "edit", activityTarget?: ActivityTarget) {
        if (!ref?.columns) return;
        // Show the row name in the drawer header, with a generic fallback.
        const detailTitle = (ref.columns.name && cellText(row.cells?.[ref.columns.name], "name")) || t("ledger.detail");
        const dlg = new Dialog({
            title: detailTitle,
            content: `<div class="b3-dialog__content b3-dialog__content--wrap" id="lv-detail-body" style="max-height:60vh;overflow:auto"></div>
<div class="b3-dialog__action lv-detail-actions"><button class="b3-button b3-button--text ft__error" id="lv-detail-del" style="color:var(--lv-danger)">${t("delete")}</button><button class="b3-button b3-button--text" id="lv-detail-duplicate">📋 ${t("ledger.duplicateRow")}</button><span class="fn__flex-1"></span><details class="lv-detail-more"><summary class="b3-button b3-button--outline">${t("ledger.detailMore")}</summary><div class="lv-detail-more-menu"><button class="b3-button b3-button--cancel" id="lv-detail-card-copy">${t("ledger.copyAsImage")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-png">${t("ledger.downloadPng")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-text">${t("ledger.copyAsText")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-masked-text">${t("ledger.copyAsMaskedText")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-ref">🔗 ${t("ledger.copyBlockRef")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-embed">📑 ${t("ledger.copyBlockEmbed")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-task">☑️ ${t("ledger.copyAsTaskBlock")}</button><button class="b3-button b3-button--cancel" id="lv-detail-push-glean">📖 ${t("ledger.pushToGlean")}</button><button class="b3-button b3-button--cancel" id="lv-detail-open">${t("ledger.openDoc")} →</button></div></details><button class="b3-button b3-button--cancel" id="lv-detail-close">${t("close")}</button><button class="b3-button" id="lv-detail-edit">${t("ledger.detailEditAll")}</button></div>`,
            width: "520px",
        });
        const body = dlg.element.querySelector("#lv-detail-body") as HTMLElement;
        const vehicleActionQueue = createVehicleActionQueue();
        const showVehicleActionError = (error: string) =>
            showMessage(t("ledger.logReadFailed") + " (" + error + ")", 6000, "error");
        const markActivityLine = (line: HTMLElement) => {
            if (!activityTarget?.activityId) return;
            line.classList.add("lv-activity-target");
            line.setAttribute("aria-current", "location");
            line.tabIndex = -1;
            line.style.cssText += ";border-radius:6px;background:var(--lv-accent-soft);outline:2px solid var(--lv-accent);outline-offset:2px;padding:7px";
            requestAnimationFrame(() => {
                if (!dlg.element.isConnected || !line.isConnected) return;
                line.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                line.focus({ preventScroll: true });
            });
        };
        const requestVehicleAction = (action: VehicleQuickAction, notifyQueued = true) => {
            const result = vehicleActionQueue.request(action);
            if (result.status === "queued" && notifyQueued) showMessage(t("vehicle.quickLoading"), 2500, "info");
            else if (result.status === "failed") showVehicleActionError(result.error ?? "");
        };
        const failVehicleActions = (actions: readonly VehicleQuickAction[], error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            for (const action of actions) vehicleActionQueue.fail(action, detail);
            showVehicleActionError(detail);
        };
        body.classList.toggle("lv-detail-body-vehicle", active === "vehicles");
        const rowCategory = active === "certs" ? selectCellContent(row.cells?.[ref.columns.category ?? ""]) : undefined;
        const activeCertFields = active === "certs" ? new Set(getCertificateProfile(rowCategory).fieldKeys) : null;
        const schemaCols: any[] = (plugin.schemaCatalog?.[active]?.columns ?? []).filter((col: any) =>
            active !== "certs" || !String(col.key).startsWith("x_cert_") || activeCertFields?.has(col.key));
        // Editable scalar fields are handled here; complex relations remain in the host view.
        const EDITABLE = new Set(["text", "number", "date", "select", "url", "checkbox"]);
        const colLabel = (col: any) => (t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.key);
        function labelSpan(col: any) {
            const k = document.createElement("span");
            k.className = "ft__on-surface";
            k.style.cssText = minW96Shrink0Css;
            k.textContent = colLabel(col);
            return k;
        }
        /**
         * Inline field editing keeps the detail view useful for quick corrections.
         * Scalar cells are edited in place; relations, assets and blocks keep their
         * dedicated actions so a click never opens an incomplete picker.
         */
        function inlineEditHint(): string {
            const translated = t("ledger.inlineEditHint");
            return translated === "ledger.inlineEditHint" ? "点击字段值即可编辑" : translated;
        }
        function beginInlineEdit(col: any, keyID: string, line: HTMLElement, valueEl: HTMLElement) {
            import("@/core/inline-edit").then(({ beginInlineEdit: runInlineEdit }) => {
                runInlineEdit({
                    col,
                    keyID,
                    line,
                    valueEl,
                    row,
                    ref: ref!,
                    active,
                    t,
                    rawFromValueFn: rawFromValue,
                    showMessageFn: showMessage,
                    hasContactsBridge: !!getContactsBridge(),
                    onPickContact: pickFromContacts,
                    onSaveSuccess: async () => {
                        await load();
                        try { await plugin.refreshHub([active]); } catch { /* soft */ }
                        dlg.destroy();
                        const fresh = rows.find((entry) => entry.itemID === row.itemID);
                        if (fresh) openDetail(fresh);
                    },
                });
            });
        }
        function addHistorySection() {
            const history = (plugin.runtime?.renewHistory?.[row.itemID] ?? []) as { from: string; to: string; at: string }[];
            if (history.length === 0) return;
            const head = document.createElement("div");
            head.className = "ft__on-surface";
            head.style.cssText = sectionHeadBorderCss;
            head.textContent = t("ledger.renewHistory");
            body.appendChild(head);
            for (const h of history) {
                const line = document.createElement("div");
                if (active === "vehicles") line.className = "lv-detail-wide";
                line.style.cssText = substRowCss;
                line.textContent = `${h.from} → ${h.to} · ${h.at.slice(0, 10)}`;
                body.appendChild(line);
            }
        }
        function addAttachmentsSection() {
            const assetCols = schemaCols.filter((col) => col.type === "mAsset" && ref!.columns[col.key]);
            if (!assetCols.length) return;
            import("@/core/attachment-drawer").then(({ renderAttachmentDrawerSection }) => {
                renderAttachmentDrawerSection({
                    body,
                    assetCols,
                    ref: ref!,
                    row,
                    active,
                    t,
                    DialogCls: Dialog,
                    showMessageFn: showMessage,
                    onUploadSuccess: async () => {
                        dlg.destroy();
                        await load();
                    },
                });
            });
        }
        // View mode includes key/value rows, history, and attachments.
        let cardRows: { key?: string; label: string; value: string }[] = [];
        function buildView() {
            body.innerHTML = "";
            cardRows = [];
            const editAction = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement;
            const closeAction = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement;
            editAction.textContent = t("ledger.detailEditAll");
            editAction.onclick = () => buildEdit();
            closeAction.textContent = t("close");
            closeAction.onclick = () => dlg.destroy();
            (dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement).hidden = false;
            const intro = document.createElement("p");
            intro.className = "lv-detail-wide lv-detail-intro";
            intro.textContent = inlineEditHint();
            body.append(intro);
            for (const col of schemaCols) {
                const keyID = ref!.columns[col.key];
                if (!keyID) continue;
                const line = document.createElement("div");
                line.className = active === "vehicles" ? "fn__flex lv-detail-kv" : "fn__flex";
                line.style.cssText = "gap:10px;padding:7px 0;font-size:13px;min-width:0";
                line.append(labelSpan(col));
                const v = document.createElement("span");
                v.style.cssText = wordBreakAllCss;
                // 提案 B/210 波：金额白名单列的数值走千分位显示（CSV/导入仍为机器可读原始值）
                const cell = row.cells[keyID];
                if (AMOUNT_KEYS.has(col.key) && cell?.type === "number" && cell?.number?.isNotEmpty && typeof cell.number.content === "number") {
                    v.textContent = formatAmount(cell.number.content);
                } else {
                    v.textContent = cellText(cell, col.key); // 211 波：select 值走枚举 i18n
                }
                // Sensitive certificate values are masked by default and can be explicitly revealed.
                if (active === "certs" && ["x_cert_id_number", "holder_no", "x_cert_birth_registration_no_last4", "x_cert_vocational_registration_last4", "x_cert_professional_registration_last4", "x_cert_graduation_no_last4", "x_cert_degree_no_last4"].includes(col.key)) {
                    const full = String(rawFromValue("text", cell) ?? "").trim();
                    if (full) {
                        const mask = col.key === "x_cert_id_number" ? maskIdNumber(full) : maskCredentialNumber(full);
                        v.textContent = mask;
                        const reveal = document.createElement("button");
                        reveal.className = "b3-button b3-button--text";
                        reveal.style.cssText = pad06Fs12Css;
                        reveal.textContent = t("ledger.idNumberShow");
                        let shown = false;
                        reveal.onclick = () => {
                            shown = !shown;
                            v.textContent = shown ? full : mask;
                            reveal.textContent = shown ? t("ledger.idNumberHide") : t("ledger.idNumberShow");
                        };
                        const copy = document.createElement("button");
                        copy.className = "b3-button b3-button--text";
                        copy.style.cssText = pad06Fs12Css;
                        copy.textContent = t("ledger.idNumberCopy");
                        copy.onclick = async () => {
                            try {
                                await navigator.clipboard.writeText(full);
                                showMessage(t("ledger.idNumberCopied"), 2500, "info");
                            } catch {
                                showMessage(t("ledger.copyAsImageFail"), 4000, "error");
                            }
                        };
                        line.append(reveal, copy);
                        // Valid ID cards can fill a linked member's birth date.
                        // Other certificate numbers support reveal/copy without ID parsing.
                        const parsedId = col.key === "x_cert_id_number" ? parseIdNumber(full) : null;
                        const memberBid = ref.columns.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;
                        const member = memberBid ? (plugin.settings.members ?? []).find(m => m.avItemId === memberBid) : undefined;
                        if (parsedId?.ok && parsedId.birth && member && !member.birthday && !member.lunarBirthday) {
                            const birthFill = document.createElement("button");
                            birthFill.className = "b3-button b3-button--text";
                            birthFill.style.cssText = pad06Fs12Css;
                            birthFill.textContent = t("ledger.idBirthFill").replace("${birth}", parsedId.birth);
                            birthFill.onclick = async () => {
                                const target = (plugin.settings.members ?? []).find(m => m.id === member.id);
                                if (!target || target.birthday) return;
                                const previousBirthday = target.birthday;
                                target.birthday = parsedId.birth;
                                try {
                                    const { updateMember } = await import("@/core/members");
                                    await updateMember(plugin as any, plugin.settings, target);
                                    // Filling a member birthday changes the
                                    // birthday reminder provider immediately.
                                    await plugin.refreshHub(undefined, true);
                                    showMessage(t("ledger.idBirthFilled").replace("${birth}", parsedId.birth), 3000, "info");
                                    birthFill.disabled = true;
                                } catch (e) {
                                    target.birthday = previousBirthday;
                                    showMessage(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
                                }
                            };
                            line.append(birthFill);
                        }
                    }
                }
            if (EDITABLE.has(col.type)) {
                if (!v.textContent?.trim() || v.textContent === "—") {
                    v.textContent = t("ledger.detailEmpty");
                    v.classList.add("is-empty");
                }
                v.addEventListener("click", () => beginInlineEdit(col, keyID, line, v));
                v.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        beginInlineEdit(col, keyID, line, v);
                    }
                });
                v.tabIndex = 0;
                v.role = "button";
                v.title = inlineEditHint();
                v.classList.add("lv-detail-value");
                v.setAttribute("aria-label", `${colLabel(col)}：${v.textContent}`);
                v.style.cssText += ";cursor:text;min-height:22px;display:inline-flex;align-items:center;flex:1;min-width:0;border-radius:4px;padding:1px 4px;margin:-1px -4px;transition:background .15s ease";
                v.dataset.lvEditable = "true";
            }
                line.append(v);
                body.appendChild(line);
                cardRows.push({ key: col.key, label: colLabel(col), value: v.classList.contains("is-empty") ? "—" : String(v.textContent) });
            }
            // Append user-created columns outside the schema as a read-only section.
            const schemaKeyIDs = new Set(Object.values<string>(ref!.columns));
            const customCols = avCols.filter((c: any) => c?.id && !schemaKeyIDs.has(c.id) && String(c.name ?? "").trim() !== "");
            if (customCols.length > 0) {
                const head = document.createElement("div");
                head.className = "ft__on-surface";
                head.style.cssText = sectionHeadBorderCss;
                head.textContent = t("ledger.customCols");
                body.appendChild(head);
                for (const c of customCols) {
                    const line = document.createElement("div");
                    line.className = active === "vehicles" ? "fn__flex lv-detail-wide" : "fn__flex";
                    line.style.cssText = "gap:10px;padding:4px 0;font-size:13px";
                    const k = document.createElement("span");
                    k.className = "ft__on-surface";
                    k.style.cssText = minW96Shrink0Css;
                    k.textContent = String(c.name);
                    line.append(k);
                    const v = document.createElement("span");
                    v.style.cssText = wordBreakAllCss;
                    v.textContent = cellText(row.cells[c.id]);
                    if (EDITABLE.has(c.type)) {
                        if (!v.textContent?.trim() || v.textContent === "—") { v.textContent = t("ledger.detailEmpty"); v.classList.add("is-empty"); }
                        v.addEventListener("click", () => beginInlineEdit({ ...c, key: c.id }, c.id, line, v));
                        v.addEventListener("keydown", (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                beginInlineEdit({ ...c, key: c.id }, c.id, line, v);
                            }
                        });
                        v.tabIndex = 0;
                        v.role = "button";
                        v.title = inlineEditHint();
                        v.classList.add("lv-detail-value");
                        v.setAttribute("aria-label", `${c.name}：${v.textContent}`);
                        v.style.cssText += ";cursor:text;min-height:22px;display:inline-flex;align-items:center;flex:1;min-width:0;border-radius:4px;padding:1px 4px;margin:-1px -4px;transition:background .15s ease";
                    }
                    line.append(v);
                    body.appendChild(line);
                    cardRows.push({ label: String(c.name), value: cellText(row.cells[c.id]) });
                }
            }
        // Shared row-log timeline section; deletion cleanup is handled with the row.
        async function addRowLogSection(opts: {
            title: string;
            emptyText: string;
            addLabel: string;
            kind?: LogKind;
            fields: { key: string; type: "date" | "number" | "text"; placeholder: string; width: number }[];
            load: () => Promise<Record<string, any>[]>;
            add: (vals: Record<string, string>) => Promise<boolean>;
            remove: (entry: Record<string, any>) => Promise<void>;
            format: (entry: Record<string, any>) => string;
        }) {
            const section = document.createElement("div");
            let loaded: Record<string, any>[] = [];
            let loadFailed = false;
            const render = () => {
                section.replaceChildren();
                for (const e of loaded) {
                    const line = document.createElement("div");
                    line.style.cssText = `${substRowCss};display:flex;gap:6px;align-items:center`;
                    if (opts.kind) {
                        line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, opts.kind, e);
                        if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);
                    }
                    const text = document.createElement("span");
                    text.textContent = opts.format(e);
                    const del = document.createElement("button");
                    del.className = "b3-button b3-button--text";
                    del.style.cssText = "padding:0 4px;font-size:12px";
                    del.textContent = t("delete");
                    del.onclick = async () => {
                        del.disabled = true;
                        try {
                            await opts.remove(e);
                        } catch (err) {
                            showMessage(t("ledger.logDeleteFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                            del.disabled = false;
                            return;
                        }
                        loaded = loaded.filter((item) => item !== e);
                        loadFailed = false;
                        render();
                        try {
                            loaded = await opts.load();
                            render();
                        } catch (err) {
                            loadFailed = true;
                            render();
                            showMessage(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                        }
                    };
                    line.append(text, del);
                    section.appendChild(line);
                }
                if (loadFailed) {
                    const error = document.createElement("div");
                    error.className = "ft__on-surface";
                    error.style.cssText = "font-size:12.5px;color:var(--lv-danger)";
                    error.textContent = t("ledger.logReadFailed");
                    section.appendChild(error);
                } else if (loaded.length === 0) {
                    const none = document.createElement("div");
                    none.className = "ft__on-surface";
                    none.style.cssText = fs125Css;
                    none.textContent = opts.emptyText;
                    section.appendChild(none);
                }
            };
            const head = document.createElement("div");
            head.className = "ft__on-surface";
            head.style.cssText = sectionHeadBorderCss;
            head.textContent = opts.title;
            body.appendChild(head);
            body.appendChild(section);
            const form = document.createElement("div");
            form.style.cssText = `${flexCenterGap6Css};margin-top:6px;flex-wrap:wrap`;
            const inputs: Record<string, HTMLInputElement> = {};
            for (const f of opts.fields) {
                const inp = document.createElement("input");
                inp.type = f.type;
                inp.className = "b3-text-field";
                inp.placeholder = f.placeholder;
                inp.style.cssText = `width:${f.width}px;font-size:12px`;
                if (f.type === "date") inp.value = localDateKey(new Date());
                inp.onkeydown = (e: KeyboardEvent) => {
                    if (e.key === "Enter" && !e.isComposing) {
                        e.preventDefault();
                        addBtn.click();
                    }
                };
                inputs[f.key] = inp;
                form.appendChild(inp);
            }
            const addBtn = document.createElement("button");
            addBtn.className = "b3-button b3-button--outline";
            addBtn.style.cssText = "font-size:12px";
            addBtn.textContent = opts.addLabel;
            addBtn.onclick = async () => {
                if (addBtn.disabled) return;
                const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
                if (!vals.date) {
                    showMessage(t("ledger.logInvalid"), 3000, "error");
                    return;
                }
                addBtn.disabled = true;
                try {
                    if (await opts.add(vals)) {
                        for (const i of Object.values(inputs)) i.value = "";
                        loadFailed = false;
                        try {
                            loaded = await opts.load();
                        } catch (err) {
                            loadFailed = true;
                            showMessage(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                        }
                        render();
                    }
                } catch (err) {
                    showMessage(t("ledger.logSaveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                } finally {
                    addBtn.disabled = false;
                }
            };
            form.appendChild(addBtn);
            body.appendChild(form);
            try {
                loaded = await opts.load();
            } catch (err) {
                loadFailed = true;
                showMessage(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
            }
            render();
        }

        addHistorySection();
        addAttachmentsSection();
        // 26.6 QR 标签（路线图 QR 项，235 波接线）：扫码直达——行有绑定块用块深链，否则回退台账文档深链
        addQrSection();

        function addQrSection() {
            const nameKey = ref?.columns?.name;
            const nameVal = nameKey ? row.cells?.[nameKey] : undefined;
            const blockId = nameVal?.type === "block" ? nameVal.block?.id : undefined;
            const link = blockDeepLink(blockId || ref?.docId || "");
            const wrap = document.createElement("div");
            if (active === "vehicles") wrap.className = "lv-detail-wide";
            wrap.style.cssText = wrapBorderCss;
            const head = document.createElement("p");
            head.style.cssText = "font-size:12px;margin:0 0 6px;color:var(--lv-tx-2)";
            head.textContent = t("ledger.qrTitle");
            const rowEl = document.createElement("div");
            rowEl.style.cssText = `${flexCenterGap6Css};gap:10px`;
            const img = document.createElement("img");
            img.alt = "QR";
            img.style.cssText = "width:96px;height:96px;border:1px solid var(--lv-line);border-radius:8px;padding:4px;background:#fff;flex-shrink:0";
            const hint = document.createElement("span");
            hint.style.cssText = "font-size:12px;color:var(--lv-tx-2);flex:1";
            hint.textContent = t("ledger.qrHint");
            rowEl.append(img, hint);
            wrap.append(head, rowEl);
            body.appendChild(wrap);
            generateQRDataUrl(link, 128).then((url) => { img.src = url; }).catch(() => { wrap.remove(); });
        }
        // Module timelines share the rowlogs storage and are read-only here.
        (async () => {
            const rl = await import("@/core/rowlog");
            const at = () => new Date().toISOString();
            const fresh = () => rl.loadRowLogs(plugin as any);
            if (active === "vehicles") {
                const { renderVehicleDetailSections } = await import("@/core/vehicle-drawer");
                await renderVehicleDetailSections({
                    body,
                    row,
                    ref: ref!,
                    active,
                    plugin,
                    t,
                    DialogCls: Dialog,
                    showMessageFn: showMessage,
                    cellTextFn: cellText,
                    selectContentFn: selectCellContent,
                    rawFromValueFn: rawFromValue,
                    activityTarget,
                    vehicleActionQueue,
                    onLogUpdated: async () => {
                        try { await plugin.refreshHub(["vehicles"], true); } catch { /* soft */ }
                    },
                });
            }
            // Keep the assets-real module ID aligned with the CSV import entry point.
            if (active === "assets-real") {
                const costVal = Number(row.cells?.[ref.columns?.amount ?? ""]?.number?.content);
                const dateVal = String(rawFromValue("date", row.cells?.[ref.columns?.date ?? ""]) ?? "").slice(0, 10);
                if (Number.isFinite(costVal) && costVal > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
                    const { calculateAssetDepreciation } = await import("@/core/depreciation");
                    const dep = calculateAssetDepreciation({ initialCost: costVal, purchaseDate: dateVal });
                    if (dep) {
                        const depCard = document.createElement("section");
                        depCard.className = "lv-card";
                        depCard.style.cssText = "margin-top:10px;padding:10px 12px;background:var(--lv-surface-2);border:1px solid var(--lv-line);border-radius:8px";
                        depCard.innerHTML = `
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                <b style="font-size:12.5px;color:var(--lv-tx)">📉 资产折旧与法定残值测算</b>
                                <span class="lv-badge" style="font-size:11px">${dep.statusLabel}</span>
                            </div>
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;font-size:11.5px;color:var(--lv-tx-2)">
                                <div>购入原值: <b style="color:var(--lv-tx)">¥${formatAmount(dep.initialCost)}</b></div>
                                <div>当前估算净值: <b style="color:var(--lv-accent)">¥${formatAmount(dep.currentNetValue)}</b></div>
                                <div>已服役月数: <b style="color:var(--lv-tx)">${dep.usedMonths} / ${dep.lifespanMonths} 月</b></div>
                                <div>累计计提折旧: <b style="color:var(--lv-danger)">¥${formatAmount(dep.accumulatedDepreciation)}</b></div>
                            </div>
                            <div class="lv-caption" style="margin-top:6px;color:var(--lv-tx-3)">💡 ${dep.suggestion}</div>
                        `;
                        body.appendChild(depCard);
                    }
                }
                await addRowLogSection({
                    title: t("ledger.valuations"), emptyText: t("ledger.noValuations"), addLabel: t("ledger.valAdd"), kind: "valuations",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "value", type: "number", placeholder: t("ledger.valValue"), width: 100 },
                    ],
                    load: () => fresh().then((l) => rl.getValuations(l, ref!.avId!, row.itemID)),
                    add: async (v) => {
                        if (!Number.isFinite(Number(v.value))) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendValuation(current, ref!.avId!, row.itemID, v.date, Number(v.value), at()));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeValuation(current, ref!.avId!, row.itemID, e.date)); },
                    format: (e) => `${e.date} · ${e.value}`,
                });
                await addRowLogSection({
                    title: t("ledger.moves"), emptyText: t("ledger.noMoves"), addLabel: t("ledger.valAdd"), kind: "moves",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "from", type: "text", placeholder: t("ledger.moveFrom"), width: 90 },
                        { key: "to", type: "text", placeholder: t("ledger.moveTo"), width: 90 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "moves")),
                    add: async (v) => {
                        if (!v.from || !v.to) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "moves", { date: v.date, from: v.from, to: v.to, at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "moves", e)); },
                    format: (e) => `${e.date} · ${e.from} → ${e.to}`,
                });
            } else if (active === "shopping") {
                // Wish progress combines target_amount with deposit row logs.
                (async () => {
                    const targetCell = row.cells[ref!.columns.target_amount ?? ""]?.number;
                    const target = targetCell?.isNotEmpty && typeof targetCell.content === "number" ? targetCell.content : undefined;
                    const logs = await rl.loadRowLogs(plugin as any);
                    const entries = rl.getEntries<any>(logs, ref!.avId!, row.itemID, "deposits");
                    const saved = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
                    if (target !== undefined || entries.length > 0) {
                        const head = document.createElement("div");
                        head.style.cssText = "margin-top:10px;font-size:12px";
                        const line = document.createElement("div");
                        line.className = "lv-caption";
                        line.textContent = `${t("ledger.savedOf").replace("${s}", formatAmount(saved)).replace("${t2}", target !== undefined ? formatAmount(target) : "—")}${target !== undefined && target > 0 ? ` (${Math.min(999, Math.round((saved / target) * 100))}%)` : ""}`;
                        head.appendChild(line);
                        // Progress bars cap their visual width at 100%.
                        if (target !== undefined && target > 0) {
                            const bar = document.createElement("div");
                            bar.style.cssText = "height:6px;border-radius:3px;background:var(--lv-surface-2);overflow:hidden;margin-top:4px";
                            const fill = document.createElement("div");
                            fill.style.cssText = `height:100%;width:${Math.min(100, Math.round((saved / target) * 100))}%;background:var(--lv-accent)`;
                            bar.appendChild(fill);
                            head.appendChild(bar);
                        }
                        body.appendChild(head);
                    }
                })().catch((e) => {
                    showMessage(t("ledger.logReadFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                });
                await addRowLogSection({
                    title: t("ledger.deposits"), emptyText: t("ledger.noDeposits"), addLabel: t("ledger.valAdd"), kind: "deposits",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "amount", type: "number", placeholder: t("ledger.depositAmt"), width: 100 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "deposits")),
                    add: async (v) => {
                        if (!v.date || !Number.isFinite(Number(v.amount))) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "deposits", { date: v.date, amount: Number(v.amount), at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "deposits", e)); },
                    format: (e) => `${e.date} · +${e.amount}`,
                });
                await addRowLogSection({
                    title: t("ledger.prices"), emptyText: t("ledger.noPrices"), addLabel: t("ledger.valAdd"), kind: "prices",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "price", type: "number", placeholder: t("ledger.priceValue"), width: 90 },
                        { key: "channel", type: "text", placeholder: t("ledger.priceChannel"), width: 100 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "prices")),
                    add: async (v) => {
                        if (!Number.isFinite(Number(v.price))) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "prices", { date: v.date, price: Number(v.price), channel: v.channel, at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "prices", e)); },
                    format: (e) => `${e.date} · ${formatAmount(Number(e.price))}${e.channel ? ` · ${e.channel}` : ""}`,
                });
            } else if (active === "chores") {
                // 310/313 波：家务轮换（动态加载 core/chore-dialog.ts）
                const { addChoreRotationSectionImpl } = await import("@/core/chore-dialog");
                await addChoreRotationSectionImpl({ t, plugin, avId: ref!.avId!, rowId: row.itemID, body, showMessageFn: showMessage });
            } else if (active === "health") {
                // 314 波（G5）：生理指标（血压/血糖/心率）趋势与留痕
                const { addVitalsSectionImpl } = await import("@/core/vitals-dialog");
                await addVitalsSectionImpl({ t, plugin: plugin as any, avId: ref!.avId!, rowId: row.itemID, body, showMessageFn: showMessage });
            } else if (active === "schooling") {
                await addRowLogSection({
                    title: t("ledger.transfers"), emptyText: t("ledger.noTransfers"), addLabel: t("ledger.valAdd"), kind: "transfers",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "from", type: "text", placeholder: t("ledger.transferFrom"), width: 90 },
                        { key: "to", type: "text", placeholder: t("ledger.transferTo"), width: 90 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "transfers")),
                    add: async (v) => {
                        if (!v.from || !v.to) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "transfers", { date: v.date, from: v.from, to: v.to, at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "transfers", e)); },
                    format: (e) => `${e.date} · ${e.from} → ${e.to}`,
                });
            } else if (active === "house") {
                // Utility meter logs record usage as the positive delta from the previous reading.
                await addRowLogSection({
                    title: t("ledger.meters"), emptyText: t("ledger.noMeters"), addLabel: t("ledger.valAdd"), kind: "meters",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "reading", type: "number", placeholder: t("ledger.meterReading"), width: 110 },
                    ],
                    load: () => fresh().then((l) => rl.getMeterReadings(l, ref!.avId!, row.itemID)),
                    add: async (v) => {
                        if (!v.date || !Number.isFinite(Number(v.reading))) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendMeterReading(current, ref!.avId!, row.itemID, v.date, Number(v.reading), at()));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeMeterReading(current, ref!.avId!, row.itemID, e.date)); },
                    format: (e: any) => `${e.date} · ${e.reading}${typeof e.usage === "number" ? ` (${e.usage})` : ""}`,
                });

                // §16 房屋保修期与关联合同只读联动核对
                const contractsRef = plugin.settings.dbRefs?.contracts;
                if (contractsRef?.avId && contractsRef?.columns) {
                    const houseWarrantySection = document.createElement("div");
                    houseWarrantySection.className = "lv-detail-section";
                    houseWarrantySection.style.cssText = sectionBorderCss;

                    const head = document.createElement("div");
                    head.style.cssText = sectionHeaderCss;
                    const title = document.createElement("span");
                    title.className = "ft__on-surface";
                    title.style.cssText = sectionTitleCss;
                    title.textContent = t("ledger.houseContractsTitle");
                    head.append(title);
                    if (contractsRef.docId) {
                        const openAll = document.createElement("button");
                        openAll.className = "b3-button b3-button--text";
                        openAll.style.cssText = linkBtnCss;
                        openAll.textContent = t("ledger.houseContractsOpenAll");
                        openAll.onclick = () => plugin.showTabDocs(contractsRef.docId);
                        head.append(openAll);
                    }
                    houseWarrantySection.append(head);

                    const contentWrap = document.createElement("div");
                    contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
                    contentWrap.innerHTML = `<span class="lv-caption">${t("ledger.loading")}</span>`;
                    houseWarrantySection.append(contentWrap);
                    body.appendChild(houseWarrantySection);

                    void (async () => {
                        try {
                            const contractAll = await renderLedgerAll(contractsRef.avId!);
                            const { matchHouseContracts } = await import("@/core/contracts");
                            const matched = matchHouseContracts(row, ref!.columns, contractAll.rows, contractsRef.columns);
                            contentWrap.replaceChildren();
                            if (matched.length === 0) {
                                const empty = document.createElement("span");
                                empty.className = "lv-caption";
                                empty.textContent = t("ledger.houseContractsEmpty");
                                contentWrap.append(empty);
                                return;
                            }
                            for (const m of matched) {
                                const line = document.createElement("div");
                                line.style.cssText = lineBadgeCss;
                                const nameSpan = document.createElement("b");
                                nameSpan.style.cssText = "font-size:12.5px;color:var(--lv-tx)";
                                nameSpan.textContent = m.title;

                                const badge = document.createElement("span");
                                if (m.warrantyStatus === "valid") {
                                    badge.className = "lv-badge green";
                                    badge.textContent = t("ledger.warrantyValid");
                                } else if (m.warrantyStatus === "expiring") {
                                    badge.className = "lv-badge orange";
                                    badge.textContent = t("ledger.warrantyExpiring");
                                } else if (m.warrantyStatus === "expired") {
                                    badge.className = "lv-badge gray";
                                    badge.textContent = t("ledger.warrantyExpired");
                                } else {
                                    badge.className = "lv-badge gray";
                                    badge.textContent = t("ledger.warrantyUnknown");
                                }

                                const metaSpan = document.createElement("span");
                                metaSpan.className = "lv-caption";
                                metaSpan.style.cssText = "margin-left:auto;font-size:11.5px";
                                const parts = [];
                                if (m.party || m.contact) parts.push(m.party || m.contact);
                                if (m.expiry) parts.push(m.daysLeft !== undefined && m.daysLeft >= 0 ? `${m.expiry} (${m.daysLeft}d)` : m.expiry);
                                metaSpan.textContent = parts.join(" · ");

                                line.append(nameSpan, badge, metaSpan);
                                contentWrap.append(line);
                            }
                        } catch (err) {
                            contentWrap.innerHTML = `<span class="lv-caption" style="color:var(--lv-danger)">${t("ledger.houseContractsFailed")}</span>`;
                        }
                    })();
                }
            } else if (active === "food") {
                const foodName = (ref?.columns?.name && cellText(row.cells[ref.columns.name])) || "";
                const ingredientsRaw = (ref?.columns?.ingredients && cellText(row.cells[ref.columns.ingredients])) || "";
                if (foodName || (ingredientsRaw && ingredientsRaw !== "—")) {
                    const foodDietarySection = document.createElement("div");
                    foodDietarySection.className = "lv-detail-section";
                    foodDietarySection.style.cssText = sectionBorderCss;

                    const head = document.createElement("div");
                    head.style.cssText = sectionHeaderCss;
                    const title = document.createElement("span");
                    title.className = "ft__on-surface";
                    title.style.cssText = sectionTitleCss;
                    title.textContent = t("ledger.foodDietaryTitle");
                    head.append(title);
                    foodDietarySection.append(head);

                    const contentWrap = document.createElement("div");
                    contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
                    foodDietarySection.append(contentWrap);
                    body.appendChild(foodDietarySection);

                    void (async () => {
                        const healthRef = plugin.settings.dbRefs?.health;
                        let healthRows: any[] | undefined;
                        if (healthRef?.avId) {
                            try {
                                const healthAll = await renderLedgerAll(healthRef.avId);
                                healthRows = healthAll.rows;
                            } catch {
                                // 静默降级
                            }
                        }
                        const { matchFoodDietaryConflicts, formatShoppingIngredientsText } = await import("@/core/food");
                        const check = matchFoodDietaryConflicts(
                            foodName,
                            ingredientsRaw !== "—" ? ingredientsRaw : "",
                            plugin.settings.members ?? [],
                            healthRows,
                            healthRef?.columns,
                        );

                        contentWrap.replaceChildren();

                        if (check.isSafe) {
                            const safeBadge = document.createElement("div");
                            safeBadge.style.cssText = "padding:8px 12px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-accent);color:var(--lv-accent);font-size:12px";
                            safeBadge.textContent = `✓ ${t("ledger.foodDietarySafe")}`;
                            contentWrap.append(safeBadge);
                        } else {
                            for (const c of check.conflicts) {
                                const alertEl = document.createElement("div");
                                if (c.type === "allergy") {
                                    alertEl.style.cssText = dangerAlertCss;
                                    alertEl.innerHTML = `<span>🚨 <b>${c.memberName}</b>：${t("ledger.foodAllergyAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}${c.detail ? ` (${c.detail})` : ""}</span>`;
                                } else {
                                    alertEl.style.cssText = warnAlertCss;
                                    alertEl.innerHTML = `<span>⚠️ <b>${c.memberName}</b>：${t("ledger.foodDislikeAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}</span>`;
                                }
                                contentWrap.append(alertEl);
                            }
                        }

                        if (check.parsedIngredients.length > 0) {
                            const actionRow = document.createElement("div");
                            actionRow.style.cssText = actionRowEndCss;
                            const copyIngBtn = document.createElement("button");
                            copyIngBtn.className = "b3-button b3-button--outline";
                            copyIngBtn.style.cssText = fs12Pad38Css;
                            copyIngBtn.textContent = `＋ ${t("ledger.foodCopyIngredients")}`;
                            copyIngBtn.onclick = async () => {
                                const text = formatShoppingIngredientsText(foodName, check.parsedIngredients);
                                try {
                                    await navigator.clipboard.writeText(text);
                                    showMessage(t("ledger.foodIngredientsCopied"), 2500, "info");
                                } catch {
                                    showMessage(t("ledger.copyAsImageFail"), 4000, "error");
                                }
                            };
                            actionRow.append(copyIngBtn);
                            contentWrap.append(actionRow);
                        }
                    })();
                }
            } else if (active === "schooling") {
                const catVal = ref?.columns?.category ? cellText(row.cells[ref.columns.category]) : "";
                const enrollRaw = ref?.columns?.enroll_year ? cellText(row.cells[ref.columns.enroll_year]) : "";
                const enrollYear = Number(enrollRaw);
                const statusVal = ref?.columns?.status ? cellText(row.cells[ref.columns.status]) : "enrolled";

                if (catVal && Number.isFinite(enrollYear) && enrollYear >= 1980) {
                    const schoolStageSection = document.createElement("div");
                    schoolStageSection.className = "lv-detail-section";
                    schoolStageSection.style.cssText = sectionBorderCss;

                    const head = document.createElement("div");
                    head.style.cssText = sectionHeaderCss;
                    const title = document.createElement("span");
                    title.className = "ft__on-surface";
                    title.style.cssText = sectionTitleCss;
                    title.textContent = t("ledger.schoolingStageTitle");
                    head.append(title);
                    schoolStageSection.append(head);

                    const contentWrap = document.createElement("div");
                    contentWrap.style.cssText = boxContentCss;
                    schoolStageSection.append(contentWrap);
                    body.appendChild(schoolStageSection);

                    void (async () => {
                        const { calculateSchoolingStage } = await import("@/core/schooling");
                        const stage = calculateSchoolingStage({
                            category: catVal,
                            enrollYear,
                            status: statusVal,
                        });

                        if (stage) {
                            const badgeCls = stage.isGraduated ? "green" : stage.daysUntilGraduation <= 100 ? "orange" : "blue";
                            const badgeText = stage.isGraduated
                                ? t("ledger.schoolingGraduated")
                                : t("ledger.schoolingDaysUntil").replace("${n}", String(stage.daysUntilGraduation));

                            contentWrap.innerHTML = `
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                  <span><b>${stage.currentGradeLabel}</b> · ${stage.transitionEventLabel}</span>
                                  <span class="lv-badge ${badgeCls}">${badgeText}</span>
                                </div>
                                <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                                  <span>${t("ledger.schoolingGraduationDate")}: ${stage.graduationDate} (${stage.stageTotalYears} 年制)</span>
                                  <span>${t("ledger.schoolingProgress")}: ${stage.stageProgressPercent}%</span>
                                </div>
                                <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                                  <div style="height:100%;background:var(--lv-accent);width:${stage.stageProgressPercent}%;border-radius:2px"></div>
                                </div>`;
                        }
                    })();
                }
            } else if (active === "pets") {
                const speciesVal = ref?.columns?.species ? cellText(row.cells[ref.columns.species]) : "cat";
                const vdueVal = ref?.columns?.vaccine_due ? cellText(row.cells[ref.columns.vaccine_due]) : undefined;
                const ddueVal = ref?.columns?.deworm_due ? cellText(row.cells[ref.columns.deworm_due]) : undefined;
                const noteVal = ref?.columns?.note ? cellText(row.cells[ref.columns.note]) : "";

                // 尝试从备注中匹配生日或出生日期（如 "2024-05-01" 或 "出生: 2024-05-01"）
                let birthMatch = noteVal.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];

                const petCareSection = document.createElement("div");
                petCareSection.className = "lv-detail-section";
                petCareSection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = t("ledger.petCareTitle");
                head.append(title);
                petCareSection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = boxContentCss;
                petCareSection.append(contentWrap);
                body.appendChild(petCareSection);

                void (async () => {
                    const { evaluatePetSummary } = await import("@/core/pets");
                    const summary = evaluatePetSummary(
                        birthMatch,
                        speciesVal,
                        vdueVal !== "—" ? vdueVal : undefined,
                        ddueVal !== "—" ? ddueVal : undefined,
                    );

                    contentWrap.replaceChildren();

                    // 1. 生理年龄与阶段
                    if (summary.ageInfo) {
                        const ageLine = document.createElement("div");
                        ageLine.style.cssText = flexBetweenCenterGap8Css;
                        ageLine.innerHTML = `
                            <span>${t("ledger.petAgeEquivalent")}: <b>${summary.ageInfo.humanEquivalentAge} 岁</b> (${summary.ageInfo.chronologicalYears} 岁 ${summary.ageInfo.chronologicalMonths} 个月)</span>
                            <span class="lv-badge purple">${summary.ageInfo.lifeStageLabel}</span>
                        `;
                        const desc = document.createElement("div");
                        desc.className = "lv-caption";
                        desc.style.cssText = "font-size:11px;line-height:1.4";
                        desc.textContent = summary.ageInfo.description;
                        contentWrap.append(ageLine, desc);
                    }

                    // 2. 疫苗与驱虫状态条
                    const careGrid = document.createElement("div");
                    careGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px";

                    const badgeCls = (u: string) => u === "overdue" ? "danger" : u === "soon" ? "orange" : u === "ok" ? "green" : "gray";

                    const vBox = document.createElement("div");
                    vBox.style.cssText = pad6BorderSurfaceCss;
                    vBox.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <span style="font-weight:500">${t("field.vaccine_due")}</span>
                            <span class="lv-badge ${badgeCls(summary.vaccine.urgency)}">${summary.vaccine.label}</span>
                        </div>
                        <span class="lv-caption" style="font-size:11px">${summary.vaccine.dueDate ? summary.vaccine.dueDate : "未填写"}</span>
                    `;

                    const dBox = document.createElement("div");
                    dBox.style.cssText = pad6BorderSurfaceCss;
                    dBox.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <span style="font-weight:500">${t("field.deworm_due")}</span>
                            <span class="lv-badge ${badgeCls(summary.deworm.urgency)}">${summary.deworm.label}</span>
                        </div>
                        <span class="lv-caption" style="font-size:11px">${summary.deworm.dueDate ? summary.deworm.dueDate : "未填写"}</span>
                    `;

                    careGrid.append(vBox, dBox);
                    contentWrap.append(careGrid);
                })();
            } else if (active === "travel-plan") {
                // Certificate checks are appended and deduplicated by the row-log helper.
                await addRowLogSection({
                    title: t("ledger.checks"), emptyText: t("ledger.noChecks"), addLabel: t("ledger.valAdd"), kind: "checks",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "result", type: "text", placeholder: t("ledger.checkResult"), width: 200 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "checks")),
                    add: async (v) => {
                        if (!v.date || !v.result) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "checks", { date: v.date, result: v.result, at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "checks", e)); },
                    format: (e) => `${e.date} · ${e.result}`,
                });
            } else if (active === "media") {
                // Book loans leave the return date empty while still borrowed.
                await addRowLogSection({
                    title: t("ledger.loans"), emptyText: t("ledger.noLoans"), addLabel: t("ledger.valAdd"), kind: "loans",
                    fields: [
                        { key: "date", type: "date", placeholder: "", width: 130 },
                        { key: "to", type: "text", placeholder: t("ledger.loanTo"), width: 100 },
                        { key: "back", type: "date", placeholder: t("ledger.loanBack"), width: 130 },
                    ],
                    load: () => fresh().then((l) => rl.getEntries<any>(l, ref!.avId!, row.itemID, "loans")),
                    add: async (v) => {
                        if (!v.date || !v.to) { showMessage(t("ledger.logInvalid"), 3000, "error"); return false; }
                        await rl.updateRowLogs(plugin as any, (current) => rl.appendEntry(current, ref!.avId!, row.itemID, "loans", { date: v.date, to: v.to, back: v.back || "", at: at() }));
                        return true;
                    },
                    remove: async (e) => { await rl.updateRowLogs(plugin as any, (current) => rl.removeEntry(current, ref!.avId!, row.itemID, "loans", e)); },
                    format: (e) => `${e.date} · ${t("ledger.loanTo")} ${e.to}${e.back ? ` · ${e.back} ${t("ledger.loanReturned")}` : ` · ${t("ledger.loanOut")}`}`,
                });
            } else if (active === "parenting") {
                const catVal = ref?.columns?.category ? cellText(row.cells[ref.columns.category]) : "";
                // 仅辅食/喂养类记录接入 3 天排敏观察期与健康过敏史联动
                if (catVal === "feeding" || catVal === t("field.category.opt.feeding")) {
                    const dateVal = ref?.columns?.date ? cellText(row.cells[ref.columns.date]) : "";
                    const foodName = (ref?.columns?.name && cellText(row.cells[ref.columns.name])) || "";
                    const memberBlockId = ref?.columns?.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;

                    const feedingSection = document.createElement("div");
                    feedingSection.className = "lv-detail-section";
                    feedingSection.style.cssText = sectionBorderCss;

                    const head = document.createElement("div");
                    head.style.cssText = sectionHeaderCss;
                    const title = document.createElement("span");
                    title.className = "ft__on-surface";
                    title.style.cssText = sectionTitleCss;
                    title.textContent = t("ledger.feedingObserveTitle");
                    head.append(title);
                    feedingSection.append(head);

                    const contentWrap = document.createElement("div");
                    contentWrap.style.cssText = "font-size:12.5px;display:flex;flex-direction:column;gap:8px";
                    feedingSection.append(contentWrap);
                    body.appendChild(feedingSection);

                    void (async () => {
                        const { evaluateFeedingObservation, findMemberAllergies, checkAllergyConflict } = await import("@/core/feeding");
                        const obs = evaluateFeedingObservation(dateVal);

                        // 1. 观察期状态条
                        if (obs) {
                            const statusLine = document.createElement("div");
                            statusLine.style.cssText = lineBadgeCss;
                            const badge = document.createElement("span");
                            if (obs.status === "observing") {
                                badge.className = "lv-badge orange";
                                badge.textContent = obs.dayProgressText;
                            } else if (obs.status === "completed") {
                                badge.className = "lv-badge green";
                                badge.textContent = t("ledger.feedingObserveDone");
                            } else {
                                badge.className = "lv-badge gray";
                                badge.textContent = obs.dayProgressText;
                            }
                            const timeText = document.createElement("span");
                            timeText.className = "lv-caption";
                            timeText.style.cssText = "margin-left:auto;font-size:11.5px";
                            timeText.textContent = `${t("ledger.feedingObserveUntil")}: ${obs.observeUntil}`;
                            statusLine.append(badge, timeText);
                            contentWrap.append(statusLine);
                        }

                        // 2. 健康库过敏史核对
                        const healthRef = plugin.settings.dbRefs?.health;
                        if (healthRef?.avId && healthRef?.columns) {
                            try {
                                const healthAll = await renderLedgerAll(healthRef.avId);
                                const allergies = findMemberAllergies(memberBlockId, healthAll.rows, healthRef.columns);
                                const conflict = checkAllergyConflict(foodName, allergies);

                                if (conflict) {
                                    const alertLine = document.createElement("div");
                                    alertLine.style.cssText = dangerAlertCss;
                                    alertLine.innerHTML = `<span>⚠️ ${t("ledger.feedingAllergyConflict").replace("${food}", conflict.name)}${conflict.reaction ? `（${conflict.reaction}）` : ""}</span>`;
                                    contentWrap.append(alertLine);
                                }
                            } catch (e) {
                                // 静默降级
                            }
                        }

                        // 3. 标记过敏并存入健康过敏史动作入口
                        if (healthRef?.avId && healthRef?.columns) {
                            const actionRow = document.createElement("div");
                            actionRow.style.cssText = actionRowEndCss;
                            const addAllergyBtn = document.createElement("button");
                            addAllergyBtn.className = "b3-button b3-button--outline";
                            addAllergyBtn.style.cssText = fs12Pad38Css;
                            addAllergyBtn.textContent = `＋ ${t("ledger.recordAllergyToHealth")}`;
                            addAllergyBtn.onclick = () => {
                                const adlg = new Dialog({
                                    title: t("ledger.recordAllergyTitle"),
                                    content: `<div class="b3-dialog__content lv-dialog-col">
                                        <p class="lv-caption" style="margin:0">${t("ledger.recordAllergyIntro").replace("${food}", foodName)}</p>
                                        <input class="b3-text-field" id="lv-allergy-reaction" placeholder="${t("ledger.recordAllergyReactionPlaceholder")}" style="width:100%" />
                                    </div>
                                    <div class="b3-dialog__action">
                                        <button class="b3-button b3-button--cancel" id="lv-allergy-cancel">${t("cancel")}</button>
                                        <button class="b3-button" id="lv-allergy-save">${t("save")}</button>
                                    </div>`,
                                    width: "420px",
                                });
                                const rxInput = adlg.element.querySelector("#lv-allergy-reaction") as HTMLInputElement;
                                requestAnimationFrame(() => rxInput?.focus());
                                (adlg.element.querySelector("#lv-allergy-cancel") as HTMLButtonElement).onclick = () => adlg.destroy();
                                (adlg.element.querySelector("#lv-allergy-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                                    this.disabled = true;
                                    const reactionVal = rxInput?.value.trim() || "";
                                    adlg.destroy();
                                    try {
                                        const { addDetachedRow, setCell } = await import("@/core/siyuan");
                                        const rowId = await addDetachedRow(healthRef.avId!, foodName);
                                        if (healthRef.columns.category) {
                                            await setCell(healthRef.avId!, healthRef.columns.category, rowId, {
                                                type: "select", select: { content: "allergy" },
                                            });
                                        }
                                        if (healthRef.columns.diagnosis && reactionVal) {
                                            await setCell(healthRef.avId!, healthRef.columns.diagnosis, rowId, {
                                                type: "text", text: { content: reactionVal },
                                            });
                                        }
                                        if (healthRef.columns.date && dateVal) {
                                            await setCell(healthRef.avId!, healthRef.columns.date, rowId, {
                                                type: "date", date: { content: dateVal, isNotEmpty: true },
                                            });
                                        }
                                        if (healthRef.columns.member && memberBlockId) {
                                            await setCell(healthRef.avId!, healthRef.columns.member, rowId, {
                                                type: "relation", relation: { blockIDs: [memberBlockId] },
                                            });
                                        }
                                        showMessage(t("ledger.recordAllergySaved"), 3500, "info");
                                    } catch (err) {
                                        showMessage(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                                    }
                                };
                            };
                            actionRow.append(addAllergyBtn);
                            contentWrap.append(actionRow);
                        }
                    })();
                }
            } else if (active === "social") {
                const memberBlockId = ref?.columns?.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;
                const member = memberBlockId ? (plugin.settings.members ?? []).find((m) => m.avItemId === memberBlockId) : undefined;
                if (member?.birthday) {
                    const socialRetireSection = document.createElement("div");
                    socialRetireSection.className = "lv-detail-section";
                    socialRetireSection.style.cssText = sectionBorderCss;

                    const head = document.createElement("div");
                    head.style.cssText = sectionHeaderCss;
                    const title = document.createElement("span");
                    title.className = "ft__on-surface";
                    title.style.cssText = sectionTitleCss;
                    title.textContent = `${t("members.retirementTitle")} · ${member.name}`;
                    head.append(title);
                    socialRetireSection.append(head);

                    const contentWrap = document.createElement("div");
                    contentWrap.style.cssText = boxContentCss;
                    socialRetireSection.append(contentWrap);
                    body.appendChild(socialRetireSection);

                    void (async () => {
                        const { calculateRetirement } = await import("@/core/retirement");
                        const ret = calculateRetirement({ birthday: member.birthday, sex: member.sex });
                        if (ret) {
                            const delayText = ret.delayedMonths > 0 ? ` · ${t("members.retirementDelay").replace("${n}", String(ret.delayedMonths))}` : "";
                            const daysBadge = ret.isRetired
                                ? `<span class="lv-badge green">${t("members.retirementRetired")}</span>`
                                : `<span class="lv-badge orange">${t("members.retirementDaysLeft").replace("${n}", String(ret.daysLeft))}</span>`;

                            contentWrap.innerHTML = `
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                    <span>${t("members.retirementTarget")}: <b>${ret.targetRetireDate}</b> (${t("members.retirementAge").replace("${age}", String(ret.targetRetireAge))}${delayText})</span>
                                    ${daysBadge}
                                </div>
                                <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                                    <span>${t("members.retirementCareerProgress")}</span>
                                    <span>${ret.careerProgressPercent}%</span>
                                </div>
                                <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                                    <div style="height:100%;background:var(--lv-accent);width:${ret.careerProgressPercent}%;border-radius:2px"></div>
                                </div>`;
                        }
                    })();
                }
            }
        })().catch((error) => {
            if (active === "vehicles") {
                failVehicleActions(["fuel", "charging", "maintenance"], error);
            } else {
                showMessage(t("ledger.logReadFailed") + " (" + (error instanceof Error ? error.message : String(error)) + ")", 6000, "error");
            }
        });

        // Modules with templates expose a document generation action.
        (async () => {
            const tplList = ((plugin.schemaCatalog?.[active] as any)?.templates ?? []) as { key: string; nameKey: string; file: string }[];
            for (const tp of tplList) {
                const label = t(tp.nameKey) !== tp.nameKey ? t(tp.nameKey) : tp.key;
                const btn = document.createElement("button");
                btn.className = "b3-button b3-button--outline";
                btn.style.cssText = btnSmCss;
                btn.textContent = `${t("ledger.genDoc")} · ${label}`;
                btn.onclick = async () => {
                    try {
                        const { getTemplate, renderTemplate, sanitizeDocTitle } = await import("@/core/templates");
                        const { sql, createDocWithMd } = await import("@/core/siyuan");
                        const file = getTemplate(tp.file);
                        if (!file) throw new Error("template missing: " + tp.file);
                        const rows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${ref!.docId.replace(/'/g, "''")}' LIMIT 1`);
                        const notebook = rows[0]?.box;
                        if (!notebook) throw new Error("notebook not found for " + ref!.docId);
                        const vars: Record<string, string> = { name: String(cellText(row.cells[ref!.columns.name])), date: localDateKey(new Date()) };
                        for (const c of schemaCols) vars[c.key] = cellText(row.cells[ref!.columns[c.key]]);
                        // Sanitize titles before creating documents in the notebook tree.
                        const title = sanitizeDocTitle(`${vars.name} · ${label} · ${vars.date}`);
                        // G2（UG12 研究产出）：落点说明——文档建在台账笔记本内，随思源同步/分享范围流转
                        confirm(t("ledger.genDoc"), t("ledger.genDocConfirm").replace("${title}", title), async () => {
                            try {
                                const docId = await createDocWithMd(notebook, `/${title}`, renderTemplate(file, vars));
                                showMessage(t("ledger.genDocDone").replace("${title}", title), 3000, "info");
                                dlg.destroy();
                                plugin.showTabDocs(docId);
                            } catch (e) {
                                showMessage(t("ledger.genDocFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                            }
                        });
                    } catch (e) {
                        showMessage(t("ledger.genDocFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                    }
                };
                body.appendChild(btn);
            }
        })();
        // 324/325波：跨台账联动（处方转药箱/备货入库/购物转资产/换证链/人情同步）抽离至 core/drawer-sections.ts
        import("@/core/drawer-sections").then(({
            renderRxToMedicineButton,
            renderStockInButton,
            renderShoppingToAssetButton,
            renderRenewChainSection,
            renderFavorsSyncSection,
        }) => {
            renderRxToMedicineButton({ body, row, ref: ref!, active, plugin, t, showMessageFn: showMessage, cellTextFn: cellText });
            renderStockInButton({ body, row, ref: ref!, active, plugin, t, DialogCls: Dialog, showMessageFn: showMessage, cellTextFn: cellText });
            renderShoppingToAssetButton({ body, row, ref: ref!, active, plugin, t, DialogCls: Dialog, showMessageFn: showMessage, cellTextFn: cellText });
            renderRenewChainSection({
                body,
                row,
                rows,
                ref: ref!,
                active,
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                cellTextFn: cellText,
                onChainUpdated: async (targetRowId: string) => {
                    await load();
                    try { await plugin.refreshHub([active]); } catch { /* ignore */ }
                    const fresh = rows.find((x) => x.itemID === targetRowId);
                    if (fresh) openDetail(fresh);
                },
            });

            renderFavorsSyncSection({
                body,
                row,
                ref: ref!,
                active,
                plugin,
                t,
                showMessageFn: showMessage,
                selectContentFn: selectCellContent,
                rawDateFn: (cell) => rawFromValue("date", cell) ?? "",
            });
        });
        }
        // Edit mode writes supported fields independently and reports partial failures.
        function buildEdit() {
            body.innerHTML = "";
            body.scrollTop = 0;
            const more = dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement;
            more.open = false;
            more.hidden = true;
            const inputs = renderEditableFormFields({
                container: body,
                schemaCols,
                columns: ref!.columns,
                rowCells: row.cells,
                t,
                rawFromValueFn: rawFromValue,
                hasContactsBridge: !!getContactsBridge(),
                onPickContact: pickFromContacts,
            });
            const errorBox = document.createElement("div");
            errorBox.className = "lv-record-error";
            errorBox.setAttribute("role", "alert");
            errorBox.style.display = "none";
            body.appendChild(errorBox);
            const save = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement;
            save.textContent = t("save");
            const cancel = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement;
            cancel.textContent = t("cancel");
            cancel.onclick = () => buildView();
            save.onclick = async () => {
                if (save.disabled) return;
                save.disabled = true;
                cancel.disabled = true;
                errorBox.style.display = "none";
                const failed: string[] = [];
                let changed = 0;
                let personChanged = false;
                const personKeyID = ref!.columns.person;
                const previousFavorSync = plugin.runtime?.favorSyncs?.[row.itemID];
                try {
                    for (const e of inputs) {
                        const v = e.get();
                        const orig = rawFromValue(e.type, row.cells[e.keyID]);
                        const same = e.type === "checkbox" ? v === orig : String(v) === String(orig);
                        if (same) continue;
                        try {
                            const nextCell = cellValue(e.type, v);
                            await setCell(ref!.avId!, e.keyID, row.itemID, nextCell, {
                                idempotencyKey: `ledger:detail-edit:${row.itemID}:${e.keyID}:${JSON.stringify(nextCell)}`,
                                retries: 1,
                            });
                            row.cells[e.keyID] = nextCell;
                            changed++;
                            if (personKeyID && e.keyID === personKeyID) personChanged = true;
                        } catch {
                            failed.push(e.label); // Aggregate field-level failures.
                        }
                    }
                    // A person change invalidates favor syncs and requires a fresh interaction.
                    if (personChanged && previousFavorSync) {
                        delete plugin.runtime.favorSyncs[row.itemID];
                        try {
                            await saveRuntime(plugin, plugin.runtime);
                        } catch (err) {
                            plugin.runtime.favorSyncs = { ...(plugin.runtime.favorSyncs ?? {}), [row.itemID]: previousFavorSync };
                            showMessage(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                        }
                    }
                    if (failed.length > 0) {
                        if (changed > 0) {
                            await load();
                            try { await plugin.refreshHub([active]); }
                            catch (err) { showMessage(t("ledger.refreshFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error"); }
                        }
                        errorBox.textContent = t("ledger.editSavePartial").replace("${fields}", failed.join(", "));
                        errorBox.style.display = "block";
                        save.disabled = false;
                        cancel.disabled = false;
                        return;
                    }
                    dlg.destroy();
                    if (changed > 0) {
                        await load();
                        if (loadError) showMessage(t("ledger.refreshFailed").replace("${msg}", loadError), 5000, "error");
                        try {
                            await plugin.refreshHub([active]); // Refresh only the active module.
                        } catch (err) {
                            showMessage(t("ledger.refreshFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                        }
                    }
                    if (changed > 0) showMessage(t("ledger.editSaved"), 2500, "info");
                } catch (err) {
                    showMessage(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                    save.disabled = false;
                    cancel.disabled = false;
                }
            };
        }
        buildView();
        if (active === "vehicles") {
            const quick = document.createElement("section");
            quick.className = "lv-vehicle-quick-actions";
            quick.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;border:1px solid var(--lv-line);border-radius:8px;background:var(--lv-surface-2)";
            const label = document.createElement("b"); label.textContent = t("vehicle.quickActions"); label.style.cssText = "font-size:12px;margin-right:2px";
            quick.appendChild(label);
            for (const action of ["fuel", "charging", "maintenance"] as const) {
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.textContent = t(`vehicle.quick.${action}`);
                button.onclick = () => requestVehicleAction(action);
                quick.appendChild(button);
            }
            body.prepend(quick);
            if (vehicleAction === "edit") {
                requestAnimationFrame(() => (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement | null)?.click());
            } else if (vehicleAction) {
                requestAnimationFrame(() => requestVehicleAction(vehicleAction));
            }
        }
        (dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement).onclick = () => dlg.destroy();
        (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement).onclick = () => buildEdit();
        (dlg.element.querySelector("#lv-detail-open") as HTMLButtonElement).onclick = () => { dlg.destroy(); plugin.showTabDocs(ref?.docId, row.itemID); };
        // R7 资料强化：分享卡（复制为图片 / 下载 PNG）——kv 用当前显示文本（掩码态即导出掩码态）
        const nameKeyForCard = ref?.columns?.name;
        const nameValForCard = nameKeyForCard ? row.cells?.[nameKeyForCard] : undefined;
        const cardTitle = (nameValForCard?.type === "block" ? nameValForCard.block?.content : "") || detailTitle;
        const cardDeepLink = nameValForCard?.type === "block" && nameValForCard.block?.id ? blockDeepLink(nameValForCard.block.id) : blockDeepLink(ref?.docId || "");
        import("@/core/drawer-actions").then(({ bindDrawerMoreActions }) => {
            bindDrawerMoreActions({
                dlg,
                row,
                cardTitle,
                cardDeepLink,
                cardRows,
                active,
                ref: ref!,
                t,
                showMessageFn: showMessage,
                cellTextFn: cellText,
            });
        });
        // Copy record as new draft.
        const dupBtn = dlg.element.querySelector("#lv-detail-duplicate") as HTMLButtonElement | null;
        if (dupBtn) {
            dupBtn.onclick = () => {
                const rowName = (ref.columns.name && cellText(row.cells?.[ref.columns.name])) || "";
                const cloneName = rowName ? `${rowName} (副本)` : "";
                const copiedValues: Record<string, any> = { name: cloneName };
                for (const col of schemaCols) {
                    if (col.key === "name" || ["asset", "mAsset", "relation"].includes(col.type)) continue;
                    const v = ref.columns[col.key] ? row.cells?.[ref.columns[col.key]] : undefined;
                    if (v) {
                        if (col.type === "select") copiedValues[col.key] = selectCellContent(v);
                        else if (col.type === "number") {
                            const raw = v.number?.content ?? (v as any).content ?? (v as any).value?.number?.content ?? v;
                            const num = Number(raw);
                            copiedValues[col.key] = Number.isFinite(num) ? num : undefined;
                        } else if (col.type === "date") {
                            const raw = v.date?.content ?? (v as any).content ?? (v as any).value?.date?.content;
                            if (typeof raw === "number") copiedValues[col.key] = localDateKey(new Date(raw));
                            else if (typeof raw === "string" && raw.trim()) {
                                const parsed = parseDate(raw.trim());
                                copiedValues[col.key] = parsed ? localDateKey(parsed) : raw.trim();
                            }
                        } else if (col.type === "checkbox") {
                            copiedValues[col.key] = v.checkbox?.checked ?? (v as any).checked ?? (v as any).value?.checkbox?.checked;
                        } else {
                            copiedValues[col.key] = cellText(v, col.key);
                        }
                    }
                }
                dlg.destroy();
                openNewRecord();
                form = copiedValues;
                showMessage(t("ledger.duplicateSuccess").replace("${name}", cloneName || rowName), 3000, "info");
            };
        }
        // Row deletion is explicit and confirmed before mutation.
        (dlg.element.querySelector("#lv-detail-del") as HTMLButtonElement).onclick = () => {
            if (plugin.runtime?.guestModeActive) {
                showMessage(t("guest.writeBlocked"), 4000, "info");
                return;
            }
            confirm(t("ledger.delTitle"), t("ledger.delBody").replace("${name}", (ref.columns.name && cellText(row.cells?.[ref.columns.name])) || t("ledger.detail")), async () => {
                try {
                    const { removeLedgerRows, } = await import("@/core/siyuan");
                    await removeLedgerRows(ref!.avId!, [row.itemID], {
                        idempotencyKey: `ledger:delete:${ref!.avId!}:${row.itemID}`,
                        retries: 1,
                    });
                } catch (e) {
                    showMessage(t("ledger.delFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                    return;
                }
                showMessage(t("ledger.delDone"), 2500, "info");
                dlg.destroy();
                const followupErrors: string[] = [];
                try {
                    const memberRef = plugin.settings.dbRefs.members;
                    if (memberRef?.avId === ref!.avId) {
                        const linkedMembers = (plugin.settings.members ?? []).filter((member) => member.avItemId === row.itemID);
                        if (linkedMembers.length) {
                            for (const member of linkedMembers) {
                                member.avItemId = undefined;
                                member.syncError = "ledger row deleted";
                                member.avRowCreatePending = undefined;
                            }
                            await saveSettings(plugin, plugin.settings);
                        }
                    }
                } catch (e) {
                    followupErrors.push(`${t("ledger.memberLinkCleanupFailed")} (${e instanceof Error ? e.message : String(e)})`);
                }
                try {
                    // Clean orphaned runtime state after deleting the row.
                    const { cleanupRowRuntimeData } = await import("@/core/hub/runtime");
                    const dirty = cleanupRowRuntimeData(plugin.runtime, row.itemID);
                    if (dirty) {
                        await saveRuntime(plugin, plugin.runtime);
                    }
                } catch (e) {
                    followupErrors.push(e instanceof Error ? e.message : String(e));
                }
                try {
                    // Remove child row-log records as well.
                    const { updateRowLogs, removeRowLog } = await import("@/core/rowlog");
                    await updateRowLogs(plugin as any, (current) => removeRowLog(current, ref!.avId!, row.itemID));
                } catch (e) {
                    followupErrors.push(e instanceof Error ? e.message : String(e));
                }
                try {
                    await load();
                    await plugin.refreshHub([active]); // Refresh only the active module.
                } catch (e) {
                    followupErrors.push(e instanceof Error ? e.message : String(e));
                }
                // The row is already deleted; follow-up failures must not trigger a second deletion.
                if (followupErrors.length) showMessage(t("ledger.delFollowupFailed").replace("${msg}", followupErrors.join("; ")), 6000, "error");
            });
        };
    }

    async function createRow() {
        if (!ref?.avId || saving || identityPending || duplicateConfirmPending) return;
        // 297 波：访客模式写保护拦截
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        validationAttempted = true;
        if (!hasAnyInput) {
            nameInput?.focus();
            showMessage(t("ledger.nameRequired"), 4000, "info");
            return;
        }
        // Name validation prevents unnamed rows when other fields are present.
        if (nameMissing) {
            saveError = t("ledger.nameRequired");
            showMessage(saveError, 4000, "error");
            return;
        }
        if (active === "certs" && !String(form.category ?? "").trim()) {
            saveError = t("ledger.categoryRequired");
            showMessage(saveError, 4000, "info");
            return;
        }
        if (active === "certs" && form.x_cert_id_number && idcardCheck && !idcardCheck.ok) {
            saveError = t("ledger.idcardBad").replace("${reason}", t(`ledger.idcardReason.${idcardCheck.reason ?? "format"}`));
            focusCaptureField("x_cert_id_number");
            showMessage(saveError, 4500, "error");
            return;
        }
        for (const field of supportableCols) {
            const error = formFieldError(field);
            if (!error) continue;
            saveError = error;
            focusCaptureField(field.key);
            showMessage(saveError, 4500, "error");
            return;
        }
        // D24（UG04 数据质量）：同名行确认——对照已加载行（render 窗口）提示同名数，确认可继续；D06 成员同名确认同款交互
        const dupName = String(form.name ?? "").trim();
        const nameKey = ref.columns?.name;
        if (dupName && !pendingItemID && nameKey) {
            const dupCount = rows.filter((r) => cellText(r.cells[nameKey]) === dupName).length;
            if (dupCount > 0) {
                duplicateConfirmPending = true;
                confirm(
                    t("ledger.dupTitle"),
                    t("ledger.dupBody").replace("${name}", dupName).replace("${n}", String(dupCount)),
                    () => { duplicateConfirmPending = false; void doCreateRow(); },
                    () => { duplicateConfirmPending = false; },
                );
                return;
            }
        }
        await doCreateRow();
    }

    async function doCreateRow() {
        if (!ref?.avId || saving) return;
        const hadIdentityPending = identityPending;
        identityPending = false;
        saving = true;
        saveError = "";
        if (missingSchemaCols.length > 0 && ref?.avId) {
            try { await plugin.repairModule?.(active); } catch { /* soft heal */ }
        }
        if (!recordOperationKey) {
            try { recordOperationKey = `ledger:${crypto.randomUUID()}`; }
            catch { recordOperationKey = `ledger:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
        }
        try {
            // 重试路径：部分字段失败或先前待确认时，复用/回查已建行（补写同一行，不重复建行）
            let itemID = pendingItemID;
            if (!itemID && hadIdentityPending) {
                try {
                    const all = await renderLedgerAll(ref.avId, 50);
                    const nameCol = ref.columns?.name;
                    const title = String(form.name ?? "").trim();
                    if (nameCol && title) {
                        const matched = all.rows.find((row) => {
                            const val = String(row.cells?.[nameCol]?.text?.content ?? row.cells?.[nameCol]?.block?.content ?? "").trim();
                            return val === title;
                        });
                        if (matched) {
                            itemID = matched.itemID;
                            pendingItemID = itemID;
                        }
                    }
                } catch { /* soft reconciliation */ }
            }
            if (!itemID) {
                itemID = await addDetachedRow(ref.avId, String(form.name ?? "").trim() || t("ledger.unnamed"), {
                    idempotencyKey: `${recordOperationKey}:row`,
                });
                pendingItemID = itemID;
            }
            const cols = plugin.settings.dbRefs[active]?.columns ?? ref.columns ?? {};
            const failed: string[] = [];
            const tryCell = async (label: string, key: string | undefined, value: unknown) => {
                if (!key) {
                    failed.push(label);
                    return;
                }
                // Null means final type validation failed; do not write an empty relation.
                if (value === null) {
                    failed.push(label);
                    return;
                }
                try {
                    await setCell(ref.avId!, key, itemID, value, {
                        idempotencyKey: `${recordOperationKey}:cell:${key}`,
                    });
                } catch {
                    failed.push(label); // Preserve the field value for retry.
                }
            };
            for (const e of supportableCols) {
                const v = form[e.key];
                if (e.key !== "name" && (v === undefined || v === "" || v === false)) continue;
                if (e.key === "name" && !(v && String(v).trim()) && pendingItemID) continue; // Do not overwrite a name on retry.
                if (e.type === "number" && (v === undefined || isNaN(Number(v)))) continue;
                await tryCell(t(`field.${e.key}`), cols[e.key], cellValue(e.type, e.key === "name" ? String(v ?? "").trim() : v));
            }
            for (const e of certificateScalarCols) {
                const v = form[e.key];
                if (v === undefined || v === "" || v === false) continue;
                if (e.type === "number" && isNaN(Number(v))) continue;
                await tryCell(t(`field.${e.key}`), cols[e.key], cellValue(e.type, v));
            }
            // Image attachments are uploaded before mAsset references are written.
            // Successful uploads remain cached so retries do not duplicate them.
            if (quickAssetCols.length > 0) {
                for (const target of quickAssetCols) {
                    const previous = uploadedCertificateFiles[target.key] ?? [];
                    const uploaded = [...previous];
                    const failedFiles: File[] = [];
                    if (!cols[target.key]) {
                        failed.push(t(`field.${target.key}`));
                        continue;
                    }
                    for (const file of certificateFiles[target.key] ?? []) {
                        try {
                            const { uploadAsset } = await import("@/core/siyuan");
                            const { name, path } = await uploadAsset(file, "/assets/siyuan-home/", {
                                idempotencyKey: `${recordOperationKey}:asset:${target.key}:${fileFingerprint(file)}`,
                            });
                            uploaded.push({ name, content: path });
                        } catch (e) {
                            failed.push(`${t(`field.${target.key}`)}: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
                            failedFiles.push(file);
                        }
                    }
                    certificateFiles = { ...certificateFiles, [target.key]: failedFiles };
                    if (uploaded.length === 0) continue;
                    uploadedCertificateFiles = { ...uploadedCertificateFiles, [target.key]: uploaded };
                    await tryCell(t(`field.${target.key}`), cols[target.key], {
                        type: "mAsset",
                        mAsset: uploaded.map(({ name, content }) => ({ name, content })),
                    });
                }
            }
            // Fill the schema default status, falling back to the first enum option.
            const statusCol = (plugin.schemaCatalog?.[active]?.columns ?? []).find((c: any) => c.key === "status");
            if (statusCol?.options?.length && (form.status === undefined || form.status === "")) {
                await tryCell(t("field.status"), cols.status, selectCellValue(statusCol.default ?? statusCol.options[0]));
            }
            if (failed.length > 0) {
                // Preserve input and item ID so a retry updates the same row.
                saveError = t("ledger.savePartial").replace("${fields}", failed.join(", "));
                const { coalescedNotify } = await import("@/libs/notify-queue");
                coalescedNotify("ledger-save-error", () => showMessage(saveError, 6000, "error"));
            } else {
                savedRecordName = String(form.name ?? "").trim();
                savedDocId = ref.docId ?? "";
                resetForm();
                // Brief save confirmation keeps the user in the recording flow.
                savedModule = active;
                setTimeout(() => { savedModule = ""; }, 8000);
                if (closeAfterSave) {
                    newRecordOpen = false;
                    restoreNewRecordFocus();
                }
            }
            await load();
            try {
                await plugin.refreshHub([active]); // Refresh only the active module.
            } catch (e) {
                showMessage(t("ledger.refreshFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            }
        } catch (e) {
            recordOperationKey = null;
            if (e instanceof RowIdentityPendingError) {
                // D02：行已提交但身份未确认——不自动重试（会重复建行），提示人工核对
                identityPending = true;
                saveError = t("ledger.savePending");
            } else {
                saveError = t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
            }
            showMessage(saveError, 6000, "error");
        } finally {
            saving = false;
        }
    }

    function vehicleImageHref(row: any): string {
        if (active !== "vehicles" || !ref?.columns?.attachments) return "";
        const cell = row.cells?.[ref.columns.attachments];
        const asset = Array.isArray(cell?.mAsset) ? cell.mAsset.find((item: any) => isImageAsset(String(item?.content ?? ""))) : undefined;
        if (!asset?.content) return "";
        try { return assetHref(String(asset.content)); } catch { return ""; }
    }

    function vehicleText(row: any, key: string): string {
        const id = ref?.columns?.[key];
        let val = id ? cellText(row.cells?.[id], key) : "—";
        // 动态自愈：若映射 ID 未取到值，从当前视图已知列（avCols）中通过别名匹配
        if ((!id || val === "—") && avCols.length > 0) {
            const aliases = ["name", "plate", "brand_model", "energy_type", "mileage"].includes(key)
                ? (COMMON_COLUMN_ALIASES[key] ?? [key])
                : [key];
            const matchedCol = avCols.find((c) => aliases.includes(c?.name) || aliases.includes(c?.keyName));
            if (matchedCol?.id && row.cells?.[matchedCol.id]) {
                const probed = cellText(row.cells[matchedCol.id], key);
                if (probed && probed !== "—") val = probed;
            }
        }
        // 车名双重兜底：若仍为空，回退到行主键块或首个文本单元格
        if (key === "name" && (val === "—" || !val)) {
            if (row?.cells) {
                for (const cell of Object.values(row.cells) as any[]) {
                    if (cell?.block?.content) return String(cell.block.content).trim();
                }
                for (const cell of Object.values(row.cells) as any[]) {
                    if (cell?.text?.content) return String(cell.text.content).trim();
                }
            }
        }
        return val || "—";
    }
</script>

<div class="lv-toolbar lv-ledger-toolbar" style="margin:0 0 14px">
    {#if ledgers.length > 0}
        <!-- Switching modules clears the previous search query. Grouped by category. -->
        <select class="b3-select" value={active} onchange={switchLedger}>
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
        <button class="b3-button" onclick={rebuildLedger}>{t("ledger.rebuild")}</button>
    {:else}
        <div class="lv-search-box" style="position:relative;display:inline-flex;align-items:center">
            <input class="b3-text-field" style="width:min(240px, 100%);padding-right:48px" type="search" placeholder={t("ledger.search")}
                bind:value={searchText}
                oninput={(event) => { panelMemory.ledgerSearch = event.currentTarget.value; }}
                onkeydown={(event) => { if (event.key === "Escape") { searchText = ""; panelMemory.ledgerSearch = ""; } }}
                title={t("ledger.search")} />
            {#if searchText}
                <span class="lv-badge {filteredRows.length > 0 ? 'blue' : 'orange'}" style="position:absolute;right:22px;font-size:10.5px;padding:1px 5px;pointer-events:none;opacity:0.85">
                    {filteredRows.length}
                </span>
                <button class="b3-button b3-button--text" style="position:absolute;right:2px;padding:2px 5px;font-size:11px;color:var(--lv-tx-3);cursor:pointer"
                    title={t("clear")} onclick={() => { searchText = ""; panelMemory.ledgerSearch = ""; }}>✕</button>
            {/if}
        </div>
        <button class="b3-button b3-button--outline lv-density-btn"
            title={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            aria-label={tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
            onclick={toggleDensity}>
            {tableDensity === "compact" ? t("ledger.densityComfortable") : t("ledger.densityCompact")}
        </button>
        <button class="lv-btn primary" onclick={openNewRecord} disabled={rebuilding}>＋ {t("ledger.newRecord")}</button>
        <details class="lv-ledger-more" bind:this={ledgerMoreDetails}>
            <summary class="b3-button b3-button--outline">{t("ledger.moreActions")}</summary>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="lv-ledger-more__menu" role="menu" tabindex="-1" onclick={() => { if (ledgerMoreDetails) ledgerMoreDetails.open = false; }}>
                <button class="b3-button b3-button--outline" title={t("ledger.exportCsvTip")}
                    disabled={filteredRows.length === 0 || exporting || printing} aria-busy={exporting} onclick={exportCsv}>{exporting ? t("ledger.saving") : t("ledger.exportCsv")}</button>
                <button class="b3-button b3-button--outline" title={t("ledger.exportArchiveTip")}
                    disabled={filteredRows.length === 0 || exporting || printing} aria-busy={exporting} onclick={exportArchiveManifest}>{t("ledger.exportArchive")}</button>
                <button class="b3-button b3-button--outline" title={t("ledger.printLabels")}
                    disabled={filteredRows.length === 0 || printing || exporting} aria-busy={printing} onclick={printLabels}>{printing ? t("ledger.saving") : t("ledger.printLabels")}</button>
                {#if active === "vehicles"}<button class="b3-button b3-button--outline" onclick={openEnergyDashboard}>{t("fuel.dashboardButton")}</button>{/if}
                {#if active === "parenting"}
                    <button class="b3-button b3-button--outline" onclick={openGrowthChart}>{t("ledger.growthChart")}</button>
                    <button class="b3-button b3-button--outline" onclick={openVaccineScheduleModal}>{t("ledger.vaccineSchedule")}</button>
                {/if}
                {#if active === "stock"}<button class="b3-button b3-button--outline" onclick={openShoppingList}>{t("ledger.shoppingList")}</button>{/if}
                {#if active === "stock"}<button class="b3-button b3-button--outline" onclick={openEmergencyKitModal}>{t("ledger.emergencyKit")}</button>{/if}
                {#if active === "shopping"}<button class="b3-button b3-button--outline" onclick={openStoreModeModal}>{t("ledger.storeMode")}</button>{/if}
                <button class="b3-button b3-button--outline" onclick={openLocationIndexModal}>{t("ledger.locSearch")}</button>
                <button class="b3-button b3-button--outline" onclick={openBlockIngestModal}>{t("capture.ingestAction")}</button>
                {#if ref?.columns?.amount}<button class="b3-button b3-button--outline" onclick={openExpenseTrendModal}>{t("ledger.expenseTrend")}</button>{/if}
                {#if active === "favors"}<button class="b3-button b3-button--outline" onclick={openFavorsReport}>{t("ledger.favorsReport")}</button>{/if}
                {#if active === "bookmarks"}<button class="b3-button b3-button--outline" onclick={openBookmarksCheck}>{t("ledger.checkBookmarks")}</button>{/if}
                {#if active === "memberships"}<button class="b3-button b3-button--outline" onclick={openSubscriptionStats}>{t("ledger.subscriptionStats")}</button>{/if}
                {#if active === "assets-real"}<button class="b3-button b3-button--outline" onclick={openAssetValuationModal}>{t("ledger.assetValuationReport")}</button>{/if}
                {#if active === "media"}<button class="b3-button b3-button--outline" onclick={openMediaReport}>{t("ledger.mediaReport")}</button>{/if}
                {#if active === "food"}<button class="b3-button b3-button--outline" onclick={openMealPlanModal}>{t("ledger.mealPlan")}</button>{/if}
                {#if active === "medicine"}<button class="b3-button b3-button--outline" onclick={openMedicineSupplyModal}>{t("ledger.medicineSupply")}</button>{/if}
                {#if active === "house"}<button class="b3-button b3-button--outline" onclick={openUtilityTiersModal}>{t("ledger.utilityTiers")}</button>{/if}
                {#if active === "house" || active === "chores"}<button class="b3-button b3-button--outline" onclick={openWasteScheduleModal}>{t("ledger.wasteSchedule")}</button>{/if}
                {#if active === "chores"}<button class="b3-button b3-button--outline" onclick={openRewardsLedgerModal}>{t("ledger.rewardsSettle")}</button>{/if}
                {#if active !== "members" && active !== "adhoc"}<button class="b3-button b3-button--outline" disabled={printing || exporting} onclick={openCsvImport}>{t("ledger.importCsv")}</button>{/if}
                <button class="b3-button b3-button--outline" disabled={!ref?.docId}
                    onclick={() => plugin.showTabDocs(ref?.docId)}>{t("ledger.openDoc")} →</button>
            </div>
        </details>
    {/if}
</div>

{#if pinnedLedgers.length > 1}
    <div class="lv-ledger-pinned-bar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:-6px 0 10px">
        <span class="lv-caption" style="font-size:11px;color:var(--lv-tx-3);margin-right:2px">📌</span>
        {#each pinnedLedgers as pid (pid)}
            <button type="button" class="lv-preset-tag" class:active={active === pid}
                onclick={() => switchLedgerTo(pid)}>
                {t(`module.${pid}`)}
            </button>
        {/each}
    </div>
{/if}

{#if (memberCol && (plugin.settings.members?.length ?? 0) > 0) || (categoryCol && availableCategories.length > 0)}
    <div class="lv-filter-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px;font-size:11.5px">
        {#if memberCol && (plugin.settings.members?.length ?? 0) > 0}
            <div style="display:inline-flex;gap:3px;align-items:center;padding:2px 6px;background:var(--lv-surface-2);border-radius:12px;border:1px solid var(--lv-line)">
                <span class="lv-caption" style="font-size:11px;margin-right:2px">👤</span>
                <button type="button" class="lv-preset-tag" class:active={!filterMemberId} onclick={() => { filterMemberId = ""; }}>{t("ledger.allMembers")}</button>
                {#each plugin.settings.members ?? [] as m (m.id)}
                    {#if m.avItemId}
                        <button type="button" class="lv-preset-tag" class:active={filterMemberId === m.avItemId} onclick={() => { filterMemberId = filterMemberId === m.avItemId ? "" : m.avItemId; }}>
                            {m.name}
                        </button>
                    {/if}
                {/each}
            </div>
        {/if}
        {#if categoryCol && availableCategories.length > 0}
            <div style="display:inline-flex;gap:3px;align-items:center;padding:2px 6px;background:var(--lv-surface-2);border-radius:12px;border:1px solid var(--lv-line)">
                <span class="lv-caption" style="font-size:11px;margin-right:2px">🏷️</span>
                <button type="button" class="lv-preset-tag" class:active={!filterCategory} onclick={() => { filterCategory = ""; }}>{t("ledger.allCategories")}</button>
                {#each availableCategories as catVal (catVal)}
                    <button type="button" class="lv-preset-tag" class:active={filterCategory === catVal} onclick={() => { filterCategory = filterCategory === catVal ? "" : catVal; }}>
                        {optLabel(t, "category", catVal)}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
{/if}

{#if savedModule}
    <div class="lv-record-save-status" role="status">
        {t("ledger.newRecordSaved").replace("${name}", savedRecordName)} · {t("ledger.savedTo").replace("${module}", t(`module.${savedModule}`) !== `module.${savedModule}` ? t(`module.${savedModule}`) : savedModule)}
        <button class="b3-button b3-button--text" onclick={() => plugin.showTabDocs(savedDocId || undefined)}>{t("ledger.openDoc")} →</button>
    </div>
{/if}

<div class="lv-mask" class:open={newRecordOpen} aria-hidden="true" onclick={closeNewRecord}></div>
<svelte:window onkeydown={onNewRecordKeydown} />
<div class="lv-modal lv-record-modal" class:open={newRecordOpen} role="dialog" aria-modal="true" aria-labelledby="lv-new-record-title" aria-busy={saving || duplicateConfirmPending} tabindex="-1" inert={!newRecordOpen || duplicateConfirmPending}>
    <div class="lv-sheet lv-record-sheet">
        <div class="lv-sheet-head">
            <div class="lv-record-title">
                <b id="lv-new-record-title">{t("ledger.newRecordTitle").replace("${module}", t(`module.${active}`) !== `module.${active}` ? t(`module.${active}`) : active)}</b>
                <span>{t("ledger.newRecordIntro")}</span>
            </div>
            <button class="lv-iconbtn" aria-label={t("ledger.closeKeepDraft")} title={t("ledger.closeKeepDraft")} onclick={closeNewRecord} disabled={saving}><UiIcon name="close" size={16} /></button>
        </div>
        <div class="lv-sheet-body lv-record-body">
            <section class="lv-record-section">
                <h3>{t("ledger.newRecordBasic")}</h3>
                {#if currentLedgerTemplates.length > 0}
                    <div class="lv-template-bar" style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;font-size:11.5px;margin-bottom:12px">
                        <span class="lv-caption" style="color:var(--lv-tx-3);font-size:11px">✨ {t("capture.frequentTemplates")}:</span>
                        {#each currentLedgerTemplates as tpl (tpl.id)}
                            <button type="button" class="lv-preset-tag" onclick={() => applyLedgerTemplate(tpl)} disabled={saving} style="font-size:11.5px;padding:2px 8px">
                                {#if tpl.icon}<span>{tpl.icon}</span>{/if}
                                <span>{tpl.label}</span>
                            </button>
                        {/each}
                    </div>
                {/if}
                <div class="lv-record-grid">
                    {#each captureCols as e (e.key)}
                        <div class="lv-record-field" class:lv-record-field-wide={e.key === "name" || e.type === "url"}>
                            {#if e.type !== "checkbox"}<label for="lv-new-{e.key}">{fieldLabel(e.key)}{e.required || (active === "certs" && e.key === "category") ? " *" : ""}</label>{/if}
                            {#if e.type === "select"}
                                <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} onfocus={active === "certs" && e.key === "category" ? () => { lastCertificateCategory = String(form.category ?? ""); } : undefined} onchange={active === "certs" && e.key === "category" ? (event) => handleCertificateCategoryChange((event.currentTarget as HTMLSelectElement).value) : undefined} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                    <option value="">{fieldLabel(e.key)}</option>
                                    {#each e.options ?? [] as opt (opt)}
                                        <option value={opt}>{t(`field.${e.key}.opt.${opt}`) !== `field.${e.key}.opt.${opt}` ? t(`field.${e.key}.opt.${opt}`) : opt}</option>
                                    {/each}
                                </select>
                            {:else if e.type === "relation"}
                                <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                    <option value="">{fieldLabel(e.key)}: {t("members.all")}</option>
                                    {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                                        <option value={m.avItemId ?? ""} disabled={!m.avItemId}>{m.name}{m.avItemId ? "" : ` · ${t("members.notLinked")}`}</option>
                                    {/each}
                                </select>
                            {:else if e.type === "date"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                <div class="lv-preset-tags">
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); form[e.key] = localDateKey(d); }}>{t("capture.presetToday")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 1); form[e.key] = localDateKey(d); }}>{t("capture.presetTomorrow")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 7); form[e.key] = localDateKey(d); }}>{t("capture.presetNextWeek")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 30); form[e.key] = localDateKey(d); }}>{t("capture.presetNextMonth")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 365); form[e.key] = localDateKey(d); }}>{t("capture.presetNextYear")}</button>
                                </div>
                            {:else if e.type === "number"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="number" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                            {:else if e.type === "url"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="url" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                            {:else if e.type === "checkbox"}
                                <label class="lv-record-check"><input id="lv-new-{e.key}" type="checkbox" class="b3-switch" bind:checked={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />{fieldLabel(e.key)}{e.required ? " *" : ""}</label>
                            {:else if e.key === "name"}
                                <input bind:this={nameInput} id="lv-new-{e.key}" class="b3-text-field" type="text" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} onblur={handleNewRecordNameBlur} onkeydown={(event: KeyboardEvent) => { if (event.key === "Enter" && !event.isComposing) saveNewRecord(false); }} />
                            {:else if ["note", "violations", "diagnosis"].includes(e.key)}
                                <textarea id="lv-new-{e.key}" class="b3-text-field lv-record-textarea" rows="3" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}></textarea>
                            {:else}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="text" list={columnSuggestions[e.key] ? `lv-datalist-${e.key}` : undefined} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                {#if columnSuggestions[e.key]}
                                    <datalist id="lv-datalist-{e.key}">
                                        {#each columnSuggestions[e.key] as suggestion (suggestion)}
                                            <option value={suggestion}></option>
                                        {/each}
                                    </datalist>
                                {/if}
                                {#if e.key === "location" || e.key === "store_place" || e.key === "copy_location"}
                                    <div class="lv-preset-tags">
                                        {#each dynamicLocations as loc (loc)}
                                            <button type="button" class="lv-preset-tag" onclick={() => { form[e.key] = loc; }}>{loc}</button>
                                        {/each}
                                    </div>
                                {/if}
                            {/if}
                            {#if fieldMetaText(e.helpKey) || fieldMetaText(e.unitKey)}
                                <small class="lv-capture-field-hint">
                                    {fieldMetaText(e.helpKey)}{#if fieldMetaText(e.helpKey) && fieldMetaText(e.unitKey)} · {/if}{#if fieldMetaText(e.unitKey)}{t("capture.unitLabel")}：{fieldMetaText(e.unitKey)}{/if}
                                </small>
                            {/if}
                            {#if formFieldError(e)}<small class="lv-record-field-error" id="lv-new-{e.key}-error" role="alert">{formFieldError(e)}</small>{/if}
                        </div>
                    {/each}
                </div>
            </section>

            {#if additionalCols.length > 0}
                <details class="lv-record-more">
                    <summary>{t("ledger.additionalFields")} <span>{additionalCols.length}</span></summary>
                    <section class="lv-record-section lv-record-section--nested">
                        <div class="lv-record-grid">
                            {#each additionalCols as e (e.key)}
                                <div class="lv-record-field" class:lv-record-field-wide={e.key === "name" || e.type === "url" || ["note", "violations", "diagnosis"].includes(e.key)}>
                                    {#if e.type !== "checkbox"}<label for="lv-new-{e.key}">{fieldLabel(e.key)}{e.required ? " *" : ""}</label>{/if}
                                    {#if e.type === "select"}
                                        <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                            <option value="">{fieldLabel(e.key)}</option>
                                            {#each e.options ?? [] as opt (opt)}<option value={opt}>{t(`field.${e.key}.opt.${opt}`) !== `field.${e.key}.opt.${opt}` ? t(`field.${e.key}.opt.${opt}`) : opt}</option>{/each}
                                        </select>
                                    {:else if e.type === "relation"}
                                        <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                            <option value="">{fieldLabel(e.key)}: {t("members.all")}</option>
                                            {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}<option value={m.avItemId ?? ""} disabled={!m.avItemId}>{m.name}{m.avItemId ? "" : ` · ${t("members.notLinked")}`}</option>{/each}
                                        </select>
                                    {:else if e.type === "date"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "number"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="number" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaText(e.placeholderKey) || fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "url"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="url" placeholder={fieldMetaText(e.placeholderKey) || fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "checkbox"}
                                        <label class="lv-record-check"><input id="lv-new-{e.key}" type="checkbox" class="b3-switch" bind:checked={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />{fieldLabel(e.key)}{e.required ? " *" : ""}</label>
                                    {:else if ["note", "violations", "diagnosis"].includes(e.key)}
                                        <textarea id="lv-new-{e.key}" class="b3-text-field lv-record-textarea" rows="3" placeholder={fieldMetaText(e.placeholderKey) || fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}></textarea>
                                    {:else}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="text" placeholder={fieldMetaText(e.placeholderKey) || fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {/if}
                                    {#if fieldMetaText(e.helpKey) || fieldMetaText(e.unitKey)}<small class="lv-capture-field-hint">{fieldMetaText(e.helpKey)}{#if fieldMetaText(e.helpKey) && fieldMetaText(e.unitKey)} · {/if}{#if fieldMetaText(e.unitKey)}{t("capture.unitLabel")}：{fieldMetaText(e.unitKey)}{/if}</small>{/if}
                                    {#if formFieldError(e)}<small class="lv-record-field-error" id="lv-new-{e.key}-error" role="alert">{formFieldError(e)}</small>{/if}
                                </div>
                            {/each}
                        </div>
                    </section>
                </details>
            {/if}

            {#if active === "certs"}
                {#if !form.category}
                    <div class="lv-record-next" role="status">{t("ledger.chooseCategoryFirst")}</div>
                {:else}
                    <section class="lv-record-section">
                        <h3>{t("ledger.newRecordDetails")}</h3>
                        <div class="lv-record-grid">
                            {#each certificateScalarCols as e (e.key)}
                                <div class="lv-record-field" class:lv-record-field-wide={e.key === "x_cert_id_number" || e.key === "note"}>
                                    <label for="lv-new-{e.key}">{fieldLabel(e.key)}</label>
                                    {#if e.type === "select"}
                                        <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending}>
                                            <option value="">{fieldLabel(e.key)}</option>
                                            {#each e.options ?? [] as opt (opt)}<option value={opt}>{t(`field.${e.key}.opt.${opt}`) !== `field.${e.key}.opt.${opt}` ? t(`field.${e.key}.opt.${opt}`) : opt}</option>{/each}
                                        </select>
                                    {:else if e.type === "date"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} />
                                    {:else if e.key === "x_cert_id_number"}
                                        <div class="lv-record-field-stack">
                                            <input id="lv-new-{e.key}" class="b3-text-field lv-sensitive-input" type="text" inputmode="numeric" autocomplete="off" placeholder={fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} />
                                            {#if idcardCheck}
                                                {#if idcardCheck.ok}<span class="lv-caption lv-valid" role="status">{t("ledger.idcardValid").replace("${birth}", idcardCheck.birth ?? "").replace("${sex}", t(`ledger.idcardGender.${idcardCheck.sex}`))}</span>
                                                {:else}<span class="lv-caption lv-warn" role="alert">{t("ledger.idcardBad").replace("${reason}", t(`ledger.idcardReason.${idcardCheck.reason ?? "format"}`))}</span>{/if}
                                            {/if}
                                        </div>
                                    {:else}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="text" placeholder={fieldLabel(e.key)} bind:value={form[e.key]} disabled={saving || identityPending} />
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </section>
                    {#if quickAssetCols.length > 0}
                        <section class="lv-record-section">
                            <h3>{t("ledger.newRecordAttachments")}</h3>
                            <div class="lv-record-assets">
                                {#each quickAssetCols as e (e.key)}
                                    <label class="b3-button b3-button--outline lv-record-upload">
                                        <input type="file" accept="image/*,.pdf" multiple={e.key === "attachments"} capture={e.key === "attachments" ? undefined : "environment"} aria-label={fieldLabel(e.key)} onchange={(event) => { const input = event.currentTarget as HTMLInputElement; setCertificateFiles(e.key, Array.from(input.files ?? [])); input.value = ""; }} disabled={saving || identityPending} />
                                        {fieldLabel(e.key)} · {selectedFileText(e.key)}
                                    </label>
                                    {#each certificateFiles[e.key] ?? [] as file, index (`${e.key}-local-${index}`)}
                                        <span class="lv-record-file">{file.name}<button class="b3-button b3-button--text" aria-label={t("ledger.removeAttachment")} title={t("ledger.removeAttachment")} onclick={() => removeCertificateFile(e.key, "local", index)} disabled={saving}>×</button></span>
                                    {/each}
                                    {#each uploadedCertificateFiles[e.key] ?? [] as file, index (`${e.key}-uploaded-${index}`)}
                                        <span class="lv-record-file">{file.name}<button class="b3-button b3-button--text" aria-label={t("ledger.removeAttachment")} title={t("ledger.removeAttachment")} onclick={() => removeCertificateFile(e.key, "uploaded", index)} disabled={saving}>×</button></span>
                                    {/each}
                                {/each}
                                <span class="lv-caption">{t("ledger.photoUploadTip")}</span>
                            </div>
                        </section>
                    {/if}
                {/if}
            {/if}
            {#if active === "vehicles" && quickAssetCols.length > 0}
                <section class="lv-record-section">
                    <h3>{t("vehicle.photoTitle")}</h3>
                    <div class="lv-record-assets">
                        {#each quickAssetCols as e (e.key)}
                            <label class="b3-button b3-button--outline lv-record-upload">
                                <input type="file" accept="image/*" multiple={false} aria-label={t("vehicle.photoTitle")} onchange={(event) => { const input = event.currentTarget as HTMLInputElement; setCertificateFiles(e.key, Array.from(input.files ?? [])); input.value = ""; }} disabled={saving || identityPending} />
                                {t("vehicle.photoChoose")} · {selectedFileText(e.key)}
                            </label>
                            {#each certificateFiles[e.key] ?? [] as file, index (`vehicle-photo-local-${index}`)}
                                <span class="lv-record-file">{file.name}<button class="b3-button b3-button--text" aria-label={t("ledger.removeAttachment")} title={t("ledger.removeAttachment")} onclick={() => removeCertificateFile(e.key, "local", index)} disabled={saving}>×</button></span>
                            {/each}
                        {/each}
                        <span class="lv-caption">{t("vehicle.photoHint")}</span>
                    </div>
                </section>
            {/if}
            {#if active !== "certs" && active !== "vehicles" && quickAssetCols.length > 0}
                <section class="lv-record-section">
                    <h3>{t("ledger.newRecordAttachments")}</h3>
                    <div class="lv-record-assets">
                        {#each quickAssetCols as e (e.key)}
                            <label class="b3-button b3-button--outline lv-record-upload">
                                <input type="file" accept="image/*,.pdf" multiple aria-label={fieldLabel(e.key)} onchange={(event) => { const input = event.currentTarget as HTMLInputElement; setCertificateFiles(e.key, Array.from(input.files ?? [])); input.value = ""; }} disabled={saving || identityPending} />
                                {fieldLabel(e.key)} · {selectedFileText(e.key)}
                            </label>
                            {#each certificateFiles[e.key] ?? [] as file, index (`generic-asset-local-${e.key}-${index}`)}
                                <span class="lv-record-file">{file.name}<button class="b3-button b3-button--text" aria-label={t("ledger.removeAttachment")} title={t("ledger.removeAttachment")} onclick={() => removeCertificateFile(e.key, "local", index)} disabled={saving}>×</button></span>
                            {/each}
                            {#each uploadedCertificateFiles[e.key] ?? [] as file, index (`generic-asset-uploaded-${e.key}-${index}`)}
                                <span class="lv-record-file">{file.name}<button class="b3-button b3-button--text" aria-label={t("ledger.removeAttachment")} title={t("ledger.removeAttachment")} onclick={() => removeCertificateFile(e.key, "uploaded", index)} disabled={saving}>×</button></span>
                            {/each}
                        {/each}
                        <span class="lv-caption">{t("ledger.photoUploadTip")}</span>
                    </div>
                </section>
            {/if}
            {#if unsupportedCount > 0}
                <div class="lv-record-next" role="note">
                    <span>{t("ledger.unsupportedInForm").replace("${fields}", unsupportedCols.map((field) => fieldLabel(field.key)).join("、"))}</span>
                    <button class="b3-button b3-button--outline" onclick={() => plugin.showTabDocs(ref?.docId)} disabled={!ref?.docId}>{t("ledger.openDoc")} →</button>
                </div>
            {/if}
            {#if saveError}<div class="lv-record-error" role="alert">{saveError}</div>{:else if nameMissing}<div class="lv-record-error lv-record-warning" role="status">{t("ledger.nameRequired")}</div>{:else if active === "certs" && !form.category}<div class="lv-record-error lv-record-warning" role="status">{t("ledger.categoryRequired")}</div>{/if}
        </div>
        <div class="lv-sheet-foot lv-record-foot">
            {#if identityPending}
                <button class="lv-btn ghost" onclick={openPendingLedger}>{t("ledger.checkPending")}</button>
                <button class="lv-btn ghost" onclick={discardUncertainDraft}>{t("ledger.discardUncertain")}</button>
            {/if}
            <button class="b3-button b3-button--text" onclick={clearNewRecord} disabled={saving}>{pendingItemID ? t("ledger.discardPartial") : t("ledger.clearDraft")}</button>
            <span class="fn__flex-1"></span>
            <button class="lv-btn" onclick={() => saveNewRecord(true)} disabled={!canSubmitNewRecord}>{saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryContinue") : t("ledger.saveContinue")}</button>
            <button class="lv-btn primary" title="Ctrl+Enter" onclick={() => saveNewRecord(false)} disabled={!canSubmitNewRecord}>{saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryClose") : t("save")}</button>
        </div>
    </div>
</div>

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
                        <button class="b3-button b3-button--outline" onclick={openCsvImport} disabled={rebuilding}>📥 {t("ledger.importCsv")}</button>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
{:else if active === "vehicles"}
    <div class="lv-vehicle-grid" aria-label={t("module.vehicles")}>
        {#each visibleRows as r (r.itemID)}
            {@const tone = ledgerTone(r)}
            {@const photo = vehicleImageHref(r)}
            <article class="lv-vehicle-card lv-card" role="group">
                <div class="lv-vehicle-photo">
                    {#if photo}<img src={photo} alt={vehicleText(r, "name")} width="96" height="72" decoding="async" loading="lazy" />{:else}<UiIcon name="car" size={28} />{/if}
                </div>
                <div class="lv-vehicle-main">
                    <div class="lv-vehicle-head">
                        <button type="button" class="lv-vehicle-title" onclick={() => openDetail(r)} aria-label={`${t("ledger.detail")}：${vehicleText(r, "name")}`}>
                            {vehicleText(r, "name")}
                        </button>
                        <span class="lv-sev {toneCls(tone)}" title={tone === "danger" ? t("level.overdue") : tone === "warn" ? t("level.soon") : ""}></span>
                    </div>
                    <div class="lv-vehicle-sub">{vehicleText(r, "brand_model")} · {vehicleText(r, "plate")}</div>
                    <div class="lv-vehicle-meta">
                        <span>{vehicleText(r, "energy_type")}</span>
                        <span>{vehicleText(r, "mileage")} {t("fuel.km")}</span>
                        <span>{t("field.inspection_due")} · {vehicleText(r, "inspection_due")}</span>
                        <span>{t("field.insurance_due")} · {vehicleText(r, "insurance_due")}</span>
                    </div>
                    <div class="lv-vehicle-actions">
                        <button class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); openDetail(r, "fuel"); }}>{t("vehicle.quick.fuel")}</button>
                        <button class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); openDetail(r, "charging"); }}>{t("vehicle.quick.charging")}</button>
                        <button class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); openDetail(r, "maintenance"); }}>{t("vehicle.quick.maintenance")}</button>
                        <button class="b3-button b3-button--text" onclick={(e) => { e.stopPropagation(); openDetail(r, "edit"); }}>{t("members.edit")}</button>
                    </div>
                </div>
            </article>
        {/each}
        {#if filteredRows.length > visibleRows.length}
            <button class="b3-button b3-button--outline lv-vehicle-more" onclick={() => (renderLimit += RENDER_PAGE)}>{t("ledger.loadMore").replace("${n}", String(filteredRows.length - visibleRows.length))}</button>
        {/if}
    </div>
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
    <div class="lv-card lv-table-wrap lv-table" class:lv-table--compact={tableDensity === "compact"} style="margin-top:12px">
        <table bind:this={ledgerTableEl}>
            <thead><tr>
                <th style="width:36px;padding:4px 6px;text-align:center">
                    <input type="checkbox" class="b3-switch" style="transform:scale(0.8);margin:0" checked={allSelected} onclick={toggleSelectAll} title="全选/取消全选" />
                </th>
                <!-- Severity indicator column. -->
                <th class="lv-sev-col"></th>
                {#each tableKeys as k (k)}
                    <th>
                        <button class="b3-button b3-button--text" style="padding:0 2px;font-weight:600" title={t("ledger.sortTip")}
                            onclick={() => toggleSort(k)}>
                            {fieldLabel(k)}{sortKey === k ? (sortAsc ? " ↑" : " ↓") : ""}
                        </button>
                    </th>
                {/each}
            </tr></thead>
            <tbody>
                {#if virtualRange.start > 0}
                    <tr class="lv-virtual-spacer" aria-hidden="true"><td colspan={tableKeys.length + 2} style={`height:${virtualRange.start * virtualRowHeight}px`}></td></tr>
                {/if}
                {#each virtualRows as r (r.itemID)}
                    {@const tone = ledgerTone(r)}
                    {@const rowName = cellText(r.cells?.[ref?.columns?.name], "name") || cellText(r.cells?.[ref?.columns?.title], "title") || t("ledger.detail")}
                    <tr class="lv-row-link" onclick={() => openDetail(r)} title={t("ledger.detail")}>
                        <td style="width:36px;padding:4px 6px;text-align:center" onclick={(e) => e.stopPropagation()}>
                            <input type="checkbox" class="b3-switch" style="transform:scale(0.8);margin:0" checked={selectedItemIds.includes(r.itemID)} onclick={() => toggleRowSelect(r.itemID)} />
                        </td>
                        <td class="lv-sev-cell">
                            <button type="button" class="lv-table-open" aria-label={`${t("ledger.detail")}：${rowName}`} title={t("ledger.detail")}
                                onclick={(e) => { e.stopPropagation(); openDetail(r); }}>
                                <span class="lv-sev {toneCls(tone)}" aria-hidden="true"></span><UiIcon name="forward" size={14} />
                            </button>
                        </td>
                        {#each tableKeys as k (k)}
                            {@const v = r.cells?.[ref?.columns?.[k]]}
                            <td class="lv-num" style={k === "expiry" || k === "due" ? `color:${toneColor(tone)}` : ""}>
                                {#if k === "qty" || k === "stock_qty"}
                                    <div class="lv-qty-stepper">
                                        <button type="button" class="lv-qty-btn"
                                            title={t("ledger.quickDec")} onclick={(e) => { e.stopPropagation(); adjustRowQty(r, k, -1); }}>−</button>
                                        <span style="min-width:18px;text-align:center">{cellText(v, k)}</span>
                                        <button type="button" class="lv-qty-btn"
                                            title={t("ledger.quickInc")} onclick={(e) => { e.stopPropagation(); adjustRowQty(r, k, 1); }}>+</button>
                                    </div>
                                {:else}
                                    {cellText(v, k)}
                                {/if}
                            </td>
                        {/each}
                    </tr>
                {/each}
                {#if virtualRange.end < visibleRows.length}
                    <tr class="lv-virtual-spacer" aria-hidden="true"><td colspan={tableKeys.length + 2} style={`height:${(visibleRows.length - virtualRange.end) * virtualRowHeight}px`}></td></tr>
                {/if}
                {#if filteredRows.length > visibleRows.length}
                    <!-- Progressive rendering load-more row. -->
                    <tr class="lv-more">
                        <td colspan={tableKeys.length + 2}>
                            <button class="b3-button b3-button--outline" style="margin:0 auto;display:block"
                                onclick={() => (renderLimit += RENDER_PAGE)}>
                                {t("ledger.loadMore").replace("${n}", String(filteredRows.length - visibleRows.length))}
                            </button>
                        </td>
                    </tr>
                {/if}
            </tbody>
        </table>
    </div>
    {#if selectedItemIds.length > 0}
        <div class="lv-batch-bar" role="toolbar" aria-label="批量操作">
            <span class="lv-caption" style="font-weight:600;color:var(--lv-tx)">
                {t("ledger.batchSelected").replace("${n}", String(selectedItemIds.length))}
            </span>
            {#if ref?.columns?.location}
                <button type="button" class="b3-button b3-button--outline" style={fs12Pad310Css} disabled={batchBusy} onclick={openBatchLocationModal}>
                    📍 {t("ledger.batchLocation")}
                </button>
            {/if}
            {#if memberCol && (plugin.settings.members?.length ?? 0) > 0}
                <button type="button" class="b3-button b3-button--outline" style={fs12Pad310Css} disabled={batchBusy} onclick={openBatchMemberModal}>
                    👤 {t("ledger.batchMember")}
                </button>
            {/if}
            <button type="button" class="b3-button b3-button--text ft__error" style="{fs12Pad310Css};color:var(--lv-danger)" disabled={batchBusy} onclick={batchDelete}>
                🗑️ {t("ledger.batchDelete")}
            </button>
            <button type="button" class="b3-button b3-button--text" style={pad36Fs12Css} onclick={() => { selectedItemIds = []; }} title={t("close")}>
                ✕
            </button>
        </div>
    {/if}
{/if}
