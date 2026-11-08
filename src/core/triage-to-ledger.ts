/**
 * 提醒中枢收件箱备忘归档与转正式台账（Triage to Ledger）引擎
 * 解耦自 reminder-dialogs.ts，封装模块选择、成员关联、自动建库、原子建行与安全写列
 */

import type { Reminder } from "@/types";
import { bindDialogA11y } from "./dialog-a11y";

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
    const targets = (plugin.settings?.enabledModules ?? [])
        .filter((id: string) => id !== "adhoc" && id !== "members")
        .map((id: string) => ({ id, ref: plugin.settings?.dbRefs?.[id] }));
    if (!targets.length) { showMessageFn(t("triage.noTarget"), 3500, "error"); return; }
    const modLabel = (id: string) => (t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id);
    const needProvision = (id: string) => !plugin.settings?.dbRefs?.[id]?.avId;
    const dlg = new DialogCls({ title: t("triage.title"), content: `<div id="lv-triage" class="lv-dialog-col"></div>`, width: "460px" });
    const box = dlg.element.querySelector("#lv-triage") as HTMLElement;

    const row1 = document.createElement("label");
    row1.className = "lv-row-field";
    const l1 = document.createElement("span"); l1.className = "ft__on-surface"; l1.textContent = t("triage.module");
    const sel = document.createElement("select"); sel.className = "b3-select";
    for (const x of targets) {
        const o = document.createElement("option"); o.value = x.id;
        o.textContent = modLabel(x.id) + (needProvision(x.id) ? t("triage.needProvision") : "");
        sel.append(o);
    }
    row1.append(l1, sel);

    const rowM = document.createElement("label");
    rowM.className = "lv-row-field";
    const lM = document.createElement("span"); lM.className = "ft__on-surface"; lM.textContent = t("field.member");
    const memberSel = document.createElement("select"); memberSel.className = "b3-select";
    const none = document.createElement("option"); none.value = ""; none.textContent = t("members.unassigned");
    memberSel.append(none);
    for (const m of plugin.settings?.members ?? []) {
        const o = document.createElement("option");
        o.value = m.avItemId ?? "";
        o.disabled = !m.avItemId;
        o.textContent = `${m.name}${m.avItemId ? "" : ` · ${t("members.notLinked")}`}`;
        memberSel.append(o);
    }
    rowM.append(lM, memberSel);

    const row2 = document.createElement("label");
    row2.className = "lv-row-field";
    const l2 = document.createElement("span"); l2.className = "ft__on-surface"; l2.textContent = t("triage.name");
    const nameInput = document.createElement("input"); nameInput.className = "b3-text-field"; nameInput.value = r.title;
    row2.append(l2, nameInput);

    const row3 = document.createElement("label");
    row3.className = "lv-row-field";
    const l3 = document.createElement("span"); l3.className = "ft__on-surface"; l3.textContent = t("triage.due");
    const dateInput = document.createElement("input"); dateInput.className = "b3-text-field"; dateInput.type = "date"; dateInput.value = r.dueDate;
    row3.append(l3, dateInput);

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "b3-button";
    ok.textContent = t("triage.create");
    const err = document.createElement("span"); err.className = "lv-caption lv-tx-danger"; err.setAttribute("role", "alert");

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
        let ref = plugin.settings?.dbRefs?.[mod];
        if (!ref?.avId) {
            ok.textContent = t("triage.provisioning");
            const { provisionModule } = await import("./provisioner");
            await provisionModule(plugin.settings, mod, plugin.schemaCatalog?.[mod], t(`module.${mod}`), { resolveName: (key: string) => String(plugin.i18n?.[`field.${key}`] ?? key) });
            try {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
            } catch { /* soft */ }
            ref = plugin.settings?.dbRefs?.[mod];
            if (!ref?.avId) { showMessageFn(t("triage.noTarget"), 3000, "error"); return; }
        }
        const selectedMember = memberSel.value;
        if (selectedMember && !(plugin.settings?.members ?? []).some((m: any) => m.avItemId === selectedMember)) {
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
        const finalDueDate = dateInput?.value?.trim() || r.dueDate;
        if (dateCol && finalDueDate) await setCellSafe(dateCol.key, { type: "date", date: { content: new Date(`${finalDueDate}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } });
        if (selectedMember) await setCellSafe("member", { type: "relation", relation: { blockIDs: [selectedMember], contents: null } });
        await plugin.complete(r);
        dlg.destroy();
        showMessageFn(t("triage.done").replace("${mod}", modLabel(mod)), 4000, "info");
        try { await plugin.refreshHub?.(undefined, true); }
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
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "b3-button b3-button--cancel";
    cancel.textContent = t("cancel");
    cancel.addEventListener("click", () => dlg.destroy());
    const action = document.createElement("div");
    action.className = "b3-dialog__action";
    action.append(cancel, ok);
    box.append(row1, rowM, row2, row3, err, action);
    bindDialogA11y({ dlg, defaultFocus: nameInput });
    nameInput.focus();
}
