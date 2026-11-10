<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import { MODULE_GROUPS, getModule } from "@/core/modules";
    import { createDefaultGuestConfig, filterGuestVisibleModules } from "@/core/guest-mode";
    import { formatLocalDate } from "@/core/date-display";
    import type { ModuleGroupId } from "@/types";

    let {
        plugin,
        version,
        t,
        firstScanPending = false,
        snapshotLabel = "",
        pendingByModule = new Map<string, number>(),
        moduleHistory = {} as Record<string, Record<string, number>>,
        healthBound = [] as Array<{ label: string; score: number }>,
        rowCountOf,
        moduleTone,
        moduleUiIcon,
        onOpenSetting,
        onGotoLedger,
        onDrillReminders,
    }: {
        plugin: any;
        version?: number;
        t: (k: string) => string;
        firstScanPending?: boolean;
        snapshotLabel?: string;
        pendingByModule?: Map<string, number>;
        moduleHistory?: Record<string, Record<string, number>>;
        healthBound?: Array<{ label: string; score: number }>;
        rowCountOf: (mid: string) => number | undefined;
        moduleTone: (mid: string) => string;
        moduleUiIcon: (mid: string) => any;
        onOpenSetting: () => void;
        onGotoLedger: (mid: string) => void;
        onDrillReminders: (mid: string) => void;
    } = $props();

    const moduleCards = $derived.by(() => {
        void version;
        const base = (plugin.settings.enabledModules ?? []).filter((id: string) => id !== "members");
        return plugin.runtime?.guestModeActive ? filterGuestVisibleModules(base, createDefaultGuestConfig(true)) : base;
    });

    let moduleGroupFilter = $state<ModuleGroupId | "all">("all");
    let moduleQuery = $state("");
    let moduleGroupOpen = $state<Partial<Record<ModuleGroupId, boolean>>>({});
    let showModuleTools = $state(false);

    const moduleGroupStats = $derived.by(() => {
        void version;
        return MODULE_GROUPS
            .map((id) => ({ id, count: moduleCards.filter((mid: string) => getModule(mid)?.group === id).length }))
            .filter((group) => group.count > 0);
    });

    const moduleSections = $derived.by(() => {
        void version;
        const query = moduleQuery.trim().toLocaleLowerCase();
        return moduleGroupStats
            .filter((group) => moduleGroupFilter === "all" || group.id === moduleGroupFilter)
            .map((group) => ({
                ...group,
                ids: moduleCards.filter((mid: string) => {
                    if (getModule(mid)?.group !== group.id) return false;
                    if (!query) return true;
                    return t(`module.${mid}`).toLocaleLowerCase().includes(query);
                }),
            }))
            .filter((group) => group.ids.length > 0);
    });

    function isModuleGroupOpen(id: ModuleGroupId, index: number, ids: string[]): boolean {
        const query = moduleQuery.trim();
        if (query || moduleGroupFilter !== "all") return ids.length > 0;
        const explicit = moduleGroupOpen[id];
        if (explicit !== undefined) return explicit;
        const hasPending = ids.some((mid) => (pendingByModule.get(mid) ?? 0) > 0);
        return index === 0 || hasPending;
    }

    function toggleModuleGroup(id: ModuleGroupId, open: boolean) {
        moduleGroupOpen = { ...moduleGroupOpen, [id]: open };
    }

    const moduleSparks = $derived.by(() => {
        const map = new Map<string, number[] | null>();
        const now = Date.now();
        const dateKeys: string[] = [];
        for (let i = 4; i >= 0; i--) {
            const d = new Date(now - i * 86400000);
            dateKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        }
        for (const mid of moduleCards) {
            const days: number[] = [];
            let known = 0;
            let max = 0;
            for (const key of dateKeys) {
                const v = moduleHistory[key]?.[mid];
                if (typeof v === "number") known++;
                const count = typeof v === "number" ? v : 0;
                days.push(count);
                if (count > max) max = count;
            }
            map.set(mid, known < 3 ? null : days.map((v) => (max > 0 ? Math.max(15, Math.round((v / max) * 100)) : 15)));
        }
        return map;
    });

    const sparkOf = (mid: string): number[] | null => moduleSparks.get(mid) ?? null;
</script>

