<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import { Menu } from "siyuan";
    import { showMessage } from "@/libs/notice";
    import type { TableDensity } from "../panel-session";

    type LedgerTone = "danger" | "warn" | "ok" | "none";

    let {
        tableDensity = "comfortable" as TableDensity,
        tableKeys = [] as string[],
        visibleRows = [] as any[],
        filteredRows = [] as any[],
        ref,
        activeModuleId = "",
        sortKey = "",
        sortAsc = true,
        selectedItemIds = $bindable<string[]>([]),
        plugin,
        t,
        fieldLabel,
        cellText,
        ledgerTone,
        toneCls,
        onToggleSort,
        onOpenDetail,
        onAdjustQty,
        onDuplicateRow,
        onDeleteRow,
        onCopyRowMarkdown,
        onLoadMore,
    }: {
        tableDensity?: TableDensity;
        tableKeys: string[];
        visibleRows: any[];
        filteredRows: any[];
        ref: any;
        activeModuleId?: string;
        sortKey?: string;
        sortAsc?: boolean;
        selectedItemIds?: string[];
        plugin?: any;
        t: (k: string) => string;
        fieldLabel?: (k: string) => string;
        cellText: (v: any, k?: string) => string;
        ledgerTone: (r: any) => LedgerTone;
        toneCls: (tone: LedgerTone) => string;
        toneColor?: (tone: LedgerTone) => string;
        onToggleSort: (k: string) => void;
        onOpenDetail: (r: any) => void;
        onAdjustQty: (r: any, k: string, delta: number) => void;
        onDuplicateRow?: (r: any) => void;
        onDeleteRow?: (r: any) => void;
        onCopyRowMarkdown?: (r: any) => void;
        onLoadMore?: () => void;
    } = $props();

    const resolveFieldLabel = (k: string) => {
        if (fieldLabel) return fieldLabel(k);
        const trans = t(`field.${k}`);
        return trans !== `field.${k}` ? trans : k;
    };

    // 密度模式（§17）：舒适（48px）与紧凑（34px）两档，滚动轨道高度随密度自适应。
    const VIRTUAL_ROW_HEIGHT_COMFORTABLE = 48;
    const VIRTUAL_ROW_HEIGHT_COMPACT = 34;
    let virtualRowHeight = $derived(tableDensity === "compact" ? VIRTUAL_ROW_HEIGHT_COMPACT : VIRTUAL_ROW_HEIGHT_COMFORTABLE);
    const VIRTUAL_OVERSCAN = 8;
    let ledgerScrollTop = $state(0);
    let ledgerViewportHeight = $state(640);
    let ledgerTableEl = $state<HTMLTableElement | undefined>(undefined);
    let virtualRoot: HTMLElement | undefined;

    let lastCheckedIndex = $state<number | null>(null);

    const allSelected = $derived(filteredRows.length > 0 && selectedItemIds.length === filteredRows.length);
    const filteredRowIndexMap = $derived(new Map(filteredRows.map((r, i) => [r.itemID, i])));

    function toggleSelectAll() {
        if (allSelected) {
            selectedItemIds = [];
            lastCheckedIndex = null;
        } else {
            selectedItemIds = filteredRows.map((r) => r.itemID);
        }
    }

    function toggleRowSelect(id: string, rowIndex: number, e?: MouseEvent) {
        if (e?.shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== rowIndex && filteredRows.length > 0) {
            const start = Math.min(lastCheckedIndex, rowIndex);
            const end = Math.max(lastCheckedIndex, rowIndex);
            const rangeIds = filteredRows.slice(start, end + 1).map((r) => r.itemID);
            const nextSet = new Set(selectedItemIds);
            rangeIds.forEach((rid) => nextSet.add(rid));
            selectedItemIds = Array.from(nextSet);
        } else {
            if (selectedItemIds.includes(id)) {
                selectedItemIds = selectedItemIds.filter((x) => x !== id);
            } else {
                selectedItemIds = [...selectedItemIds, id];
            }
        }
        lastCheckedIndex = rowIndex;
    }

    const numericSummaries = $derived.by(() => {
        if (!ref?.columns || filteredRows.length === 0) return null;
        let sumAmount = 0;
        let hasAmount = false;
        let sumQty = 0;
        let hasQty = false;

        const amountCol = ref.columns.amount;
        const qtyCol = ref.columns.qty || ref.columns.stock_qty;

        for (const r of filteredRows) {
            if (amountCol) {
                const cell = r.cells?.[amountCol];
                const val = typeof cell?.number?.content === "number" ? cell.number.content
                    : typeof cell === "number" ? cell
                    : Number(cell?.text?.content || 0);
                if (Number.isFinite(val) && val > 0) {
                    sumAmount += val;
                    hasAmount = true;
                }
            }
            if (qtyCol) {
                const cell = r.cells?.[qtyCol];
                const val = typeof cell?.number?.content === "number" ? cell.number.content
                    : typeof cell === "number" ? cell
                    : Number(cell?.text?.content || 0);
                if (Number.isFinite(val) && val > 0) {
                    sumQty += val;
                    hasQty = true;
                }
            }
        }

        if (!hasAmount && !hasQty) return null;
        return {
            amount: hasAmount ? sumAmount : undefined,
            qty: hasQty ? sumQty : undefined,
        };
    });

    // 列宽拖拽与持久化记忆 (CAND-27)
    let currentModuleColWidths = $state<Record<string, number>>({});
    let resizingColKey = $state<string | null>(null);

    $effect(() => {
        const modKey = activeModuleId || ref?.avId || "default";
        const saved = plugin?.settings?.ledgerColumnWidths?.[modKey] || {};
        currentModuleColWidths = { ...saved };
    });

    function startColResize(e: MouseEvent, k: string, thElement: HTMLElement) {
        if (typeof window === "undefined") return;
        e.preventDefault();
        e.stopPropagation();
        resizingColKey = k;
        const startX = e.clientX;
        const startWidth = thElement.getBoundingClientRect().width;

        const onMouseMove = (moveEv: MouseEvent) => {
            const diff = moveEv.clientX - startX;
            const newWidth = Math.max(50, Math.round(startWidth + diff));
            currentModuleColWidths = {
                ...currentModuleColWidths,
                [k]: newWidth,
            };
        };

        const onMouseUp = async () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            document.body.classList.remove("lv-col-resizing");
            resizingColKey = null;

            if (plugin?.settings) {
                const modKey = activeModuleId || ref?.avId || "default";
                if (!plugin.settings.ledgerColumnWidths) {
                    plugin.settings.ledgerColumnWidths = {};
                }
                plugin.settings.ledgerColumnWidths[modKey] = { ...currentModuleColWidths };
                try {
                    const { saveSettings } = await import("@/core/settings");
                    await saveSettings(plugin, plugin.settings);
                } catch { /* soft fail */ }
            }
        };

        document.body.classList.add("lv-col-resizing");
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }

    function resetColWidth(k: string) {
        const next = { ...currentModuleColWidths };
        delete next[k];
        currentModuleColWidths = next;
        if (plugin?.settings?.ledgerColumnWidths) {
            const modKey = activeModuleId || ref?.avId || "default";
            if (plugin.settings.ledgerColumnWidths[modKey]) {
                delete plugin.settings.ledgerColumnWidths[modKey][k];
            }
            void import("@/core/settings").then(({ saveSettings }) => saveSettings(plugin, plugin.settings));
        }
    }

    function handleRowContextMenu(e: MouseEvent, r: any) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
            const menu = new Menu("lv-ledger-table-row");
            menu.addItem({
                label: t("ledger.detail"),
                click: () => onOpenDetail(r),
            });
            menu.addItem({
                label: t("ledger.copyBlockRef"),
                click: async () => {
                    const rowName = cellText(r.cells?.[ref?.columns?.name], "name") || cellText(r.cells?.[ref?.columns?.title], "title") || t("ledger.detail");
                    try {
                        await navigator.clipboard.writeText(`((${r.itemID} '${rowName}'))`);
                        showMessage(t("spotlight.refCopied"), 2500, "info");
                    } catch (err) {
                        showMessage(t("ledger.copyAsImageFail") + ` (${err instanceof Error ? err.message : String(err)})`, 4000, "error");
                    }
                },
            });
            if (onCopyRowMarkdown) {
                menu.addItem({
                    label: t("ledger.copyAsMarkdown"),
                    click: () => onCopyRowMarkdown(r),
                });
            }
            if (onDuplicateRow) {
                menu.addItem({
                    label: t("ledger.duplicateRow"),
                    click: () => onDuplicateRow(r),
                });
            }
            if (ref?.docId && plugin?.showTabDocs) {
                menu.addItem({
                    label: t("ledger.openDoc"),
                    click: () => plugin.showTabDocs(ref.docId, r.itemID),
                });
            }
            if (onDeleteRow) {
                menu.addItem({
                    label: t("delete"),
                    click: () => onDeleteRow(r),
                });
            }
            menu.open({ x: e.clientX, y: e.clientY });
        }, 0);
    }

    let sortAnnouncement = $state("");

    function handleSortClick(k: string) {
        const isCurrent = sortKey === k;
        const nextAsc = isCurrent ? !sortAsc : true;
        const label = resolveFieldLabel(k);
        sortAnnouncement = (nextAsc ? t("ledger.sortSortedAsc") : t("ledger.sortSortedDesc")).replace("${field}", label);
        onToggleSort(k);
    }

    function handleHeaderKeydown(e: KeyboardEvent) {
        const target = e.target as HTMLElement;
        if (!target) return;
        const headerRow = e.currentTarget as HTMLElement;
        const controls = Array.from(headerRow.querySelectorAll<HTMLElement>("input, .lv-th-sort-btn"));
        const idx = controls.indexOf(target);
        if (idx === -1) return;

        if (e.key === "ArrowRight") {
            e.preventDefault();
            controls[(idx + 1) % controls.length]?.focus();
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            controls[(idx - 1 + controls.length) % controls.length]?.focus();
        } else if (e.key === "Home") {
            e.preventDefault();
            controls[0]?.focus();
        } else if (e.key === "End") {
            e.preventDefault();
            controls[controls.length - 1]?.focus();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const firstRow = ledgerTableEl?.querySelector<HTMLElement>("tbody tr.lv-row-link");
            firstRow?.focus();
        }
    }

    function handleRowKeydown(e: KeyboardEvent, r: any) {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenDetail(r);
        } else if (e.key === "ArrowDown") {
            let nextEl = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
            while (nextEl && !nextEl.classList.contains("lv-row-link")) {
                nextEl = nextEl.nextElementSibling as HTMLElement | null;
            }
            if (nextEl) {
                e.preventDefault();
                nextEl.focus();
            }
        } else if (e.key === "ArrowUp") {
            let prevEl = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
            while (prevEl && !prevEl.classList.contains("lv-row-link")) {
                prevEl = prevEl.previousElementSibling as HTMLElement | null;
            }
            if (prevEl) {
                e.preventDefault();
                prevEl.focus();
            } else {
                e.preventDefault();
                const firstHeader = ledgerTableEl?.querySelector<HTMLElement>("thead .lv-th-sort-btn, thead input");
                firstHeader?.focus();
            }
        }
    }

    let cachedTableTop = $state(0);

    const virtualRange = $derived.by(() => {
        void ledgerScrollTop;
        void ledgerViewportHeight;
        const total = visibleRows.length;
        const isNarrowMobile = typeof window !== "undefined" && window.innerWidth <= 680;
        if (total <= 80 || isNarrowMobile) return { start: 0, end: total };
        const tableTop = Math.round(cachedTableTop);
        const scrollTop = Math.round(ledgerScrollTop);
        const first = Math.max(0, Math.floor((scrollTop - tableTop) / virtualRowHeight) - VIRTUAL_OVERSCAN);
        const count = Math.ceil(Math.round(ledgerViewportHeight) / virtualRowHeight) + VIRTUAL_OVERSCAN * 2;
        const start = Math.max(0, Math.min(first, Math.max(0, total - count)));
        const end = Math.min(total, start + count);
        return { start, end };
    });
    const virtualRows = $derived(visibleRows.slice(virtualRange.start, virtualRange.end));

    function measureLedgerViewport() {
        if (!virtualRoot) return;
        ledgerViewportHeight = Math.round(virtualRoot.clientHeight) || 640;
        ledgerScrollTop = Math.round(virtualRoot.scrollTop);
        if (ledgerTableEl) {
            try {
                const tableRect = ledgerTableEl.getBoundingClientRect();
                const rootRect = virtualRoot.getBoundingClientRect();
                cachedTableTop = Math.round(tableRect.top - rootRect.top + virtualRoot.scrollTop);
            } catch { /* soft measure */ }
        }
    }

    $effect(() => {
        const table = ledgerTableEl;
        if (!table) return;
        const root = table.closest<HTMLElement>(".lv-home");
        if (!root) return;
        virtualRoot = root;
        let scrollRaf = 0;
        const onScroll = () => {
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
                scrollRaf = 0;
                ledgerScrollTop = Math.round(root.scrollTop);
            });
        };
        root.addEventListener("scroll", onScroll, { passive: true });
        const resize = new ResizeObserver(measureLedgerViewport);
        resize.observe(root);
        measureLedgerViewport();
        return () => {
            if (scrollRaf) cancelAnimationFrame(scrollRaf);
            root.removeEventListener("scroll", onScroll);
            resize.disconnect();
            if (virtualRoot === root) virtualRoot = undefined;
        };
    });
