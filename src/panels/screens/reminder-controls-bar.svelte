<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { ReminderNamedView } from "@/core/hub/runtime";

    let {
        filter = $bindable<string>("all"),
        filterMember = $bindable<string | undefined>(undefined),
        filterModule = $bindable<string | undefined>(undefined),
        dueWithin = $bindable<string>("all"),
        viewMode = $bindable<"list" | "calendar">("list"),
        activeNamedViewId = $bindable<string | undefined>(undefined),
        batchMode = $bindable<boolean>(false),
        memberOptions = [] as Array<{ id: string; name: string }>,
        moduleOptions = [] as string[],
        namedViews = [] as ReminderNamedView[],
        batchBusy = false,
        digestBusy = false,
        rescanning = false,
        exportingIcs = false,
        todaySilentOn = false,
        filteredCount = 0,
        t,
        onApplyNamedView,
        onPromptSaveNamedView,
        onConfirmDeleteNamedView,
        onOpenDigest,
        onToggleTodaySilent,
        onRescan,
        onExportIcs,
        onFilterChanged,
        onClearSelection,
    }: {
        filter?: string;
        filterMember?: string | undefined;
        filterModule?: string | undefined;
        dueWithin?: string;
        viewMode?: "list" | "calendar";
        activeNamedViewId?: string | undefined;
        batchMode?: boolean;
        memberOptions?: Array<{ id: string; name: string }>;
        moduleOptions?: string[];
        namedViews?: ReminderNamedView[];
        batchBusy?: boolean;
        digestBusy?: boolean;
        rescanning?: boolean;
        exportingIcs?: boolean;
        todaySilentOn?: boolean;
        filteredCount?: number;
        t: (k: string) => string;
        onApplyNamedView: (v: ReminderNamedView) => void;
        onPromptSaveNamedView: () => void;
        onConfirmDeleteNamedView: (v: ReminderNamedView) => void;
        onOpenDigest: () => void;
        onToggleTodaySilent: () => void;
        onRescan: () => void;
        onExportIcs: () => void;
        onFilterChanged?: () => void;
        onClearSelection?: () => void;
    } = $props();

    function changeFilter(value: string) {
        filter = value;
        activeNamedViewId = undefined;
        onFilterChanged?.();
    }

    function toggleBatchMode() {
        if (batchMode) {
            batchMode = false;
            onClearSelection?.();
        } else {
            batchMode = true;
        }
    }
</script>

