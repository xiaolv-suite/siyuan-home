const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * 台账详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：证件换证链 (Certs Renew Chain)、人情转人脉 (Favors to Contacts)、购物转资产 (Shopping to Asset)
 */

import { setCell } from "./siyuan";
import { bindDialogA11y } from "./dialog-a11y";
import { saveRuntime } from "./hub/runtime";
import { blockDeepLink, generateQRDataUrl } from "./qr";
import { localDateKey } from "./hub/rule";
import type { LogKind } from "./rowlog";
import { markActivityLine, rowLogActivityId, type ActivityTarget } from "./activity";
import { uiIcon } from "@/ui/icons";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export * from "./drawer-conversions";

export interface RenewChainSectionOptions {
    body: HTMLElement;
    row: any;
    rows: any[];
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any) => string;
    onChainUpdated?: (targetRowId: string) => Promise<void>;
}

export function renderRenewChainSection(options: RenewChainSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, rows, ref, active, t, DialogCls, showMessageFn, cellTextFn, onChainUpdated } = options;
    if (active !== "certs" || !ref.columns) return;
    const relKey = ref.columns.renewed_to;
    if (!relKey) return;

    const nameOf = (id: string) => {
        const r = rows.find((x) => x.itemID === id);
        return r ? String(cellTextFn(r.cells[ref.columns!.name])) : "?";
    };

    const forward = (row.cells[relKey]?.relation?.blockIDs ?? []) as string[];
    const backward = rows.filter((r) => ((r.cells[relKey]?.relation?.blockIDs ?? []) as string[]).includes(row.itemID));

    const linkBtn = () => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "b3-button b3-button--outline lv-att-upload-btn";
        btn.textContent = t("ledger.linkNew");
        btn.onclick = () => {
            const picker = new DialogCls({
                title: t("ledger.pickNew"),
                content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-pick-body"></div>`,
                width: "420px",
            });
            bindDialogA11y({ dlg: picker });
            const list = picker.element.querySelector("#lv-pick-body") as HTMLElement;
            for (const r of rows) {
                if (r.itemID === row.itemID) continue;
                const b = document.createElement("button");
                b.type = "button";
                b.className = "b3-button b3-button--text fn__block fn__text-left";
                const exp = ref.columns!.expiry ? cellTextFn(r.cells[ref.columns!.expiry]) : "";
                b.textContent = `${String(cellTextFn(r.cells[ref.columns!.name]))}${exp && exp !== "—" ? ` · ${exp}` : ""}`;
                b.onclick = async () => {
                    b.disabled = true;
                    try {
                        await setCell(ref.avId!, relKey, row.itemID, { type: "relation", relation: { blockIDs: [r.itemID], contents: null } }, {
                            idempotencyKey: `ledger:renew-link:${row.itemID}:${r.itemID}`,
                            retries: 1,
                        });
                        picker.destroy();
                        showMessageFn(t("ledger.linked").replace("${name}", String(cellTextFn(r.cells[ref.columns!.name]))), 2500, "info");
                        if (onChainUpdated) await onChainUpdated(row.itemID);
                    } catch (e) {
                        showMessageFn(t("ledger.renewLinkFailed").replace("${msg}", errMsg(e)), 6000, "error");
                        b.disabled = false;
                    }
                };
                list.appendChild(b);
            }
            if (!list.children.length) list.innerHTML = `<div class="ft__on-surface fn__text-center">${t("ledger.noOtherRows")}</div>`;
        };
        return btn;
    };

    if (forward.length === 0 && backward.length === 0) {
        body.appendChild(linkBtn());
        return;
    }

    const head = document.createElement("div");
    head.className = "ft__on-surface lv-dialog-sec-head";
    head.textContent = t("ledger.renewChain");
    body.appendChild(head);

    for (const id of forward) {
        const line = document.createElement("div");
        line.className = "lv-dialog-row-text";
        line.innerHTML = `${uiIcon("forward", "", 12)} <span>${esc(nameOf(id))} (${t("ledger.newCert")})</span>`;
        body.appendChild(line);
    }
    for (const r of backward) {
        const line = document.createElement("div");
        line.className = "lv-dialog-row-text";
        line.innerHTML = `${uiIcon("back", "", 12)} <span>${esc(String(cellTextFn(r.cells[ref.columns!.name])))} (${t("ledger.oldCert")})</span>`;
        body.appendChild(line);
    }
    body.appendChild(linkBtn());
}