<div class="lv-sec">
    <h2 class="lv-title-sec">{t("dash.myModules")}</h2>
    <span class="lv-sub"><b class="lv-num">{moduleCards.length}</b> {t("dash.moduleCount")}</span>
    <span class="fn__flex-1"></span>
    <button type="button" class="b3-button b3-button--text" aria-pressed={showModuleTools} onclick={() => { showModuleTools = !showModuleTools; }}>
        <UiIcon name="filter" size={13} /> <span>{t("filter")}</span>
    </button>
    <button type="button" class="b3-button b3-button--text" onclick={onOpenSetting}><span>{t("dash.enableMore")}</span> <UiIcon name="forward" size={12} /></button>
</div>
{#if firstScanPending}
    <!-- 262 波：首扫骨架补全模块网格（与提醒骨架同一 loading 故事） -->
    <div class="lv-mods" aria-hidden="true">
        {#each [0, 1, 2, 3] as i (i)}
            <div class="lv-card lv-mod">
                <div class="lv-skel lv-skel--icon"></div>
                <div class="lv-skel lv-skel--w56"></div>
                <div class="lv-skel lv-skel--w38"></div>
            </div>
        {/each}
    </div>
{:else}
    {#if showModuleTools || moduleQuery || moduleGroupFilter !== "all"}
        <div class="lv-module-tools" aria-label={t("dash.moduleFilterLabel")}>
            <div class="lv-module-filters" role="group" aria-label={t("dash.moduleFilterLabel")}>
                <button type="button" class="lv-module-filter" class:on={moduleGroupFilter === "all"} aria-pressed={moduleGroupFilter === "all"}
                    onclick={() => (moduleGroupFilter = "all")}>{t("dash.moduleAll")}</button>
                {#each moduleGroupStats as group (group.id)}
                    <button type="button" class="lv-module-filter" class:on={moduleGroupFilter === group.id} aria-pressed={moduleGroupFilter === group.id}
                        onclick={() => (moduleGroupFilter = group.id)}>{t(`group.${group.id}`)} <span>{group.count}</span></button>
                {/each}
            </div>
            <label class="lv-module-search">
                <UiIcon name="search" size={15} />
                <input class="b3-text-field" type="search" bind:value={moduleQuery} placeholder={t("dash.moduleSearch")} aria-label={t("dash.moduleSearch")} />
            </label>
        </div>
    {/if}
    {#if moduleSections.length === 0}
        <div class="lv-card lv-module-empty" role="status">
            <UiIcon name="search" size={17} /><span>{t("dash.moduleEmpty")}</span>
            <button type="button" class="b3-button b3-button--text" onclick={() => { moduleQuery = ""; moduleGroupFilter = "all"; }}>{t("dash.moduleClear")}</button>
        </div>
    {:else}
    {#each moduleSections as section, sectionIndex (section.id)}
    {@const expanded = isModuleGroupOpen(section.id, sectionIndex, section.ids)}
    {@const sectionPending = section.ids.reduce((total, id) => total + (pendingByModule.get(id) ?? 0), 0)}
    {@const sectionRows = section.ids.reduce((total, id) => total + (rowCountOf(id) ?? 0), 0)}
    {@const sectionRowsKnown = section.ids.every((id) => rowCountOf(id) !== undefined)}
    <section class="lv-module-section" aria-labelledby={`lv-module-group-${section.id}`}>
        <h3 class="lv-module-section__heading">
            <button type="button" class="lv-module-section__head" aria-expanded={expanded} aria-controls={expanded ? `lv-module-items-${section.id}` : undefined}
                onclick={() => toggleModuleGroup(section.id, !expanded)}>
                <span class="lv-module-section__chevron" aria-hidden="true"><UiIcon name={expanded ? "chevronDown" : "forward"} size={12} /></span>
                <span class="lv-module-section__title" id={`lv-module-group-${section.id}`}>{t(`group.${section.id}`)}</span>
                <span class="lv-caption">{(sectionRowsKnown ? t("dash.moduleGroupSummary") : t("dash.moduleGroupSummaryUnknown")).replace("${m}", String(section.ids.length)).replace("${r}", String(sectionRows)).replace("${p}", String(sectionPending))}</span>
                {#if sectionPending > 0}<span class="lv-badge red lv-num">{sectionPending} <UiIcon name="alert" size={12} /></span>{/if}
            </button>
        </h3>
        {#if expanded}
        <div id={`lv-module-items-${section.id}`} class="lv-module-section__body">
        <div class="lv-mods">
    {#each section.ids as mid (mid)}
        {@const pending = pendingByModule.get(mid) ?? 0}
        <div class="lv-card lv-mod" aria-label={t(`module.${mid}`)}
            role="button" tabindex="0"
            onclick={() => onGotoLedger(mid)}
            onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGotoLedger(mid); } }}>
            <div class="lv-module-open">
                <span class="lv-mi" class:tone-blue={moduleTone(mid) === "t-blue"} class:tone-green={moduleTone(mid) === "t-green"}
                    class:tone-rose={moduleTone(mid) === "t-rose"} class:tone-amber={moduleTone(mid) === "t-amber"}
                    aria-hidden="true"><UiIcon name={moduleUiIcon(mid) as any} size={20} /></span><b>{t(`module.${mid}`)}</b>
                {#if plugin.settings.dbRefs?.[mid]?.docId}
                    <button type="button" class="b3-button b3-button--text lv-mod-doc-btn"
                        title={t("ledger.openDoc")}
                        aria-label={`${t(`module.${mid}`)} · ${t("ledger.openDoc")}`}
                        onclick={(e: MouseEvent) => { e.stopPropagation(); plugin.showTabDocs?.(plugin.settings.dbRefs[mid].docId); }}>
                        <UiIcon name="folder" size={13} />
                    </button>
                {/if}
            </div>
            <div class="lv-stat" title={t("dash.statScope").replace("${t}", snapshotLabel)}>
            {#if rowCountOf(mid) !== undefined}
                <b class="lv-num" class:zero={rowCountOf(mid) === 0}>{rowCountOf(mid)}</b><span>{t("mod.records")}</span>
                {#if pending > 0}
                    <button type="button" class="lv-module-pending up"
                        title={t("mod.pendingDrill")}
                        onclick={(e: MouseEvent) => { e.stopPropagation(); onDrillReminders(mid); }}
                    ><span class="lv-badge red lv-num">{pending} <UiIcon name="alert" size={12} /></span></button>
                {/if}
            {:else if pending > 0}
                <button type="button" class="lv-num lv-module-pending"
                    title={t("mod.pendingDrill")}
                    onclick={(e: MouseEvent) => { e.stopPropagation(); onDrillReminders(mid); }}
                ><b>{pending}</b><span class="lv-tx-warn">{t("mod.pending")}</span></button>
            {:else if plugin.settings.dbRefs?.[mid] && !plugin.settings.dbRefs[mid].docId}
                    <span class="lv-tx-warn">{t("diag.missing")}</span>
            {:else if plugin.settings.dbRefs?.[mid]?.provisional}
                    <span>{t("diag.provisional")}</span>
            {:else}
                    <span class="lv-go"><span>{t("mod.inLedger")}</span> <UiIcon name="forward" size={11} /></span>
            {/if}
            {#if sparkOf(mid)}
                <span class="lv-spark" aria-hidden="true" title={t("dash.sparkTip")}>
                    {#each sparkOf(mid) as h, i (i)}
                        <i class:hi={i === 4} style="height:{h}%"></i>
                    {/each}
                </span>
            {/if}
            </div>
            {#if mid === "exams" && plugin.runtime?.lastExamStats?.generatedAt}
                <!-- EC21：lv-exam:stats 聚合展示（只读子集，标注更新日期；不读题目内容） -->
                <div class="lv-caption" title={t("mod.examStatsTip").replace("${d}", formatLocalDate(plugin.runtime.lastExamStats.generatedAt) ?? "—")}>
                    <UiIcon name="note" size={13} /> {t("mod.examStreak").replace("${n}", String(plugin.runtime.lastExamStats.streak)).replace("${p}", String(plugin.runtime.lastExamStats.accuracy))}
                </div>
            {/if}
            {#if mid === "health" && healthBound.length > 0}
                <!-- EC09（D20）：打卡绑定摘要（只读；只统计有强度数据的绑定项） -->
                <div class="lv-caption" title={healthBound.map((b) => `${b.label} · ${b.score}`).join("\n")}>
                    <UiIcon name="clock" size={12} /> {t("mod.checkinBound").replace("${n}", String(healthBound.length))}
                </div>
            {/if}
        </div>
    {/each}
        </div>
        </div>
        {/if}
    </section>
    {/each}
    {/if}
{/if}

