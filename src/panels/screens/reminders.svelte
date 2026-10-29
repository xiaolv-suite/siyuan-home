<script lang="ts">
    import { Dialog, Menu, showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import type { HomePluginLike } from "@/types/plugin";
    import {
        saveRuntime, applyNamedView, type ReminderNamedView,
        getReminderPlanStatus, type ReminderPlanStatus,
    } from "@/core/hub/runtime";
    import { localDateKey } from "@/core/hub/rule";
    import { toggleReminderPin } from "@/core/hub/actions";
    import { isReminderPinned } from "@/core/hub/runtime";
    import { stageBadgeLabel, stageBadge, stagesOf } from "@/core/reminder-stage";
    import { formatAsTaskBlock } from "@/core/block-capture";
    import Calendar from "@/panels/screens/calendar.svelte";
    import ReminderGroupsList from "@/panels/screens/reminder-groups-list.svelte";
    import ReminderBatchBar from "@/panels/screens/reminder-batch-bar.svelte";
    import ReminderHandledList from "@/panels/screens/reminder-handled-list.svelte";
    import ReminderControlsBar from "@/panels/screens/reminder-controls-bar.svelte";
    import { openReminderDigestDialog, exportReminderIcs } from "@/core/reminder-dialogs";
    import UiIcon from "@/ui/icon.svelte";
    import type { Reminder, ReminderKind } from "@/types";
    let { plugin, t, version }: { plugin: HomePluginLike; t: (k: string) => string; version?: number } = $props();

    // 就地展开摘要（§17）：不打开抽屉直接查看派生规则、所属模块与责任成员
    let expandedReminders = $state(new Set<string>());
    function toggleReminderExpand(id: string) {
        const next = new Set(expandedReminders);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedReminders = next;
    }
    function ruleText(ruleKey: string): string {
        const key = `rule.${ruleKey}`;
        const val = t(key);
        return val === key ? ruleKey : val;
    }
    function kindText(kind?: ReminderKind): string {
        if (!kind) return "";
        const map: Record<string, string> = {
            recurring: t("hub.kindRecurring"),
            anniversary: t("hub.kindAnniversary"),
            oneoff: t("hub.kindOneoff"),
            after: t("hub.kindAfter"),
        };
        return map[kind] ?? kind;
    }

    // version（H02）：hub 变更时递增，驱动派生重算（plugin.* 为普通对象引用）
    const all = $derived.by(() => {
        void version;
        return plugin.scan?.reminders ?? [];
    });
    const overdueCount = $derived(all.filter((r: Reminder) => r.level === "overdue").length);
    const permissionDenied = $derived((plugin.scan?.errors ?? []).some((error) => error.moduleId === "permission"));
    // C3d：筛选持久化（runtime.hubFilter）——初始快照为设计意图
    // svelte-ignore state_referenced_locally
    let filter = $state(plugin.runtime.hubFilter ?? "all");
    // C3a 成员/模块筛选（H16：成员删除后由成员页复位持久化值；本地 $state 驱动，runtime 只作持久化）
    // svelte-ignore state_referenced_locally
    let filterMember = $state<string | undefined>(plugin.runtime.hubMemberId);
    // svelte-ignore state_referenced_locally
    let filterModule = $state<string | undefined>(plugin.runtime.hubModuleId);
    // C3a 时间窗：all=不限 / 0=今天 / 7 / 30（含逾期）
    // svelte-ignore state_referenced_locally
    let dueWithin = $state<string>(plugin.runtime.hubDueWithin ?? "all");

    // 双日期模式（§17/284波 Things 3 印证）：计划处理日 (planDate) 与客观截止日 (deadline/dueDate) 分离
    const planDates = $derived.by(() => {
        void version;
        return plugin.runtime.planDates ?? {};
    });
    const planStatusOf = (r: Reminder): ReminderPlanStatus =>
        getReminderPlanStatus(localDateKey(new Date()), r.dueDate, planDates[r.id]);

    function schedulePlanDialog(r: Reminder) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openReminderPlanDialog({
                r,
                plugin,
                DialogCls: Dialog,
                t,
                showMessageFn: showMessage,
            });
        });
    }

    async function copyAsTaskBlock(r: Reminder) {
        const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
        const text = formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("hub.taskBlockCopied"), 3000, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        }
    }

    async function quickPlanToday(r: Reminder) {
        const todayKey = localDateKey(new Date());
        const planDates = plugin.runtime.planDates ?? {};
        const isAlreadyToday = planDates[r.id] === todayKey;
        try {
            if (isAlreadyToday) {
                const { clearReminderPlanDate } = await import("@/core/hub/runtime");
                clearReminderPlanDate(plugin.runtime, r.id);
                showMessage(t("hub.planDateCleared"), 2000, "info");
            } else {
                const { setReminderPlanDate } = await import("@/core/hub/runtime");
                setReminderPlanDate(plugin.runtime, r.id, todayKey);
                showMessage(t("hub.planDateSaved"), 2000, "info");
            }
            await saveRuntime(plugin, plugin.runtime);
            await plugin.refreshHub?.(undefined, true);
        } catch (e) {
            showMessage(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }

    // 命名视图（§17）：筛选组合一键保存与切换
    const namedViews = $derived.by(() => {
        void version;
        return plugin.runtime.namedViews ?? [];
    });
    // svelte-ignore state_referenced_locally
    let activeNamedViewId = $state<string | undefined>(plugin.runtime.activeNamedViewId);

    function applyView(v: ReminderNamedView) {
        applyNamedView(plugin.runtime, v);
        filter = v.filter ?? "all";
        filterMember = v.memberId;
        filterModule = v.moduleId;
        dueWithin = v.dueWithin ?? "all";
        activeNamedViewId = v.id;
        pruneSelection();
        void persistFilter();
    }

    function promptSaveNamedView() {
        import("@/core/reminder-dialogs").then((m) => {
            m.openNamedViewSaveDialog({
                plugin,
                currentFilter: { filter, filterMember, filterModule, dueWithin },
                DialogCls: Dialog,
                t,
                showMessageFn: showMessage,
                onViewSaved: async (viewId) => { activeNamedViewId = viewId; },
            });
        });
    }

    function confirmDeleteNamedView(v: ReminderNamedView) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openNamedViewDeleteConfirm({
                v,
                plugin,
                activeNamedViewId,
                t,
                showMessageFn: showMessage,
                onViewDeleted: async (id) => {
                    if (activeNamedViewId === id) activeNamedViewId = undefined;
                },
            });
        });
    }
    const memberOptions = $derived.by(() => {
        void version;
        return plugin.settings.members ?? [];
    });
    const moduleOptions = $derived.by(() => {
        void version;
        return [...new Set([
            ...(plugin.scan?.reminders ?? []).map((r: Reminder) => r.moduleId),
            ...(plugin.listHandled?.() ?? []).map((entry) => entry.moduleId).filter(Boolean),
        ])];
    });
    // 262 波（Todoist/Linear assignee avatar 语言）：行级成员微头像
    const memberOf = (id: string | undefined) => (id ? (memberOptions ?? []).find((m) => m.id === id) : undefined);
    async function persistFilter() {
        plugin.runtime.hubFilter = filter;
        plugin.runtime.hubMemberId = filterMember;
        plugin.runtime.hubModuleId = filterModule;
        plugin.runtime.hubDueWithin = dueWithin;
        plugin.runtime.activeNamedViewId = activeNamedViewId;
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch (e) {
            showMessage(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }
    const filtered = $derived.by(() => {
        const level = filter;
        let list = level === "all" ? all : level === "handled" ? [] : all.filter((r: Reminder) => r.level === level);
        if (filterMember) list = list.filter((r: Reminder) => !r.memberId || r.memberId === filterMember);
        if (filterModule) list = list.filter((r: Reminder) => r.moduleId === filterModule);
        if (dueWithin !== "all") {
            // 时间窗含逾期：dueDate ≤ 今天+N（yyyy-MM-dd 字符串比较安全；逾期恒在窗内）
            const today = new Date();
            const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(dueWithin));
            const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
            list = list.filter((r: Reminder) => r.dueDate <= endKey);
        }
        return list;
    });
    // Index the scan once so handled filtering does not repeatedly scan the
    // complete derived cache for every archived entry (O(n*m) on large hubs).
    const reminderById = $derived.by(() => {
        void version;
        const map = new Map<string, Reminder>();
        for (const reminder of plugin.runtime?.cache?.derived ?? []) map.set(reminder.id, reminder);
        return map;
    });
    // 225 波：行级级别徽章撤除（级别由色轨+右侧相对时间大字承载，避免重复）——levelBadge 随之移除

    // UG11 v1：提醒导出 .ics（当前筛选为范围；G1 同款——含高后果模块先点名确认）
    let exportingIcs = $state(false);
    async function exportIcs() {
        if (exportingIcs) return;
        exportingIcs = true;
        try {
            await exportReminderIcs({
                list: filtered,
                t,
                showMessageFn: showMessage,
                confirmFn: confirm,
            });
        } finally {
            exportingIcs = false;
        }
    }
    // H07：已处理视图真实数据源（runtime 留痕 + 缓存派生列表回查标题）
    const handledEntries = $derived.by(() => {
        void version;
        return plugin.listHandled?.() ?? [];
    });
    const handledFiltered = $derived.by(() => {
        let list = handledEntries;
        if (filterMember) {
            list = list.filter((entry) => {
                const reminder = reminderById.get(entry.id);
                // 运行态留痕可能比派生缓存更久（模块扫描失败、历史行删除或缓存迁移时尤甚）。
                // 无法确认成员归属时保留条目，避免用户在成员筛选下误以为已处理记录丢失。
                return !reminder || !reminder.memberId || reminder.memberId === filterMember;
            });
        }
        if (filterModule) list = list.filter((entry) => entry.moduleId === filterModule);
        if (dueWithin !== "all") {
            const today = new Date();
            const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(dueWithin));
            const endKey = [end.getFullYear(), String(end.getMonth() + 1).padStart(2, "0"), String(end.getDate()).padStart(2, "0")].join("-");
            list = list.filter((entry) => !!entry.dueDate && entry.dueDate <= endKey);
        }
        return list;
    });

    async function restoreEntry(id: string) {
        await runReminderAction(async () => {
            await plugin.restore(id);
            showMessage(t("hub.restoreDone"), 3000, "info");
        }, id);
    }

    function confirmDeleteHandledMemo(id: string, title: string) {
        confirm(t("delete"), t("hub.memoDeleteBody").replace("${title}", title), async () => {
            await runReminderAction(async () => {
                await plugin.removeMemo(id);
                showMessage(t("hub.memoDeleted"), 2500, "info");
            }, id);
        });
    }

    let reminderBusy = $state<Set<string>>(new Set());
    async function runReminderAction(action: () => Promise<void>, key = "global") {
        if (reminderBusy.has(key)) return;
        reminderBusy = new Set([...reminderBusy, key]);
        try { await action(); }
        catch (e) {
            showMessage(t("hub.actionFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
        finally {
            const next = new Set(reminderBusy);
            next.delete(key);
            reminderBusy = next;
        }
    }

    // H03：未处理备忘的显式删除（确认后物理删除；这是备忘唯一的物理删除路径）
    function confirmDeleteMemo(r: Reminder) {
        confirm(t("delete"), t("hub.memoDeleteBody").replace("${title}", r.title), async () => {
            await runReminderAction(async () => {
                await plugin.removeMemo(r.id);
                showMessage(t("hub.memoDeleted"), 2500, "info");
            }, r.id);
        });
    }

    // 17 组：批量操作——选择模式下逐条勾选，批量完成/延后 7 天/忽略（H01 串行队列逐条落盘）
    let batchMode = $state(false);
    // 230 波：原生日历视图切换（列表 ⇄ 日历；批量模式仅在列表生效）
    // 263 波：视图偏好持久化（runtime.hubViewMode，跨会话记忆）
    // svelte-ignore state_referenced_locally
    let viewMode = $state<"list" | "calendar">(plugin.runtime.hubViewMode ?? "list");
    $effect(() => {
        if (viewMode === "calendar") clearSelection();
        if (plugin.runtime.hubViewMode !== viewMode) {
            plugin.runtime.hubViewMode = viewMode;
            saveRuntime(plugin, plugin.runtime).catch((e) => showMessage(t("hub.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error"));
        }
    });
    let selected = $state<Set<string>>(new Set());
    let batchBusy = $state(false);
    function toggleSelect(id: string) {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selected = next;
    }
    function pruneSelection() {
        const visibleIds = new Set(filtered.map((r: Reminder) => r.id));
        const next = new Set([...selected].filter((id) => visibleIds.has(id)));
        if (next.size !== selected.size) selected = next;
    }
    function clearSelection() {
        selected = new Set();
        batchMode = false;
    }

    // B4b 续期：思源 Dialog 小窗（H10：失败保留 Dialog 与输入、错误就地显示，不提前销毁）
    function renewDialog(r: Reminder) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openReminderRenewDialog({
                r,
                plugin,
                DialogCls: Dialog,
                t,
            });
        });
    }

    // C3c 延后天数菜单（1/3/7/30）
    function snoozeMenu(r: Reminder, ev: MouseEvent) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openSnoozeMenu({
                r,
                ev,
                MenuCls: Menu,
                t,
                onSnooze: (days) => runReminderAction(() => plugin.snooze(r.id, days), r.id),
            });
        });
    }

    // 246 波（收件箱深化）：备忘编辑对话框（标题/到期日修正 → updateMemo 落盘）
    function editMemoDialog(r: Reminder) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openMemoEditDialog({
                r,
                plugin,
                DialogCls: Dialog,
                t,
                showMessageFn: showMessage,
            });
        });
    }

    // 311 波（G2）：多段提醒割点——从 schema 规则查得 leadStages 后算出当前段位
    const schemaRuleCache = new Map<string, { leadStages?: number[]; leadDays: number }>();
    function ruleOf(r: Reminder): { leadStages?: number[]; leadDays: number } {
        const key = `${r.moduleId}.${r.ruleKey}`;
        const hit = schemaRuleCache.get(key);
        if (hit) return hit;
        const spec = (plugin.schemaCatalog?.[r.moduleId]?.reminders ?? []).find((x: any) => x.key === r.ruleKey);
        const rule = { leadStages: spec?.leadStages, leadDays: typeof spec?.leadDays === "number" ? spec.leadDays : 30 };
        schemaRuleCache.set(key, rule);
        return rule;
    }
    function stageOf(r: Reminder): { label: string; isUrgent: boolean; stages: number[] } | null {
        const rule = ruleOf(r);
        if (!rule.leadStages || rule.leadStages.length === 0) return null;
        const label = stageBadgeLabel(r.daysLeft, rule, t);
        if (!label) return null;
        const badge = stageBadge(r.daysLeft, rule);
        return { label, isUrgent: badge.isUrgentStage, stages: stagesOf(rule) };
    }
    function stageLabelOf(r: Reminder): string {
        return stageOf(r)?.label ?? "";
    }

    // 246 波（收件箱深化）& 304 波（重要提醒与证件紧急置顶）：置顶项在所属分组内排最前
    function isPinned(r: Reminder): boolean {
        return isReminderPinned(plugin.runtime, r);
    }
    function pinnedFirst(items: Reminder[]): Reminder[] {
        return [...items].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
    }
    // 29 组：同成员同日多条合并为一条可展开卡；175 波 O(n) 分组、179 波抽纯函数（core/hub/display，带单测）
    // 181 波：DisplayEntry 平铺化（key/row/items 恒有值），模板无需联合收窄。
    // Keep grouping and pin sorting in one derived pass. The old template
    // rebuilt three filtered arrays and three sorted arrays on every update.
    const displayGroups = $derived.by(() => {
        void version;
        if (filter === "all") {
            return [
                { key: "overdue", label: t("hub.groupOverdue"), items: pinnedFirst(filtered.filter((r: Reminder) => r.level === "overdue")) },
                { key: "soon", label: t("hub.groupSoon"), items: pinnedFirst(filtered.filter((r: Reminder) => r.level === "soon")) },
                { key: "lead", label: t("hub.groupLead"), items: pinnedFirst(filtered.filter((r: Reminder) => r.level === "lead")) },
            ].filter((g) => g.items.length > 0);
        }
        return [{ key: filter, label: "", items: pinnedFirst(filtered) }];
    });

    // 236 波（收件箱分诊）：备忘 → 正式台账行（解耦至 core/reminder-dialogs.ts）
    function toLedgerDialog(r: Reminder) {
        import("@/core/reminder-dialogs").then((m) => {
            m.openTriageToLedgerDialog({
                r,
                plugin,
                DialogCls: Dialog,
                t,
                showMessageFn: showMessage,
            });
        });
    }

    // 261 波：重扫 busy 态——31 模块串行扫描可达秒级，此前可连点堆积多次全量扫描
    let rescanning = $state(false);
    // 29 组：今日免打扰（runtime 非响应式——依赖 version prop 刷新；当日键比较即跨天自动失效）
    const todaySilentOn = $derived.by(() => {
        void version;
        return plugin.runtime.todaySilent === localDateKey(new Date());
    });
    async function rescan() {
        if (rescanning) return;
        rescanning = true;
        try {
            await plugin.refreshHub(undefined, true);
        } catch (e) {
            showMessage(t("hub.rescanFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            rescanning = false;
        }
    }
    function toggleTodaySilent() {
        void runReminderAction(() => plugin.toggleTodaySilent(), "today-silent");
    }

    // 306 波：家庭提醒周报/月报摘要——把当前提醒快照汇总为可粘贴的 Markdown 文本
    let digestBusy = $state(false);
    async function openDigestDialog() {
        if (digestBusy) return;
        digestBusy = true;
        try {
            await openReminderDigestDialog({
                filtered,
                plugin,
                DialogCls: Dialog,
                t,
                showMessageFn: showMessage,
            });
        } finally {
            digestBusy = false;
        }
    }

    // 260 波：首扫 loading 态（未知 ≠ "暂无事项"，33.3/13 §3.4）
    const firstScanPending = $derived.by(() => {
        void version;
        return !plugin.runtime?.scannedAt && !(plugin.scan?.errors?.length) && all.length === 0;
    });
</script>

<div class="lv-hero lv-hub-hero" aria-labelledby="lv-hub-title">
    <div class="lv-hero-copy">
        <span class="lv-hub-eyebrow">{t("dash.upcoming")}</span>
        <h1 id="lv-hub-title">{t("hub.title")}</h1>
        <p class="lv-hero-lead">{t("hub.subtitle")}</p>
    </div>
    <div class="lv-hero-tools">
        <div class="lv-hub-summary" aria-label={t("hub.title")}>
            <div class="lv-hub-summary__item"><span>{t("hub.filterAll")}</span><b class="lv-num">{all.length}</b></div>
            <div class="lv-hub-summary__item is-overdue"><span>{t("hub.groupOverdue")}</span><b class="lv-num">{overdueCount}</b></div>
        </div>
    </div>
</div>

<ReminderControlsBar
    bind:filter
    bind:filterMember
    bind:filterModule
    bind:dueWithin
    bind:viewMode
    bind:activeNamedViewId
    bind:batchMode
    {memberOptions}
    {moduleOptions}
    {namedViews}
    {batchBusy}
    {digestBusy}
    {rescanning}
    {exportingIcs}
    {todaySilentOn}
    filteredCount={filtered.length}
    {t}
    onApplyNamedView={applyView}
    onPromptSaveNamedView={promptSaveNamedView}
    onConfirmDeleteNamedView={confirmDeleteNamedView}
    onOpenDigest={openDigestDialog}
    onToggleTodaySilent={toggleTodaySilent}
    onRescan={rescan}
    onExportIcs={exportIcs}
    onFilterChanged={() => {
        if (filter === "handled") clearSelection();
        pruneSelection();
        void persistFilter();
    }}
    onClearSelection={clearSelection}
/>

{#if permissionDenied}
    <div class="lv-card" role="alert" style="display:flex;align-items:center;gap:12px;padding:12px 16px">
        <UiIcon name="alert" size={18} />
        <span style="flex:1;min-width:0;overflow-wrap:anywhere">{t("permission.body")}</span>
        <button class="b3-button b3-button--outline" disabled={rescanning} aria-busy={rescanning} onclick={rescan}>
            {rescanning ? t("diag.rebuilding") : t("hub.rescan")}
        </button>
    </div>
{/if}

{#if batchMode && filter !== "handled" && viewMode === "list"}
    <ReminderBatchBar
        bind:selected
        bind:batchMode
        {filtered}
        {all}
        {plugin}
        {t}
        onActionCompleted={async () => {
            await plugin.refreshHub?.(undefined, true);
        }}
    />
{/if}



{#if filter === "handled"}
    <ReminderHandledList
        {handledFiltered}
        {handledEntries}
        {reminderBusy}
        {t}
        onClearFilters={() => {
            filterMember = undefined;
            filterModule = undefined;
            dueWithin = "all";
            void persistFilter();
        }}
        onRestore={restoreEntry}
        onDeleteMemo={confirmDeleteHandledMemo}
    />
{:else if viewMode === "calendar" && filter !== "handled"}
    <!-- 日历在空筛选结果时仍提供日期浏览与新增备忘入口。 -->
    <Calendar items={filtered} {t} {version} initialMode={plugin.runtime.hubCalMode}
        onModeChange={(m: "month" | "week") => { plugin.runtime.hubCalMode = m; saveRuntime(plugin, plugin.runtime).catch((e) => showMessage(t("hub.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error")); }}
        onComplete={(r: Reminder) => runReminderAction(() => plugin.complete(r), `calendar:${r.id}`)}
        onTogglePin={(r: Reminder) => runReminderAction(async () => { await toggleReminderPin(plugin, r.id); await plugin.refreshHub(); }, `calendar:pin:${r.id}`)}
        isPinnedFn={(r: Reminder) => isPinned(r)}
        onLocate={(r: Reminder) => plugin.showTabDocs(plugin.settings.dbRefs[r.moduleId]?.docId, r.rowId)}
        onAddMemo={(title: string, due: string) => plugin.addMemo(title, due)}
        onConvert={(r: Reminder) => toLedgerDialog(r)} />
{:else}
    <ReminderGroupsList
        {plugin}
        {t}
        {filtered}
        {displayGroups}
        {firstScanPending}
        {rescanning}
        {filter}
        {filterMember}
        {filterModule}
        {dueWithin}
        {batchMode}
        {viewMode}
        {batchBusy}
        {selected}
        {expandedReminders}
        {reminderBusy}
        {planStatusOf}
        {stageOf}
        {stageLabelOf}
        {isPinned}
        {memberOf}
        {ruleText}
        {kindText}
        onToggleSelect={toggleSelect}
        onToggleExpand={toggleReminderExpand}
        onRunAction={runReminderAction}
        onRenew={renewDialog}
        onSchedulePlan={schedulePlanDialog}
        onCopyTask={copyAsTaskBlock}
        onTogglePin={(rem) => runReminderAction(async () => { await toggleReminderPin(plugin, rem.id); await plugin.refreshHub(); }, rem.id)}
        onQuickPlanToday={quickPlanToday}
        onSnooze={snoozeMenu}
        onEditMemo={editMemoDialog}
        onDeleteMemo={confirmDeleteMemo}
        onTriage={toLedgerDialog}
        onRescan={rescan}
        onClearFilters={() => {
            filter = "all";
            filterMember = undefined;
            filterModule = undefined;
            dueWithin = "all";
            pruneSelection();
            void persistFilter();
        }}
    />
{/if}

<style>
    /* 提醒页局部视觉层级：页头负责摘要，控制区分成筛选与动作两层，避免长工具条抢占内容。 */
    .lv-hub-eyebrow {
        display: block;
        color: var(--lv-accent);
        font-size: 11px;
        font-weight: 650;
        letter-spacing: .08em;
        text-transform: uppercase;
        margin-bottom: 2px;
    }
    .lv-hub-summary {
        display: flex;
        align-items: stretch;
        gap: 1px;
        flex: none;
        overflow: hidden;
        border: 1px solid var(--lv-line);
        border-radius: var(--lv-r-2);
        background: var(--lv-surface-2);
        box-shadow: var(--lv-shadow-1);
    }
    .lv-hub-summary__item {
        min-width: 74px;
        padding: 8px 14px;
        display: flex;
        flex-direction: column-reverse;
        gap: 2px;
        text-align: right;
        background: var(--lv-surface);
    }
    .lv-hub-summary__item + .lv-hub-summary__item { border-left: 1px solid var(--lv-line); }
    .lv-hub-summary__item span { color: var(--lv-tx-3); font-size: 11px; white-space: nowrap; }
    .lv-hub-summary__item b { font-size: 20px; line-height: 1.1; font-weight: 650; color: var(--lv-tx); }
    .lv-hub-summary__item.is-overdue b { color: var(--lv-danger); }
    @media (max-width: 760px) {
        .lv-hub-summary { align-self: stretch; width: 100%; }
        .lv-hub-summary__item { flex: 1; min-width: 0; text-align: left; }
    }
    /* 嵌入思源侧栏时 viewport 仍可能很宽，使用面板容器宽度复用移动布局。 */
    @container lv-home (max-width: 760px) {
        .lv-hub-summary { align-self: stretch; width: 100%; }
        .lv-hub-summary__item { flex: 1; min-width: 0; text-align: left; }
    }
    @container lv-home (max-width: 420px) {
        .lv-hub-summary__item { padding-inline: 9px; }
        .lv-hub-summary__item b { font-size: 17px; }
    }
</style>