export interface FavorsSyncSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    selectContentFn: (cell: any) => string | undefined;
    rawDateFn: (cell: any) => string;
}

export function renderFavorsSyncSection(options: FavorsSyncSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, showMessageFn, selectContentFn, rawDateFn } = options;
    if (active !== "favors" || !ref.columns?.person) return;
    const personName = (row.cells[ref.columns.person]?.text?.content ?? "").trim();
    if (!personName) return;

    const synced = plugin.runtime?.favorSyncs?.[row.itemID];
    const head = document.createElement("div");
    head.className = "ft__on-surface lv-dialog-sec-head";
    head.textContent = t("ec15.title");
    body.appendChild(head);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "b3-button b3-button--outline lv-att-upload-btn";
    btn.textContent = synced ? t("ec15.again") : t("ec15.record");

    btn.onclick = async () => {
        const w = (typeof window !== "undefined" ? window : {}) as Record<string, unknown>;
        const bridge = (w.LvContacts || w.xiaolvContacts || w.siyuanContacts || w.lvContacts) as {
            ensurePerson: (name: string) => Promise<{ docId: string; name: string; created: boolean }>;
            recordInteraction: (ids: readonly string[], meta?: { ref?: string; date?: string; note?: string }) => Promise<{ recorded: number }>;
        } | undefined;

        if (!bridge?.ensurePerson || !bridge.recordInteraction) {
            showMessageFn(t("ledger.contactsMissing"), 5000, "info");
            return;
        }

        btn.disabled = true;
        try {
            const person = await bridge.ensurePerson(personName);
            const dateVal = ref.columns!.date ? rawDateFn(row.cells[ref.columns!.date]) : "";
            const dir = selectContentFn(row.cells[ref.columns!.direction ?? ""]) ?? "";
            const amount = row.cells[ref.columns!.amount ?? ""]?.number;
            const noteParts = [
                dir === "in" ? t("ec15.received") : dir === "out" ? t("ec15.given") : "",
                typeof amount?.content === "number" && amount.isNotEmpty ? String(amount.content) : "",
            ].filter(Boolean);

            const result = await bridge.recordInteraction([person.docId], {
                ref: `favor:${row.itemID}`,
                date: dateVal || undefined,
                note: noteParts.join(" "),
            });

            plugin.runtime.favorSyncs = {
                ...(plugin.runtime.favorSyncs ?? {}),
                [row.itemID]: { docId: person.docId, at: new Date().toISOString() },
            };
            await saveRuntime(plugin, plugin.runtime);
            showMessageFn(t("ec15.done").replace("${n}", person.name).replace("${r}", String(result.recorded)), 3000, "info");
            btn.disabled = false;
        } catch (e) {
            showMessageFn(t("ec15.failed").replace("${msg}", errMsg(e)), 6000, "error");
            btn.disabled = false;
        }
    };

    if (synced) {
        const tag = document.createElement("span");
        tag.className = "lv-caption lv-tx-accent lv-ml-8";
        tag.style.fontWeight = "normal";
        tag.textContent = t("ec15.synced");
        head.appendChild(tag);
    }

    body.appendChild(btn);
}

export interface RenderRowLogSectionOptions {
    body: HTMLElement;
    row: any;
    active: string;
    activityTarget?: ActivityTarget;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    title: string;
    emptyText: string;
    addLabel: string;
    kind?: LogKind;
    fields: { key: string; type: "date" | "number" | "text"; placeholder: string; width: number }[];
    load: () => Promise<Record<string, any>[]>;
    add: (vals: Record<string, string>) => Promise<boolean>;
    remove: (entry: Record<string, any>) => Promise<void>;
    format: (entry: Record<string, any>) => string;
}

