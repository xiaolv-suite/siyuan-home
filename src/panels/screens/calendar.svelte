<script lang="ts">
    // 原生日历视图（路线图"下一阶段"，230 波；233 波周视图 + 当日快捷新增）：
    // 月/周双模式——月历网格看全月分布，周视图按标题细看；数据只读自扫描结果，动作仅"完成"。
    import type { Reminder } from "@/types";
    import { monthGrid, weekGrid } from "@/core/calendar";
    import type { CalCell } from "@/core/calendar";
    import { localDateKey } from "@/core/hub/rule";
    import { parseQuickAdd } from "@/core/quick-add";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { homeNotify as showMessage, homeInline } from "@/libs/notice";
    import { formatAsTaskBlock } from "@/core/block-capture";

    let { items, t, version, isGuest = false, onComplete, onAddMemo, onConvert, initialMode, onModeChange, onTogglePin, isPinnedFn, onLocate, onReschedule }: {
        items: Reminder[];
        t: (k: string) => string;
        version?: number;
        isGuest?: boolean;
        onComplete: (r: Reminder) => void | Promise<void>;
        onAddMemo: (title: string, due: string, options?: any) => void | Promise<void>;
        onConvert: (r: Reminder) => void;
        /** 263 波：会历模式偏好（runtime 持久化，由父组件读写） */
        initialMode?: "month" | "week";
        onModeChange?: (m: "month" | "week") => void;
        onTogglePin?: (r: Reminder) => void | Promise<void>;
        isPinnedFn?: (r: Reminder) => boolean;
        onLocate?: (r: Reminder) => void;
        onReschedule?: (id: string, targetDate: string) => void | Promise<void>;
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
        if (isGuest) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const rawTitle = memoTitle.trim();
        if (!rawTitle) {
            memoInput?.focus();
            showMessage(t("memo.titleRequired"), 4000, "info");
            return;
        }
        const parsed = parseQuickAdd(memoTitle);
        const cleanTitle = parsed.cleanTitle || rawTitle;
        const targetDue = parsed.dueDate || selected;
        savingMemo = true;
        try {
            await onAddMemo(cleanTitle, targetDue, {
                priority: parsed.priority,
                category: parsed.category,
                cycle: parsed.cycle,
                recurrenceAnchor: parsed.recurrenceAnchor,
            });
            memoTitle = "";
        } catch (e) {
            showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            savingMemo = false;
        }
    }

    async function copyDayTasks(e?: MouseEvent) {
        if (dayItems.length === 0) return;
        const text = dayItems.map((r) => {
            const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
            return formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        }).join("\n");
        try {
            await navigator.clipboard.writeText(text);
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("hub.batchTasksCopied").replace("${n}", String(dayItems.length)));
            }
            showMessage(t("hub.batchTasksCopied").replace("${n}", String(dayItems.length)), 2500, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        }
    }

    async function copySingleTask(r: Reminder, e?: MouseEvent) {
        const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
        const text = formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
        try {
            await navigator.clipboard.writeText(text);
            if (e?.currentTarget) {
                homeInline(e.currentTarget as HTMLElement, t("hub.taskBlockCopied"));
            }
            showMessage(t("hub.taskBlockCopied"), 2500, "info");
        } catch {
            showMessage(t("hub.digestCopyFailed"), 3000, "error");
        }
    }
    let draggingReminderId = $state<string | null>(null);
    let dragOverCellKey = $state<string | null>(null);

    function handleDragStart(e: DragEvent, r: Reminder) {
        if (isGuest) return;
        draggingReminderId = r.id;
        if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", r.id);
            e.dataTransfer.setData("application/json", JSON.stringify({ id: r.id, dueDate: r.dueDate, title: r.title }));
            e.dataTransfer.effectAllowed = "move";
        }
    }

    function handleDragEnd() {
        draggingReminderId = null;
        dragOverCellKey = null;
    }

    function handleCellDragOver(e: DragEvent, cellKey: string) {
        if (isGuest) return;
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "move";
        }
        if (dragOverCellKey !== cellKey) {
            dragOverCellKey = cellKey;
        }
    }

    function handleCellDragLeave(cellKey: string) {
        if (dragOverCellKey === cellKey) {
            dragOverCellKey = null;
        }
    }

    async function handleCellDrop(e: DragEvent, cellKey: string) {
        if (isGuest) return;
        e.preventDefault();
        dragOverCellKey = null;
        const remId = e.dataTransfer?.getData("text/plain") || draggingReminderId;
        draggingReminderId = null;
        if (!remId) return;
        const targetReminder = items.find((r) => r.id === remId);
        if (targetReminder && targetReminder.dueDate === cellKey) {
            return;
        }
        try {
            if (onReschedule) {
                await onReschedule(remId, cellKey);
            }
            showMessage(t("cal.rescheduledTo").replace("${d}", cellKey), 2500, "info");
        } catch (err) {
            showMessage(t("hub.actionFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 4000, "error");
        }
    }

    function moveDayFocus(event: KeyboardEvent, index: number) {
        const key = event.key;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(key)) return;
        event.preventDefault();
        if (key === "PageUp") {
            nav(-1);
            return;
        }
        if (key === "PageDown") {
            nav(1);
            return;
        }
        const cols = 7;
        const rowStart = Math.floor(index / cols) * cols;
        const next = key === "Home" ? rowStart : key === "End" ? Math.min(cells.length - 1, rowStart + cols - 1)
            : key === "ArrowLeft" ? Math.max(0, index - 1) : key === "ArrowRight" ? Math.min(cells.length - 1, index + 1)
                : key === "ArrowUp" ? Math.max(0, index - cols) : Math.min(cells.length - 1, index + cols);
        const targetCell = cells[next];
        selectCalCell(targetCell);
        requestAnimationFrame(() => (document.querySelector(`[data-cal-day="${targetCell.key}"]`) as HTMLButtonElement | undefined)?.focus());
    }

    function selectCalCell(c: CalCell) {
        selected = c.key;
        if (mode === "month" && !c.inMonth) {
            const cellDate = keyToDate(c.key);
            viewYear = cellDate.getFullYear();
            viewMonth = cellDate.getMonth();
        }
    }

    async function exportCalendarIcs() {
        if (typeof document === "undefined") return;
        const visibleKeys = new Set(cells.map((c) => c.key));
        const matched = items.filter((r) => visibleKeys.has(r.dueDate) || (mode === "month" && r.dueDate.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`)));
        if (matched.length === 0) {
            showMessage(t("hub.icsEmpty"), 3000, "info");
            return;
        }
        try {
            const { buildIcs } = await import("@/core/ics");
            const events = matched.map((r: Reminder) => ({
                uid: `${r.id}@lvhome.local`,
                date: r.dueDate,
                summary: r.title,
                description: r.moduleId === "adhoc" ? t("adhoc.name") : (t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId),
            }));
            const label = mode === "month" ? `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}` : weekLabel.replace(/\s+/g, "");
            const ics = buildIcs(`${t("cal.title")} · ${headLabel}`, events);
            const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lvhome-schedule-${label}.ics`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 0);
            showMessage(t("cal.icsExportDone").replace("${n}", String(matched.length)), 3000, "info");
        } catch (e) {
            showMessage(t("hub.icsFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }
</script>

<div class="lv-cal">
    <div class="lv-cal-head">
        <b>{headLabel}</b>
        <span class="fn__flex-1"></span>
        <button type="button" class="b3-button b3-button--outline lv-cal-export-btn" title={t("cal.exportIcs")} aria-label={t("cal.exportIcs")} onclick={exportCalendarIcs}>
            <UiIcon name="calendar" size={13} /> {t("cal.exportIcs")}
        </button>
        <span class="lv-tabs" role="group" aria-label={t("cal.title")}>
            <button type="button" class="lv-tabs__item" class:on={mode === "month"}
                aria-pressed={mode === "month"} onclick={() => setMode("month")}>{t("view.month")}</button>
            <button type="button" class="lv-tabs__item" class:on={mode === "week"}
                aria-pressed={mode === "week"} onclick={() => setMode("week")}>{t("view.week")}</button>
        </span>
        <button type="button" class="lv-iconbtn" aria-label={t("cal.prev")} title={t("cal.prev")} onclick={() => nav(-1)}><UiIcon name="back" size={16} /></button>
        <button type="button" class="b3-button b3-button--outline lv-cal-today-btn" onclick={goToday}>{t("cal.today")}</button>
        <button type="button" class="lv-iconbtn" aria-label={t("cal.next")} title={t("cal.next")} onclick={() => nav(1)}><UiIcon name="forward" size={16} /></button>
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
                    <button type="button" class="lv-cal-cell" class:out={mode === "month" && !c.inMonth} class:sel={c.key === selected} class:is-drag-over={dragOverCellKey === c.key}
                        data-cal-day={c.key} role="gridcell" aria-selected={c.key === selected}
                        aria-label={`${c.key}, ${dayReminders.length} ${t("cal.itemsUnit")}${c.key === todayKey ? `, ${t("cal.today")}` : ""}${mode === "month" && !c.inMonth ? `, ${t("cal.otherMonth")}` : ""}`}
                        tabindex={c.key === selected ? 0 : -1} onkeydown={(e) => moveDayFocus(e, weekIndex * 7 + dayIndex)}
                        ondragover={(e) => handleCellDragOver(e, c.key)}
                        ondragleave={() => handleCellDragLeave(c.key)}
                        ondrop={(e) => handleCellDrop(e, c.key)}
                        onclick={() => selectCalCell(c)}>
                        <span class="d" class:today={c.key === todayKey} class:has-overdue={hasOverdue}>{c.day}</span>
                        <span class="dots">
                            {#each dayReminders.slice(0, 5) as r (r.id)}
                                <i class={dotCls(r)} title={r.title}></i>
                            {/each}
                            {#if dayReminders.length > 5}<i class="more" title={`${dayReminders.length - 5} more`}><UiIcon name="add" size={9} /></i>{/if}
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
                <button type="button" class="b3-button b3-button--text lv-tx-accent lv-cal-copy-btn" onclick={(e) => copyDayTasks(e)}>
                    <UiIcon name="note" size={13} /> {t("hub.batchCopyTasks")}
                </button>
            {/if}
        </div>
        {#if dayItems.length === 0}
            <div class="lv-caption lv-cal-empty-tip">{t("cal.emptyDay")}</div>
        {:else}
            <div class="lv-cal-items">
                {#each dayItems as r (r.id)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="lv-cal-item" role="listitem" draggable={!isGuest} class:is-dragging={draggingReminderId === r.id}
                        ondragstart={(e) => handleDragStart(e, r)} ondragend={handleDragEnd}
                        title={!isGuest ? t("cal.dragDropTip") : undefined}>
                        <span class="lv-rem-ic" aria-hidden="true"><UiIcon name={moduleUiIcon(r.moduleId)} size={18} /></span>
                        {#if onLocate && r.moduleId !== "adhoc"}
                            <div class="lv-cal-item-t is-link"
                                role="button"
                                tabindex="0"
                                title={t("act.locate")}
                                onclick={() => onLocate?.(r)}
                                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLocate?.(r); } }}>
                                <b>
                                    {#if isPinnedFn?.(r)}<span class="lv-tx-accent lv-cal-pin-mark"><UiIcon name="bookmark" size={12} /></span>{/if}
                                    {r.title}
                                </b>
                                <span class="lv-caption">{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId}</span>
                            </div>
                        {:else}
                            <div class="lv-cal-item-t">
                                <b>
                                    {#if isPinnedFn?.(r)}<span class="lv-tx-accent lv-cal-pin-mark"><UiIcon name="bookmark" size={12} /></span>{/if}
                                    {r.title}
                                </b>
                                <span class="lv-caption">{t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId}</span>
                            </div>
                        {/if}
                        <span class="lv-badge {r.level === "overdue" ? "red" : r.level === "soon" ? "orange" : "yellow"}">{r.level === "overdue" ? t("level.overdue") : r.level === "soon" ? t("level.soon") : t("level.lead")}</span>
                        <button type="button" class="b3-button b3-button--text" title={t("hub.copyTaskBlock")} aria-label={t("hub.copyTaskBlock")} onclick={(e) => copySingleTask(r, e)}><UiIcon name="note" size={13} /></button>
                        {#if onTogglePin}
                            <button type="button" class="b3-button b3-button--text" title={isPinnedFn?.(r) ? t("act.unpin") : t("act.pin")} aria-label={isPinnedFn?.(r) ? t("act.unpin") : t("act.pin")} onclick={() => onTogglePin?.(r)}><UiIcon name="bookmark" size={12} /> {isPinnedFn?.(r) ? t("act.unpin") : t("act.pin")}</button>
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
            <input bind:this={memoInput} type="text" class="b3-text-field fn__flex-1"
                placeholder={isGuest ? t("guest.writeBlocked") : t("cal.memoPlaceholder")}
                aria-label={t("cal.memoPlaceholder")}
                disabled={savingMemo || isGuest}
                bind:value={memoTitle}
                onkeydown={(e: KeyboardEvent) => e.key === "Enter" && !e.isComposing && void addMemoForDay()} />
            <button type="button" class="lv-btn primary sm" disabled={savingMemo || isGuest || !memoTitle.trim()} aria-busy={savingMemo} onclick={addMemoForDay}>
                {#if !savingMemo}<UiIcon name="add" size={12} /> {/if}{savingMemo ? t("ledger.saving") : t("memo.add")}
            </button>
        </div>
    </div>
</div>