<section class="lv-hub-controls" aria-label={t("hub.title")}>
    <div class="lv-card lv-hub-bar-card">
        <div class="lv-hub-bar-row">
            <!-- 视图模式胶囊切换 -->
            <span class="lv-tabs lv-hub-view-toggle" role="group" aria-label={t("view.list") + "/" + t("view.calendar")}>
                <button class="lv-tabs__item" class:on={viewMode === "list"}
                    disabled={batchBusy} aria-pressed={viewMode === "list"} onclick={() => (viewMode = "list")}>{t("view.list")}</button>
                <button class="lv-tabs__item" class:on={viewMode === "calendar"}
                    disabled={batchBusy} aria-pressed={viewMode === "calendar"} onclick={() => (viewMode = "calendar")}>{t("view.calendar")}</button>
            </span>
            <div class="lv-toolbar lv-hub-filters">
                <select class="b3-select" aria-label={t("hub.title")} value={filter} disabled={batchBusy} onchange={(e) => changeFilter((e.target as HTMLSelectElement).value)}>
                    <option value="all">{t("hub.filterAll")}</option>
                    <option value="overdue">{t("hub.filterOverdue")}</option>
                    <option value="soon">{t("hub.filterSoon")}</option>
                    <option value="lead">{t("hub.filterLead")}</option>
                    <option value="handled">{t("hub.filterHandled")}</option>
                </select>
                <select class="b3-select" aria-label={t("field.member")} value={filterMember ?? ""} disabled={batchBusy} onchange={(e) => { filterMember = (e.target as HTMLSelectElement).value || undefined; activeNamedViewId = undefined; onFilterChanged?.(); }}>
                    <option value="">{t("field.member")}: {t("members.all")}</option>
                    {#each memberOptions as m (m.id)}
                        <option value={m.id}>{m.name}</option>
                    {/each}
                </select>
                <select class="b3-select" aria-label={t("hub.filterAllModule")} value={filterModule ?? ""} disabled={batchBusy} onchange={(e) => { filterModule = (e.target as HTMLSelectElement).value || undefined; activeNamedViewId = undefined; onFilterChanged?.(); }}>
                    <option value="">{t("hub.filterAllModule")}</option>
                    {#each moduleOptions as mid (mid)}
                        <option value={mid}>{mid === "adhoc" ? t("adhoc.name") : (t(`module.${mid}`) !== `module.${mid}` ? t(`module.${mid}`) : mid)}</option>
                    {/each}
                </select>
                <select class="b3-select" aria-label={t("hub.dueAll")} value={dueWithin} disabled={batchBusy} onchange={(e) => { dueWithin = (e.target as HTMLSelectElement).value; activeNamedViewId = undefined; onFilterChanged?.(); }}>
                    <option value="all">{t("hub.dueAll")}</option>
                    <option value="0">{t("hub.dueToday")}</option>
                    <option value="7">{t("hub.due7")}</option>
                    <option value="30">{t("hub.due30")}</option>
                </select>
                <!-- 243 波（收件箱分诊）：一键切片到备忘项集合（转行/完成/延后集中处理） -->
                <button class="b3-button b3-button--outline lv-btn-chip" class:is-filtered={filterModule === "adhoc"} disabled={batchBusy}
                    aria-pressed={filterModule === "adhoc"} onclick={() => { filterModule = filterModule === "adhoc" ? undefined : "adhoc"; activeNamedViewId = undefined; onFilterChanged?.(); }}>
                    {t("hub.triageChip")}{#if filterModule === "adhoc"} ✓{/if}
                </button>
            </div>
            <div class="lv-toolbar lv-hub-actions">
                <button class="b3-button b3-button--outline" title={t("hub.digestTip")} disabled={batchBusy || digestBusy || filteredCount === 0}
                    aria-busy={digestBusy} onclick={onOpenDigest}>{digestBusy ? t("ledger.saving") : t("hub.digest")}</button>
                <button class="b3-button b3-button--outline" class:is-active={todaySilentOn}
                    aria-pressed={todaySilentOn} title={t("hub.todaySilentTip")}
                    disabled={batchBusy} onclick={onToggleTodaySilent}>
                    {#if todaySilentOn}<UiIcon name="mute" size={13} /> {/if}{t("hub.todaySilent")}{#if todaySilentOn} <UiIcon name="check" size={12} />{/if}
                </button>
                <button class="b3-button b3-button--outline" class:is-active={batchMode} aria-pressed={batchMode} disabled={batchBusy} onclick={toggleBatchMode}>{t("hub.batch")}</button>
                <button class="b3-button b3-button--outline" disabled={batchBusy || rescanning} aria-busy={rescanning} onclick={onRescan}>{t("hub.rescan")}</button>
                <button class="b3-button b3-button--outline" disabled={batchBusy || exportingIcs} aria-busy={exportingIcs} onclick={onExportIcs}>{exportingIcs ? t("ledger.saving") : t("hub.icsExport")}</button>
            </div>
        </div>
        {#if !batchMode}
            <div class="lv-named-views-bar" role="group" aria-label={t("hub.namedViews")}>
                <span class="lv-caption lv-tx-3">{t("hub.namedViews")}:</span>
                {#each namedViews as v (v.id)}
                    <span class="lv-named-view-chip" class:is-active={activeNamedViewId === v.id}>
                        <button type="button" class="lv-named-view-btn"
                            onclick={() => onApplyNamedView(v)}
                            title={`${v.name} (${v.filter ?? "all"})`}>
                            {v.name}
                        </button>
                        <button type="button" class="lv-named-view-del"
                            onclick={(e) => { e.stopPropagation(); onConfirmDeleteNamedView(v); }}
                            title={t("hub.deleteView")}
                            aria-label={`${t("hub.deleteView")}: ${v.name}`}>
                            <UiIcon name="close" size={11} />
                        </button>
                    </span>
                {/each}
                <button type="button" class="b3-button b3-button--text lv-save-view-btn"
                    onclick={onPromptSaveNamedView}>
                    <UiIcon name="add" size={13} /> {t("hub.saveCurrentView")}
                </button>
            </div>
        {/if}
    </div>
</section>

<style>
    .lv-hub-controls { margin-bottom: 18px; }
    .lv-hub-bar-card {
        padding: 12px 16px;
        min-width: 0;
        border: 1px solid var(--lv-line);
        border-radius: var(--lv-r-3);
        background: var(--lv-surface);
        box-shadow: var(--lv-shadow-1);
    }
    .lv-hub-bar-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .lv-hub-filters {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 auto;
        min-width: 0;
    }
    .lv-hub-filters .b3-select {
        flex: 1 1 120px;
        min-width: 100px;
        max-width: 170px;
    }
    .lv-hub-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-left: auto;
    }
    .lv-hub-view-toggle { flex: 0 0 auto; padding: 2px; }
    .lv-hub-view-toggle .lv-tabs__item { min-height: 28px; padding: 4px 10px; font-size: 12px; }
    .lv-btn-chip.is-filtered, .lv-hub-actions .is-active {
        color: var(--lv-accent);
        border-color: var(--lv-accent-line);
        background: var(--lv-accent-soft);
        font-weight: 550;
    }
    .lv-save-view-btn {
        font-size: 12px;
        padding: 2px 8px;
        color: var(--lv-accent);
    }
    @media (max-width: 860px) {
        .lv-hub-bar-row { gap: 8px; }
        .lv-hub-filters { flex-basis: 100%; order: 2; }
        .lv-hub-actions { flex-basis: 100%; order: 3; margin-left: 0; justify-content: flex-start; }
        .lv-hub-view-toggle { order: 1; }
    }
    @media (max-width: 420px) {
        .lv-hub-filters .b3-select { flex-basis: calc(50% - 4px); }
        .lv-hub-filters .b3-button { flex-basis: 100%; }
        .lv-hub-actions .b3-button { flex-basis: calc(50% - 4px); }
        .lv-hub-view-toggle { width: 100%; }
        .lv-hub-view-toggle .lv-tabs__item { flex: 1; }
    }
    @container lv-home (max-width: 760px) {
        .lv-hub-controls { grid-template-columns: 1fr; gap: 8px; }
        .lv-hub-bar-card { padding: 10px; }
        .lv-hub-actions .b3-button { flex: 1 1 110px; }
    }
    @container lv-home (max-width: 420px) {
        .lv-hub-filters .b3-select { flex-basis: calc(50% - 4px); }
        .lv-hub-filters .b3-button { flex-basis: 100%; }
        .lv-hub-actions .b3-button { flex-basis: calc(50% - 4px); }
        .lv-hub-view-toggle { width: 100%; }
        .lv-hub-view-toggle .lv-tabs__item { flex: 1; }
    }
</style>
