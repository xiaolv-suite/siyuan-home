<script lang="ts">
    import { showMessage } from "siyuan";
    import { formatAsTaskBlock } from "@/core/block-capture";
    import { saveRuntime } from "@/core/hub/runtime";
    import type { Reminder } from "@/types";

    let {
        selected = $bindable<Set<string>>(new Set()),
        batchMode = $bindable<boolean>(false),
        filtered = [] as Reminder[],
        all = [] as Reminder[],
        plugin,
        t,
        onActionCompleted,
    }: {
        selected?: Set<string>;
        batchMode?: boolean;
        filtered?: Reminder[];
        all?: Reminder[];
        plugin: any;
        t: (k: string) => string;
        onActionCompleted?: () => Promise<void>;
    } = $props();

    let batchBusy = $state(false);
    const selectedCount = $derived(selected.size);

    function selectAllFiltered() {
        selected = new Set(filtered.map((r: Reminder) => r.id));
    }

    function clearSelection() {
        selected = new Set();
        batchMode = false;
    }

    async function batchCopyAsTasks() {
        if (batchBusy) return;
        const selectedList = filtered.filter((r) => selected.has(r.id));
        if (selectedList.length === 0) return;
        batchBusy = true;
        const text = selectedList
            .map((r) => {
                const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
                return formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
            })
            .join("\n");
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("hub.batchTasksCopied").replace("${n}", String(selectedList.length)), 3000, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        } finally {
            batchBusy = false;
        }
    }

    async function batchCopyBlockRefs() {
        if (batchBusy) return;
        const selectedList = filtered.filter((r) => selected.has(r.id));
        if (selectedList.length === 0) return;
        batchBusy = true;
        const refsText = selectedList
            .map((r) => `((${r.rowId || r.id} '${r.title}'))`)
            .join("\n");
        try {
            await navigator.clipboard.writeText(refsText);
            showMessage(t("hub.batchRefsCopied").replace("${n}", String(selectedList.length)), 3000, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        } finally {
            batchBusy = false;
        }
    }

    async function batchPlanToday() {
        if (batchBusy || selected.size === 0) return;
        batchBusy = true;
        try {
            const { batchPushRemindersToTodayPlan } = await import("@/core/hub/runtime");
            const count = batchPushRemindersToTodayPlan(plugin.runtime, [...selected]);
            await saveRuntime(plugin, plugin.runtime);
            showMessage(t("hub.planDateSaved") + ` (${count})`, 2500, "info");
            selected = new Set();
            batchMode = false;
            if (onActionCompleted) {
                await onActionCompleted();
            } else {
                await plugin.refreshHub?.(undefined, true);
            }
        } catch (e) {
            showMessage(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            batchBusy = false;
        }
    }

    async function runBatch(kind: "done" | "snooze7" | "mute") {
        if (batchBusy || selected.size === 0) return;
        const visibleIds = new Set(filtered.map((r: Reminder) => r.id));
        selected = new Set([...selected].filter((id) => visibleIds.has(id)));
        if (selected.size === 0) {
            showMessage(t("hub.selectionNoLongerVisible"), 3500, "info");
            return;
        }
        batchBusy = true;
        try {
            const byId = new Map<string, Reminder>(all.map((r: Reminder) => [r.id, r] as [string, Reminder]));
            let ok = 0;
            const failed: string[] = [];
            // 逐条容错：单项失败不中断批量（剩余项继续处理），失败清单在回执中报告
            for (const id of selected) {
                const r = byId.get(id);
                if (!r) continue;
                try {
                    if (kind === "done") await plugin.complete(r);
                    else if (kind === "snooze7") await plugin.snooze(id, 7);
                    else await plugin.mute(id);
                    ok++;
                } catch (e) {
                    failed.push((r as any).title || id);
                    console.warn("[LvHome] batch item failed:", e instanceof Error ? e.message : e);
                }
            }
            if (failed.length > 0) {
                showMessage(t("hub.batchPartial").replace("${ok}", String(ok)).replace("${failed}", failed.join("、")), 7000, "error");
            } else {
                showMessage(t("hub.batchDone").replace("${n}", String(ok)), 3000, "info");
            }
            selected = new Set();
            batchMode = false;
            if (onActionCompleted) {
                await onActionCompleted();
            }
        } finally {
            batchBusy = false;
        }
    }
</script>

<div class="lv-card lv-toolbar lv-hub-batchbar" role="toolbar" aria-label={t("hub.batch")}>
    <b class="lv-caption">{t("hub.selectedN").replace("${n}", String(selectedCount))}</b>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy} onclick={selectAllFiltered}>{t("hub.selectAll")}</button>
    <span class="fn__flex-1"></span>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={batchCopyAsTasks}>📋 {t("hub.batchCopyTasks")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={batchCopyBlockRefs}>🔗 {t("hub.batchCopyRefs")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={batchPlanToday}>📅 {t("hub.planPresetToday")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("done")}>{t("act.done")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("snooze7")}>{t("act.snooze7")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("mute")}>{t("act.mute")}</button>
    <button type="button" class="b3-button b3-button--outline" disabled={batchBusy} onclick={clearSelection}>{t("cancel")}</button>
</div>

<style>
    .lv-hub-batchbar {
        padding: 8px 16px;
        margin-bottom: 14px;
        border: 1px solid var(--lv-accent);
        border-radius: var(--lv-r-2);
        background: var(--lv-surface);
        box-shadow: 0 4px 12px rgba(217, 119, 6, 0.12);
    }
    .lv-hub-batchbar .lv-caption {
        color: var(--lv-accent);
        font-weight: 650;
    }
    .lv-hub-batchbar .b3-button--text {
        color: var(--lv-tx-2);
        font-size: 12.5px;
        padding: 4px 8px;
        border-radius: 6px;
    }
    .lv-hub-batchbar .b3-button--text:hover {
        color: var(--lv-tx);
        background: var(--lv-surface-2);
    }
</style>
