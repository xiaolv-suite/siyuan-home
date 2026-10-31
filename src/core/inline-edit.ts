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
    const { col, keyID, line, valueEl, row, ref, active, t, rawFromValueFn, showMessageFn, hasContactsBridge, onPickContact, onSaveSuccess } = options;
    const EDITABLE = new Set(["text", "number", "date", "checkbox", "select", "url"]);
    if (!EDITABLE.has(col.type) || line.dataset.lvEditing === "true") return;

    valueEl.setAttribute("aria-hidden", "true");
    line.dataset.lvEditing = "true";
    const originalChildren = Array.from(line.children);
    const current = rawFromValueFn(col.type, row.cells[keyID]);

    const editor = document.createElement("div");
    editor.className = "lv-inline-editor";

    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const longText = col.type === "text" && /(^|_)(note|memo|description|remark|address)($|_)/i.test(String(col.key));

    if (col.type === "select") {
        const select = document.createElement("select");
        select.className = "b3-select lv-inline-input";
        select.add(new Option("", ""));
        for (const opt of col.options ?? []) select.add(new Option(optLabel(t, col.key, opt), String(opt)));
        select.value = String(current ?? "");
        control = select;
    } else if (longText) {
        const area = document.createElement("textarea");
        area.className = "b3-text-field lv-inline-textarea";
        area.rows = 2;
        area.value = String(current ?? "");
        control = area;
    } else {
        const input = document.createElement("input");
        input.className = col.type === "checkbox" ? "b3-switch" : "b3-text-field lv-inline-input";
        input.type = col.type === "checkbox" ? "checkbox" : col.type === "number" ? "number" : col.type === "date" ? "date" : col.type === "url" ? "url" : "text";
        if (col.type === "checkbox") input.checked = !!current;
        else input.value = String(current ?? "");
        if (col.type === "number") input.step = "any";
        control = input;
    }

    const actions = document.createElement("span");
    actions.className = "lv-inline-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "b3-button b3-button--text lv-btn-text-sm lv-tx-accent";
    save.textContent = t("save");

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "b3-button b3-button--text lv-btn-text-sm";
    cancel.textContent = t("cancel");
    actions.append(save, cancel);
    editor.append(control);

    if (col.key === "contact" && control instanceof HTMLInputElement && hasContactsBridge && onPickContact) {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "b3-button b3-button--outline lv-btn-text-sm";
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
            let writeKey = keyID;
            try {
                await setCell(ref.avId!, writeKey, row.itemID, nextCell, {
                    idempotencyKey: `ledger:inline:${row.itemID}:${writeKey}:${Date.now()}`,
                    retries: 1,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("key not found")) {
                    const { healColumnMapping } = await import("./provisioner");
                    const healedKey = await healColumnMapping(ref, active, col.key);
                    if (healedKey && healedKey !== writeKey) {
                        writeKey = healedKey;
                        await setCell(ref.avId!, writeKey, row.itemID, nextCell, {
                            idempotencyKey: `ledger:inline:${row.itemID}:${writeKey}:healed:${Date.now()}`,
                            retries: 1,
                        });
                    } else {
                        throw err;
                    }
                } else {
                    throw err;
                }
            }
            row.cells[writeKey] = nextCell;
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

export interface QuickAdjustRowQtyOptions {
    row: any;
    fieldKey: string;
    delta: number;
    ref?: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

const adjustingRowKeys = new Set<string>();

/** 台账列表数量/库存快速 +1 / -1 增量微调 */
export async function quickAdjustRowQty(options: QuickAdjustRowQtyOptions): Promise<number | undefined> {
    const { row, fieldKey, delta, ref, active, plugin, showMessageFn } = options;
    if (plugin?.runtime?.guestModeActive) {
        const msg = plugin?.i18n?.["guest.writeBlocked"] ? String(plugin.i18n["guest.writeBlocked"]) : "访客只读模式运行中，已拦截写入操作";
        showMessageFn(msg, 3500, "info");
        return undefined;
    }
    if (!ref?.avId || !ref.columns?.[fieldKey]) return undefined;
    const lockKey = `${row.itemID}:${fieldKey}`;
    if (adjustingRowKeys.has(lockKey)) return undefined;
    adjustingRowKeys.add(lockKey);
    const colId = ref.columns[fieldKey];
    const cell = row.cells?.[colId];
    let cur = 0;
    if (typeof cell?.number?.content === "number" && !isNaN(cell.number.content)) {
        cur = cell.number.content;
    } else if (cell?.text?.content) {
        const parsed = parseFloat(cell.text.content);
        if (!isNaN(parsed)) cur = parsed;
    }
    const next = Math.max(0, cur + delta);
    try {
        await setCell(ref.avId, colId, row.itemID, { type: "number", number: { content: next } });
        if (!row.cells[colId]) row.cells[colId] = { type: "number", number: {} };
        row.cells[colId].number = { content: next, isNotEmpty: true };
        showMessageFn(`${delta > 0 ? "+1" : "-1"} (${next})`, 1500, "info");
        // 库存变动后轻量触发单模块重扫，自动更新/解除到期与低库存提醒
        void plugin.refreshHub?.(active);
        return next;
    } catch (e) {
        showMessageFn(String(e), 3000, "error");
        return undefined;
    } finally {
        adjustingRowKeys.delete(lockKey);
    }
}

