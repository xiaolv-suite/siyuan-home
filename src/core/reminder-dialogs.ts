/**
 * 提醒中枢业务弹窗与动作分发中枢（解耦抽取自 reminders.svelte，促进大文件瘦身）
 * 包含：排期规划、命名视图保存/删除、续期对话框、备忘编辑、延后菜单
 */

import { escapeHtml } from "./modal-shell";
import { bindDialogA11y } from "./dialog-a11y";
import type { Reminder } from "@/types";
import { localDateKey } from "./hub/rule";
import { parseQuickAdd } from "./quick-add";
import {
    saveRuntime,
    setReminderPlanDate,
    clearReminderPlanDate,
    saveNamedView,
    removeNamedView,
    type ReminderNamedView,
} from "./hub/runtime";
import { confirm } from "@/libs/dialog";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface OpenReminderPlanDialogOptions {
    r: Reminder;
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    onPlanUpdated?: () => Promise<void>;
}

export function openReminderPlanDialog(options: OpenReminderPlanDialogOptions): void {
    if (typeof document === "undefined") return;
    const { r, plugin, DialogCls, t, showMessageFn, onPlanUpdated } = options;
    const planDates = plugin.runtime?.planDates || {};
    const currentPlan = planDates[r.id] || "";
    const todayKey = localDateKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = localDateKey(tomorrow);

    const nextMon = new Date();
    const dayOfWeek = nextMon.getDay();
    const daysUntilMon = ((1 + 7 - dayOfWeek) % 7) || 7;
    nextMon.setDate(nextMon.getDate() + daysUntilMon);
    const nextMonKey = localDateKey(nextMon);

    const dlg = new DialogCls({
        title: t("hub.planScheduleTitle"),
        content: `<div class="b3-dialog__content lv-dialog-col">
            <p class="lv-caption">${t("hub.planScheduleIntro")}</p>
            <div class="lv-caption ft__on-surface">
                <b>${escapeHtml(r.title)}</b> · ${t("hub.summaryDue")}: ${escapeHtml(r.dueDate)}
            </div>
            <div class="lv-chips-wrap">
                <button class="b3-button b3-button--outline lv-preset-tag" id="lv-plan-preset-today">${t("hub.planPresetToday")}</button>
                <button class="b3-button b3-button--outline lv-preset-tag" id="lv-plan-preset-tomorrow">${t("hub.planPresetTomorrow")}</button>
                <button class="b3-button b3-button--outline lv-preset-tag" id="lv-plan-preset-nextmon">${t("hub.planPresetNextWeek")}</button>
            </div>
            <label class="lv-form-group">
                <span class="lv-caption ft__on-surface">${t("hub.planDateLabel")}</span>
                <input class="b3-text-field" id="lv-plan-date-input" type="date" value="${currentPlan || todayKey}" />
            </label>
        </div>
        <div class="b3-dialog__action">
            ${currentPlan ? `<button class="b3-button b3-button--text ft__error lv-tx-danger" id="lv-plan-clear">${t("hub.clearPlanDate")}</button>` : ""}
            <span class="fn__flex-1"></span>
            <button class="b3-button b3-button--cancel" id="lv-plan-cancel">${t("cancel")}</button>
            <button class="b3-button" id="lv-plan-save">${t("save")}</button>
        </div>`,
        width: "420px",
    });

    bindDialogA11y({ dlg, defaultFocus: "#lv-plan-date-input" });
    const dateInput = dlg.element.querySelector("#lv-plan-date-input") as HTMLInputElement;
    const setDate = (val: string) => { if (dateInput) dateInput.value = val; };
    if (dateInput) {
        dateInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.isComposing) (dlg.element.querySelector("#lv-plan-save") as HTMLButtonElement)?.click();
        });
    }

    (dlg.element.querySelector("#lv-plan-preset-today") as HTMLButtonElement).onclick = () => setDate(todayKey);
    (dlg.element.querySelector("#lv-plan-preset-tomorrow") as HTMLButtonElement).onclick = () => setDate(tomorrowKey);
    (dlg.element.querySelector("#lv-plan-preset-nextmon") as HTMLButtonElement).onclick = () => setDate(nextMonKey);

    const clearBtn = dlg.element.querySelector("#lv-plan-clear") as HTMLButtonElement | null;
    if (clearBtn) {
        clearBtn.onclick = async () => {
            dlg.destroy();
            clearReminderPlanDate(plugin.runtime, r.id);
            try {
                await saveRuntime(plugin, plugin.runtime);
                showMessageFn(t("hub.planDateCleared"), 2500, "info");
                if (onPlanUpdated) await onPlanUpdated();
                await plugin.refreshHub?.(undefined, true);
            } catch (e) {
                showMessageFn(t("hub.filterSaveFailed").replace("${msg}", errMsg(e)), 5000, "error");
            }
        };
    }

    (dlg.element.querySelector("#lv-plan-cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    (dlg.element.querySelector("#lv-plan-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
        const chosenDate = dateInput?.value.trim();
        if (!chosenDate) {
            showMessageFn(t("hub.planScheduleIntro"), 3000, "error");
            return;
        }
        this.disabled = true;
        dlg.destroy();
        setReminderPlanDate(plugin.runtime, r.id, chosenDate);
        try {
            await saveRuntime(plugin, plugin.runtime);
            showMessageFn(t("hub.planDateSaved"), 2500, "info");
            if (onPlanUpdated) await onPlanUpdated();
            await plugin.refreshHub?.(undefined, true);
        } catch (e) {
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", errMsg(e)), 5000, "error");
        }
    };
}