export async function renderRowLogSection(options: RenderRowLogSectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, active, activityTarget, t, showMessageFn, title, emptyText, addLabel, kind, fields, load, add, remove, format } = options;

    const section = document.createElement("div");
    let loaded: Record<string, any>[] = [];
    let loadFailed = false;

    const render = () => {
        section.replaceChildren();
        for (const e of loaded) {
            const line = document.createElement("div");
            line.className = "lv-dialog-row lv-dialog-row-text";
            line.style.gap = "6px";
            if (kind) {
                line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, kind, e);
                if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);
            }
            const text = document.createElement("span");
            text.innerHTML = format(e);
            const del = document.createElement("button");
            del.type = "button";
            del.className = "b3-button b3-button--text lv-btn-text-sm";
            del.textContent = t("delete");
            del.onclick = async () => {
                del.disabled = true;
                try {
                    await remove(e);
                } catch (err) {
                    showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", errMsg(err)), 5000, "error");
                    del.disabled = false;
                    return;
                }
                loaded = loaded.filter((item) => item !== e);
                loadFailed = false;
                render();
                try {
                    loaded = await load();
                    render();
                } catch (err) {
                    loadFailed = true;
                    render();
                    showMessageFn(t("ledger.logReadFailed").replace("${msg}", errMsg(err)), 5000, "error");
                }
            };
            line.append(text, del);
            section.appendChild(line);
        }
        if (loadFailed) {
            const error = document.createElement("div");
            error.className = "ft__on-surface lv-tx-danger";
            error.textContent = t("ledger.logReadFailed");
            section.appendChild(error);
        } else if (loaded.length === 0) {
            const none = document.createElement("div");
            none.className = "ft__on-surface lv-caption";
            none.textContent = emptyText;
            section.appendChild(none);
        }
    };

    const head = document.createElement("div");
    head.className = "ft__on-surface lv-dialog-sec-head";
    head.textContent = title;
    body.appendChild(head);
    body.appendChild(section);

    const form = document.createElement("div");
    form.className = "lv-dialog-form-row";
    const inputs: Record<string, HTMLInputElement> = {};
    for (const f of fields) {
        const inp = document.createElement("input");
        inp.type = f.type;
        inp.className = "b3-text-field lv-select-sm";
        inp.placeholder = f.placeholder;
        inp.style.width = `${f.width}px`;
        if (f.type === "date") inp.value = localDateKey(new Date());
        inp.onkeydown = (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault();
                addBtn.click();
            }
        };
        inputs[f.key] = inp;
        form.appendChild(inp);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "b3-button b3-button--outline lv-btn-text-sm";
    addBtn.textContent = addLabel;
    addBtn.onclick = async () => {
        if (addBtn.disabled) return;
        const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
        if (!vals.date) {
            showMessageFn(t("ledger.logInvalid"), 3000, "error");
            return;
        }
        addBtn.disabled = true;
        try {
            if (await add(vals)) {
                for (const i of Object.values(inputs)) i.value = "";
                loadFailed = false;
                try {
                    loaded = await load();
                } catch (err) {
                    loadFailed = true;
                    showMessageFn(t("ledger.logReadFailed").replace("${msg}", errMsg(err)), 5000, "error");
                }
                render();
            }
        } catch (err) {
            showMessageFn(t("ledger.logSaveFailed").replace("${msg}", errMsg(err)), 5000, "error");
        } finally {
            addBtn.disabled = false;
        }
    };
    form.appendChild(addBtn);
    body.appendChild(form);
    try {
        loaded = await load();
    } catch (err) {
        loadFailed = true;
        showMessageFn(t("ledger.logReadFailed").replace("${msg}", errMsg(err)), 5000, "error");
    }
    render();
}

export interface RenderDrawerQrSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    active: string;
    t: (k: string) => string;
}

export function renderDrawerQrSection(options: RenderDrawerQrSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, t } = options;
    const nameKey = ref.columns?.name;
    const nameVal = nameKey ? row.cells?.[nameKey] : undefined;
    const blockId = nameVal?.type === "block" ? nameVal.block?.id : undefined;
    const link = blockDeepLink(blockId || ref.docId || "");
    const wrap = document.createElement("div");
    wrap.className = active === "vehicles" ? "lv-qr-wrap lv-detail-wide" : "lv-qr-wrap";
    const head = document.createElement("p");
    head.className = "ft__on-surface lv-caption";
    head.style.margin = "0 0 6px";
    head.textContent = t("ledger.qrTitle");
    const rowEl = document.createElement("div");
    rowEl.className = "lv-dialog-row__left";
    const img = document.createElement("img");
    img.alt = "QR";
    img.className = "lv-qr-img";
    const hint = document.createElement("span");
    hint.className = "lv-caption fn__flex-1";
    hint.textContent = t("ledger.qrHint");
    rowEl.append(img, hint);
    wrap.append(head, rowEl);
    body.appendChild(wrap);
    generateQRDataUrl(link, 128).then((url) => { img.src = url; }).catch(() => { wrap.remove(); });
}

