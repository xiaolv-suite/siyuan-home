/**
 * 台账行详情抽屉完整驱动引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：行内详情字段展示、敏感脱敏、自定义列、各业务扩展板块、文档模板生成、编辑与删除
 */

import { createVehicleActionQueue, type VehicleQuickAction } from "./vehicle";
import { rowLogActivityId, type ActivityTarget } from "./activity";
import { selectCellContent } from "./avcell";
import { getCertificateProfile } from "./schema";
import { maskCredentialNumber, maskIdNumber, parseIdNumber } from "./idcard";
import { AMOUNT_KEYS, formatAmount } from "./format";
import { localDateKey, parseDate } from "./hub/rule";
import { blockDeepLink, generateQRDataUrl } from "./qr";
import { confirm } from "@/libs/dialog";
import { openContactPicker } from "@/libs/contact-picker";
import type { LogKind } from "./rowlog";
import { setCell } from "./siyuan";
import { saveRuntime } from "./hub/runtime";
import { saveSettings } from "./settings";

export interface OpenLedgerDetailDrawerOptions {
    row: any;
    vehicleAction?: "fuel" | "charging" | "maintenance" | "edit";
    activityTarget?: ActivityTarget;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    avCols?: any[];
    openNewRecordFn: (initialForm?: Record<string, any>) => void;
    onReload: () => Promise<void>;
}

const substRowCss = "padding:2px 0;font-size:12.5px";
const sectionBorderCss = "margin-top:14px;padding-top:10px;border-top:1px solid var(--lv-line)";
const flexBetweenCenterGap8Css = "display:flex;align-items:center;justify-content:space-between;gap:8px";
const sectionHeaderCss = `${flexBetweenCenterGap8Css};margin-bottom:8px`;
const sectionTitleCss = "font-weight:600;font-size:12px";
const lineBadgeCss = "display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line)";
const sectionHeadBorderCss = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px";
const linkBtnCss = "font-size:11.5px;padding:0 4px;color:var(--lv-accent)";
const btnSmCss = "margin-top:8px;font-size:12px";
const boxContentCss = "padding:10px 12px;background:var(--lv-surface-2);border-radius:8px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:6px;font-size:12px";
const wrapBorderCss = "margin-top:12px;padding-top:10px;border-top:1px solid var(--lv-line)";
const actionRowEndCss = "display:flex;align-items:center;justify-content:flex-end;margin-top:2px";
const flexCenterGap6Css = "display:flex;align-items:center;gap:6px";
const flexColGap6Css = "display:flex;flex-direction:column;gap:6px";
const dangerAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-danger-soft);border-radius:6px;border:1px solid var(--lv-danger);color:var(--lv-danger);font-size:12px";
const warnAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line);color:var(--lv-warn);font-size:12px";
const pad06Fs12Css = "padding:0 6px;font-size:12px";
const minW96Shrink0Css = "min-width:96px;flex-shrink:0";
const wordBreakAllCss = "word-break:break-all";
const fs125Css = "font-size:12.5px";
const pad6BorderSurfaceCss = "padding:6px 8px;background:var(--lv-surface);border-radius:6px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:3px";
const fs12Pad38Css = "font-size:12px;padding:3px 8px";

