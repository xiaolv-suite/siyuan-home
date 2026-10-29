<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";

    let {
        plugin,
        active,
        ref,
        selectedItemIds = $bindable<string[]>([]),
        rows = [],
        dynamicLocations = [],
        memberCol,
        t,
        onReload,
    }: {
        plugin: any;
        active: string;
        ref?: { avId?: string; columns?: Record<string, string> };
        selectedItemIds: string[];
        rows?: any[];
        dynamicLocations?: string[];
        memberCol?: string;
        t: (k: string) => string;
        onReload?: () => Promise<void>;
    } = $props();

    let batchBusy = $state(false);
    const fs12Pad310Css = "font-size:12px;padding:3px 10px";
    const pad36Fs12Css = "padding:3px 6px;font-size:12px";

    async function openBatchMemberModal() {
        if (!selectedItemIds.length || !ref?.avId || !memberCol || batchBusy) return;
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
                selectedItemIds,
                avId: ref.avId,
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
                    if (onReload) await onReload();
                    try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
                },
            });
        } catch (e) {
            showMessage(String(e), 5000, "error");
        }
    }

    async function batchCopyRefs() {
        if (!selectedItemIds.length || !ref?.avId) return;
        const nameCol = ref.columns?.name;
        const selectedRows = rows.filter((r) => selectedItemIds.includes(r.itemID));
        const refs = selectedRows.map((r) => {
            const title = String(r.cells?.[nameCol ?? ""]?.text?.content ?? r.cells?.[nameCol ?? ""]?.block?.content ?? r.itemID).trim();
            return `((${r.itemID} '${title}'))`;
        });
        const text = refs.join("\n");
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("spotlight.refCopied") || `已复制 ${selectedRows.length} 条块引用`, 2500, "info");
        } catch {
            showMessage(t("ledger.copyAsImageFail"), 4000, "error");
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
	                    // 安全回收站快照留存：批量删除前为所有选定行建立完整备份
	                    if (plugin.runtime) {
	                        const trashList = plugin.runtime.trash ?? [];
	                        for (const id of selectedItemIds) {
	                            const matchedRow = rows.find((r) => r.itemID === id);
	                            const nameCol = ref?.columns?.name;
	                            const rawTitle = nameCol ? (matchedRow?.cells?.[nameCol]?.text?.content ?? matchedRow?.cells?.[nameCol]?.block?.content) : undefined;
	                            const title = String(rawTitle || matchedRow?.itemID || `${count} 项批量删除条目`).trim();
	                            trashList.unshift({
	                                id,
	                                moduleId: active,
	                                title,
	                                deletedAt: new Date().toISOString(),
	                                rowSnapshot: matchedRow ? JSON.parse(JSON.stringify(matchedRow)) : { itemID: id },
	                            });
	                        }
	                        if (trashList.length > 50) trashList.length = 50;
	                        plugin.runtime.trash = trashList;
	                    }
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
        <button type="button" class="b3-button b3-button--outline" style={fs12Pad310Css} disabled={batchBusy} onclick={batchCopyRefs}>
            🔗 {t("ledger.copyBlockRef")}
        </button>
        <button type="button" class="b3-button b3-button--text ft__error" style="{fs12Pad310Css};color:var(--lv-danger)" disabled={batchBusy} onclick={batchDelete}>
            🗑️ {t("ledger.batchDelete")}
        </button>
        <button type="button" class="b3-button b3-button--text" style={pad36Fs12Css} onclick={() => { selectedItemIds = []; }} title={t("close")} aria-label={t("close")}>
            ✕
        </button>
    </div>
{/if}
