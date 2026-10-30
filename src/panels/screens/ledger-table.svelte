<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { TableDensity } from "../panel-session";

    type LedgerTone = "danger" | "warn" | "ok" | "none";

    let {
        tableDensity = "comfortable" as TableDensity,
        tableKeys = [] as string[],
        visibleRows = [] as any[],
        filteredRows = [] as any[],
        ref,
        sortKey = "",
        sortAsc = true,
        selectedItemIds = $bindable<string[]>([]),
        t,
        fieldLabel,
        cellText,
        ledgerTone,
        toneCls,
        onToggleSort,
        onOpenDetail,
        onAdjustQty,
        onLoadMore,
    }: {
        tableDensity?: TableDensity;
        tableKeys: string[];
        visibleRows: any[];
        filteredRows: any[];
        ref: any;
        sortKey?: string;
        sortAsc?: boolean;
        selectedItemIds?: string[];
        t: (k: string) => string;
        fieldLabel?: (k: string) => string;
        cellText: (v: any, k?: string) => string;
        ledgerTone: (r: any) => LedgerTone;
        toneCls: (tone: LedgerTone) => string;
        toneColor?: (tone: LedgerTone) => string;
        onToggleSort: (k: string) => void;
        onOpenDetail: (r: any) => void;
        onAdjustQty: (r: any, k: string, delta: number) => void;
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

    const allSelected = $derived(filteredRows.length > 0 && selectedItemIds.length === filteredRows.length);

    function toggleSelectAll() {
        if (allSelected) selectedItemIds = [];
        else selectedItemIds = filteredRows.map((r) => r.itemID);
    }

    function toggleRowSelect(id: string) {
        if (selectedItemIds.includes(id)) {
            selectedItemIds = selectedItemIds.filter((x) => x !== id);
        } else {
            selectedItemIds = [...selectedItemIds, id];
        }
    }

    let cachedTableTop = $state(0);

    const virtualRange = $derived.by(() => {
        void ledgerScrollTop;
        void ledgerViewportHeight;
        const total = visibleRows.length;
        if (total <= 80) return { start: 0, end: total };
        const tableTop = cachedTableTop;
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
        if (ledgerTableEl) {
            try {
                cachedTableTop = ledgerTableEl.getBoundingClientRect().top - virtualRoot.getBoundingClientRect().top + virtualRoot.scrollTop;
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
                ledgerScrollTop = root.scrollTop;
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
    <table bind:this={ledgerTableEl}>
        <thead><tr>
            <th class="lv-check-col">
                <input type="checkbox" class="b3-checkbox lv-checkbox-clean" checked={allSelected} onclick={toggleSelectAll} title={t("hub.selectAll")} aria-label={t("hub.selectAll")} />
            </th>
            <!-- Severity indicator column. -->
            <th class="lv-sev-col"></th>
            {#each tableKeys as k (k)}
                <th aria-sort={sortKey === k ? (sortAsc ? "ascending" : "descending") : "none"}>
                    <button class="b3-button b3-button--text lv-th-sort-btn" title={t("ledger.sortTip")}
                        aria-label={`${resolveFieldLabel(k)}${sortKey === k ? (sortAsc ? "，升序" : "，降序") : "，未排序"}`}
                        onclick={() => onToggleSort(k)}>
                        {resolveFieldLabel(k)}{#if sortKey === k}<span class="lv-sort-arrow" aria-hidden="true"><UiIcon name={sortAsc ? "chevronUp" : "chevronDown"} size={11} /></span>{/if}
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
                <tr class="lv-row-link" tabindex="0"
                    onclick={() => onOpenDetail(r)}
                    onkeydown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onOpenDetail(r); } }}
                    title={t("ledger.detail")}>
                    <td class="lv-check-cell" onclick={(e) => e.stopPropagation()}>
                        <input type="checkbox" class="b3-checkbox lv-checkbox-clean" checked={selectedItemIds.includes(r.itemID)} onclick={() => toggleRowSelect(r.itemID)} aria-label={`${t("hub.select")} ${rowName}`} />
                    </td>
                    <td class="lv-sev-cell">
                        <button type="button" class="lv-table-open" aria-label={`${t("ledger.detail")}：${rowName}`} title={t("ledger.detail")}
                            onclick={(e) => { e.stopPropagation(); onOpenDetail(r); }}>
                            <span class="lv-sev {toneCls(tone)}" aria-hidden="true"></span><UiIcon name="forward" size={14} />
                        </button>
                    </td>
                    {#each tableKeys as k (k)}
                        {@const v = r.cells?.[ref?.columns?.[k]]}
                        <td class="lv-num" class:lv-tx-danger={(k === "expiry" || k === "due") && tone === "danger"} class:lv-tx-warn={(k === "expiry" || k === "due") && tone === "warn"}>
                            {#if k === "qty" || k === "stock_qty"}
                                <div class="lv-qty-stepper">
                                    <button type="button" class="lv-qty-btn"
                                        title={t("ledger.quickDec")} aria-label={t("ledger.quickDec")} onclick={(e) => { e.stopPropagation(); onAdjustQty(r, k, -1); }}>−</button>
                                    <span class="lv-cell-center-min">{cellText(v, k)}</span>
                                    <button type="button" class="lv-qty-btn"
                                        title={t("ledger.quickInc")} aria-label={t("ledger.quickInc")} onclick={(e) => { e.stopPropagation(); onAdjustQty(r, k, 1); }}><UiIcon name="add" size={10} /></button>
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
                        <button class="b3-button b3-button--outline lv-btn-center-block"
                            onclick={() => onLoadMore?.()}>
                            {t("ledger.loadMore").replace("${n}", String(filteredRows.length - visibleRows.length))}
                        </button>
                    </td>
                </tr>
            {/if}
        </tbody>
    </table>
</div>

<style>
    .lv-table-margin-top {
        margin-top: 12px;
    }
    .lv-checkbox-clean {
        cursor: pointer;
        margin: 0;
    }
    .lv-th-sort-btn {
        padding: 0 2px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }
    .lv-sort-arrow {
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
    }
    .lv-cell-center-min {
        min-width: 18px;
        text-align: center;
    }
    .lv-btn-center-block {
        margin: 0 auto;
        display: block;
    }
</style>