export interface OpenNamedViewSaveDialogOptions {
    plugin: any;
    currentFilter: {
        filter: string;
        filterMember?: string;
        filterModule?: string;
        dueWithin: string;
    };
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    onViewSaved?: (viewId: string) => Promise<void>;
}

export function openNamedViewSaveDialog(options: OpenNamedViewSaveDialogOptions): void {
    if (typeof document === "undefined") return;
    const { plugin, currentFilter, DialogCls, t, showMessageFn, onViewSaved } = options;
    const dlg = new DialogCls({
        title: t("hub.saveViewTitle"),
        content: `<div class="b3-dialog__content lv-dialog-col">
            <p class="lv-caption">${t("hub.saveViewIntro")}</p>
            <input class="b3-text-field fn__block" id="lv-named-view-input" placeholder="${t("hub.saveViewPlaceholder")}" />
        </div>
        <div class="b3-dialog__action">
            <button class="b3-button b3-button--cancel" id="lv-named-view-cancel">${t("cancel")}</button>
            <button class="b3-button" id="lv-named-view-save">${t("save")}</button>
        </div>`,
        width: "400px",
    });
    bindDialogA11y({ dlg, defaultFocus: "#lv-named-view-input" });
    const input = dlg.element.querySelector("#lv-named-view-input") as HTMLInputElement;
    if (input) {
        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.isComposing) (dlg.element.querySelector("#lv-named-view-save") as HTMLButtonElement)?.click();
        });
    }
    requestAnimationFrame(() => input?.focus());
    (dlg.element.querySelector("#lv-named-view-cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    (dlg.element.querySelector("#lv-named-view-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
        const nameVal = input?.value.trim();
        if (!nameVal) {
            showMessageFn(t("hub.saveViewEmptyName"), 3000, "error");
            return;
        }
        this.disabled = true;
        dlg.destroy();
        const saved = saveNamedView(plugin.runtime, {
            name: nameVal,
            filter: currentFilter.filter as any,
            memberId: currentFilter.filterMember,
            moduleId: currentFilter.filterModule,
            dueWithin: currentFilter.dueWithin as any,
        });
        try {
            await saveRuntime(plugin, plugin.runtime);
            showMessageFn(t("hub.namedViewSaved"), 2500, "info");
            if (onViewSaved) await onViewSaved(saved.id);
        } catch (e) {
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", errMsg(e)), 5000, "error");
        }
    };
}

