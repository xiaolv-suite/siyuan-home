/**
 * 提醒中枢业务弹窗与动作分发中枢（解耦抽取自 reminders.svelte，促进大文件瘦身）
 * 包含：排期规划、命名视图保存/删除、续期对话框、备忘编辑、延后菜单
 */

import type { Reminder } from "@/types";
import { localDateKey } from "./hub/rule";
import {
    saveRuntime,
    setReminderPlanDate,
    clearReminderPlanDate,
    saveNamedView,
    removeNamedView,
    type ReminderNamedView,
} from "./hub/runtime";
import { confirm } from "@/libs/dialog";

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
    const planDates = plugin.runtime?.reminderPlanDates || {};
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
        content: `<div class="b3-dialog__content" style="padding:16px;display:flex;flex-direction:column;gap:12px">
            <p class="lv-caption" style="margin:0">${t("hub.planScheduleIntro")}</p>
            <div style="font-size:12px;color:var(--lv-tx-2)">
                <b>${r.title}</b> · ${t("hub.summaryDue")}: ${r.dueDate}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
                <button class="b3-button b3-button--outline" id="lv-plan-preset-today" style="font-size:12px;padding:3px 8px">${t("hub.planPresetToday")}</button>
                <button class="b3-button b3-button--outline" id="lv-plan-preset-tomorrow" style="font-size:12px;padding:3px 8px">${t("hub.planPresetTomorrow")}</button>
                <button class="b3-button b3-button--outline" id="lv-plan-preset-nextmon" style="font-size:12px;padding:3px 8px">${t("hub.planPresetNextWeek")}</button>
            </div>
            <label style="display:flex;flex-direction:column;gap:6px">
                <span style="font-size:12px;color:var(--lv-tx-2)">${t("hub.planDateLabel")}</span>
                <input class="b3-text-field" id="lv-plan-date-input" type="date" value="${currentPlan || todayKey}" style="width:100%" />
            </label>
        </div>
        <div class="b3-dialog__action">
            ${currentPlan ? `<button class="b3-button b3-button--text ft__error" id="lv-plan-clear" style="color:var(--lv-danger)">${t("hub.clearPlanDate")}</button>` : ""}
            <span class="fn__flex-1"></span>
            <button class="b3-button b3-button--cancel" id="lv-plan-cancel">${t("cancel")}</button>
            <button class="b3-button" id="lv-plan-save">${t("save")}</button>
        </div>`,
        width: "420px",
    });

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
                showMessageFn(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
        content: `<div class="b3-dialog__content" style="padding:16px;display:flex;flex-direction:column;gap:12px">
            <p class="lv-caption" style="margin:0">${t("hub.saveViewIntro")}</p>
            <input class="b3-text-field" id="lv-named-view-input" placeholder="${t("hub.saveViewPlaceholder")}" style="width:100%" />
        </div>
        <div class="b3-dialog__action">
            <button class="b3-button b3-button--cancel" id="lv-named-view-cancel">${t("cancel")}</button>
            <button class="b3-button" id="lv-named-view-save">${t("save")}</button>
        </div>`,
        width: "400px",
    });
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
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
            showMessageFn(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
            err.textContent = t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
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
    const dlg = new DialogCls({ title: t("memo.edit"), content: `<div id="lv-memoedit" style="display:flex;flex-direction:column;gap:10px"></div>`, width: "460px" });
    const box = dlg.element.querySelector("#lv-memoedit") as HTMLElement;
    const rowFlexCenterCss = "display:flex;align-items:center;gap:8px";
    const row1 = document.createElement("div");
    row1.style.cssText = rowFlexCenterCss;
    const l1 = document.createElement("span"); l1.className = "ft__on-surface"; l1.style.minWidth = "72px"; l1.textContent = t("triage.name");
    const titleInput = document.createElement("input"); titleInput.className = "b3-text-field"; titleInput.style.flex = "1"; titleInput.value = r.title;
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save.click(); });
    row1.append(l1, titleInput);
    const row2 = document.createElement("div");
    row2.style.cssText = rowFlexCenterCss;
    const l2 = document.createElement("span"); l2.className = "ft__on-surface"; l2.style.minWidth = "72px"; l2.textContent = t("triage.due");
    const dateInput = document.createElement("input"); dateInput.className = "b3-text-field"; dateInput.type = "date"; dateInput.value = r.dueDate;
    dateInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save.click(); });
    row2.append(l2, dateInput);
    const save = document.createElement("button"); save.className = "b3-button"; save.textContent = t("save");
    const err = document.createElement("span"); err.className = "lv-caption"; err.setAttribute("role", "alert"); err.style.color = "var(--lv-danger)";
    let saving = false;
    save.addEventListener("click", async () => {
        if (saving) return;
        const title = titleInput.value.trim();
        if (!title) { err.textContent = t("ledger.nameRequired"); titleInput.focus(); return; }
        if (!dateInput.value) { err.textContent = t("form.required"); dateInput.focus(); return; }
        saving = true;
        save.disabled = true;
        try {
            await plugin.updateMemo(r.id, { title, dueDate: dateInput.value });
            dlg.destroy();
            if (onMemoUpdated) await onMemoUpdated();
        } catch (e) {
            err.textContent = t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
            save.disabled = false;
            saving = false;
        }
    });
    const cancel = document.createElement("button"); cancel.className = "b3-button b3-button--cancel"; cancel.textContent = t("cancel");
    cancel.addEventListener("click", () => dlg.destroy());
    const action = document.createElement("div"); action.className = "b3-dialog__action"; action.append(err, cancel, save);
    box.append(row1, row2, action);
    requestAnimationFrame(() => titleInput.focus());
}