export async function openLedgerDetailDrawer(options: OpenLedgerDetailDrawerOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const {
        row,
        vehicleAction,
        activityTarget,
        ref,
        active,
        plugin,
        t,
        DialogCls,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
        avCols = [],
        openNewRecordFn,
        onReload,
    } = options;

    if (!ref?.columns) return;
    const detailTitle = (ref.columns.name && cellTextFn(row.cells?.[ref.columns.name], "name")) || t("ledger.detail");
    const dlg = new DialogCls({
        title: detailTitle,
        content: `<div class="b3-dialog__content b3-dialog__content--wrap" id="lv-detail-body" style="max-height:60vh;overflow:auto"></div>
<div class="b3-dialog__action lv-detail-actions"><button class="b3-button b3-button--text ft__error" id="lv-detail-del" style="color:var(--lv-danger)">${t("delete")}</button><button class="b3-button b3-button--text" id="lv-detail-duplicate">📋 ${t("ledger.duplicateRow")}</button><span class="fn__flex-1"></span><details class="lv-detail-more"><summary class="b3-button b3-button--outline">${t("ledger.detailMore")}</summary><div class="lv-detail-more-menu"><button class="b3-button b3-button--cancel" id="lv-detail-card-copy">${t("ledger.copyAsImage")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-png">${t("ledger.downloadPng")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-text">${t("ledger.copyAsText")}</button><button class="b3-button b3-button--cancel" id="lv-detail-card-masked-text">${t("ledger.copyAsMaskedText")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-ref">🔗 ${t("ledger.copyBlockRef")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-embed">📑 ${t("ledger.copyBlockEmbed")}</button><button class="b3-button b3-button--cancel" id="lv-detail-copy-task">☑️ ${t("ledger.copyAsTaskBlock")}</button><button class="b3-button b3-button--cancel" id="lv-detail-push-glean">📖 ${t("ledger.pushToGlean")}</button><button class="b3-button b3-button--cancel" id="lv-detail-open">${t("ledger.openDoc")} →</button></div></details><button class="b3-button b3-button--cancel" id="lv-detail-close">${t("close")}</button><button class="b3-button" id="lv-detail-edit">${t("ledger.detailEditAll")}</button></div>`,
        width: "520px",
    });

    const body = dlg.element.querySelector("#lv-detail-body") as HTMLElement;
    const vehicleActionQueue = createVehicleActionQueue();
    const showVehicleActionError = (error: string) =>
        showMessageFn(t("ledger.logReadFailed") + " (" + error + ")", 6000, "error");

    const markActivityLine = (line: HTMLElement) => {
        if (!activityTarget?.activityId) return;
        line.classList.add("lv-activity-target");
        line.setAttribute("aria-current", "location");
        line.tabIndex = -1;
        line.style.cssText += ";border-radius:6px;background:var(--lv-accent-soft);outline:2px solid var(--lv-accent);outline-offset:2px;padding:7px";
        requestAnimationFrame(() => {
            if (!dlg.element.isConnected || !line.isConnected) return;
            line.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            line.focus({ preventScroll: true });
        });
    };

    const requestVehicleAction = (action: VehicleQuickAction, notifyQueued = true) => {
        const result = vehicleActionQueue.request(action);
        if (result.status === "queued" && notifyQueued) showMessageFn(t("vehicle.quickLoading"), 2500, "info");
        else if (result.status === "failed") showVehicleActionError(result.error ?? "");
    };

    body.classList.toggle("lv-detail-body-vehicle", active === "vehicles");
    const rowCategory = active === "certs" ? selectCellContent(row.cells?.[ref.columns.category ?? ""]) : undefined;
    const activeCertFields = active === "certs" ? new Set(getCertificateProfile(rowCategory).fieldKeys) : null;
    const schemaCols: any[] = (plugin.schemaCatalog?.[active]?.columns ?? []).filter((col: any) =>
        active !== "certs" || !String(col.key).startsWith("x_cert_") || activeCertFields?.has(col.key));
    const EDITABLE = new Set(["text", "number", "date", "select", "url", "checkbox"]);
    const colLabel = (col: any) => (t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.key);

    function labelSpan(col: any) {
        const k = document.createElement("span");
        k.className = "ft__on-surface";
        k.style.cssText = minW96Shrink0Css;
        k.textContent = colLabel(col);
        return k;
    }

    function inlineEditHint(): string {
        const translated = t("ledger.inlineEditHint");
        return translated === "ledger.inlineEditHint" ? "点击字段值即可编辑" : translated;
    }

    function rawFromValue(type: string, v: any): any {
        switch (type) {
            case "number": return v?.number?.isNotEmpty && typeof v.number.content === "number" ? v.number.content : "";
            case "date": return v?.date?.isNotEmpty ? localDateKey(new Date(v.date.content)) : "";
            case "checkbox": return !!v?.checkbox?.checked;
            case "select": return selectCellContent(v) ?? "";
            case "url": return v?.url?.content ?? "";
            default: return v?.text?.content ?? "";
        }
    }

    function pickFromContacts(onPicked: (snapshot: string) => void) {
        openContactPicker({
            t: (key, vars) => {
                let out = t(key);
                if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`\${${k}}`, v);
                return out;
            },
            showMessage: (msg, timeout, type) => showMessageFn(msg, timeout, type),
        }, onPicked);
    }

    function beginInlineEdit(col: any, keyID: string, line: HTMLElement, valueEl: HTMLElement) {
        import("./inline-edit").then(({ beginInlineEdit: runInlineEdit }) => {
            runInlineEdit({
                col,
                keyID,
                line,
                valueEl,
                row,
                ref,
                active,
                t,
                rawFromValueFn: rawFromValue,
                showMessageFn,
                hasContactsBridge: true,
                onPickContact: pickFromContacts,
                onSaveSuccess: async () => {
                    await onReload();
                    try { await plugin.refreshHub([active]); } catch { /* soft */ }
                    dlg.destroy();
                    const fresh = (await renderLedgerAllFn(ref.avId!)).rows.find((entry) => entry.itemID === row.itemID);
                    if (fresh) void openLedgerDetailDrawer({ ...options, row: fresh });
                },
            });
        });
    }

    function addHistorySection() {
        const history = (plugin.runtime?.renewHistory?.[row.itemID] ?? []) as { from: string; to: string; at: string }[];
        if (history.length === 0) return;
        const head = document.createElement("div");
        head.className = "ft__on-surface";
        head.style.cssText = sectionHeadBorderCss;
        head.textContent = t("ledger.renewHistory");
        body.appendChild(head);
        for (const h of history) {
            const line = document.createElement("div");
            if (active === "vehicles") line.className = "lv-detail-wide";
            line.style.cssText = substRowCss;
            line.textContent = `${h.from} → ${h.to} · ${h.at.slice(0, 10)}`;
            body.appendChild(line);
        }
    }

    function addAttachmentsSection() {
        const assetCols = schemaCols.filter((col) => col.type === "mAsset" && ref.columns?.[col.key]);
        if (!assetCols.length) return;
        import("./attachment-drawer").then(({ renderAttachmentDrawerSection }) => {
            renderAttachmentDrawerSection({
                body,
                assetCols,
                ref,
                row,
                active,
                t,
                DialogCls,
                showMessageFn,
                onUploadSuccess: async () => {
                    dlg.destroy();
                    await onReload();
                },
            });
        });
    }

    let cardRows: { key?: string; label: string; value: string }[] = [];
    function buildView() {
        body.innerHTML = "";
        cardRows = [];
        const editAction = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement;
        const closeAction = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement;
        editAction.textContent = t("ledger.detailEditAll");
        editAction.onclick = () => buildEdit();
        closeAction.textContent = t("close");
        closeAction.onclick = () => dlg.destroy();
        (dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement).hidden = false;
        const intro = document.createElement("p");
        intro.className = "lv-detail-wide lv-detail-intro";
        intro.textContent = inlineEditHint();
        body.append(intro);
        for (const col of schemaCols) {
            const keyID = ref.columns?.[col.key];
            if (!keyID) continue;
            const line = document.createElement("div");
            line.className = active === "vehicles" ? "fn__flex lv-detail-kv" : "fn__flex";
            line.style.cssText = "gap:10px;padding:7px 0;font-size:13px;min-width:0";
            line.append(labelSpan(col));
            const v = document.createElement("span");
            v.style.cssText = wordBreakAllCss;
            const cell = row.cells[keyID];
            if (AMOUNT_KEYS.has(col.key) && cell?.type === "number" && cell?.number?.isNotEmpty && typeof cell.number.content === "number") {
                v.textContent = formatAmount(cell.number.content);
            } else {
                v.textContent = cellTextFn(cell, col.key);
            }
            if (active === "certs" && ["x_cert_id_number", "holder_no", "x_cert_birth_registration_no_last4", "x_cert_vocational_registration_last4", "x_cert_professional_registration_last4", "x_cert_graduation_no_last4", "x_cert_degree_no_last4"].includes(col.key)) {
                const full = String(rawFromValue("text", cell) ?? "").trim();
                if (full) {
                    const mask = col.key === "x_cert_id_number" ? maskIdNumber(full) : maskCredentialNumber(full);
                    v.textContent = mask;
                    const reveal = document.createElement("button");
                    reveal.className = "b3-button b3-button--text";
                    reveal.style.cssText = pad06Fs12Css;
                    reveal.textContent = t("ledger.idNumberShow");
                    let shown = false;
                    reveal.onclick = () => {
                        shown = !shown;
                        v.textContent = shown ? full : mask;
                        reveal.textContent = shown ? t("ledger.idNumberHide") : t("ledger.idNumberShow");
                    };
                    const copy = document.createElement("button");
                    copy.className = "b3-button b3-button--text";
                    copy.style.cssText = pad06Fs12Css;
                    copy.textContent = t("ledger.idNumberCopy");
                    copy.onclick = async () => {
                        try {
                            await navigator.clipboard.writeText(full);
                            showMessageFn(t("ledger.idNumberCopied"), 2500, "info");
                        } catch {
                            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
                        }
                    };
                    line.append(reveal, copy);
                    const parsedId = col.key === "x_cert_id_number" ? parseIdNumber(full) : null;
                    const memberBid = ref.columns?.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;
                    const member = memberBid ? (plugin.settings.members ?? []).find((m: any) => m.avItemId === memberBid) : undefined;
                    if (parsedId?.ok && parsedId.birth && member && !member.birthday && !member.lunarBirthday) {
                        const birthFill = document.createElement("button");
                        birthFill.className = "b3-button b3-button--text";
                        birthFill.style.cssText = pad06Fs12Css;
                        birthFill.textContent = t("ledger.idBirthFill").replace("${birth}", parsedId.birth);
                        birthFill.onclick = async () => {
                            const target = (plugin.settings.members ?? []).find((m: any) => m.id === member.id);
                            if (!target || target.birthday) return;
                            const previousBirthday = target.birthday;
                            target.birthday = parsedId.birth;
                            try {
                                const { updateMember } = await import("./members");
                                await updateMember(plugin, plugin.settings, target);
                                await plugin.refreshHub(undefined, true);
                                showMessageFn(t("ledger.idBirthFilled").replace("${birth}", parsedId.birth), 3000, "info");
                                birthFill.disabled = true;
                            } catch (e) {
                                target.birthday = previousBirthday;
                                showMessageFn(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
                            }
                        };
                        line.append(birthFill);
                    }
                }
            }
            if (EDITABLE.has(col.type)) {
                if (!v.textContent?.trim() || v.textContent === "—") {
                    v.textContent = t("ledger.detailEmpty");
                    v.classList.add("is-empty");
                }
                v.addEventListener("click", () => beginInlineEdit(col, keyID, line, v));
                v.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        beginInlineEdit(col, keyID, line, v);
                    }
                });
                v.tabIndex = 0;
                v.role = "button";
                v.title = inlineEditHint();
                v.classList.add("lv-detail-value");
                v.setAttribute("aria-label", `${colLabel(col)}：${v.textContent}`);
                v.style.cssText += ";cursor:text;min-height:22px;display:inline-flex;align-items:center;flex:1;min-width:0;border-radius:4px;padding:1px 4px;margin:-1px -4px;transition:background .15s ease";
                v.dataset.lvEditable = "true";
            }
            line.append(v);
            body.appendChild(line);
            cardRows.push({ key: col.key, label: colLabel(col), value: v.classList.contains("is-empty") ? "—" : String(v.textContent) });
        }
        const schemaKeyIDs = new Set(Object.values<string>(ref.columns ?? {}));
        const customCols = avCols.filter((c: any) => c?.id && !schemaKeyIDs.has(c.id) && String(c.name ?? "").trim() !== "");
        if (customCols.length > 0) {
            const head = document.createElement("div");
            head.className = "ft__on-surface";
            head.style.cssText = sectionHeadBorderCss;
            head.textContent = t("ledger.customCols");
            body.appendChild(head);
            for (const c of customCols) {
                const line = document.createElement("div");
                line.className = active === "vehicles" ? "fn__flex lv-detail-wide" : "fn__flex";
                line.style.cssText = "gap:10px;padding:4px 0;font-size:13px";
                const k = document.createElement("span");
                k.className = "ft__on-surface";
                k.style.cssText = minW96Shrink0Css;
                k.textContent = String(c.name);
                line.append(k);
                const v = document.createElement("span");
                v.style.cssText = wordBreakAllCss;
                v.textContent = cellTextFn(row.cells[c.id]);
                if (EDITABLE.has(c.type)) {
                    if (!v.textContent?.trim() || v.textContent === "—") { v.textContent = t("ledger.detailEmpty"); v.classList.add("is-empty"); }
                    v.addEventListener("click", () => beginInlineEdit({ ...c, key: c.id }, c.id, line, v));
                    v.addEventListener("keydown", (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            beginInlineEdit({ ...c, key: c.id }, c.id, line, v);
                        }
                    });
                    v.tabIndex = 0;
                    v.role = "button";
                    v.title = inlineEditHint();
                    v.classList.add("lv-detail-value");
                    v.setAttribute("aria-label", `${c.name}：${v.textContent}`);
                    v.style.cssText += ";cursor:text;min-height:22px;display:inline-flex;align-items:center;flex:1;min-width:0;border-radius:4px;padding:1px 4px;margin:-1px -4px;transition:background .15s ease";
                }
                line.append(v);
                body.appendChild(line);
                cardRows.push({ label: String(c.name), value: cellTextFn(row.cells[c.id]) });
            }
        }
    }

    async function addRowLogSection(opts: {
        title: string;
        emptyText: string;
        addLabel: string;
        kind?: LogKind;
        fields: { key: string; type: "date" | "number" | "text"; placeholder: string; width: number }[];
        load: () => Promise<Record<string, any>[]>;
        add: (vals: Record<string, string>) => Promise<boolean>;
        remove: (entry: Record<string, any>) => Promise<void>;
        format: (entry: Record<string, any>) => string;
    }) {
        const section = document.createElement("div");
        let loaded: Record<string, any>[] = [];
        let loadFailed = false;
        const render = () => {
            section.replaceChildren();
            for (const e of loaded) {
                const line = document.createElement("div");
                line.style.cssText = `${substRowCss};display:flex;gap:6px;align-items:center`;
                if (opts.kind) {
                    line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, opts.kind, e);
                    if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);
                }
                const text = document.createElement("span");
                text.textContent = opts.format(e);
                const del = document.createElement("button");
                del.className = "b3-button b3-button--text";
                del.style.cssText = "padding:0 4px;font-size:12px";
                del.textContent = t("delete");
                del.onclick = async () => {
                    del.disabled = true;
                    try {
                        await opts.remove(e);
                    } catch (err) {
                        showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                        del.disabled = false;
                        return;
                    }
                    loaded = loaded.filter((item) => item !== e);
                    loadFailed = false;
                    render();
                    try {
                        loaded = await opts.load();
                        render();
                    } catch (err) {
                        loadFailed = true;
                        render();
                        showMessageFn(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                    }
                };
                line.append(text, del);
                section.appendChild(line);
            }
            if (loadFailed) {
                const error = document.createElement("div");
                error.className = "ft__on-surface";
                error.style.cssText = "font-size:12.5px;color:var(--lv-danger)";
                error.textContent = t("ledger.logReadFailed");
                section.appendChild(error);
            } else if (loaded.length === 0) {
                const none = document.createElement("div");
                none.className = "ft__on-surface";
                none.style.cssText = fs125Css;
                none.textContent = opts.emptyText;
                section.appendChild(none);
            }
        };
        const head = document.createElement("div");
        head.className = "ft__on-surface";
        head.style.cssText = sectionHeadBorderCss;
        head.textContent = opts.title;
        body.appendChild(head);
        body.appendChild(section);
        const form = document.createElement("div");
        form.style.cssText = `${flexCenterGap6Css};margin-top:6px;flex-wrap:wrap`;
        const inputs: Record<string, HTMLInputElement> = {};
        for (const f of opts.fields) {
            const inp = document.createElement("input");
            inp.type = f.type;
            inp.className = "b3-text-field";
            inp.placeholder = f.placeholder;
            inp.style.cssText = `width:${f.width}px;font-size:12px`;
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
        addBtn.className = "b3-button b3-button--outline";
        addBtn.style.cssText = "font-size:12px";
        addBtn.textContent = opts.addLabel;
        addBtn.onclick = async () => {
            if (addBtn.disabled) return;
            const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
            if (!vals.date) {
                showMessageFn(t("ledger.logInvalid"), 3000, "error");
                return;
            }
            addBtn.disabled = true;
            try {
                if (await opts.add(vals)) {
                    for (const i of Object.values(inputs)) i.value = "";
                    loadFailed = false;
                    try {
                        loaded = await opts.load();
                    } catch (err) {
                        loadFailed = true;
                        showMessageFn(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                    }
                    render();
                }
            } catch (err) {
                showMessageFn(t("ledger.logSaveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
            } finally {
                addBtn.disabled = false;
            }
        };
        form.appendChild(addBtn);
        body.appendChild(form);
        try {
            loaded = await opts.load();
        } catch (err) {
            loadFailed = true;
            showMessageFn(t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
        }
        render();
    }

    addHistorySection();
    addAttachmentsSection();

    function addQrSection() {
        const nameKey = ref.columns?.name;
        const nameVal = nameKey ? row.cells?.[nameKey] : undefined;
        const blockId = nameVal?.type === "block" ? nameVal.block?.id : undefined;
        const link = blockDeepLink(blockId || ref.docId || "");
        const wrap = document.createElement("div");
        if (active === "vehicles") wrap.className = "lv-detail-wide";
        wrap.style.cssText = wrapBorderCss;
        const head = document.createElement("p");
        head.style.cssText = "font-size:12px;margin:0 0 6px;color:var(--lv-tx-2)";
        head.textContent = t("ledger.qrTitle");
        const rowEl = document.createElement("div");
        rowEl.style.cssText = `${flexCenterGap6Css};gap:10px`;
        const img = document.createElement("img");
        img.alt = "QR";
        img.style.cssText = "width:96px;height:96px;border:1px solid var(--lv-line);border-radius:8px;padding:4px;background:#fff;flex-shrink:0";
        const hint = document.createElement("span");
        hint.style.cssText = "font-size:12px;color:var(--lv-tx-2);flex:1";
        hint.textContent = t("ledger.qrHint");
        rowEl.append(img, hint);
        wrap.append(head, rowEl);
        body.appendChild(wrap);
        generateQRDataUrl(link, 128).then((url) => { img.src = url; }).catch(() => { wrap.remove(); });
    }

    addQrSection();

    // 跨模块业务时间线与子记录
    (async () => {
        const rl = await import("./rowlog");
        const at = () => new Date().toISOString();
        const fresh = () => rl.loadRowLogs(plugin);
        if (active === "vehicles") {
            const { renderVehicleDetailSections } = await import("./vehicle-drawer");
            await renderVehicleDetailSections({
                body,
                row,
                ref,
                active,
                plugin,
                t,
                DialogCls,
                showMessageFn,
                cellTextFn,
                selectContentFn: (cell) => selectCellContent(cell),
                rawFromValueFn: rawFromValue,
                activityTarget,
                vehicleActionQueue,
                onLogUpdated: async () => {
                    try { await plugin.refreshHub(["vehicles"], true); } catch { /* soft */ }
                },
            });
        }
        if (active === "assets-real") {
            const costVal = Number(row.cells?.[ref.columns?.amount ?? ""]?.number?.content);
            const dateVal = String(rawFromValue("date", row.cells?.[ref.columns?.date ?? ""]) ?? "").slice(0, 10);
            if (Number.isFinite(costVal) && costVal > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
                const { calculateAssetDepreciation } = await import("./depreciation");
                const dep = calculateAssetDepreciation({ initialCost: costVal, purchaseDate: dateVal });
                if (dep) {
                    const depCard = document.createElement("section");
                    depCard.className = "lv-card";
                    depCard.style.cssText = "margin-top:10px;padding:10px 12px;background:var(--lv-surface-2);border:1px solid var(--lv-line);border-radius:8px";
                    depCard.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                            <b style="font-size:12.5px;color:var(--lv-tx)">📉 资产折旧与法定残值测算</b>
                            <span class="lv-badge" style="font-size:11px">${dep.statusLabel}</span>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;font-size:11.5px;color:var(--lv-tx-2)">
                            <div>购入原值: <b style="color:var(--lv-tx)">¥${formatAmount(dep.initialCost)}</b></div>
                            <div>当前估算净值: <b style="color:var(--lv-accent)">¥${formatAmount(dep.currentNetValue)}</b></div>
                            <div>已服役月数: <b style="color:var(--lv-tx)">${dep.usedMonths} / ${dep.lifespanMonths} 月</b></div>
                            <div>累计计提折旧: <b style="color:var(--lv-danger)">¥${formatAmount(dep.accumulatedDepreciation)}</b></div>
                        </div>
                        <div class="lv-caption" style="margin-top:6px;color:var(--lv-tx-3)">💡 ${dep.suggestion}</div>
                    `;
                    body.appendChild(depCard);
                }
            }
            await addRowLogSection({
                title: t("ledger.valuations"), emptyText: t("ledger.noValuations"), addLabel: t("ledger.valAdd"), kind: "valuations",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "value", type: "number", placeholder: t("ledger.valValue"), width: 100 },
                ],
                load: () => fresh().then((l) => rl.getValuations(l, ref.avId!, row.itemID)),
                add: async (v) => {
                    if (!Number.isFinite(Number(v.value))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendValuation(current, ref.avId!, row.itemID, v.date, Number(v.value), at()));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeValuation(current, ref.avId!, row.itemID, e.date)); },
                format: (e) => `${e.date} · ${e.value}`,
            });
            await addRowLogSection({
                title: t("ledger.moves"), emptyText: t("ledger.noMoves"), addLabel: t("ledger.valAdd"), kind: "moves",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "from", type: "text", placeholder: t("ledger.moveFrom"), width: 90 },
                    { key: "to", type: "text", placeholder: t("ledger.moveTo"), width: 90 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "moves")),
                add: async (v) => {
                    if (!v.from || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "moves", { date: v.date, from: v.from, to: v.to, at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "moves", e)); },
                format: (e) => `${e.date} · ${e.from} → ${e.to}`,
            });
        } else if (active === "shopping") {
            (async () => {
                const targetCell = row.cells[ref.columns?.target_amount ?? ""]?.number;
                const target = targetCell?.isNotEmpty && typeof targetCell.content === "number" ? targetCell.content : undefined;
                const logs = await rl.loadRowLogs(plugin);
                const entries = rl.getEntries<any>(logs, ref.avId!, row.itemID, "deposits");
                const saved = entries.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
                if (target !== undefined || entries.length > 0) {
                    const head = document.createElement("div");
                    head.style.cssText = "margin-top:10px;font-size:12px";
                    const line = document.createElement("div");
                    line.className = "lv-caption";
                    line.textContent = `${t("ledger.savedOf").replace("${s}", formatAmount(saved)).replace("${t2}", target !== undefined ? formatAmount(target) : "—")}${target !== undefined && target > 0 ? ` (${Math.min(999, Math.round((saved / target) * 100))}%)` : ""}`;
                    head.appendChild(line);
                    if (target !== undefined && target > 0) {
                        const bar = document.createElement("div");
                        bar.style.cssText = "height:6px;border-radius:3px;background:var(--lv-surface-2);overflow:hidden;margin-top:4px";
                        const fill = document.createElement("div");
                        fill.style.cssText = `height:100%;width:${Math.min(100, Math.round((saved / target) * 100))}%;background:var(--lv-accent)`;
                        bar.appendChild(fill);
                        head.appendChild(bar);
                    }
                    body.appendChild(head);
                }
            })().catch((e) => {
                showMessageFn(t("ledger.logReadFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
            });
            await addRowLogSection({
                title: t("ledger.deposits"), emptyText: t("ledger.noDeposits"), addLabel: t("ledger.valAdd"), kind: "deposits",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "amount", type: "number", placeholder: t("ledger.depositAmt"), width: 100 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "deposits")),
                add: async (v) => {
                    if (!v.date || !Number.isFinite(Number(v.amount))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "deposits", { date: v.date, amount: Number(v.amount), at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "deposits", e)); },
                format: (e) => `${e.date} · +${e.amount}`,
            });
            await addRowLogSection({
                title: t("ledger.prices"), emptyText: t("ledger.noPrices"), addLabel: t("ledger.valAdd"), kind: "prices",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "price", type: "number", placeholder: t("ledger.priceValue"), width: 90 },
                    { key: "channel", type: "text", placeholder: t("ledger.priceChannel"), width: 100 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "prices")),
                add: async (v) => {
                    if (!Number.isFinite(Number(v.price))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "prices", { date: v.date, price: Number(v.price), channel: v.channel, at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "prices", e)); },
                format: (e) => `${e.date} · ${formatAmount(Number(e.price))}${e.channel ? ` · ${e.channel}` : ""}`,
            });
        } else if (active === "chores") {
            const { addChoreRotationSectionImpl } = await import("./chore-dialog");
            await addChoreRotationSectionImpl({ t, plugin, avId: ref.avId!, rowId: row.itemID, body, showMessageFn });
        } else if (active === "health") {
            const { addVitalsSectionImpl } = await import("./vitals-dialog");
            await addVitalsSectionImpl({ t, plugin, avId: ref.avId!, rowId: row.itemID, body, showMessageFn });
        } else if (active === "schooling") {
            await addRowLogSection({
                title: t("ledger.transfers"), emptyText: t("ledger.noTransfers"), addLabel: t("ledger.valAdd"), kind: "transfers",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "from", type: "text", placeholder: t("ledger.transferFrom"), width: 90 },
                    { key: "to", type: "text", placeholder: t("ledger.transferTo"), width: 90 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "transfers")),
                add: async (v) => {
                    if (!v.from || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "transfers", { date: v.date, from: v.from, to: v.to, at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "transfers", e)); },
                format: (e) => `${e.date} · ${e.from} → ${e.to}`,
            });
        } else if (active === "house") {
            await addRowLogSection({
                title: t("ledger.meters"), emptyText: t("ledger.noMeters"), addLabel: t("ledger.valAdd"), kind: "meters",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "reading", type: "number", placeholder: t("ledger.meterReading"), width: 110 },
                ],
                load: () => fresh().then((l) => rl.getMeterReadings(l, ref.avId!, row.itemID)),
                add: async (v) => {
                    if (!v.date || !Number.isFinite(Number(v.reading))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendMeterReading(current, ref.avId!, row.itemID, v.date, Number(v.reading), at()));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeMeterReading(current, ref.avId!, row.itemID, e.date)); },
                format: (e: any) => `${e.date} · ${e.reading}${typeof e.usage === "number" ? ` (${e.usage})` : ""}`,
            });

            const contractsRef = plugin.settings.dbRefs?.contracts;
            if (contractsRef?.avId && contractsRef?.columns) {
                const houseWarrantySection = document.createElement("div");
                houseWarrantySection.className = "lv-detail-section";
                houseWarrantySection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = t("ledger.houseContractsTitle");
                head.append(title);
                if (contractsRef.docId) {
                    const openAll = document.createElement("button");
                    openAll.className = "b3-button b3-button--text";
                    openAll.style.cssText = linkBtnCss;
                    openAll.textContent = t("ledger.houseContractsOpenAll");
                    openAll.onclick = () => plugin.showTabDocs(contractsRef.docId);
                    head.append(openAll);
                }
                houseWarrantySection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
                contentWrap.innerHTML = `<span class="lv-caption">${t("ledger.loading")}</span>`;
                houseWarrantySection.append(contentWrap);
                body.appendChild(houseWarrantySection);

                void (async () => {
                    try {
                        const contractAll = await renderLedgerAllFn(contractsRef.avId!);
                        const { matchHouseContracts } = await import("./contracts");
                        const matched = matchHouseContracts(row, ref.columns!, contractAll.rows, contractsRef.columns);
                        contentWrap.replaceChildren();
                        if (matched.length === 0) {
                            const empty = document.createElement("span");
                            empty.className = "lv-caption";
                            empty.textContent = t("ledger.houseContractsEmpty");
                            contentWrap.append(empty);
                            return;
                        }
                        for (const m of matched) {
                            const line = document.createElement("div");
                            line.style.cssText = lineBadgeCss;
                            const nameSpan = document.createElement("b");
                            nameSpan.style.cssText = "font-size:12.5px;color:var(--lv-tx)";
                            nameSpan.textContent = m.title;

                            const badge = document.createElement("span");
                            if (m.warrantyStatus === "valid") {
                                badge.className = "lv-badge green";
                                badge.textContent = t("ledger.warrantyValid");
                            } else if (m.warrantyStatus === "expiring") {
                                badge.className = "lv-badge orange";
                                badge.textContent = t("ledger.warrantyExpiring");
                            } else if (m.warrantyStatus === "expired") {
                                badge.className = "lv-badge gray";
                                badge.textContent = t("ledger.warrantyExpired");
                            } else {
                                badge.className = "lv-badge gray";
                                badge.textContent = t("ledger.warrantyUnknown");
                            }

                            const metaSpan = document.createElement("span");
                            metaSpan.className = "lv-caption";
                            metaSpan.style.cssText = "margin-left:auto;font-size:11.5px";
                            const parts = [];
                            if (m.party || m.contact) parts.push(m.party || m.contact);
                            if (m.expiry) parts.push(m.daysLeft !== undefined && m.daysLeft >= 0 ? `${m.expiry} (${m.daysLeft}d)` : m.expiry);
                            metaSpan.textContent = parts.join(" · ");

                            line.append(nameSpan, badge, metaSpan);
                            contentWrap.append(line);
                        }
                    } catch {
                        contentWrap.innerHTML = `<span class="lv-caption" style="color:var(--lv-danger)">${t("ledger.houseContractsFailed")}</span>`;
                    }
                })();
            }
        } else if (active === "food") {
            const foodName = (ref.columns?.name && cellTextFn(row.cells[ref.columns.name])) || "";
            const ingredientsRaw = (ref.columns?.ingredients && cellTextFn(row.cells[ref.columns.ingredients])) || "";
            if (foodName || (ingredientsRaw && ingredientsRaw !== "—")) {
                const foodDietarySection = document.createElement("div");
                foodDietarySection.className = "lv-detail-section";
                foodDietarySection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = t("ledger.foodDietaryTitle");
                head.append(title);
                foodDietarySection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
                foodDietarySection.append(contentWrap);
                body.appendChild(foodDietarySection);

                void (async () => {
                    const healthRef = plugin.settings.dbRefs?.health;
                    let healthRows: any[] | undefined;
                    if (healthRef?.avId) {
                        try {
                            const healthAll = await renderLedgerAllFn(healthRef.avId);
                            healthRows = healthAll.rows;
                        } catch { /* soft */ }
                    }
                    const { matchFoodDietaryConflicts, formatShoppingIngredientsText } = await import("./food");
                    const check = matchFoodDietaryConflicts(
                        foodName,
                        ingredientsRaw !== "—" ? ingredientsRaw : "",
                        plugin.settings.members ?? [],
                        healthRows,
                        healthRef?.columns,
                    );

                    contentWrap.replaceChildren();

                    if (check.isSafe) {
                        const safeBadge = document.createElement("div");
                        safeBadge.style.cssText = "padding:8px 12px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-accent);color:var(--lv-accent);font-size:12px";
                        safeBadge.textContent = `✓ ${t("ledger.foodDietarySafe")}`;
                        contentWrap.append(safeBadge);
                    } else {
                        for (const c of check.conflicts) {
                            const alertEl = document.createElement("div");
                            if (c.type === "allergy") {
                                alertEl.style.cssText = dangerAlertCss;
                                alertEl.innerHTML = `<span>🚨 <b>${c.memberName}</b>：${t("ledger.foodAllergyAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}${c.detail ? ` (${c.detail})` : ""}</span>`;
                            } else {
                                alertEl.style.cssText = warnAlertCss;
                                alertEl.innerHTML = `<span>⚠️ <b>${c.memberName}</b>：${t("ledger.foodDislikeAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}</span>`;
                            }
                            contentWrap.append(alertEl);
                        }
                    }

                    if (check.parsedIngredients.length > 0) {
                        const actionRow = document.createElement("div");
                        actionRow.style.cssText = actionRowEndCss;
                        const copyIngBtn = document.createElement("button");
                        copyIngBtn.className = "b3-button b3-button--outline";
                        copyIngBtn.style.cssText = fs12Pad38Css;
                        copyIngBtn.textContent = `＋ ${t("ledger.foodCopyIngredients")}`;
                        copyIngBtn.onclick = async () => {
                            const text = formatShoppingIngredientsText(foodName, check.parsedIngredients);
                            try {
                                await navigator.clipboard.writeText(text);
                                showMessageFn(t("ledger.foodIngredientsCopied"), 2500, "info");
                            } catch {
                                showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
                            }
                        };
                        actionRow.append(copyIngBtn);
                        contentWrap.append(actionRow);
                    }
                })();
            }
        } else if (active === "schooling") {
            const catVal = ref.columns?.category ? cellTextFn(row.cells[ref.columns.category]) : "";
            const enrollRaw = ref.columns?.enroll_year ? cellTextFn(row.cells[ref.columns.enroll_year]) : "";
            const enrollYear = Number(enrollRaw);
            const statusVal = ref.columns?.status ? cellTextFn(row.cells[ref.columns.status]) : "enrolled";

            if (catVal && Number.isFinite(enrollYear) && enrollYear >= 1980) {
                const schoolStageSection = document.createElement("div");
                schoolStageSection.className = "lv-detail-section";
                schoolStageSection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = t("ledger.schoolingStageTitle");
                head.append(title);
                schoolStageSection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = boxContentCss;
                schoolStageSection.append(contentWrap);
                body.appendChild(schoolStageSection);

                void (async () => {
                    const { calculateSchoolingStage } = await import("./schooling");
                    const stage = calculateSchoolingStage({
                        category: catVal,
                        enrollYear,
                        status: statusVal,
                    });

                    if (stage) {
                        const badgeCls = stage.isGraduated ? "green" : stage.daysUntilGraduation <= 100 ? "orange" : "blue";
                        const badgeText = stage.isGraduated
                            ? t("ledger.schoolingGraduated")
                            : t("ledger.schoolingDaysUntil").replace("${n}", String(stage.daysUntilGraduation));

                        contentWrap.innerHTML = `
                            <div style="display:flex;align-items:center;justify-content:space-between">
                              <span><b>${stage.currentGradeLabel}</b> · ${stage.transitionEventLabel}</span>
                              <span class="lv-badge ${badgeCls}">${badgeText}</span>
                            </div>
                            <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                              <span>${t("ledger.schoolingGraduationDate")}: ${stage.graduationDate} (${stage.stageTotalYears} 年制)</span>
                              <span>${t("ledger.schoolingProgress")}: ${stage.stageProgressPercent}%</span>
                            </div>
                            <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                              <div style="height:100%;background:var(--lv-accent);width:${stage.stageProgressPercent}%;border-radius:2px"></div>
                            </div>`;
                    }
                })();
            }
        } else if (active === "pets") {
            const speciesVal = ref.columns?.species ? cellTextFn(row.cells[ref.columns.species]) : "cat";
            const vdueVal = ref.columns?.vaccine_due ? cellTextFn(row.cells[ref.columns.vaccine_due]) : undefined;
            const ddueVal = ref.columns?.deworm_due ? cellTextFn(row.cells[ref.columns.deworm_due]) : undefined;
            const noteVal = ref.columns?.note ? cellTextFn(row.cells[ref.columns.note]) : "";

            let birthMatch = noteVal.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];

            const petCareSection = document.createElement("div");
            petCareSection.className = "lv-detail-section";
            petCareSection.style.cssText = sectionBorderCss;

            const head = document.createElement("div");
            head.style.cssText = sectionHeaderCss;
            const title = document.createElement("span");
            title.className = "ft__on-surface";
            title.style.cssText = sectionTitleCss;
            title.textContent = t("ledger.petCareTitle");
            head.append(title);
            petCareSection.append(head);

            const contentWrap = document.createElement("div");
            contentWrap.style.cssText = boxContentCss;
            petCareSection.append(contentWrap);
            body.appendChild(petCareSection);

            void (async () => {
                const { evaluatePetSummary } = await import("./pets");
                const summary = evaluatePetSummary(
                    birthMatch,
                    speciesVal,
                    vdueVal !== "—" ? vdueVal : undefined,
                    ddueVal !== "—" ? ddueVal : undefined,
                );

                contentWrap.replaceChildren();

                if (summary.ageInfo) {
                    const ageLine = document.createElement("div");
                    ageLine.style.cssText = flexBetweenCenterGap8Css;
                    ageLine.innerHTML = `
                        <span>${t("ledger.petAgeEquivalent")}: <b>${summary.ageInfo.humanEquivalentAge} 岁</b> (${summary.ageInfo.chronologicalYears} 岁 ${summary.ageInfo.chronologicalMonths} 个月)</span>
                        <span class="lv-badge purple">${summary.ageInfo.lifeStageLabel}</span>
                    `;
                    const desc = document.createElement("div");
                    desc.className = "lv-caption";
                    desc.style.cssText = "font-size:11px;line-height:1.4";
                    desc.textContent = summary.ageInfo.description;
                    contentWrap.append(ageLine, desc);
                }

                const careGrid = document.createElement("div");
                careGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px";

                const badgeCls = (u: string) => u === "overdue" ? "danger" : u === "soon" ? "orange" : u === "ok" ? "green" : "gray";

                const vBox = document.createElement("div");
                vBox.style.cssText = pad6BorderSurfaceCss;
                vBox.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="font-weight:500">${t("field.vaccine_due")}</span>
                        <span class="lv-badge ${badgeCls(summary.vaccine.urgency)}">${summary.vaccine.label}</span>
                    </div>
                    <span class="lv-caption" style="font-size:11px">${summary.vaccine.dueDate ? summary.vaccine.dueDate : "未填写"}</span>
                `;

                const dBox = document.createElement("div");
                dBox.style.cssText = pad6BorderSurfaceCss;
                dBox.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="font-weight:500">${t("field.deworm_due")}</span>
                        <span class="lv-badge ${badgeCls(summary.deworm.urgency)}">${summary.deworm.label}</span>
                    </div>
                    <span class="lv-caption" style="font-size:11px">${summary.deworm.dueDate ? summary.deworm.dueDate : "未填写"}</span>
                `;

                careGrid.append(vBox, dBox);
                contentWrap.append(careGrid);
            })();
        } else if (active === "travel-plan") {
            await addRowLogSection({
                title: t("ledger.checks"), emptyText: t("ledger.noChecks"), addLabel: t("ledger.valAdd"), kind: "checks",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "result", type: "text", placeholder: t("ledger.checkResult"), width: 200 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "checks")),
                add: async (v) => {
                    if (!v.date || !v.result) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "checks", { date: v.date, result: v.result, at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "checks", e)); },
                format: (e) => `${e.date} · ${e.result}`,
            });
        } else if (active === "media") {
            await addRowLogSection({
                title: t("ledger.loans"), emptyText: t("ledger.noLoans"), addLabel: t("ledger.valAdd"), kind: "loans",
                fields: [
                    { key: "date", type: "date", placeholder: "", width: 130 },
                    { key: "to", type: "text", placeholder: t("ledger.loanTo"), width: 100 },
                    { key: "back", type: "date", placeholder: t("ledger.loanBack"), width: 130 },
                ],
                load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "loans")),
                add: async (v) => {
                    if (!v.date || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                    await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "loans", { date: v.date, to: v.to, back: v.back || "", at: at() }));
                    return true;
                },
                remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "loans", e)); },
                format: (e) => `${e.date} · ${t("ledger.loanTo")} ${e.to}${e.back ? ` · ${e.back} ${t("ledger.loanReturned")}` : ` · ${t("ledger.loanOut")}`}`,
            });
        } else if (active === "parenting") {
            const catVal = ref.columns?.category ? cellTextFn(row.cells[ref.columns.category]) : "";
            if (catVal === "feeding" || catVal === t("field.category.opt.feeding")) {
                const dateVal = ref.columns?.date ? cellTextFn(row.cells[ref.columns.date]) : "";
                const foodName = (ref.columns?.name && cellTextFn(row.cells[ref.columns.name])) || "";
                const memberBlockId = ref.columns?.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;

                const feedingSection = document.createElement("div");
                feedingSection.className = "lv-detail-section";
                feedingSection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = t("ledger.feedingObserveTitle");
                head.append(title);
                feedingSection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = "font-size:12.5px;display:flex;flex-direction:column;gap:8px";
                feedingSection.append(contentWrap);
                body.appendChild(feedingSection);

                void (async () => {
                    const { evaluateFeedingObservation, findMemberAllergies, checkAllergyConflict } = await import("./feeding");
                    const obs = evaluateFeedingObservation(dateVal);

                    if (obs) {
                        const statusLine = document.createElement("div");
                        statusLine.style.cssText = lineBadgeCss;
                        const badge = document.createElement("span");
                        if (obs.status === "observing") {
                            badge.className = "lv-badge orange";
                            badge.textContent = obs.dayProgressText;
                        } else if (obs.status === "completed") {
                            badge.className = "lv-badge green";
                            badge.textContent = t("ledger.feedingObserveDone");
                        } else {
                            badge.className = "lv-badge gray";
                            badge.textContent = obs.dayProgressText;
                        }
                        const timeText = document.createElement("span");
                        timeText.className = "lv-caption";
                        timeText.style.cssText = "margin-left:auto;font-size:11.5px";
                        timeText.textContent = `${t("ledger.feedingObserveUntil")}: ${obs.observeUntil}`;
                        statusLine.append(badge, timeText);
                        contentWrap.append(statusLine);
                    }

                    const healthRef = plugin.settings.dbRefs?.health;
                    if (healthRef?.avId && healthRef?.columns) {
                        try {
                            const healthAll = await renderLedgerAllFn(healthRef.avId);
                            const allergies = findMemberAllergies(memberBlockId, healthAll.rows, healthRef.columns);
                            const conflict = checkAllergyConflict(foodName, allergies);

                            if (conflict) {
                                const alertLine = document.createElement("div");
                                alertLine.style.cssText = dangerAlertCss;
                                alertLine.innerHTML = `<span>⚠️ ${t("ledger.feedingAllergyConflict").replace("${food}", conflict.name)}${conflict.reaction ? `（${conflict.reaction}）` : ""}</span>`;
                                contentWrap.append(alertLine);
                            }
                        } catch { /* soft */ }
                    }

                    if (healthRef?.avId && healthRef?.columns) {
                        const actionRow = document.createElement("div");
                        actionRow.style.cssText = actionRowEndCss;
                        const addAllergyBtn = document.createElement("button");
                        addAllergyBtn.className = "b3-button b3-button--outline";
                        addAllergyBtn.style.cssText = fs12Pad38Css;
                        addAllergyBtn.textContent = `＋ ${t("ledger.recordAllergyToHealth")}`;
                        addAllergyBtn.onclick = () => {
                            const adlg = new DialogCls({
                                title: t("ledger.recordAllergyTitle"),
                                content: `<div class="b3-dialog__content lv-dialog-col">
                                    <p class="lv-caption" style="margin:0">${t("ledger.recordAllergyIntro").replace("${food}", foodName)}</p>
                                    <input class="b3-text-field" id="lv-allergy-reaction" placeholder="${t("ledger.recordAllergyReactionPlaceholder")}" style="width:100%" />
                                </div>
                                <div class="b3-dialog__action">
                                    <button class="b3-button b3-button--cancel" id="lv-allergy-cancel">${t("cancel")}</button>
                                    <button class="b3-button" id="lv-allergy-save">${t("save")}</button>
                                </div>`,
                                width: "420px",
                            });
                            const rxInput = adlg.element.querySelector("#lv-allergy-reaction") as HTMLInputElement;
                            requestAnimationFrame(() => rxInput?.focus());
                            (adlg.element.querySelector("#lv-allergy-cancel") as HTMLButtonElement).onclick = () => adlg.destroy();
                            (adlg.element.querySelector("#lv-allergy-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                                this.disabled = true;
                                const reactionVal = rxInput?.value.trim() || "";
                                adlg.destroy();
                                try {
                                    const { addDetachedRow } = await import("./siyuan");
                                    const rowId = await addDetachedRow(healthRef.avId!, foodName);
                                    if (healthRef.columns.category) {
                                        await setCell(healthRef.avId!, healthRef.columns.category, rowId, {
                                            type: "select", select: { content: "allergy" },
                                        });
                                    }
                                    if (healthRef.columns.diagnosis && reactionVal) {
                                        await setCell(healthRef.avId!, healthRef.columns.diagnosis, rowId, {
                                            type: "text", text: { content: reactionVal },
                                        });
                                    }
                                    if (healthRef.columns.date && dateVal) {
                                        await setCell(healthRef.avId!, healthRef.columns.date, rowId, {
                                            type: "date", date: { content: dateVal, isNotEmpty: true },
                                        });
                                    }
                                    if (healthRef.columns.member && memberBlockId) {
                                        await setCell(healthRef.avId!, healthRef.columns.member, rowId, {
                                            type: "relation", relation: { blockIDs: [memberBlockId] },
                                        });
                                    }
                                    showMessageFn(t("ledger.recordAllergySaved"), 3500, "info");
                                } catch (err) {
                                    showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                                }
                            };
                        };
                        actionRow.append(addAllergyBtn);
                        contentWrap.append(actionRow);
                    }
                })();
            }
        } else if (active === "social") {
            const memberBlockId = ref.columns?.member ? row.cells[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;
            const member = memberBlockId ? (plugin.settings.members ?? []).find((m: any) => m.avItemId === memberBlockId) : undefined;
            if (member?.birthday) {
                const socialRetireSection = document.createElement("div");
                socialRetireSection.className = "lv-detail-section";
                socialRetireSection.style.cssText = sectionBorderCss;

                const head = document.createElement("div");
                head.style.cssText = sectionHeaderCss;
                const title = document.createElement("span");
                title.className = "ft__on-surface";
                title.style.cssText = sectionTitleCss;
                title.textContent = `${t("members.retirementTitle")} · ${member.name}`;
                head.append(title);
                socialRetireSection.append(head);

                const contentWrap = document.createElement("div");
                contentWrap.style.cssText = boxContentCss;
                socialRetireSection.append(contentWrap);
                body.appendChild(socialRetireSection);

                void (async () => {
                    const { calculateRetirement } = await import("./retirement");
                    const ret = calculateRetirement({ birthday: member.birthday, sex: member.sex });
                    if (ret) {
                        const delayText = ret.delayedMonths > 0 ? ` · ${t("members.retirementDelay").replace("${n}", String(ret.delayedMonths))}` : "";
                        const daysBadge = ret.isRetired
                            ? `<span class="lv-badge green">${t("members.retirementRetired")}</span>`
                            : `<span class="lv-badge orange">${t("members.retirementDaysLeft").replace("${n}", String(ret.daysLeft))}</span>`;

                        contentWrap.innerHTML = `
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <span>${t("members.retirementTarget")}: <b>${ret.targetRetireDate}</b> (${t("members.retirementAge").replace("${age}", String(ret.targetRetireAge))}${delayText})</span>
                                ${daysBadge}
                            </div>
                            <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                                <span>${t("members.retirementCareerProgress")}</span>
                                <span>${ret.careerProgressPercent}%</span>
                            </div>
                            <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                                <div style="height:100%;background:var(--lv-accent);width:${ret.careerProgressPercent}%;border-radius:2px"></div>
                            </div>`;
                    }
                })();
            }
        }
    })().catch((error) => {
        showMessageFn(t("ledger.logReadFailed") + " (" + (error instanceof Error ? error.message : String(error)) + ")", 6000, "error");
    });

    (async () => {
        const tplList = ((plugin.schemaCatalog?.[active] as any)?.templates ?? []) as { key: string; nameKey: string; file: string }[];
        for (const tp of tplList) {
            const label = t(tp.nameKey) !== tp.nameKey ? t(tp.nameKey) : tp.key;
            const btn = document.createElement("button");
            btn.className = "b3-button b3-button--outline";
            btn.style.cssText = btnSmCss;
            btn.textContent = `${t("ledger.genDoc")} · ${label}`;
            btn.onclick = async () => {
                try {
                    const { getTemplate, renderTemplate, sanitizeDocTitle } = await import("./templates");
                    const { sql, createDocWithMd } = await import("./siyuan");
                    const file = getTemplate(tp.file);
                    if (!file) throw new Error("template missing: " + tp.file);
                    const rows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${ref.docId!.replace(/'/g, "''")}' LIMIT 1`);
                    const notebook = rows[0]?.box;
                    if (!notebook) throw new Error("notebook not found for " + ref.docId);
                    const vars: Record<string, string> = { name: String(cellTextFn(row.cells[ref.columns!.name])), date: localDateKey(new Date()) };
                    for (const c of schemaCols) vars[c.key] = cellTextFn(row.cells[ref.columns![c.key]]);
                    const title = sanitizeDocTitle(`${vars.name} · ${label} · ${vars.date}`);
                    confirm(t("ledger.genDoc"), t("ledger.genDocConfirm").replace("${title}", title), async () => {
                        try {
                            const docId = await createDocWithMd(notebook, `/${title}`, renderTemplate(file, vars));
                            showMessageFn(t("ledger.genDocDone").replace("${title}", title), 3000, "info");
                            dlg.destroy();
                            plugin.showTabDocs(docId);
                        } catch (e) {
                            showMessageFn(t("ledger.genDocFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                        }
                    });
                } catch (e) {
                    showMessageFn(t("ledger.genDocFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                }
            };
            body.appendChild(btn);
        }
    })();

    import("./drawer-sections").then(({
        renderRxToMedicineButton,
        renderStockInButton,
        renderShoppingToAssetButton,
        renderRenewChainSection,
        renderFavorsSyncSection,
    }) => {
        renderRxToMedicineButton({ body, row, ref, active, plugin, t, showMessageFn, cellTextFn });
        renderStockInButton({ body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn });
        renderShoppingToAssetButton({ body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn });
        renderRenewChainSection({
            body,
            row,
            rows: [],
            ref,
            active,
            t,
            DialogCls,
            showMessageFn,
            cellTextFn,
            onChainUpdated: async (targetRowId: string) => {
                await onReload();
                try { await plugin.refreshHub([active]); } catch { /* ignore */ }
                const fresh = (await renderLedgerAllFn(ref.avId!)).rows.find((x) => x.itemID === targetRowId);
                if (fresh) void openLedgerDetailDrawer({ ...options, row: fresh });
            },
        });

        renderFavorsSyncSection({
            body,
            row,
            ref,
            active,
            plugin,
            t,
            showMessageFn,
            selectContentFn: (cell) => selectCellContent(cell),
            rawDateFn: (cell) => rawFromValue("date", cell) ?? "",
        });
    });

    function buildEdit() {
        body.innerHTML = "";
        body.scrollTop = 0;
        const more = dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement;
        more.open = false;
        more.hidden = true;
        import("./record-form").then(({ renderEditableFormFields }) => {
            const inputs = renderEditableFormFields({
                container: body,
                schemaCols,
                columns: ref.columns!,
                rowCells: row.cells,
                t,
                rawFromValueFn: rawFromValue,
                hasContactsBridge: true,
                onPickContact: pickFromContacts,
            });
            const errorBox = document.createElement("div");
            errorBox.className = "lv-record-error";
            errorBox.setAttribute("role", "alert");
            errorBox.style.display = "none";
            body.appendChild(errorBox);
            const save = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement;
            save.textContent = t("save");
            const cancel = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement;
            cancel.textContent = t("cancel");
            cancel.onclick = () => buildView();
            save.onclick = async () => {
                if (save.disabled) return;
                save.disabled = true;
                cancel.disabled = true;
                errorBox.style.display = "none";
                const failed: string[] = [];
                let changed = 0;
                let personChanged = false;
                const personKeyID = ref.columns?.person;
                const previousFavorSync = plugin.runtime?.favorSyncs?.[row.itemID];
                try {
                    for (const e of inputs) {
                        const v = e.get();
                        const orig = rawFromValue(e.type, row.cells[e.keyID]);
                        const same = e.type === "checkbox" ? v === orig : String(v) === String(orig);
                        if (same) continue;
                        try {
                            const { cellValue } = await import("./avcell");
                            const nextCell = cellValue(e.type, v);
                            await setCell(ref.avId!, e.keyID, row.itemID, nextCell, {
                                idempotencyKey: `ledger:detail-edit:${row.itemID}:${e.keyID}:${JSON.stringify(nextCell)}`,
                                retries: 1,
                            });
                            row.cells[e.keyID] = nextCell;
                            changed++;
                            if (personKeyID && e.keyID === personKeyID) personChanged = true;
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            if (msg.includes("key not found")) {
                                try {
                                    const { healColumnMapping } = await import("./provisioner");
                                    const healedKey = await healColumnMapping(plugin, active, e.colKey);
                                    if (healedKey && healedKey !== e.keyID) {
                                        const { cellValue } = await import("./avcell");
                                        const nextCell = cellValue(e.type, v);
                                        await setCell(ref.avId!, healedKey, row.itemID, nextCell, {
                                            idempotencyKey: `ledger:detail-edit:${row.itemID}:${healedKey}:${JSON.stringify(nextCell)}`,
                                            retries: 1,
                                        });
                                        row.cells[healedKey] = nextCell;
                                        changed++;
                                        continue;
                                    }
                                } catch { /* fail to failed.push */ }
                            }
                            failed.push(e.label);
                        }
                    }
                    if (personChanged && previousFavorSync) {
                        delete plugin.runtime.favorSyncs[row.itemID];
                        try {
                            await saveRuntime(plugin, plugin.runtime);
                        } catch (err) {
                            plugin.runtime.favorSyncs = { ...(plugin.runtime.favorSyncs ?? {}), [row.itemID]: previousFavorSync };
                            showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                        }
                    }
                    if (failed.length > 0) {
                        if (changed > 0) {
                            await onReload();
                            try { await plugin.refreshHub([active]); } catch { /* soft */ }
                        }
                        errorBox.textContent = t("ledger.editSavePartial").replace("${fields}", failed.join(", "));
                        errorBox.style.display = "block";
                        save.disabled = false;
                        cancel.disabled = false;
                        return;
                    }
                    dlg.destroy();
                    if (changed > 0) {
                        await onReload();
                        try { await plugin.refreshHub([active]); } catch { /* soft */ }
                    }
                    if (changed > 0) showMessageFn(t("ledger.editSaved"), 2500, "info");
                } catch (err) {
                    showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                    save.disabled = false;
                    cancel.disabled = false;
                }
            };
        });
    }

    buildView();

    if (active === "vehicles") {
        const quick = document.createElement("section");
        quick.className = "lv-vehicle-quick-actions";
        quick.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;border:1px solid var(--lv-line);border-radius:8px;background:var(--lv-surface-2)";
        const label = document.createElement("b"); label.textContent = t("vehicle.quickActions"); label.style.cssText = "font-size:12px;margin-right:2px";
        quick.appendChild(label);
        for (const action of ["fuel", "charging", "maintenance"] as const) {
            const button = document.createElement("button");
            button.className = "b3-button b3-button--outline";
            button.textContent = t(`vehicle.quick.${action}`);
            button.onclick = () => requestVehicleAction(action);
            quick.appendChild(button);
        }
        body.prepend(quick);
        if (vehicleAction === "edit") {
            requestAnimationFrame(() => (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement | null)?.click());
        } else if (vehicleAction) {
            requestAnimationFrame(() => requestVehicleAction(vehicleAction));
        }
    }

    (dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement).onclick = () => buildEdit();
    (dlg.element.querySelector("#lv-detail-open") as HTMLButtonElement).onclick = () => { dlg.destroy(); plugin.showTabDocs(ref.docId, row.itemID); };

    const nameKeyForCard = ref.columns?.name;
    const nameValForCard = nameKeyForCard ? row.cells?.[nameKeyForCard] : undefined;
    const cardTitle = (nameValForCard?.type === "block" ? nameValForCard.block?.content : "") || detailTitle;
    const cardDeepLink = nameValForCard?.type === "block" && nameValForCard.block?.id ? blockDeepLink(nameValForCard.block.id) : blockDeepLink(ref.docId || "");

    import("./drawer-actions").then(({ bindDrawerMoreActions }) => {
        bindDrawerMoreActions({
            dlg,
            row,
            cardTitle,
            cardDeepLink,
            cardRows,
            active,
            ref,
            t,
            showMessageFn,
            cellTextFn,
        });
    });

    const dupBtn = dlg.element.querySelector("#lv-detail-duplicate") as HTMLButtonElement | null;
    if (dupBtn) {
        dupBtn.onclick = () => {
            const rowName = (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || "";
            const cloneName = rowName ? `${rowName} (副本)` : "";
            const copiedValues: Record<string, any> = { name: cloneName };
            for (const col of schemaCols) {
                if (col.key === "name" || ["asset", "mAsset", "relation"].includes(col.type)) continue;
                const v = ref.columns?.[col.key] ? row.cells?.[ref.columns[col.key]] : undefined;
                if (v) {
                    if (col.type === "select") copiedValues[col.key] = selectCellContent(v);
                    else if (col.type === "number") {
                        const raw = v.number?.content ?? (v as any).content ?? (v as any).value?.number?.content ?? v;
                        const num = Number(raw);
                        copiedValues[col.key] = Number.isFinite(num) ? num : undefined;
                    } else if (col.type === "date") {
                        const raw = v.date?.content ?? (v as any).content ?? (v as any).value?.date?.content;
                        if (typeof raw === "number") copiedValues[col.key] = localDateKey(new Date(raw));
                        else if (typeof raw === "string" && raw.trim()) {
                            const parsed = parseDate(raw.trim());
                            copiedValues[col.key] = parsed ? localDateKey(parsed) : raw.trim();
                        }
                    } else if (col.type === "checkbox") {
                        copiedValues[col.key] = v.checkbox?.checked ?? (v as any).checked ?? (v as any).value?.checkbox?.checked;
                    } else {
                        copiedValues[col.key] = cellTextFn(v, col.key);
                    }
                }
            }
            dlg.destroy();
            openNewRecordFn(copiedValues);
            showMessageFn(t("ledger.duplicateSuccess").replace("${name}", cloneName || rowName), 3000, "info");
        };
    }

    (dlg.element.querySelector("#lv-detail-del") as HTMLButtonElement).onclick = () => {
        if (plugin.runtime?.guestModeActive) {
            showMessageFn(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        confirm(t("ledger.delTitle"), t("ledger.delBody").replace("${name}", (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || t("ledger.detail")), async () => {
            try {
                const { removeLedgerRows } = await import("./siyuan");
                await removeLedgerRows(ref.avId!, [row.itemID], {
                    idempotencyKey: `ledger:delete:${ref.avId!}:${row.itemID}`,
                    retries: 1,
                });
            } catch (e) {
                showMessageFn(t("ledger.delFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                return;
            }
            showMessageFn(t("ledger.delDone"), 2500, "info");
            dlg.destroy();
            const followupErrors: string[] = [];
            try {
                const memberRef = plugin.settings.dbRefs.members;
                if (memberRef?.avId === ref.avId) {
                    const linkedMembers = (plugin.settings.members ?? []).filter((member: any) => member.avItemId === row.itemID);
                    if (linkedMembers.length) {
                        for (const member of linkedMembers) {
                            member.avItemId = undefined;
                            member.syncError = "ledger row deleted";
                            member.avRowCreatePending = undefined;
                        }
                        await saveSettings(plugin, plugin.settings);
                    }
                }
            } catch (e) {
                followupErrors.push(`${t("ledger.memberLinkCleanupFailed")} (${e instanceof Error ? e.message : String(e)})`);
            }
            try {
                const { cleanupRowRuntimeData } = await import("./hub/runtime");
                const dirty = cleanupRowRuntimeData(plugin.runtime, row.itemID);
                if (dirty) {
                    await saveRuntime(plugin, plugin.runtime);
                }
            } catch (e) {
                followupErrors.push(e instanceof Error ? e.message : String(e));
            }
            try {
                const { updateRowLogs, removeRowLog } = await import("./rowlog");
                await updateRowLogs(plugin, (current) => removeRowLog(current, ref.avId!, row.itemID));
            } catch (e) {
                followupErrors.push(e instanceof Error ? e.message : String(e));
            }
            try {
                await onReload();
                await plugin.refreshHub([active]);
            } catch (e) {
                followupErrors.push(e instanceof Error ? e.message : String(e));
            }
            if (followupErrors.length) showMessageFn(t("ledger.delFollowupFailed").replace("${msg}", followupErrors.join("; ")), 6000, "error");
        });
    };
}
