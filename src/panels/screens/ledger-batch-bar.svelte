<script lang="ts">
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage, homeInline } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        active,
        ref,
        selectedItemIds = $bindable<string[]>([]),
        rows = [],
        filteredRows,
        dynamicLocations = [],
        memberCol,
        cellText,
        t,
        onReload,
    }: {
        plugin: any;
        active: string;
        ref?: { avId?: string; columns?: Record<string, string> };
        selectedItemIds: string[];
        rows?: any[];
        filteredRows?: any[];
        dynamicLocations?: string[];
        memberCol?: string;
        cellText?: (cell: any, key?: string, raw?: boolean) => string;
        t: (k: string) => string;
        onReload?: () => Promise<void>;
    } = $props();

    let batchBusy = $state(false);
    let toolbarEl = $state<HTMLElement | undefined>(undefined);
    const isGuestMode = $derived(Boolean(plugin?.runtime?.guestModeActive));
    const currentVisibleRows = $derived(filteredRows ?? rows);

    function getVisibleSelectedIds(): string[] {
        const visibleSet = new Set(currentVisibleRows.map((r) => r.itemID));
        const next = selectedItemIds.filter((id) => visibleSet.has(id));
        if (next.length !== selectedItemIds.length) {
            selectedItemIds = next;
        }
        return next;
    }

    function restoreFocusAfterClear() {
        try {
            const root = toolbarEl?.closest(".lv-home") || document;
            const selectAll = root.querySelector<HTMLElement>(".lv-check-col input, .lv-table thead input");
            selectAll?.focus();
        } catch { /* soft */ }
    }

    function clearSelection() {
        selectedItemIds = [];
        restoreFocusAfterClear();
    }

    function handleToolbarKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            return;
        }
        if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            const buttons = Array.from(
                toolbarEl?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []
            );
            if (buttons.length === 0) return;
            const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex = 0;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                nextIndex = currentIndex >= 0 ? (currentIndex + 1) % buttons.length : 0;
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
            } else if (e.key === "Home") {
                nextIndex = 0;
            } else if (e.key === "End") {
                nextIndex = buttons.length - 1;
            }
            e.preventDefault();
            buttons[nextIndex]?.focus();
        }
    }

    async function openBatchMemberModal() {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        const targetIds = getVisibleSelectedIds();
        if (!targetIds.length || !ref?.avId || !memberCol || batchBusy) return;
        const membersList = (plugin.settings.members ?? []).filter((m: any) => !!m.avItemId);
        if (!membersList.length) {
            showMessage(t("members.notLinked"), 4000, "info");
            return;
        }
        try {
            const { openBatchMemberDialog } = await import("@/core/batch-dialog");
            openBatchMemberDialog({
                targetCol: memberCol,
                membersList,
                selectedItemIds: targetIds,
                avId: ref.avId,
                plugin,
                moduleId: active,
                ref,
                colKey: "member",
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onBatchSuccess: async () => {
                    selectedItemIds = [];
                    if (onReload) await onReload();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    async function openBatchLocationModal() {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        const targetIds = getVisibleSelectedIds();
        if (!targetIds.length || !ref?.avId || !ref?.columns?.location || batchBusy) return;
        try {
            const { openBatchLocationDialog } = await import("@/core/batch-dialog");
            openBatchLocationDialog({
                targetCol: ref.columns.location,
                selectedItemIds: targetIds,
                locOptions: dynamicLocations,
                avId: ref.avId,
                plugin,
                moduleId: active,
                ref,
                colKey: "location",
                t,
                DialogCls: Dialog,
                showMessageFn: showMessage,
                onBatchSuccess: async () => {
                    selectedItemIds = [];
                    if (onReload) await onReload();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    async function batchCopyRefs(e?: MouseEvent) {
        const targetIds = getVisibleSelectedIds();
        if (!targetIds.length || !ref?.avId) return;
        const nameCol = ref.columns?.name;
        const selectedRows = currentVisibleRows.filter((r) => targetIds.includes(r.itemID));
        const refs = selectedRows.map((r) => {
            const rawTitle = String(r.cells?.[nameCol ?? ""]?.text?.content ?? r.cells?.[nameCol ?? ""]?.block?.content ?? r.itemID).trim();
            const title = rawTitle.replace(/[\r\n]+/g, " ").replace(/'/g, "’");
            return `((${r.itemID} '${title}'))`;
        });
        const text = refs.join("\n");
        try {
            await navigator.clipboard.writeText(text);
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("spotlight.refCopied"));
            }
            showMessage(t("spotlight.refCopied"), 2500, "info");
        } catch {
            showMessage(t("ledger.copyAsImageFail"), 4000, "error");
        }
    }

    async function batchExportCsv() {
        const targetIds = getVisibleSelectedIds();
        if (!targetIds.length || !ref?.columns) return;
        const selectedRows = currentVisibleRows.filter((r) => targetIds.includes(r.itemID));
        if (selectedRows.length === 0) return;
        const { exportSelectedRowsToCsv } = await import("@/core/ledger-export");
        exportSelectedRowsToCsv({
            rows: selectedRows,
            moduleId: active,
            sourceRef: ref,
            schemaCatalog: plugin.schemaCatalog,
            t,
            cellTextFn: cellText ?? ((c: any) => String(c?.text?.content || c?.content || "")),
        });
        showMessage(t("ledger.exportSuccess"), 2000, "info");
    }

    function batchDelete() {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        const targetIds = getVisibleSelectedIds();
        if (!targetIds.length || !ref?.avId || batchBusy) return;
        const count = targetIds.length;
        confirm(
            t("ledger.batchDelete"),
            t("ledger.batchDeleteConfirm").replace("${n}", String(count)),
            async () => {
                batchBusy = true;
                try {
                    const { removeLedgerRows } = await import("@/core/siyuan");
                    const { cleanupRowRuntimeData } = await import("@/core/hub/runtime");
                    const { withRuntime } = await import("@/core/hub/actions");
                    const { updateRowLogs, removeRowLog } = await import("@/core/rowlog");
                    await removeLedgerRows(ref!.avId!, targetIds, {
                        idempotencyKey: `ledger:batch-del:${ref!.avId!}:${Date.now()}`,
                        retries: 1,
                    });
                    const snapshots = targetIds.map((id) => {
                        const matchedRow = currentVisibleRows.find((r) => r.itemID === id) ?? rows.find((r) => r.itemID === id);
                        const nameCol = ref?.columns?.name;
                        const rawTitle = nameCol ? (matchedRow?.cells?.[nameCol]?.text?.content ?? matchedRow?.cells?.[nameCol]?.block?.content) : undefined;
                        const title = String(rawTitle || matchedRow?.itemID || t("ledger.batchDeletedItems").replace("${n}", String(count))).trim();
                        return {
                            id,
                            moduleId: active,
                            title,
                            deletedAt: new Date().toISOString(),
                            rowSnapshot: matchedRow ? JSON.parse(JSON.stringify(matchedRow)) : { itemID: id },
                        };
                    });
                    await withRuntime(plugin as any, (rt) => {
                        const trashList = rt.trash ?? [];
                        for (let i = snapshots.length - 1; i >= 0; i--) {
                            trashList.unshift(snapshots[i]);
                        }
                        const maxCap = Math.max(200, snapshots.length);
                        if (trashList.length > maxCap) trashList.length = maxCap;
                        rt.trash = trashList;
                        for (const id of targetIds) {
                            cleanupRowRuntimeData(rt, id);
                        }
                    });
                    await updateRowLogs(plugin, (logs) => {
                        let next = logs;
                        for (const id of targetIds) {
                            next = removeRowLog(next, ref!.avId!, id);
                        }
                        return next;
                    }).catch(() => undefined);
                    selectedItemIds = [];
                    showMessage(t("ledger.delDone") + ` (${count})`, 3000, "info");
                    if (onReload) await onReload();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                } catch (e) {
                    showMessage(t("ledger.delFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                } finally {
                    batchBusy = false;
                }
            }
        );
    }
</script>

{#if selectedItemIds.length > 0}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        bind:this={toolbarEl}
        class="lv-batch-bar"
        role="toolbar"
        tabindex="0"
        aria-label={t("hub.batch")}
        aria-busy={batchBusy}
        onkeydown={handleToolbarKeydown}
    >
        <span class="lv-caption lv-batch-selected-count" aria-live="polite" aria-atomic="true">
            {t("ledger.batchSelected").replace("${n}", String(selectedItemIds.length))}
        </span>
        {#if ref?.columns?.location}
            <button type="button" class="b3-button b3-button--outline lv-batch-btn" disabled={batchBusy || isGuestMode} onclick={openBatchLocationModal}>
                <UiIcon name="mapPin" size={13} /> {t("ledger.batchLocation")}
            </button>
        {/if}
        {#if memberCol && (plugin.settings.members?.length ?? 0) > 0}
            <button type="button" class="b3-button b3-button--outline lv-batch-btn" disabled={batchBusy || isGuestMode} onclick={openBatchMemberModal}>
                <UiIcon name="users" size={13} /> {t("ledger.batchMember")}
            </button>
        {/if}
        <button type="button" class="b3-button b3-button--outline lv-batch-btn" disabled={batchBusy} onclick={(e) => batchCopyRefs(e)}>
            <UiIcon name="paperclip" size={13} /> {t("ledger.copyBlockRef")}
        </button>
        <button type="button" class="b3-button b3-button--outline lv-batch-btn" disabled={batchBusy} onclick={batchExportCsv}>
            <UiIcon name="folder" size={13} /> {t("ledger.batchExportCsv")}
        </button>
        <button type="button" class="b3-button b3-button--text ft__error lv-batch-btn lv-tx-danger" disabled={batchBusy || isGuestMode} aria-busy={batchBusy} onclick={batchDelete}>
            <UiIcon name="close" size={13} /> {batchBusy ? t("ledger.saving") : t("ledger.batchDelete")}
        </button>
        <button type="button" class="b3-button b3-button--text lv-batch-close" onclick={clearSelection} title={t("close")} aria-label={t("close")}>
            <UiIcon name="close" size={12} />
        </button>
    </div>
{/if}