</script>

<div class="lv-card lv-table-wrap lv-table lv-table-margin-top" class:lv-table--compact={tableDensity === "compact"}>
    <div class="lv-sr-only" aria-live="polite" aria-atomic="true">
        {sortAnnouncement}
    </div>
    <table bind:this={ledgerTableEl}>
        <thead><tr onkeydown={handleHeaderKeydown}>
            <th class="lv-check-col">
                <input type="checkbox" class="b3-checkbox lv-checkbox-clean" checked={allSelected} onclick={toggleSelectAll} title={t("hub.selectAll")} aria-label={t("hub.selectAll")} />
            </th>
            <!-- Severity indicator column. -->
            <th class="lv-sev-col"></th>
            {#each tableKeys as k (k)}
                {@const colWidth = currentModuleColWidths[k]}
                <th aria-sort={sortKey === k ? (sortAsc ? "ascending" : "descending") : "none"}
                    style={colWidth ? `width:${colWidth}px;min-width:${colWidth}px;max-width:${colWidth}px` : undefined}>
                    <button type="button" class="b3-button b3-button--text lv-th-sort-btn" title={t("ledger.sortTip")}
                        aria-label={`${resolveFieldLabel(k)}${sortKey === k ? `，${sortAsc ? t("ledger.sortAsc") : t("ledger.sortDesc")}` : ""}`}
                        onclick={() => handleSortClick(k)}>
                        {resolveFieldLabel(k)}{#if sortKey === k}<span class="lv-sort-arrow" aria-hidden="true"><UiIcon name={sortAsc ? "chevronUp" : "chevronDown"} size={11} /></span>{/if}
                    </button>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span class="lv-col-resizer" class:is-resizing={resizingColKey === k}
                        title="双击恢复自适应宽度，拖拽调整列宽"
                        ondblclick={(e) => { e.stopPropagation(); resetColWidth(k); }}
                        onmousedown={(e) => {
                            const th = (e.currentTarget as HTMLElement).closest("th");
                            if (th) startColResize(e, k, th);
                        }}></span>
                </th>
            {/each}
        </tr></thead>
        <tbody>
            {#if virtualRange.start > 0}
                <tr class="lv-virtual-spacer" aria-hidden="true"><td colspan={tableKeys.length + 2} style={`height:${Math.round(virtualRange.start * virtualRowHeight)}px`}></td></tr>
            {/if}
            {#each virtualRows as r (r.itemID)}
                {@const tone = ledgerTone(r)}
                {@const rowName = cellText(r.cells?.[ref?.columns?.name], "name") || cellText(r.cells?.[ref?.columns?.title], "title") || t("ledger.detail")}
                <tr class="lv-row-link" tabindex="0"
                    onclick={() => onOpenDetail(r)}
                    oncontextmenu={(e) => handleRowContextMenu(e, r)}
                    onkeydown={(e) => handleRowKeydown(e, r)}
                    title={t("ledger.detail")}>
                    <td class="lv-check-cell" onclick={(e) => e.stopPropagation()}>
                        <input type="checkbox" class="b3-checkbox lv-checkbox-clean"
                            checked={selectedItemIds.includes(r.itemID)}
                            onclick={(e) => {
                                const idx = filteredRowIndexMap.get(r.itemID) ?? -1;
                                toggleRowSelect(r.itemID, idx, e);
                            }}
                            aria-label={`${t("hub.select")} ${rowName}`} />
                    </td>
                    <td class="lv-sev-cell">
                        <button type="button" class="lv-table-open" aria-label={`${t("ledger.detail")}：${rowName}`} title={t("ledger.detail")}
                            onclick={(e) => { e.stopPropagation(); onOpenDetail(r); }}>
                            <span class="lv-sev {toneCls(tone)}" aria-hidden="true"></span><UiIcon name="forward" size={14} />
                        </button>
                    </td>
                    {#each tableKeys as k (k)}
                        {@const colWidth = currentModuleColWidths[k]}
                        {@const v = r.cells?.[ref?.columns?.[k]]}
                        {@const cellVal = cellText(v, k)}
                        <td class="lv-num" data-label={resolveFieldLabel(k)} data-col={k}
                            class:is-empty-cell={!cellVal || cellVal === "—"}
                            class:lv-tx-danger={(k === "expiry" || k === "due") && tone === "danger"} class:lv-tx-warn={(k === "expiry" || k === "due") && tone === "warn"}
                            style={colWidth ? `width:${colWidth}px;min-width:${colWidth}px;max-width:${colWidth}px;overflow:hidden;text-overflow:ellipsis` : undefined}>
                            {#if k === "qty" || k === "stock_qty"}
                                <div class="lv-qty-stepper">
                                    <button type="button" class="lv-qty-btn"
                                        title={t("ledger.quickDec")} aria-label={t("ledger.quickDec")} onclick={(e) => { e.stopPropagation(); onAdjustQty(r, k, -1); }}><UiIcon name="minus" size={10} /></button>
                                    <span class="lv-cell-center-min">{cellVal}</span>
                                    <button type="button" class="lv-qty-btn"
                                        title={t("ledger.quickInc")} aria-label={t("ledger.quickInc")} onclick={(e) => { e.stopPropagation(); onAdjustQty(r, k, 1); }}><UiIcon name="add" size={10} /></button>
                                </div>
                            {:else}
                                {cellVal}
                            {/if}
                        </td>
                    {/each}
                </tr>
            {/each}
            {#if virtualRange.end < visibleRows.length}
                <tr class="lv-virtual-spacer" aria-hidden="true"><td colspan={tableKeys.length + 2} style={`height:${Math.round((visibleRows.length - virtualRange.end) * virtualRowHeight)}px`}></td></tr>
            {/if}
            {#if filteredRows.length > visibleRows.length}
                <!-- Progressive rendering load-more row. -->
                <tr class="lv-more">
                    <td colspan={tableKeys.length + 2}>
                        <button type="button" class="b3-button b3-button--outline lv-btn-center-block"
                            onclick={() => onLoadMore?.()}>
                            {t("ledger.loadMore").replace("${n}", String(filteredRows.length - visibleRows.length))}
                        </button>
                    </td>
                </tr>
            {/if}
        </tbody>
    </table>
    {#if numericSummaries && filteredRows.length > 0}
        <div class="lv-table-summary-bar" role="status" aria-label={t("ledger.summary")}>
            <span class="lv-table-summary-item lv-tx-muted">
                {t("ledger.summaryRows").replace("${n}", String(filteredRows.length))}
            </span>
            {#if numericSummaries.amount !== undefined}
                <span class="lv-table-summary-item">
                    <span class="lv-table-summary-label">{t("ledger.summaryAmount")}:</span>
                    <b class="lv-num lv-tx-accent">¥{numericSummaries.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</b>
                </span>
            {/if}
            {#if numericSummaries.qty !== undefined}
                <span class="lv-table-summary-item">
                    <span class="lv-table-summary-label">{t("ledger.summaryQty")}:</span>
                    <b class="lv-num">{numericSummaries.qty}</b>
                </span>
            {/if}
            {#if selectedItemIds.length > 0}
                <span class="lv-badge blue lv-badge--xs">
                    {t("ledger.selectedCount").replace("${n}", String(selectedItemIds.length))}
                </span>
            {/if}
        </div>
    {/if}
</div>