export interface OpenNamedViewDeleteConfirmOptions {
    v: ReminderNamedView;
    plugin: any;
    activeNamedViewId?: string;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    onViewDeleted?: (id: string) => Promise<void>;
}

export function openNamedViewDeleteConfirm(options: OpenNamedViewDeleteConfirmOptions): void {
    const { v, plugin, t, showMessageFn, onViewDeleted } = options;
    confirm(t("hub.deleteViewTitle"), t("hub.deleteViewBody").replace("${name}", v.name), async () => {
        removeNamedView(plugin.runtime, v.id);
        try {
            await saveRuntime(plugin, plugin.runtime);
            showMessageFn(t("hub.namedViewDeleted"), 2500, "info");
            if (onViewDeleted) await onViewDeleted(v.id);
        } catch (e) {
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", errMsg(e)), 5000, "error");
        }
    });
}

export interface OpenReminderRenewDialogOptions {
    r: Reminder;
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    onRenewSuccess?: () => Promise<void>;
}

export function openReminderRenewDialog(options: OpenReminderRenewDialogOptions): void {
    if (typeof document === "undefined") return;
    const { r, plugin, DialogCls, t, onRenewSuccess } = options;
    const dlg = new DialogCls({
        title: t("act.renew"),
        content: `<div class="b3-dialog__content"><div class="b3-dialog__content" id="lv-renew-sub" style="margin-bottom:8px"></div><input class="b3-text-field fn__block" id="lv-renew-date" type="date"><div class="lv-caption" id="lv-renew-err" role="alert" style="color:var(--b3-card-error-color);display:none"></div></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-renew-cancel">${t("cancel")}</button><button class="b3-button" id="lv-renew-ok">${t("save")}</button></div>`,
        width: "380px",
    });
    const dateInput = dlg.element.querySelector("#lv-renew-date") as HTMLInputElement;
    dateInput.value = r.dueDate;
    const sub = dlg.element.querySelector("#lv-renew-sub") as HTMLElement;
    sub.textContent = r.title;
    dateInput?.focus();
    bindDialogA11y({ dlg, defaultFocus: "#lv-renew-date" });
    dlg.element.querySelector("#lv-renew-cancel")?.addEventListener("click", () => dlg.destroy());
    dlg.element.querySelector("#lv-renew-ok")?.addEventListener("click", async () => {
        const v = dateInput?.value;
        const err = dlg.element.querySelector("#lv-renew-err") as HTMLElement;
        if (!v) {
            err.textContent = t("form.required");
            err.style.display = "block";
            dateInput?.focus();
            return;
        }
        const okBtn = dlg.element.querySelector("#lv-renew-ok") as HTMLButtonElement;
        try {
            okBtn.disabled = true;
            await plugin.renew(r, v);
            dlg.destroy();
            if (onRenewSuccess) await onRenewSuccess();
        } catch (e) {
            err.textContent = t("ledger.saveFailed").replace("${msg}", errMsg(e));
            err.style.display = "block";
            okBtn.disabled = false;
        }
    });
}

export interface OpenMemoEditDialogOptions {
    r: Reminder;
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    onMemoUpdated?: () => Promise<void>;
}

