/**
 * 台账详情抽屉动态编辑表单控件生成器（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { optLabel } from "./format";

export interface FormFieldInputBinding {
    keyID: string;
    colKey: string;
    type: string;
    label: string;
    get: () => any;
}

export interface RenderEditableFormFieldsOptions {
    container: HTMLElement;
    schemaCols: any[];
    columns: Record<string, string>;
    rowCells: Record<string, any>;
    t: (k: string) => string;
    rawFromValueFn: (type: string, cell: any) => any;
    onPickContact?: (callback: (picked: string) => void) => void;
    hasContactsBridge?: boolean;
}

export function renderEditableFormFields(options: RenderEditableFormFieldsOptions): FormFieldInputBinding[] {
    if (typeof document === "undefined") return [];
    const { container, schemaCols, columns, rowCells, t, rawFromValueFn, onPickContact, hasContactsBridge } = options;
    const EDITABLE = new Set(["text", "number", "date", "checkbox", "select", "url"]);
    const inputs: FormFieldInputBinding[] = [];

    const labelSpan = (col: any) => {
        const s = document.createElement("span");
        s.className = "ft__on-surface lv-label-key";
        s.textContent = t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.name || col.key;
        return s;
    };

    const colLabel = (col: any) => (t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.name || col.key);

    for (const col of schemaCols) {
        const keyID = columns[col.key];
        if (!keyID || !EDITABLE.has(col.type)) continue;

        const wrap = document.createElement("div");
        wrap.className = "fn__flex lv-detail-kv-line";
        wrap.style.alignItems = "center";
        wrap.append(labelSpan(col));

        const cur = rawFromValueFn(col.type, rowCells[keyID]);
        let control: HTMLInputElement | HTMLSelectElement;

        if (col.type === "select") {
            const sel = document.createElement("select");
            sel.className = "b3-select fn__flex-1";
            sel.add(new Option("", ""));
            for (const opt of col.options ?? []) {
                sel.add(new Option(optLabel(t, col.key, opt), String(opt)));
            }
            sel.value = String(cur ?? "");
            control = sel;
        } else {
            const input = document.createElement("input");
            input.className = "b3-text-field fn__flex-1";
            input.type = col.type === "number" ? "number" : col.type === "date" ? "date" : col.type === "url" ? "url" : "text";
            input.value = String(cur ?? "");
            if (col.type === "checkbox") {
                input.type = "checkbox";
                input.checked = !!cur;
                input.className = "b3-switch";
            }
            control = input;
        }

        control.setAttribute("aria-label", colLabel(col));
        wrap.append(control);

        if (col.key === "contact" && control instanceof HTMLInputElement && hasContactsBridge && onPickContact) {
            const pick = document.createElement("button");
            pick.type = "button";
            pick.className = "b3-button b3-button--outline lv-btn-text-sm";
            pick.textContent = t("ledger.pickContact");
            pick.onclick = () => onPickContact((picked) => { control.value = picked; });
            wrap.append(pick);
        }

        container.appendChild(wrap);
        inputs.push({
            keyID,
            colKey: col.key,
            type: col.type,
            label: colLabel(col),
            get: () => (control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value),
        });
    }

    return inputs;
}
