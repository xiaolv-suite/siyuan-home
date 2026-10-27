/**
 * 台账行内编辑微控件与状态流转（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { setCell } from "./siyuan";
import { cellValue } from "./avcell";
import { optLabel } from "./format";

export interface InlineEditOptions {
    col: any;
    keyID: string;
    line: HTMLElement;
    valueEl: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    t: (k: string) => string;
    rawFromValueFn: (type: string, cell: any) => any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    hasContactsBridge?: boolean;
    onPickContact?: (callback: (picked: string) => void) => void;
    onSaveSuccess?: () => Promise<void>;
}

export function beginInlineEdit(options: InlineEditOptions): void {
    if (typeof document === "undefined") return;
    const { col, keyID, line, valueEl, row, ref, t, rawFromValueFn, showMessageFn, hasContactsBridge, onPickContact, onSaveSuccess } = options;
    const EDITABLE = new Set(["text", "number", "date", "checkbox", "select", "url"]);
    if (!EDITABLE.has(col.type) || line.dataset.lvEditing === "true") return;

    valueEl.setAttribute("aria-hidden", "true");
    line.dataset.lvEditing = "true";
    const originalChildren = Array.from(line.children);
    const current = rawFromValueFn(col.type, row.cells[keyID]);

    const editor = document.createElement("div");
    editor.className = "lv-inline-editor";
    editor.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;flex-wrap:wrap";

    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const longText = col.type === "text" && /(^|_)(note|memo|description|remark|address)($|_)/i.test(String(col.key));

    if (col.type === "select") {
        const select = document.createElement("select");
        select.className = "b3-select";
        select.style.cssText = "flex:1;min-width:140px";
        select.add(new Option("", ""));
        for (const opt of col.options ?? []) select.add(new Option(optLabel(t, col.key, opt), String(opt)));
        select.value = String(current ?? "");
        control = select;
    } else if (longText) {
        const area = document.createElement("textarea");
        area.className = "b3-text-field";
        area.rows = 2;
        area.style.cssText = "flex:1;min-width:160px;resize:vertical";
        area.value = String(current ?? "");
        control = area;
    } else {
        const input = document.createElement("input");
        input.className = col.type === "checkbox" ? "b3-switch" : "b3-text-field";
        input.type = col.type === "checkbox" ? "checkbox" : col.type === "number" ? "number" : col.type === "date" ? "date" : col.type === "url" ? "url" : "text";
        if (col.type === "checkbox") input.checked = !!current;
        else input.value = String(current ?? "");
        if (col.type === "number") input.step = "any";
        input.style.cssText = col.type === "checkbox" ? "flex:0 0 auto" : "flex:1;min-width:140px";
        control = input;
    }

    const actions = document.createElement("span");
    actions.style.cssText = "display:inline-flex;gap:3px;flex:0 0 auto";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "b3-button b3-button--text";
    save.style.cssText = "padding:2px 6px;font-size:12px;color:var(--lv-accent)";
    save.textContent = t("save");

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "b3-button b3-button--text";
    cancel.style.cssText = "padding:3px 6px;font-size:12px";
    cancel.textContent = t("cancel");
    actions.append(save, cancel);
    editor.append(control);

    if (col.key === "contact" && control instanceof HTMLInputElement && hasContactsBridge && onPickContact) {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "b3-button b3-button--outline";
        pick.style.cssText = "padding:3px 6px;font-size:12px";
        pick.textContent = t("ledger.pickContact");
        pick.onclick = () => onPickContact((picked) => { control.value = picked; });
        editor.append(pick);
    }
    editor.append(actions);

    const colName = t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.name || col.key;
    control.setAttribute("aria-label", colName);
    line.replaceChildren(...[originalChildren[0], editor]);

    const restore = () => {
        line.replaceChildren(...originalChildren);
        delete line.dataset.lvEditing;
        valueEl.removeAttribute("aria-hidden");
    };

    cancel.onclick = restore;

    const inlineValue = (ctrl: any) => {
        if (ctrl instanceof HTMLInputElement && ctrl.type === "checkbox") return ctrl.checked;
        return ctrl.value;
    };

    const saveInline = async () => {
        if (save.disabled) return;
        const value = inlineValue(control);
        if (col.type === "number" && value !== "" && !Number.isFinite(Number(value))) {
            showMessageFn(t("ledger.logInvalid"), 3000, "error");
            control.focus();
            return;
        }
        const original = rawFromValueFn(col.type, row.cells[keyID]);
        const same = col.type === "checkbox" ? value === original : String(value) === String(original);
        if (same) { restore(); return; }

        save.disabled = true;
        cancel.disabled = true;
        control.disabled = true;
        try {
            const nextCell = cellValue(col.type, value);
            await setCell(ref.avId!, keyID, row.itemID, nextCell, {
                idempotencyKey: `ledger:inline:${row.itemID}:${keyID}:${Date.now()}`,
                retries: 1,
            });
            row.cells[keyID] = nextCell;
            showMessageFn(t("ledger.editSaved"), 2500, "info");
            if (onSaveSuccess) await onSaveSuccess();
        } catch (error) {
            save.disabled = false;
            cancel.disabled = false;
            control.disabled = false;
            showMessageFn(t("ledger.saveFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 6000, "error");
        }
    };

    save.onclick = () => { void saveInline(); };
    control.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape") { event.preventDefault(); restore(); }
        else if (event.key === "Enter" && (!(control instanceof HTMLTextAreaElement) || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void saveInline();
        }
    });

    requestAnimationFrame(() => control.focus());
}
