<script lang="ts">
    // 原生日历视图（路线图"下一阶段"，230 波；233 波周视图 + 当日快捷新增）：
    // 月/周双模式——月历网格看全月分布，周视图按标题细看；数据只读自扫描结果，动作仅"完成"。
    import type { Reminder } from "@/types";
    import { monthGrid, weekGrid } from "@/core/calendar";
    import type { CalCell } from "@/core/calendar";
    import { localDateKey } from "@/core/hub/rule";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { showMessage } from "siyuan";
    import { formatAsTaskBlock } from "@/core/block-capture";

    let { items, t, version, onComplete, onAddMemo, onConvert, initialMode, onModeChange, onTogglePin, isPinnedFn, onLocate }: {
        items: Reminder[];
        t: (k: string) => string;
        version?: number;
        onComplete: (r: Reminder) => void | Promise<void>;
        onAddMemo: (title: string, due: string) => void | Promise<void>;
        onConvert: (r: Reminder) => void;
        /** 263 波：会历模式偏好（runtime 持久化，由父组件读写） */
        initialMode?: "month" | "week";
        onModeChange?: (m: "month" | "week") => void;
        onTogglePin?: (r: Reminder) => void | Promise<void>;
        isPinnedFn?: (r: Reminder) => boolean;
        onLocate?: (r: Reminder) => void;
    } = $props();

    const now = new Date();
    // svelte-ignore state_referenced_locally
    let mode = $state<"month" | "week">(initialMode === "week" ? "week" : "month");
    function setMode(m: "month" | "week") {
        if (mode === m) return;
        mode = m;
        const selectedDate = keyToDate(selected);
        if (m === "week") weekAnchor = selected;
        else { viewYear = selectedDate.getFullYear(); viewMonth = selectedDate.getMonth(); }
        onModeChange?.(m);
    }
    let viewYear = $state(now.getFullYear());
    let viewMonth = $state(now.getMonth());
    let weekAnchor = $state(localDateKey(now));
    let selected = $state(localDateKey(now));
    const todayKey = localDateKey(new Date());

    const keyToDate = (k: string) => {
        const [y, m, d] = k.split("-").map(Number);
        return new Date(y, m - 1, d);
    };

    const cells = $derived.by(() => {
        void version;
        return mode === "week" ? weekGrid(keyToDate(weekAnchor)) : monthGrid(viewYear, viewMonth);
    });
    // Keep the seven-column calendar semantics explicit for assistive technology:
    // one header row followed by one row per visible week.
    const calendarWeeks = $derived.by(() => {
        const weeks: CalCell[][] = [];
        for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
        return weeks;
    });
    const byDate = $derived.by(() => {
        void version;
        const m = new Map<string, Reminder[]>();
        for (const r of items) {
            if (!m.has(r.dueDate)) m.set(r.dueDate, []);
            m.get(r.dueDate)!.push(r);
        }
        return m;
    });
    const dayItems = $derived(byDate.get(selected) ?? []);
    const monthLabel = $derived(`${viewYear} · ${String(viewMonth + 1).padStart(2, "0")}`);
    const weekLabel = $derived.by(() => {
        const cs = cells;
        return cs.length ? `${cs[0].key.slice(5)} ~ ${cs[cs.length - 1].key.slice(5)}` : "";
    });
    const headLabel = $derived(mode === "month" ? monthLabel : weekLabel);

    function shiftMonth(delta: number) {
        const d = new Date(viewYear, viewMonth + delta, 1);
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
        selected = localDateKey(d);
    }
    function shiftWeek(deltaDays: number) {
        const d = keyToDate(weekAnchor);
        d.setDate(d.getDate() + deltaDays);
        weekAnchor = localDateKey(d);
        selected = weekAnchor;
    }
    function goToday() {
        const d = new Date();
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
        weekAnchor = localDateKey(d);
        selected = localDateKey(d);
    }
    function nav(delta: number) {
        if (mode === "week") shiftWeek(delta * 7);
        else shiftMonth(delta);
    }
    function dotCls(r: Reminder): string {
        return r.level === "overdue" ? "danger" : r.level === "soon" ? "warn" : "amber";
    }
    const weekdays = ["cal.wk.mo", "cal.wk.tu", "cal.wk.we", "cal.wk.th", "cal.wk.fr", "cal.wk.sa", "cal.wk.su"];
    // 233 波：当日面板快捷新增备忘（预设选中日；回车或按钮提交后清空）
    let memoTitle = $state("");
    let memoInput: HTMLInputElement | undefined = $state();
    let savingMemo = $state(false);
    let completing = $state<Set<string>>(new Set());
    async function completeReminder(r: Reminder) {
        if (completing.has(r.id)) return;
        completing = new Set([...completing, r.id]);
        try { await onComplete(r); }
        catch (e) {
            showMessage(t("hub.actionFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            const next = new Set(completing);
            next.delete(r.id);
            completing = next;
        }
    }
    async function addMemoForDay() {
        if (savingMemo) return;
        const title = memoTitle.trim();
        if (!title) {
            memoInput?.focus();
            showMessage(t("memo.titleRequired"), 4000, "info");
            return;
        }
        savingMemo = true;
        try {
            await onAddMemo(title, selected);
            memoTitle = "";
        } catch (e) {
            showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            savingMemo = false;
        }
    }

    async function copyDayTasks() {
        if (dayItems.length === 0) return;
        const text = dayItems.map((r) => {
            const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
            return formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        }).join("\n");
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("hub.batchTasksCopied").replace("${n}", String(dayItems.length)), 2500, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        }
    }

    async function copySingleTask(r: Reminder) {
        const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
        const text = formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t("hub.taskBlockCopied"), 2500, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        }
    }
    function moveDayFocus(event: KeyboardEvent, index: number) {
        const key = event.key;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
        event.preventDefault();
        const cols = 7;
        const rowStart = Math.floor(index / cols) * cols;
        const next = key === "Home" ? rowStart : key === "End" ? Math.min(cells.length - 1, rowStart + cols - 1)
            : key === "ArrowLeft" ? Math.max(0, index - 1) : key === "ArrowRight" ? Math.min(cells.length - 1, index + 1)
                : key === "ArrowUp" ? Math.max(0, index - cols) : Math.min(cells.length - 1, index + cols);
        selected = cells[next].key;
        requestAnimationFrame(() => (document.querySelector(`[data-cal-day="${cells[next].key}"]`) as HTMLButtonElement | undefined)?.focus());
    }