export interface OpenSnoozeMenuOptions {
    r: Reminder;
    ev: MouseEvent;
    MenuCls: any;
    t: (k: string) => string;
    onSnooze: (days: number) => Promise<void>;
}

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
        for (const d of [1, 3, 7, 30]) {
            menu.addItem({
                label: t("act.snoozeN").replace("${n}", String(d)),
                click: () => { void onSnooze(d); },
            });
        }
        menu.open({ x, y });
    }, 0);
}

export interface OpenTriageToLedgerDialogOptions {
    r: Reminder;
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
}

export function openTriageToLedgerDialog(options: OpenTriageToLedgerDialogOptions): void {
    if (typeof document === "undefined") return;
    const { r, plugin, DialogCls, t, showMessageFn } = options;
    const targets = (plugin.settings.enabledModules ?? [])
        .filter((id: string) => id !== "adhoc" && id !== "members")
        .map((id: string) => ({ id, ref: plugin.settings.dbRefs[id] }));
    if (!targets.length) { showMessageFn(t("triage.noTarget"), 3500, "error"); return; }
    const modLabel = (id: string) => (t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id);
    const needProvision = (id: string) => !plugin.settings.dbRefs[id]?.avId;
    const dlg = new DialogCls({ title: t("triage.title"), content: `<div id="lv-triage" style="display:flex;flex-direction:column;gap:10px"></div>`, width: "460px" });
    const box = dlg.element.querySelector("#lv-triage") as HTMLElement;
    const rowFlexCenterCss = "display:flex;gap:8px;align-items:center";

    const row1 = document.createElement("div");
    row1.style.cssText = rowFlexCenterCss;
    const l1 = document.createElement("span"); l1.className = "ft__on-surface"; l1.style.minWidth = "72px"; l1.textContent = t("triage.module");
    const sel = document.createElement("select"); sel.className = "b3-select"; sel.style.flex = "1";
    for (const x of targets) {
        const o = document.createElement("option"); o.value = x.id;
        o.textContent = modLabel(x.id) + (needProvision(x.id) ? t("triage.needProvision") : "");
        sel.append(o);
    }
    row1.append(l1, sel);

    const rowM = document.createElement("div");
    rowM.style.cssText = rowFlexCenterCss;
    const lM = document.createElement("span"); lM.className = "ft__on-surface"; lM.style.minWidth = "72px"; lM.textContent = t("field.member");
    const memberSel = document.createElement("select"); memberSel.className = "b3-select"; memberSel.style.flex = "1";
    const none = document.createElement("option"); none.value = ""; none.textContent = t("members.unassigned");
    memberSel.append(none);
    for (const m of plugin.settings.members ?? []) {
        const o = document.createElement("option");
        o.value = m.avItemId ?? "";
        o.disabled = !m.avItemId;
        o.textContent = `${m.name}${m.avItemId ? "" : ` · ${t("members.notLinked")}`}`;
        memberSel.append(o);
    }
    rowM.append(lM, memberSel);

    const row2 = document.createElement("div");
    row2.style.cssText = rowFlexCenterCss;
    const l2 = document.createElement("span"); l2.className = "ft__on-surface"; l2.style.minWidth = "72px"; l2.textContent = t("triage.name");
    const nameInput = document.createElement("input"); nameInput.className = "b3-text-field"; nameInput.style.flex = "1"; nameInput.value = r.title;
    row2.append(l2, nameInput);

    const row3 = document.createElement("div");
    row3.style.cssText = rowFlexCenterCss;
    const l3 = document.createElement("span"); l3.className = "ft__on-surface"; l3.style.minWidth = "72px"; l3.textContent = t("triage.due");
    const dateInput = document.createElement("input"); dateInput.className = "b3-text-field"; dateInput.type = "date"; dateInput.value = r.dueDate;
    row3.append(l3, dateInput);

    const ok = document.createElement("button"); ok.className = "b3-button"; ok.textContent = t("triage.create");
    const err = document.createElement("span"); err.className = "lv-caption"; err.setAttribute("role", "alert"); err.style.color = "var(--lv-danger)";

    let operationKey = (() => {
        try { return `triage:${crypto.randomUUID()}`; }
        catch { return `triage:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    })();
    let pendingRowId: string | undefined;
    let pendingModuleId: string | undefined;
    let identityPending = false;

    const doCreate = async () => {
        const title = nameInput.value.trim();
        if (!title) { err.textContent = t("ledger.nameRequired"); nameInput.focus(); return; }
        const mod = sel.value;
        if (pendingRowId && pendingModuleId !== mod) {
            err.textContent = t("triage.pendingTarget");
            return;
        }
        let ref = plugin.settings.dbRefs[mod];
        if (!ref?.avId) {
            ok.textContent = t("triage.provisioning");
            const { provisionModule } = await import("./provisioner");
            await provisionModule(plugin.settings, mod, plugin.schemaCatalog?.[mod], t(`module.${mod}`), { resolveName: (key: string) => String(plugin.i18n[`field.${key}`] ?? key) });
            try {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
            } catch { /* soft */ }
            ref = plugin.settings.dbRefs[mod];
            if (!ref?.avId) { showMessageFn(t("triage.noTarget"), 3000, "error"); return; }
        }
        const selectedMember = memberSel.value;
        if (selectedMember && !(plugin.settings.members ?? []).some((m: any) => m.avItemId === selectedMember)) {
            err.textContent = t("members.notLinked");
            memberSel.focus();
            return;
        }
        let itemID = pendingRowId;
        if (!itemID) {
            try {
                const { addDetachedRow } = await import("./siyuan");
                itemID = await addDetachedRow(ref.avId, title, { idempotencyKey: `${operationKey}:row`, retries: 1 });
                pendingRowId = itemID;
                pendingModuleId = mod;
            } catch (e) {
                operationKey = `triage:${Date.now()}`;
                const { RowIdentityPendingError } = await import("./siyuan");
                if (e instanceof RowIdentityPendingError) {
                    identityPending = true;
                    ok.disabled = false;
                    err.textContent = t("triage.identityPending");
                    return;
                }
                throw e;
            }
        }
        const setCellSafe = async (key: string, value: unknown) => {
            const keyID = ref.columns?.[key];
            if (!keyID) return;
            for (let attempt = 0; ; attempt++) {
                try {
                    const { setCell } = await import("./siyuan");
                    await setCell(ref.avId, keyID, itemID, value, {
                        idempotencyKey: `${operationKey}:cell:${keyID}`,
                        retries: 1,
                    });
                    return;
                }
                catch (e) {
                    if (attempt >= 2) throw e;
                    await new Promise((r2) => setTimeout(r2, 400));
                }
            }
        };
        await setCellSafe("name", { type: "text", text: { content: title } });
        const schemaCols = plugin.schemaCatalog?.[mod]?.columns ?? [];
        const ruleFields = (plugin.schemaCatalog?.[mod]?.reminders ?? []).map((x: any) => x.field);
        const dateCol = schemaCols.find((c: any) => c.type === "date" && ruleFields.includes(c.key))
            ?? schemaCols.find((c: any) => c.type === "date");
        if (dateCol && r.dueDate) await setCellSafe(dateCol.key, { type: "date", date: { content: new Date(`${r.dueDate}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } });
        if (selectedMember) await setCellSafe("member", { type: "relation", relation: { blockIDs: [selectedMember], contents: null } });
        await plugin.complete(r);
        dlg.destroy();
        showMessageFn(t("triage.done").replace("${mod}", modLabel(mod)), 4000, "info");
        try { await plugin.refreshHub(undefined, true); }
        catch (e) {
            console.warn("[LvHome] triage saved but refresh failed:", e);
            showMessageFn(t("triage.refreshFailed"), 5000, "error");
        }
    };

    ok.addEventListener("click", () => {
        if (identityPending) return;
        ok.disabled = true;
        doCreate().catch((e) => {
            err.textContent = t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
        }).finally(() => { if (!identityPending) ok.disabled = false; });
    });
    box.append(row1, rowM, row2, row3, err, ok);
    nameInput.focus();
}