export function openMemoEditDialog(options: OpenMemoEditDialogOptions): void {
    if (typeof document === "undefined") return;
    const { r, plugin, DialogCls, t, onMemoUpdated } = options;
    const dlg = new DialogCls({ title: t("memo.edit"), content: `<div id="lv-memoedit" class="lv-dialog-col"></div>`, width: "460px" });
    const box = dlg.element.querySelector("#lv-memoedit") as HTMLElement;
    const row1 = document.createElement("label");
    row1.className = "lv-row-field";
    const l1 = document.createElement("span"); l1.className = "ft__on-surface"; l1.textContent = t("triage.name");
    const titleInput = document.createElement("input"); titleInput.className = "b3-text-field"; titleInput.value = r.title;
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save.click(); });
    row1.append(l1, titleInput);
    const row2 = document.createElement("label");
    row2.className = "lv-row-field";
    const l2 = document.createElement("span"); l2.className = "ft__on-surface"; l2.textContent = t("triage.due");
    const dateInput = document.createElement("input"); dateInput.className = "b3-text-field"; dateInput.type = "date"; dateInput.value = r.dueDate;
    dateInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save.click(); });
    row2.append(l2, dateInput);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "b3-button";
    save.textContent = t("save");
    const err = document.createElement("span"); err.className = "lv-caption lv-tx-danger"; err.setAttribute("role", "alert");
    let saving = false;
    save.addEventListener("click", async () => {
        if (saving) return;
        const rawTitle = titleInput.value.trim();
        if (!rawTitle) { err.textContent = t("ledger.nameRequired"); titleInput.focus(); return; }
        if (!dateInput.value) { err.textContent = t("form.required"); dateInput.focus(); return; }
        const parsed = parseQuickAdd(rawTitle);
        const title = parsed.cleanTitle || rawTitle;
        const dueDate = (dateInput.value === r.dueDate && parsed.dueDate) ? parsed.dueDate : dateInput.value;
        saving = true;
        save.disabled = true;
        try {
            await plugin.updateMemo(r.id, {
                title,
                dueDate,
                ...(parsed.priority ? { priority: parsed.priority } : {}),
                ...(parsed.category ? { category: parsed.category } : {}),
                ...(parsed.cycle ? { cycle: parsed.cycle, recurrenceAnchor: parsed.recurrenceAnchor ?? "due" } : {}),
            });
            dlg.destroy();
            if (onMemoUpdated) await onMemoUpdated();
        } catch (e) {
            err.textContent = t("ledger.saveFailed").replace("${msg}", errMsg(e));
            save.disabled = false;
            saving = false;
        }
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "b3-button b3-button--cancel";
    cancel.textContent = t("cancel");
    cancel.addEventListener("click", () => dlg.destroy());
    const action = document.createElement("div"); action.className = "b3-dialog__action"; action.append(err, cancel, save);
    box.append(row1, row2, action);
    bindDialogA11y({ dlg, defaultFocus: titleInput });
    requestAnimationFrame(() => titleInput.focus());
}

export interface OpenSnoozeMenuOptions {
    r: Reminder;
    ev: MouseEvent;
    MenuCls: any;
    t: (k: string) => string;
    onSnooze: (days: number) => Promise<void>;
}

import { getSnoozePresets } from "./snooze-presets";

export function openSnoozeMenu(options: OpenSnoozeMenuOptions): void {
    if (typeof window === "undefined") return;
    const { ev, MenuCls, t, onSnooze } = options;
    const target = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : undefined;
    const rect = target?.getBoundingClientRect();
    const rawX = ev.detail > 0 ? ev.clientX : rect?.right ?? 0;
    const rawY = ev.detail > 0 ? ev.clientY : rect?.bottom ?? 0;
    const x = Math.max(8, Math.min(rawX, window.innerWidth - 8));
    const y = Math.max(8, Math.min(rawY, window.innerHeight - 8));
    setTimeout(() => {
        const menu = new MenuCls("lv-snooze");
        // 1. 一键梯度推迟预设（Tasks.org 标杆规格：推迟1天、推迟至周末、推迟至下周一）
        const presets = getSnoozePresets(new Date());
        for (const p of presets) {
            menu.addItem({
                label: t(p.labelKey),
                click: () => { void onSnooze(p.days); },
            });
        }
        // 2. 传统通用时间窗（7天、30天）
        for (const d of [7, 30]) {
            menu.addItem({
                label: t("act.snoozeN").replace("${n}", String(d)),
                click: () => { void onSnooze(d); },
            });
        }
        menu.open({ x, y });
    }, 0);
}

export * from "./triage-to-ledger";
export * from "./reminder-exporter";


