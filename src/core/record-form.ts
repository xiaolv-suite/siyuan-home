/**
 * 台账详情抽屉动态编辑表单控件生成器（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { optLabel } from "./format";
import { normalizeSelectValue } from "./avcell";
import { GENERIC_FORM_COLUMN_TYPES } from "./field-capability-matrix";

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

function parseMSelectTokens(raw: unknown): string[] {
    const arr = Array.isArray(raw)
        ? raw
        : typeof raw === "string" && raw.trim()
            ? raw.split(/[,，、;；]+/)
            : [];
    return Array.from(new Set(arr.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export function renderEditableFormFields(options: RenderEditableFormFieldsOptions): FormFieldInputBinding[] {
    if (typeof document === "undefined") return [];
    const { container, schemaCols, columns, rowCells, t, rawFromValueFn, onPickContact, hasContactsBridge } = options;
    const EDITABLE = GENERIC_FORM_COLUMN_TYPES;
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
        wrap.style.alignItems = col.type === "mSelect" ? "flex-start" : "center";
        wrap.append(labelSpan(col));

        const cur = rawFromValueFn(col.type, rowCells[keyID]);

        if (col.type === "mSelect") {
            const selected = new Set<string>(parseMSelectTokens(cur));
            const mSelectHost = document.createElement("div");
            mSelectHost.className = "fn__flex-1 lv-mselect-editor";
            mSelectHost.setAttribute("role", "group");
            mSelectHost.setAttribute("aria-label", colLabel(col));

            if (Array.isArray(col.options) && col.options.length > 0) {
                const chipsWrap = document.createElement("div");
                chipsWrap.className = "lv-chips-wrap";
                for (const opt of col.options) {
                    const chipLabel = document.createElement("label");
                    chipLabel.className = "lv-record-check";
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.value = String(opt);
                    cb.checked = selected.has(String(opt));
                    cb.onchange = () => {
                        if (cb.checked) selected.add(String(opt));
                        else selected.delete(String(opt));
                    };
                    chipLabel.append(cb, document.createTextNode(optLabel(t, col.key, String(opt))));
                    chipsWrap.appendChild(chipLabel);
                }
                mSelectHost.appendChild(chipsWrap);
                wrap.appendChild(mSelectHost);
                container.appendChild(wrap);
                inputs.push({
                    keyID,
                    colKey: col.key,
                    type: col.type,
                    label: colLabel(col),
                    get: () => Array.from(selected),
                });
                continue;
            }

            const chipsWrap = document.createElement("div");
            chipsWrap.className = "lv-chips-wrap";
            const input = document.createElement("input");
            input.type = "text";
            input.className = "b3-text-field fn__block";
            input.placeholder = "输入标签后回车或用逗号分隔";
            input.setAttribute("aria-label", colLabel(col));

            const renderChips = () => {
                chipsWrap.innerHTML = "";
                for (const tag of selected) {
                    const chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "lv-preset-tag";
                    chip.textContent = `${optLabel(t, col.key, tag)} ×`;
                    chip.title = tag;
                    chip.onclick = () => {
                        selected.delete(tag);
                        renderChips();
                    };
                    chipsWrap.appendChild(chip);
                }
            };
            const commitTokens = () => {
                const tokens = parseMSelectTokens(input.value);
                if (tokens.length > 0) {
                    for (const tok of tokens) selected.add(tok);
                    input.value = "";
                    renderChips();
                }
            };
            input.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    commitTokens();
                }
            });
            input.addEventListener("blur", commitTokens);
            renderChips();
            mSelectHost.append(chipsWrap, input);
            wrap.appendChild(mSelectHost);
            container.appendChild(wrap);
            inputs.push({
                keyID,
                colKey: col.key,
                type: col.type,
                label: colLabel(col),
                get: () => Array.from(new Set([...selected, ...parseMSelectTokens(input.value)])),
            });
            continue;
        }

        let control: HTMLInputElement | HTMLSelectElement;

        if (col.type === "select") {
            const sel = document.createElement("select");
            sel.className = "b3-select fn__flex-1";
            sel.add(new Option("", ""));
            for (const opt of col.options ?? []) {
                sel.add(new Option(optLabel(t, col.key, opt), String(opt)));
            }
            const rawStr = String(cur ?? "").trim();
            const normalizedCur = rawStr
                ? (normalizeSelectValue(rawStr, col, {
                    fallbackToDefault: col.default !== undefined,
                    labelOf: (opt) => optLabel(t, col.key, opt),
                }) ?? rawStr)
                : "";
            if (normalizedCur && !(col.options ?? []).includes(normalizedCur)) {
                sel.add(new Option(normalizedCur, normalizedCur));
            }
            sel.value = normalizedCur;
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