export interface OpenReminderDigestDialogOptions {
    filtered: Reminder[];
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
}

export async function openReminderDigestDialog(options: OpenReminderDigestDialogOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { filtered, plugin, DialogCls, t, showMessageFn } = options;
    try {
        const { buildReminderDigest, formatDigestMarkdown } = await import("./reminder-digest");
        const input = filtered.map((r) => ({
            id: r.id,
            moduleId: r.moduleId,
            title: r.title,
            dueDate: r.dueDate,
            daysLeft: r.daysLeft,
            level: r.level,
        }));
        const history = plugin.runtime?.digestHistory;
        const digest = buildReminderDigest(input, {
            periodLabel: t("hub.digestThisWeek"),
            previousOverdue: typeof history?.overdue === "number" ? history.overdue : null,
        });
        const markdown = formatDigestMarkdown(digest, (id) => t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id);

        const dlg = new DialogCls({
            title: t("hub.digestTitle"),
            content: `<div class="b3-dialog__content lv-dialog-scroll-body"><pre class="lv-caption" style="white-space:pre-wrap;line-height:1.7;margin:0"></pre></div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("close")}</button>
  <button class="b3-button" id="lv-digest-copy">${t("hub.digestCopy")}</button>
</div>`,
            width: "600px",
        });

        const pre = dlg.element.querySelector("pre");
        if (pre) pre.textContent = markdown;
        const cancelBtn = dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement | null;
        if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();
        const copyBtn = dlg.element.querySelector("#lv-digest-copy") as HTMLButtonElement | null;
        if (copyBtn) {
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(markdown);
                    showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
                } catch {
                    showMessageFn(t("hub.digestCopyFailed"), 4000, "error");
                }
            };
        }

        // 记录本次快照，供下期生成对比差值
        if (!plugin.runtime) plugin.runtime = {};
        plugin.runtime.digestHistory = { overdue: digest.counts.overdue, at: digest.generatedAt };
        await saveRuntime(plugin, plugin.runtime);
    } catch (e) {
        showMessageFn(t("hub.digestFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}

const HIGH_CONSEQUENCE_MODULES = new Set([
    "health", "parenting", "certs", "insurance", "assets-real", "assets-virtual", "contracts", "medicine", "schooling"
]);

export interface ExportReminderIcsOptions {
    list: Reminder[];
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    confirmFn: (title: string, body: string, onConfirm: () => void) => void;
}

/** 提醒中枢日历 ICS 导出（含敏感模块二次确认） */
export async function exportReminderIcs(options: ExportReminderIcsOptions): Promise<void> {
    const { list, t, showMessageFn, confirmFn } = options;
    if (list.length === 0) {
        showMessageFn(t("hub.icsEmpty"), 3000, "error");
        return;
    }
    const download = async () => {
        if (typeof document === "undefined") return;
        try {
            const { buildIcs } = await import("./ics");
            const events = list.map((r: Reminder) => ({
                uid: `${r.id}@lvhome.local`,
                date: r.dueDate,
                summary: r.title,
                description: r.moduleId === "adhoc" ? t("adhoc.name") : (t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId),
            }));
            const ics = buildIcs(t("hub.title"), events);
            const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lvhome-reminders-${new Date().toISOString().slice(0, 10)}.ics`;
            a.click();
            URL.revokeObjectURL(a.href);
            showMessageFn(t("hub.icsDone").replace("${n}", String(list.length)), 3000, "info");
        } catch (e) {
            showMessageFn(t("hub.icsFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    };
    if (list.some((r: Reminder) => HIGH_CONSEQUENCE_MODULES.has(r.moduleId))) {
        confirmFn(t("hub.icsTitle"), t("hub.icsBody").replace("${n}", String(list.length)), () => { void download(); });
        return;
    }
    await download();
}