</script>

<div class="lv-cal">
    <div class="lv-cal-head">
        <b>{headLabel}</b>
        <span class="fn__flex-1"></span>
        <span class="lv-tabs" role="group" aria-label={t("cal.title")}>
            <button class="lv-tabs__item" class:on={mode === "month"}
                aria-pressed={mode === "month"} onclick={() => setMode("month")}>{t("view.month")}</button>
            <button class="lv-tabs__item" class:on={mode === "week"}
                aria-pressed={mode === "week"} onclick={() => setMode("week")}>{t("view.week")}</button>
        </span>
        <button class="lv-iconbtn" aria-label={t("cal.prev")} title={t("cal.prev")} onclick={() => nav(-1)}><UiIcon name="back" size={16} /></button>
        <button class="b3-button b3-button--outline" onclick={goToday}>{t("cal.today")}</button>
        <button class="lv-iconbtn" aria-label={t("cal.next")} title={t("cal.next")} onclick={() => nav(1)}><UiIcon name="forward" size={16} /></button>
    </div>
    <div class="lv-cal-grid" class:wk={mode === "week"} role="grid" aria-label={t("cal.title")}>
        <div class="lv-cal-row" role="row">
            {#each weekdays as wk (wk)}
                <div class="lv-cal-wk" role="columnheader">{t(wk)}</div>
            {/each}
        </div>
        {#each calendarWeeks as week, weekIndex (week[0]?.key ?? weekIndex)}
            <div class="lv-cal-row" role="row" aria-label={`${week[0]?.key ?? ""} – ${week[week.length - 1]?.key ?? ""}`}>
                {#each week as c, dayIndex (c.key)}
                    {@const dayReminders = byDate.get(c.key) ?? []}
                    {@const hasOverdue = dayReminders.some((r) => r.level === "overdue")}
                    <button class="lv-cal-cell" class:out={mode === "month" && !c.inMonth} class:sel={c.key === selected}
                        data-cal-day={c.key} role="gridcell" aria-selected={c.key === selected}
                        aria-label={`${c.key}, ${dayReminders.length} ${t("cal.itemsUnit")}${c.key === todayKey ? `, ${t("cal.today")}` : ""}${mode === "month" && !c.inMonth ? `, ${t("cal.otherMonth")}` : ""}`}
                        tabindex={c.key === selected ? 0 : -1} onkeydown={(e) => moveDayFocus(e, weekIndex * 7 + dayIndex)}
                        onclick={() => (selected = c.key)}>
                        <span class="d" class:today={c.key === todayKey} class:has-overdue={hasOverdue}>{c.day}</span>
                        <span class="dots">
                            {#each dayReminders.slice(0, 5) as r (r.id)}
                                <i class={dotCls(r)} title={r.title}></i>
                            {/each}
                            {#if dayReminders.length > 5}<i class="more" title={`${dayReminders.length - 5} more`}>+</i>{/if}
                        </span>
                        {#if mode === "week"}
                            <span class="tt">
                                {#each dayReminders.slice(0, 3) as r (r.id)}
                                    <span class="tt-line {r.level}">{r.title}</span>
                                {/each}
                                {#if dayReminders.length > 3}
                                    <span class="tt-line">+{dayReminders.length - 3}</span>
                                {/if}
                            </span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/each}
    </div>
    <div class="lv-card lv-cal-day-panel">
        <div class="lv-cal-day-head">
            <b class="lv-title-sec" role="status" aria-live="polite">{selected} · {dayItems.length} {t("cal.itemsUnit")}</b>
            {#if dayItems.length > 0}
                <button class="b3-button b3-button--text lv-tx-accent lv-cal-copy-btn" onclick={copyDayTasks}>
                    📋 {t("hub.batchCopyTasks")}
                </button>
            {/if}
        </div>
        {#if dayItems.length === 0}
            <div class="lv-caption lv-cal-empty-tip">{t("cal.emptyDay")}</div>
        {:else}
            <div class="lv-cal-items">
                {#each dayItems as r (r.id)}
                    <div class="lv-cal-item">
                        <span class="lv-rem-ic" aria-hidden="true"><UiIcon name={moduleUiIcon(r.moduleId)} size={18} /></span>
                        {#if onLocate && r.moduleId !== "adhoc"}
                            <div class="lv-cal-item-t is-link"
                                role="button"
                                tabindex="0"
                                title={t("act.locate")}
                                onclick={() => onLocate?.(r)}
                                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLocate?.(r); } }}>
                                <b>
                                    {#if isPinnedFn?.(r)}<span class="lv-tx-accent lv-cal-pin-mark">📌</span>{/if}
                                    {r.title}
                                </b>
                                <span class="lv-caption">{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId}</span>
                            </div>
                        {:else}
                            <div class="lv-cal-item-t">
                                <b>
                                    {#if isPinnedFn?.(r)}<span class="lv-tx-accent lv-cal-pin-mark">📌</span>{/if}
                                    {r.title}
                                </b>
                                <span class="lv-caption">{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId}</span>
                            </div>
                        {/if}
                        <span class="lv-badge {r.level === "overdue" ? "red" : r.level === "soon" ? "orange" : "yellow"}">{r.level === "overdue" ? t("level.overdue") : r.level === "soon" ? t("level.soon") : t("level.lead")}</span>
                        <button type="button" class="b3-button b3-button--text" title={t("hub.copyTaskBlock")} aria-label={t("hub.copyTaskBlock")} onclick={() => copySingleTask(r)}>📋</button>
                        {#if onTogglePin}
                            <button type="button" class="b3-button b3-button--text" title={isPinnedFn?.(r) ? t("act.unpin") : t("act.pin")} aria-label={isPinnedFn?.(r) ? t("act.unpin") : t("act.pin")} onclick={() => onTogglePin?.(r)}>{isPinnedFn?.(r) ? "📌 " + t("act.unpin") : "📌 " + t("act.pin")}</button>
                        {/if}
                        {#if r.moduleId === "adhoc"}
                            <!-- 241 波：备忘项同步提供分诊入口（与提醒中枢一致） -->
                            <button type="button" class="b3-button b3-button--text" title={t("triage.title")} aria-label={t("triage.title")} onclick={() => onConvert(r)}>{t("triage.title")}</button>
                        {/if}
                        <button type="button" class="b3-button b3-button--text" disabled={completing.has(r.id)} aria-busy={completing.has(r.id)} onclick={() => void completeReminder(r)}>{completing.has(r.id) ? t("ledger.saving") : t("act.done")}</button>
                    </div>
                {/each}
            </div>
        {/if}
        <!-- 233 波：当日快捷新增备忘（日期预设为选中日） -->
        <div class="lv-cal-memo-bar">
            <input bind:this={memoInput} class="b3-text-field fn__flex-1" placeholder={t("cal.memoPlaceholder")} aria-label={t("cal.memoPlaceholder")} disabled={savingMemo}
                bind:value={memoTitle}
                onkeydown={(e: KeyboardEvent) => e.key === "Enter" && !e.isComposing && void addMemoForDay()} />
            <button class="lv-btn primary sm" disabled={savingMemo} aria-busy={savingMemo} onclick={addMemoForDay}>{savingMemo ? t("ledger.saving") : `＋ ${t("memo.add")}`}</button>
        </div>
    </div>
</div>
