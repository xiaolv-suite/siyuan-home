<script lang="ts">
    import { homeNotify as showMessage, homeInline } from "@/libs/notice";
    import { formatAsTaskBlock } from "@/core/block-capture";
    import { saveRuntime } from "@/core/hub/runtime";
    import UiIcon from "@/ui/icon.svelte";
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
    let toolbarEl = $state<HTMLElement | undefined>(undefined);
    const selectedCount = $derived(selected.size);

    function selectAllFiltered() {
        selected = new Set(filtered.map((r: Reminder) => r.id));
    }

    function restoreFocusAfterClear() {
        try {
            const root = toolbarEl?.closest(".lv-home") || document;
            const toggleBtn = root.querySelector<HTMLElement>(".lv-hub-actions button[aria-pressed], .lv-hub-actions .b3-button");
            toggleBtn?.focus();
        } catch { /* soft */ }
    }

    function clearSelection() {
        selected = new Set();
        batchMode = false;
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

    async function batchCopyAsTasks(e?: MouseEvent) {
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
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("hub.batchTasksCopied").replace("${n}", String(selectedList.length)));
            }
            showMessage(t("hub.batchTasksCopied").replace("${n}", String(selectedList.length)), 3000, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        } finally {
            batchBusy = false;
        }
    }

    async function batchCopyBlockRefs(e?: MouseEvent) {
        if (batchBusy) return;
        const selectedList = filtered.filter((r) => selected.has(r.id));
        if (selectedList.length === 0) return;
        batchBusy = true;
        const refsText = selectedList
            .map((r) => `((${r.rowId || r.id} '${r.title}'))`)
            .join("\n");
        try {
            await navigator.clipboard.writeText(refsText);
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("hub.batchRefsCopied").replace("${n}", String(selectedList.length)));
            }
            showMessage(t("hub.batchRefsCopied").replace("${n}", String(selectedList.length)), 3000, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        } finally {
            batchBusy = false;
        }
    }

    async function batchCopyDailyBoard(e?: MouseEvent) {
        if (batchBusy) return;
        const selectedList = filtered.filter((r) => selected.has(r.id));
        const targetList = selectedList.length > 0 ? selectedList : filtered;
        if (targetList.length === 0) return;
        batchBusy = true;
        try {
            const { formatDailyHomeBoardMarkdown } = await import("@/core/reminder-digest");
            const boardItems = targetList.map((r) => ({
                id: r.id,
                moduleId: r.moduleId,
                title: r.title,
                dueDate: r.dueDate,
                daysLeft: r.daysLeft,
                level: r.level,
                location: (r as any).location,
            }));
            const md = formatDailyHomeBoardMarkdown(boardItems, {
                label: (mid) => (t(`module.${mid}`) !== `module.${mid}` ? t(`module.${mid}`) : mid),
            });
            await navigator.clipboard.writeText(md);
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("hub.dailyBoardCopied"));
            }
            showMessage(t("hub.dailyBoardCopied"), 3000, "info");
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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    bind:this={toolbarEl}
    class="lv-card lv-toolbar lv-hub-batchbar"
    role="toolbar"
    tabindex="0"
    aria-label={t("hub.batch")}
    aria-busy={batchBusy}
    onkeydown={handleToolbarKeydown}
>
    <b class="lv-caption" aria-live="polite" aria-atomic="true">{t("hub.selectedN").replace("${n}", String(selectedCount))}</b>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy} onclick={selectAllFiltered}>{t("hub.selectAll")}</button>
    <span class="fn__flex-1"></span>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={(e) => batchCopyAsTasks(e)}><UiIcon name="note" size={13} /> {t("hub.batchCopyTasks")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={(e) => batchCopyDailyBoard(e)}><UiIcon name="home" size={13} /> {t("hub.batchCopyDailyBoard")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={(e) => batchCopyBlockRefs(e)}><UiIcon name="paperclip" size={13} /> {t("hub.batchCopyRefs")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={batchPlanToday}><UiIcon name="calendar" size={13} /> {t("hub.planPresetToday")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("done")}><UiIcon name="check" size={13} /> {t("act.done")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("snooze7")}><UiIcon name="clock" size={13} /> {t("act.snooze7")}</button>
    <button type="button" class="b3-button b3-button--text" disabled={batchBusy || selectedCount === 0} onclick={() => runBatch("mute")}><UiIcon name="mute" size={13} /> {t("act.mute")}</button>
    <button type="button" class="b3-button b3-button--outline" disabled={batchBusy} onclick={clearSelection}><UiIcon name="close" size={12} /> {t("cancel")}</button>
</div>
