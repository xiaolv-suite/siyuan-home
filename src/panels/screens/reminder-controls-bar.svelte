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

    let mobileDrawerOpen = $state(false);
    const activeSecondaryCount = $derived(
        (filter !== "all" && filter !== "overdue" ? 1 : 0) +
        (filterMember ? 1 : 0) +
        (filterModule ? 1 : 0) +
        (dueWithin !== "all" ? 1 : 0) +
        (batchMode ? 1 : 0) +
        (todaySilentOn ? 1 : 0),
    );

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
                <button type="button" class="lv-tabs__item" class:on={viewMode === "list"}
                    disabled={batchBusy} aria-pressed={viewMode === "list"} onclick={() => (viewMode = "list")}>{t("view.list")}</button>
                <button type="button" class="lv-tabs__item" class:on={viewMode === "calendar"}
                    disabled={batchBusy} aria-pressed={viewMode === "calendar"} onclick={() => (viewMode = "calendar")}>{t("view.calendar")}</button>
            </span>
            <!-- 手机端首屏快捷状态胶囊（全部 / 逾期） -->
            <div class="lv-hub-mobile-quick-status" role="group" aria-label={t("hub.title")}>
                <button type="button" class="lv-chip lv-chip--sm" class:on={filter === "all"}
                    disabled={batchBusy} aria-pressed={filter === "all"} onclick={() => changeFilter("all")}>{t("hub.filterAll")}</button>
                <button type="button" class="lv-chip lv-chip--sm" class:on={filter === "overdue"}
                    disabled={batchBusy} aria-pressed={filter === "overdue"} onclick={() => changeFilter("overdue")}>{t("hub.groupOverdue")}</button>
            </div>
            <!-- 手机端筛选与操作抽屉开关 -->
            <button
                type="button"
                class="b3-button b3-button--outline lv-hub-mobile-drawer-btn"
                class:is-active={mobileDrawerOpen || activeSecondaryCount > 0}
                aria-expanded={mobileDrawerOpen}
                aria-controls="lv-hub-collapsible-drawer"
                onclick={() => (mobileDrawerOpen = !mobileDrawerOpen)}
            >
                <UiIcon name="filter" size={13} />
                <span>{t("hub.mobileFilterAndOps") !== "hub.mobileFilterAndOps" ? t("hub.mobileFilterAndOps") : "筛选与操作"}</span>
                {#if activeSecondaryCount > 0}
                    <span class="lv-badge blue lv-badge--xs">{activeSecondaryCount}</span>
                {/if}
                <UiIcon name={mobileDrawerOpen ? "chevronUp" : "chevronDown"} size={12} />
            </button>
            <div id="lv-hub-collapsible-drawer" class="lv-hub-collapsible-drawer" class:is-open={mobileDrawerOpen}>
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
                    <button type="button" class="b3-button b3-button--outline lv-btn-chip" class:is-filtered={filterModule === "adhoc"} disabled={batchBusy}
                        aria-pressed={filterModule === "adhoc"} onclick={() => { filterModule = filterModule === "adhoc" ? undefined : "adhoc"; activeNamedViewId = undefined; onFilterChanged?.(); }}>
                        {t("hub.triageChip")}{#if filterModule === "adhoc"} <UiIcon name="check" size={12} />{/if}
                    </button>
                </div>
                <div class="lv-toolbar lv-hub-actions">
                    <button type="button" class="b3-button b3-button--outline" title={t("hub.digestTip")} disabled={batchBusy || digestBusy || filteredCount === 0}
                        aria-busy={digestBusy} onclick={onOpenDigest}>{digestBusy ? t("ledger.saving") : t("hub.digest")}</button>
                    <button type="button" class="b3-button b3-button--outline" class:is-active={todaySilentOn}
                        aria-pressed={todaySilentOn} title={t("hub.todaySilentTip")}
                        disabled={batchBusy} onclick={onToggleTodaySilent}>
                        {#if todaySilentOn}<UiIcon name="mute" size={13} /> {/if}{t("hub.todaySilent")}{#if todaySilentOn} <UiIcon name="check" size={12} />{/if}
                    </button>
                    <button type="button" class="b3-button b3-button--outline" class:is-active={batchMode} aria-pressed={batchMode} disabled={batchBusy} onclick={toggleBatchMode}>{t("hub.batch")}</button>
                    <button type="button" class="b3-button b3-button--outline" disabled={batchBusy || rescanning} aria-busy={rescanning} onclick={onRescan}>{t("hub.rescan")}</button>
                    <button type="button" class="b3-button b3-button--outline" disabled={batchBusy || exportingIcs} aria-busy={exportingIcs} onclick={onExportIcs}>{exportingIcs ? t("ledger.saving") : t("hub.icsExport")}</button>
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
        </div>
    </div>
</section>
