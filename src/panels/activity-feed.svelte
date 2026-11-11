<script lang="ts">
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage, homeInline } from "@/libs/notice";
    import { showDocTreeNativeMenu } from "@/libs/lv-notice-kit";
    import { sql } from "@/core/siyuan";
    import { onDestroy } from "svelte";
    import type { ActivityRecord, ActivitySnapshot } from "@/core/activity";
    import { loadActivitySnapshot } from "@/core/activity";
    import type { HomePluginLike } from "@/types/plugin";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin, t, version, memberId, compact = false, initialCollapsed = false,
    }: {
        plugin: HomePluginLike;
        t: (key: string) => string;
        version?: number;
        memberId?: string;
        compact?: boolean;
        initialCollapsed?: boolean;
    } = $props();

    let snapshot = $state<ActivitySnapshot | undefined>();
    let loading = $state(false);
    let loadError = $state("");
    let progress = $state({ done: 0, total: 0 });
    let query = $state("");
    let moduleFilter = $state("all");
    let page = $state(1);
    // svelte-ignore state_referenced_locally
    let collapsed = $state(initialCollapsed);
    let showFilterTools = $state(false);
    let loadedVersion = $state<number | undefined>();
    let activeController: AbortController | undefined;
    let prevBtnEl = $state<HTMLButtonElement | undefined>(undefined);
    let nextBtnEl = $state<HTMLButtonElement | undefined>(undefined);

    function handlePrevPage() {
        if (page <= 1) return;
        const targetPage = page - 1;
        page = targetPage;
        if (targetPage <= 1) {
            setTimeout(() => nextBtnEl?.focus(), 0);
        }
    }

    function handleNextPage() {
        if (page >= pageCount) return;
        const targetPage = page + 1;
        page = targetPage;
        if (targetPage >= pageCount) {
            setTimeout(() => prevBtnEl?.focus(), 0);
        }
    }

    function handlePaginationKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowLeft") {
            if (!prevBtnEl?.disabled) {
                e.preventDefault();
                handlePrevPage();
            }
        } else if (e.key === "ArrowRight") {
            if (!nextBtnEl?.disabled) {
                e.preventDefault();
                handleNextPage();
            }
        } else if (e.key === "Home") {
            if (page > 1) {
                e.preventDefault();
                page = 1;
            }
        } else if (e.key === "End") {
            if (page < pageCount) {
                e.preventDefault();
                page = pageCount;
            }
        }
    }

    onDestroy(() => {
        activeController?.abort();
        activeController = undefined;
    });
    const pageSize = $derived(compact ? 3 : 8);

    const records = $derived.by(() => {
        void version;
        const source = snapshot?.records ?? [];
        const isGuest = Boolean(plugin.runtime?.guestModeActive);
        const guestAllowed = new Set(["medicine", "address", "food", "stock", "chores", "pets"]);
        const needle = query.trim().toLocaleLowerCase();
        return source.filter((record) => {
            if (isGuest && record.moduleId && !guestAllowed.has(record.moduleId)) return false;
            if (memberId && record.memberId !== memberId) return false;
            if (moduleFilter !== "all" && record.moduleId !== moduleFilter) return false;
            if (!needle) return true;
            const details = record.details.map((item) => `${t(`field.${item.key}`)} ${translated(item.valueKey, item.value)}`).join(" ");
            return `${record.title} ${t(`module.${record.moduleId}`)} ${details} ${memberName(record.memberId)}`.toLocaleLowerCase().includes(needle);
        });
    });
    const pageCount = $derived(Math.max(1, Math.ceil(records.length / pageSize)));
    const safePage = $derived(Math.min(Math.max(1, page), pageCount));
    const pageRecords = $derived(records.slice((safePage - 1) * pageSize, safePage * pageSize));
    $effect(() => {
        if (page !== safePage) {
            page = safePage;
        }
    });
    const moduleOptions = $derived.by(() => {
        const found = new Set((snapshot?.records ?? []).filter((r) => !memberId || r.memberId === memberId).map((r) => r.moduleId));
        return [...found].sort((a, b) => t(`module.${a}`).localeCompare(t(`module.${b}`), undefined, { numeric: true }));
    });

    function translated(key: string | undefined, fallback: string): string {
        if (!key) return fallback;
        const value = t(key);
        return value === key ? fallback : value;
    }

    function memberName(id: string | undefined): string {
        if (!id) return t("members.unassigned");
        return plugin.settings.members.find((member) => member.id === id)?.name ?? t("members.unassigned");
    }

    // 307 波：时间轴活跃度洞察（模块/成员热度 + 长期空窗预警）
    let insightBusy = $state(false);
    async function openInsightDialog() {
        if (insightBusy) return;
        insightBusy = true;
        try {
            const { buildTimelineInsight, formatTimelineInsight } = await import("@/core/timeline-insight");
            const input = (snapshot?.records ?? []).map((r) => ({
                id: r.id,
                moduleId: r.moduleId,
                memberId: r.memberId,
                date: r.recordedAt ?? r.eventDate,
            }));
            const knownModules = [...new Set((snapshot?.records ?? []).map((r) => r.moduleId))].slice(0, 40);
            const insight = buildTimelineInsight(input, { knownModules, windowDays: 180, gapDays: 60 });
            const text = formatTimelineInsight(insight, (id) =>
                t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : memberName(id));

            const dlg = new Dialog({
                title: t("activity.insightTitle"),
                content: `<div class="b3-dialog__content lv-dialog-scroll-body"><pre class="lv-caption lv-report-pre"></pre></div>
<div class="b3-dialog__action">
  <button type="button" class="b3-button b3-button--cancel">${t("close")}</button>
  <button type="button" class="b3-button" id="lv-insight-copy">${t("activity.insightCopy")}</button>
</div>`,
                width: "600px",
            });
            const pre = dlg.element.querySelector("pre");
            if (pre) pre.textContent = text;
            (dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
            const copyInsightBtn = dlg.element.querySelector("#lv-insight-copy") as HTMLButtonElement;
            copyInsightBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    homeInline(copyInsightBtn, t("activity.insightCopy") || "已复制洞察");
                    showMessage(t("overview.lifeIndexCopied"), 2500, "info");
                } catch {
                    showMessage(t("activity.insightCopyFailed"), 4000, "error");
                }
            };
        } catch (e) {
            showMessage(t("activity.insightFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            insightBusy = false;
        }
    }

    async function refresh(force = false) {
        if (loading) return;
        const requestedVersion = version ?? 0;
        loading = true;
        loadError = "";
        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        try {
            snapshot = await loadActivitySnapshot(plugin, {
                force,
                revision: requestedVersion,
                signal: controller.signal,
                onProgress: (done, total) => { progress = { done, total }; },
            });
            if (snapshot.records.length === 0 && snapshot.errors.length > 0 && snapshot.coveredModules.length === 0) {
                loadError = snapshot.errors.map((error) => `${error.moduleId}: ${error.message}`).join("；");
            }
        } catch (error) {
            if (!controller.signal.aborted && !(error instanceof Error && (error.name === "RequestSupersededError" || error.name === "RequestAbortedError"))) {
                loadError = error instanceof Error ? error.message : String(error);
            }
        } finally {
            // Record the revision actually requested. If the hub advanced while
            // this read was in flight, the effect below will immediately fetch it.
            loadedVersion = requestedVersion;
            if (activeController === controller) {
                activeController = undefined;
                loading = false;
            }
        }
    }

    $effect(() => {
        const currentVersion = version;
        void memberId;
        if (loadedVersion === undefined && !loading) void refresh();
        else if (loadedVersion !== undefined && loadedVersion !== currentVersion && !loading) void refresh(true);
    });

    function open(record: ActivityRecord) {
        if (!plugin.openActivityTarget) {
            showMessage(t("activity.navigationUnavailable"), 4000, "error");
            return;
        }
        plugin.openActivityTarget({
            moduleId: record.moduleId,
            rowId: record.rowId,
            source: record.source,
            logKind: record.logKind,
            entryAt: record.recordedAt,
            eventDate: record.eventDate,
            activityId: record.source === "rowlog" ? record.id : undefined,
        });
    }

    function clearFilters() {
        query = "";
        moduleFilter = "all";
        page = 1;
    }

    function recordTime(record: ActivityRecord): string {
        if (record.recordedAt) {
            const date = new Date(record.recordedAt);
            return Number.isNaN(date.getTime()) ? record.recordedAt.slice(0, 16) : date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        }
        return record.eventDate ?? t("activity.dateUnknown");
    }

    function timeBasis(record: ActivityRecord): string {
        if (record.recordedAt && record.eventDate && record.recordedAt.slice(0, 10) !== record.eventDate) {
            return `${t("activity.recordedAt")} · ${t("activity.eventDate")} ${record.eventDate}`;
        }
        return record.recordedAt ? t("activity.recordedAt") : t("activity.eventDate");
    }

    function detailValue(record: ActivityRecord, valueKey: string | undefined, value: string): string {
        if (record.moduleId === "vehicles" && valueKey) {
            const parts = valueKey.split(".");
            const selected = parts[parts.length - 1];
            const candidates = [`fuel.option.${selected}`, `field.energy_type.opt.${selected}`, `activity.detail.${selected}`];
            for (const candidate of candidates) { const result = t(candidate); if (result !== candidate) return result; }
        }
        return translated(valueKey, value);
    }

    function detailLabel(key: string): string {
        const keys: Record<string, string> = {
            fuelGrade: "fuel.field.fuelGrade", chargingMode: "fuel.field.chargingMode",
            quantity: "fuel.field.quantity", odometer: "fuel.field.odometer", totalCost: "fuel.field.totalCost",
            cost: "fuel.field.totalCost", unitPrice: "fuel.field.unitPrice", station: "fuel.field.station",
            value: "activity.detail.value", from: "activity.detail.from", to: "activity.detail.to",
            result: "activity.detail.result", back: "activity.detail.back",
        };
        const lookup = keys[key] ?? `field.${key}`;
        const value = t(lookup);
        return value === lookup ? key : value;
    }

    function goToLedger() {
        const target = memberId ? (snapshot?.records.find((record) => record.memberId === memberId) ?? snapshot?.records[0]) : snapshot?.records[0];
        const moduleId = target?.moduleId ?? moduleOptions[0];
        if (!moduleId) return;
        plugin.setActiveLedger(moduleId);
        plugin.panelScreenSwitch?.("ledger");
    }

    function openRecordDoc(record: ActivityRecord) {
        const docId = plugin.settings?.dbRefs?.[record.moduleId]?.docId;
        if (docId && plugin.showTabDocs) {
            plugin.showTabDocs(docId, record.rowId);
        }
    }

    async function openJournalDoc() {
        const { openDailyJournalDoc } = await import("@/core/doc-sync");
        await openDailyJournalDoc(plugin);
    }
</script>

    <section class="lv-activity" aria-labelledby={memberId ? `lv-activity-${memberId}` : "lv-activity-title"}>
    <div class="lv-activity-head">
        <div class="lv-activity-heading">
            <h2 id={memberId ? `lv-activity-${memberId}` : "lv-activity-title"} class="lv-title-sec">{memberId ? t("activity.memberTimeline") : t("activity.title")}</h2>
            <span class="lv-sub">{t("activity.scopeHint")}</span>
        </div>
        <div class="lv-activity-actions">
            {#if !collapsed}
                {#if compact && (snapshot?.records.length || query || moduleFilter !== "all")}
                    <button type="button" class="b3-button b3-button--text" aria-pressed={showFilterTools} onclick={() => { showFilterTools = !showFilterTools; }}>
                        <UiIcon name="filter" size={13} /> {t("filter")}
                    </button>
                {/if}
                <button type="button" class="b3-button b3-button--text" onclick={() => void openJournalDoc()} title={t("capture.openJournalDoc")}>
                    <UiIcon name="note" size={13} /> {t("capture.openJournalDoc")}
                </button>
                <button type="button" class="b3-button b3-button--text" onclick={() => void refresh(true)} disabled={loading} aria-busy={loading}>
                    {#if loading}<span class="lv-activity-spinner lv-activity-spinner--small" aria-hidden="true"></span>{:else}<UiIcon name="history" size={14} />{/if}{t("activity.refresh")}
                </button>
                <!-- 307 波：时间轴活跃度洞察（模块/成员热度 + 长期空窗预警） -->
                <button type="button" class="b3-button b3-button--text" disabled={!snapshot?.records.length || insightBusy} onclick={openInsightDialog}>{t("activity.insight")}</button>
            {/if}
            <button type="button" class="lv-iconbtn" aria-expanded={!collapsed} aria-controls={memberId ? `lv-activity-body-${memberId}` : "lv-activity-body"}
                aria-label={collapsed ? t("activity.expand") : t("activity.collapse")} onclick={(event) => { collapsed = !collapsed; if (collapsed && event.currentTarget instanceof HTMLElement) event.currentTarget.focus(); }}>
                <UiIcon name={collapsed ? "chevronDown" : "chevronUp"} size={14} />
            </button>
        </div>
    </div>

        <div id={memberId ? `lv-activity-body-${memberId}` : "lv-activity-body"} class="lv-activity-body" hidden={collapsed}>
            {#if (!compact || showFilterTools || query || moduleFilter !== "all") && (snapshot?.records.length || loading || loadError)}
                <div class="lv-activity-tools">
                    <label class="lv-activity-search">
                        <UiIcon name="search" size={15} />
                        <input type="search" value={query} oninput={(event) => { query = event.currentTarget.value; page = 1; }} placeholder={t("activity.search")} aria-label={t("activity.search")} />
                    </label>
                    <select class="b3-select lv-activity-filter" value={moduleFilter} onchange={(event) => { moduleFilter = event.currentTarget.value; page = 1; }} aria-label={t("activity.moduleFilter")}>
                        <option value="all">{t("activity.allModules")}</option>
                        {#each moduleOptions as moduleId (moduleId)}<option value={moduleId}>{t(`module.${moduleId}`)}</option>{/each}
                    </select>
                </div>
            {/if}

            {#if loading && !snapshot}
                <div class="lv-card lv-activity-state" role="status" aria-busy="true">
                    <span class="lv-activity-spinner" aria-hidden="true"></span>
                    <b>{t("activity.loading")}</b>
                    <span>{progress.total > 0 ? t("activity.progress").replace("${done}", String(progress.done)).replace("${total}", String(progress.total)) : t("activity.readingLedgers")}</span>
                </div>
            {:else if loadError && !snapshot?.records.length}
                <div class="lv-card lv-empty" role="alert">
                    <div class="eic"><UiIcon name="alert" size={22} /></div>
                    <b>{t("activity.failed")}</b><span>{loadError}</span>
                    <button type="button" class="b3-button b3-button--outline lv-mt-8" disabled={loading} onclick={() => void refresh(true)}>{loading ? t("activity.loading") : t("activity.retry")}</button>
                </div>
            {:else if records.length === 0}
                {#if snapshot?.errors.length}
                    <div class="lv-activity-partial" role="status">
                        <UiIcon name="alert" size={14} />
                        {t("activity.partial").replace("${n}", String(snapshot.errors.length))}
                        <button type="button" class="b3-button b3-button--text" disabled={loading} onclick={() => void refresh(true)}>{t("activity.retry")}</button>
                    </div>
                {/if}
                <div class="lv-card {compact ? 'lv-empty-compact' : 'lv-empty'}" role="status">
                    <div class={compact ? "eic-sm" : "eic"}><UiIcon name="calendar" size={compact ? 18 : 22} /></div>
                    {#if compact}
                        <div class="lv-empty-compact__text">
                            <b>{query || moduleFilter !== "all" ? t("activity.noMatch") : t("activity.empty")}</b>
                            <span>{snapshot?.errors.length ? t("activity.incompleteEmptyHint") : query || moduleFilter !== "all" ? t("activity.noMatchHint") : t("activity.emptyHint")}</span>
                        </div>
                        {#if query || moduleFilter !== "all"}<button type="button" class="b3-button b3-button--outline" onclick={clearFilters}>{t("activity.clearFilters")}</button>{/if}
                        {#if snapshot?.eligibleModules === 0}<button type="button" class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("activity.configure")}</button>{/if}
                    {:else}
                        <b>{query || moduleFilter !== "all" ? t("activity.noMatch") : t("activity.empty")}</b>
                        <span>{snapshot?.errors.length ? t("activity.incompleteEmptyHint") : query || moduleFilter !== "all" ? t("activity.noMatchHint") : t("activity.emptyHint")}</span>
                        {#if query || moduleFilter !== "all"}<button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={clearFilters}>{t("activity.clearFilters")}</button>{/if}
                        {#if snapshot?.eligibleModules === 0}<button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={() => plugin.openSetting()}>{t("activity.configure")}</button>{/if}
                    {/if}
                </div>
            {:else}
                {#if snapshot?.errors.length}
                    <div class="lv-activity-partial" role="status">
                        <UiIcon name="alert" size={14} />
                        {t("activity.partial").replace("${n}", String(snapshot.errors.length))}
                        <button type="button" class="b3-button b3-button--text" disabled={loading} onclick={() => void refresh(true)}>{t("activity.retry")}</button>
                    </div>
                {/if}
                {#if loadError}
                    <div class="lv-activity-partial" role="alert"><UiIcon name="alert" size={14} />{t("activity.failed")}：{loadError}<button type="button" class="b3-button b3-button--text" disabled={loading} onclick={() => void refresh(true)}>{t("activity.retry")}</button></div>
                {/if}
                <div class="lv-card lv-activity-list">
                    {#each pageRecords as record (record.id)}
                        <article class="lv-activity-row">
                            <span class="lv-activity-mark" aria-hidden="true"><UiIcon name={record.logKind === "fuelings" ? "fuel" : record.logKind === "chargings" ? "bolt" : record.logKind === "maintenance" ? "wrench" : record.logKind === "vitals" ? "heartPulse" : record.logKind === "chexecs" ? "checkCircle" : "note"} size={16} /></span>
                            <div class="lv-activity-main">
                                <div class="lv-activity-title-row">
                                    <button class="lv-activity-open" type="button" onclick={() => open(record)} title={t("activity.openRecord")}>
                                        <b>{record.title || t("ledger.unnamed")}</b>
                                        <span class="lv-activity-module">{t(`module.${record.moduleId}`)}{record.memberId ? ` · ${memberName(record.memberId)}` : ` · ${t("members.unassigned")}`}</span>
                                    </button>
                                    {#if plugin.settings?.dbRefs?.[record.moduleId]?.docId}
                                        <button type="button" class="b3-button b3-button--text lv-activity-doc-btn"
                                            title={`${t("ledger.openDoc")}（右键打开原生文档树菜单）`}
                                            aria-label={t("ledger.openDoc")}
                                            onclick={() => openRecordDoc(record)}
                                            oncontextmenu={async (e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                const docId = plugin.settings?.dbRefs?.[record.moduleId]?.docId;
                                                let notebookId = plugin.settings?.dbRefs?.[record.moduleId]?.notebook;
                                                if (docId) {
                                                    if (!notebookId) {
                                                        try {
                                                            const rows = await sql<any>(`SELECT box FROM blocks WHERE id = '${docId.replace(/'/g, "''")}' LIMIT 1`);
                                                            if (rows && rows[0]?.box) notebookId = rows[0].box;
                                                        } catch {}
                                                    }
                                                    if (notebookId) {
                                                        await showDocTreeNativeMenu({ notebookId, docId, position: { x: e.clientX, y: e.clientY } });
                                                    }
                                                }
                                            }}>
                                            <UiIcon name="folder" size={13} />
                                        </button>
                                    {/if}
                                </div>
                                <div class="lv-activity-details">
                                    {#if record.logKind}
                                        <span class="lv-badge gray">{t(`activity.log.${record.logKind}`)}</span>
                                    {/if}
                                    {#each record.details as detail (detail.key)}
                                        <span>{detailLabel(detail.key)}：{detailValue(record, detail.valueKey, detail.value)}</span>
                                    {/each}
                                </div>
                            </div>
                            <div class="lv-activity-time"><b class="lv-num">{recordTime(record)}</b><span>{timeBasis(record)}</span></div>
                        </article>
                    {/each}
                    {#if snapshot?.orphanedRowLogs}
                        <div class="lv-activity-orphan" role="note">{t("activity.orphaned").replace("${n}", String(snapshot.orphanedRowLogs))}</div>
                    {/if}
                </div>
                <div class="lv-activity-footer">
                    <span role="status" aria-live="polite" aria-atomic="true">{t("activity.count").replace("${start}", String((page - 1) * pageSize + 1)).replace("${end}", String(Math.min(page * pageSize, records.length))).replace("${total}", String(records.length))}</span>
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <nav class="lv-activity-pagination" aria-label={t("activity.title")} onkeydown={handlePaginationKeydown}>
                        <button bind:this={prevBtnEl} type="button" class="lv-iconbtn" aria-label={t("activity.previous")} disabled={page <= 1} onclick={handlePrevPage}><UiIcon name="back" size={14} /></button>
                        {#if pageCount > 2}
                            <select class="b3-select lv-activity-page-select" aria-label={t("activity.pageSelect")} value={page} onchange={(e) => { page = Number((e.currentTarget as HTMLSelectElement).value); }}>
                                {#each Array.from({ length: pageCount }, (_, i) => i + 1) as p (p)}
                                    <option value={p}>{p} / {pageCount}</option>
                                {/each}
                            </select>
                        {:else}
                            <span class="lv-num" aria-current="page">{page} / {pageCount}</span>
                        {/if}
                        <button bind:this={nextBtnEl} type="button" class="lv-iconbtn" aria-label={t("activity.next")} disabled={page >= pageCount} onclick={handleNextPage}><UiIcon name="forward" size={14} /></button>
                    </nav>
                    <button type="button" class="b3-button b3-button--text" onclick={goToLedger}><span>{t("activity.goToLedger")}</span> <UiIcon name="forward" size={12} /></button>
                </div>
            {/if}
        </div>
</section>
