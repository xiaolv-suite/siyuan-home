/**
 * 台账行详情抽屉完整驱动引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：行内详情字段展示、敏感脱敏、自定义列、各业务扩展板块、文档模板生成、编辑与删除
 */

import { createVehicleActionQueue, type VehicleQuickAction } from "./vehicle";
import type { ActivityTarget } from "./activity";
import { selectCellContent } from "./avcell";
import { getCertificateProfile } from "./schema";
import { maskCredentialNumber, maskIdNumber, parseIdNumber } from "./idcard";
import { AMOUNT_KEYS, formatAmount } from "./format";
import { localDateKey } from "./hub/rule";
import { blockDeepLink } from "./qr";
import { openContactPicker } from "@/libs/contact-picker";
import { uiIcon } from "@/ui/icons";
import { renderRowLogSection, renderDrawerQrSection } from "./drawer-sections";
import { renderDrawerDocTemplates, bindDrawerRowOperations } from "./drawer-actions";
import { bindDialogA11y } from "./dialog-a11y";

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
        content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-detail-body"></div>
<div class="b3-dialog__action lv-detail-actions"><button class="b3-button b3-button--text ft__error lv-detail-del-btn" id="lv-detail-del">${t("delete")}</button><button class="b3-button b3-button--text" id="lv-detail-duplicate">${uiIcon("copy", "", 13)} ${t("ledger.duplicateRow")}</button><button class="b3-button b3-button--text" id="lv-detail-open-direct">${uiIcon("folder", "", 13)} ${t("ledger.openDoc")}</button><span class="fn__flex-1"></span><details class="lv-detail-more"><summary class="b3-button b3-button--outline">${t("ledger.detailMore")}</summary><div class="lv-detail-more-menu"><button class="b3-button b3-button--text" id="lv-detail-card-copy">${t("ledger.copyAsImage")}</button><button class="b3-button b3-button--text" id="lv-detail-card-png">${t("ledger.downloadPng")}</button><button class="b3-button b3-button--text" id="lv-detail-card-text">${t("ledger.copyAsText")}</button><button class="b3-button b3-button--text" id="lv-detail-card-masked-text">${t("ledger.copyAsMaskedText")}</button><button class="b3-button b3-button--text" id="lv-detail-copy-ref">${uiIcon("link", "", 13)} ${t("ledger.copyBlockRef")}</button><button class="b3-button b3-button--text" id="lv-detail-copy-embed">${uiIcon("paperclip", "", 13)} ${t("ledger.copyBlockEmbed")}</button><button class="b3-button b3-button--text" id="lv-detail-copy-task">${uiIcon("checkCircle", "", 13)} ${t("ledger.copyAsTaskBlock")}</button><button class="b3-button b3-button--text" id="lv-detail-push-glean">${uiIcon("note", "", 13)} ${t("ledger.pushToGlean")}</button><button class="b3-button b3-button--text" id="lv-detail-open">${t("ledger.openDoc")} ${uiIcon("forward", "", 12)}</button></div></details><button class="b3-button b3-button--cancel" id="lv-detail-close">${t("close")}</button><button class="b3-button lv-btn primary" id="lv-detail-edit">${t("ledger.detailEditAll")}</button></div>`,
        width: "520px",
    });

    const body = dlg.element.querySelector("#lv-detail-body") as HTMLElement;
    bindDialogA11y({ dlg, defaultFocus: "#lv-detail-close" });
    const vehicleActionQueue = createVehicleActionQueue();
    const showVehicleActionError = (error: string) =>
        showMessageFn(t("ledger.logReadFailed") + " (" + error + ")", 6000, "error");

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
        k.className = "ft__on-surface lv-label-key";
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
            case "date": return v?.date?.isNotEmpty && v.date.content ? localDateKey(new Date(v.date.content)) : "";
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
        if (plugin.runtime?.guestModeActive) {
            showMessageFn(t("guest.writeBlocked"), 3500, "info");
            return;
        }
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
        head.className = "ft__on-surface lv-dialog-sec-head";
        head.textContent = t("ledger.renewHistory");
        body.appendChild(head);
        for (const h of history) {
            const line = document.createElement("div");
            line.className = active === "vehicles" ? "lv-dialog-row-text lv-detail-wide" : "lv-dialog-row-text";
            line.innerHTML = `${h.from} ${uiIcon("forward", "", 12)} ${h.to} · <span class="lv-dialog-row-sub">${h.at.slice(0, 10)}</span>`;
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
            line.className = active === "vehicles" ? "fn__flex lv-detail-kv lv-detail-kv-line" : "fn__flex lv-detail-kv-line";
            line.append(labelSpan(col));
            const v = document.createElement("span");
            v.className = "lv-word-break";
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
                    reveal.className = "b3-button b3-button--text lv-btn-text-sm";
                    reveal.textContent = t("ledger.idNumberShow");
                    let shown = false;
                    reveal.onclick = () => {
                        shown = !shown;
                        v.textContent = shown ? full : mask;
                        reveal.textContent = shown ? t("ledger.idNumberHide") : t("ledger.idNumberShow");
                    };
                    const copy = document.createElement("button");
                    copy.className = "b3-button b3-button--text lv-btn-text-sm";
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
                        birthFill.className = "b3-button b3-button--text lv-btn-text-sm";
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
                v.classList.add("lv-detail-value", "lv-editable-cell");
                v.setAttribute("aria-label", `${colLabel(col)}：${v.textContent}`);
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
            head.className = "ft__on-surface lv-dialog-sec-head";
            head.textContent = t("ledger.customCols");
            body.appendChild(head);
            for (const c of customCols) {
                const line = document.createElement("div");
                line.className = active === "vehicles" ? "fn__flex lv-detail-wide lv-detail-kv-line" : "fn__flex lv-detail-kv-line";
                const k = document.createElement("span");
                k.className = "ft__on-surface lv-label-key";
                k.textContent = String(c.name);
                line.append(k);
                const v = document.createElement("span");
                v.className = "lv-word-break";
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
                    v.classList.add("lv-detail-value", "lv-editable-cell");
                    v.setAttribute("aria-label", `${c.name}：${v.textContent}`);
                }
                line.append(v);
                body.appendChild(line);
                cardRows.push({ label: String(c.name), value: cellTextFn(row.cells[c.id]) });
            }
        }

        const addRowLogSection = (opts: any) => renderRowLogSection({
            body,
            row,
            active,
            activityTarget,
            t,
            showMessageFn,
            ...opts,
        });

        addHistorySection();
        addAttachmentsSection();
        renderDrawerQrSection({ body, row, ref, active, t });

        // 跨模块业务时间线与子记录
        (async () => {
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
            const { renderModuleSpecificSections } = await import("./drawer-module-sections");
            await renderModuleSpecificSections({
                body,
                active,
                row,
                ref,
                plugin,
                t,
                DialogCls,
                showMessageFn,
                renderLedgerAllFn,
                cellTextFn,
                rawFromValue,
                addRowLogSection,
            });
        })().catch((error) => {
            showMessageFn(t("ledger.logReadFailed") + " (" + (error instanceof Error ? error.message : String(error)) + ")", 6000, "error");
        });

        renderDrawerDocTemplates({
            body,
            dlg,
            row,
            ref,
            active,
            schemaCols,
            plugin,
            t,
            cellTextFn,
            showMessageFn,
        });

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

        if (active === "vehicles") {
            const quick = document.createElement("section");
            quick.className = "lv-vehicle-quick-actions lv-quick-bar";
            const label = document.createElement("b"); label.textContent = t("vehicle.quickActions"); label.className = "lv-domain-title";
            quick.appendChild(label);
            for (const action of ["fuel", "charging", "maintenance"] as const) {
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.textContent = t(`vehicle.quick.${action}`);
                button.onclick = () => requestVehicleAction(action);
                quick.appendChild(button);
            }
            body.prepend(quick);
        }
    }

    function buildEdit() {
        if (plugin.runtime?.guestModeActive) {
            showMessageFn(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        import("./drawer-actions").then(({ renderDrawerEditMode }) => {
            renderDrawerEditMode({
                body,
                dlg,
                row,
                ref,
                active,
                schemaCols,
                plugin,
                t,
                rawFromValueFn: rawFromValue,
                showMessageFn,
                pickFromContactsFn: pickFromContacts,
                onCancel: () => buildView(),
                onReload,
            });
        });
    }

    buildView();

    if (active === "vehicles") {
        if (vehicleAction === "edit") {
            requestAnimationFrame(() => (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement | null)?.click());
        } else if (vehicleAction) {
            requestAnimationFrame(() => requestVehicleAction(vehicleAction));
        }
    }

    (dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    (dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement).onclick = () => buildEdit();
    const openDocFromDrawer = () => { dlg.destroy(); plugin.showTabDocs(ref.docId, row.itemID); };
    (dlg.element.querySelector("#lv-detail-open") as HTMLButtonElement).onclick = openDocFromDrawer;
    const directOpenBtn = dlg.element.querySelector("#lv-detail-open-direct") as HTMLButtonElement | null;
    if (directOpenBtn) directOpenBtn.onclick = openDocFromDrawer;

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

    bindDrawerRowOperations({
        dlg,
        row,
        ref,
        active,
        schemaCols,
        plugin,
        t,
        cellTextFn,
        showMessageFn,
        openNewRecordFn,
        onReload,
    });
}
