/**
 * 台账行详情抽屉完整驱动引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：行内详情字段展示、敏感脱敏、自定义列、各业务扩展板块、文档模板生成、编辑与删除
 */

import { createVehicleActionQueue, type VehicleQuickAction } from "./vehicle";
import type { ActivityTarget } from "./activity";
import { selectCellContent } from "./avcell";
import { getCertificateProfile } from "./schema";
import { maskCredentialNumber, maskIdNumber, parseIdNumber } from "./idcard";
import { AMOUNT_KEYS, formatAmount, SENSITIVE_ID_KEYS, SENSITIVE_CREDENTIAL_KEYS } from "./format";
import { localDateKey } from "./hub/rule";
import { blockDeepLink } from "./qr";
import { openContactPicker } from "@/libs/contact-picker";
import { uiIcon } from "@/ui/icons";
import { renderRowLogSection, renderDrawerQrSection } from "./drawer-sections";
import { renderDrawerDocTemplates, bindDrawerRowOperations } from "./drawer-actions";
import { bindDialogA11y } from "./dialog-a11y";
import { escapeHtml } from "./modal-shell";
import { calculateLedgerTone } from "./ledger-view-model";

export function isDrawerFieldEmpty(displayText: string, emptyPlaceholder: string): boolean {
    const trimmed = String(displayText ?? "").trim();
    return !trimmed || trimmed === "—" || trimmed === emptyPlaceholder;
}

export interface OpenLedgerDetailDrawerOptions {
    row: any;
    rows?: any[];
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
    const dBtn = (id: string, text: string, ic = "") => `<button class="b3-button b3-button--text" id="${escapeHtml(id)}">${ic ? ic + " " : ""}${escapeHtml(text)}</button>`;
    const dlg = new DialogCls({
        title: escapeHtml(detailTitle),
        content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-detail-body"></div>
<div class="b3-dialog__action lv-detail-actions"><button class="b3-button b3-button--text ft__error lv-detail-del-btn" id="lv-detail-del">${escapeHtml(t("delete"))}</button>${dBtn("lv-detail-duplicate", t("ledger.duplicateRow"), uiIcon("copy", "", 13))}${dBtn("lv-detail-open-direct", t("ledger.openDoc"), uiIcon("folder", "", 13))}<span class="fn__flex-1"></span><details class="lv-detail-more"><summary class="b3-button b3-button--outline">${escapeHtml(t("ledger.detailMore"))}</summary><div class="lv-detail-more-menu" aria-label="${escapeHtml(t("ledger.detailMore"))}">${dBtn("lv-detail-card-copy", t("ledger.copyAsImage"))}${dBtn("lv-detail-card-png", t("ledger.downloadPng"))}${dBtn("lv-detail-card-text", t("ledger.copyAsText"))}${dBtn("lv-detail-card-masked-text", t("ledger.copyAsMaskedText"))}${dBtn("lv-detail-copy-ref", t("ledger.copyBlockRef"), uiIcon("link", "", 13))}${dBtn("lv-detail-copy-embed", t("ledger.copyBlockEmbed"), uiIcon("paperclip", "", 13))}${dBtn("lv-detail-copy-task", t("ledger.copyAsTaskBlock"), uiIcon("checkCircle", "", 13))}${dBtn("lv-detail-record-contact", t("ledger.recordContactInteraction"), uiIcon("users", "", 13))}${dBtn("lv-detail-push-glean", t("ledger.pushToGlean"), uiIcon("note", "", 13))}${dBtn("lv-detail-open", t("ledger.openDoc"), uiIcon("forward", "", 12))}</div></details><button class="b3-button b3-button--cancel" id="lv-detail-close" data-lv-skip-auto-close="1">${escapeHtml(t("close"))}</button><button class="b3-button lv-btn primary" id="lv-detail-edit">${escapeHtml(t("ledger.detailEditAll"))}</button></div>`,
        width: "min(520px, 94vw)",
    });

    let drawerClosed = false;
    const rawDestroy = dlg.destroy?.bind(dlg);
    if (rawDestroy) {
        dlg.destroy = () => {
            drawerClosed = true;
            rawDestroy();
        };
    }

    dlg.element?.classList?.add?.("lv-home-detail-dialog");
    dlg.element?.querySelector?.(".b3-dialog")?.classList?.add?.("lv-home-detail-dialog");
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
    const EDITABLE = new Set(["text", "number", "date", "select", "url", "checkbox", "block"]);
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
            case "block": return v?.block?.content ?? v?.text?.content ?? "";
            case "number": return v?.number?.isNotEmpty !== false && typeof v?.number?.content === "number" ? v.number.content : "";
            case "date": {
                if (!v?.date || v.date.isNotEmpty === false || !v.date.content) return "";
                const num = Number(v.date.content);
                if (!isNaN(num) && (num === 0 || num <= -60000000000000)) return "";
                const d = !isNaN(num) && num > 100000000 ? new Date(num) : new Date(String(v.date.content));
                return isNaN(d.getTime()) || d.getFullYear() < 1900 ? "" : localDateKey(d);
            }
            case "checkbox": return !!v?.checkbox?.checked;
            case "select": return selectCellContent(v) ?? "";
            case "mSelect":
                return Array.isArray(v?.mSelect)
                    ? v.mSelect.map((o: any) => String(o?.content ?? "").trim()).filter(Boolean)
                    : [];
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
                plugin,
                t,
                rawFromValueFn: rawFromValue,
                showMessageFn,
                hasContactsBridge: true,
                onPickContact: pickFromContacts,
                onSaveSuccess: async () => {
                    const stillOpenBeforeReload = !drawerClosed && dlg.element?.isConnected !== false;
                    await onReload();
                    try { await plugin.refreshHub([active]); } catch { /* soft */ }
                    if (!stillOpenBeforeReload || drawerClosed || dlg.element?.isConnected === false) return;
                    dlg.destroy();
                    const allRows = (await renderLedgerAllFn(ref.avId!)).rows;
                    const fresh = allRows.find((entry) => entry.itemID === row.itemID);
                    if (fresh && !plugin.isUnloading) void openLedgerDetailDrawer({ ...options, row: fresh, rows: allRows });
                },
            });
        });
    }

    const cardRows: { key?: string; label: string; value: string }[] = [];
    let activeTab: "core" | "history" = (vehicleAction || activityTarget) ? "history" : "core";
    let emptyFieldsExpanded = false;

    function buildView() {
        body.innerHTML = "";
        cardRows.length = 0;
        const editAction = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement;
        const closeAction = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement;
        editAction.textContent = t("ledger.detailEditAll");
        if (plugin.runtime?.guestModeActive) {
            editAction.disabled = true;
            editAction.title = t("guest.writeBlocked");
        }
        editAction.onclick = () => buildEdit();
        closeAction.textContent = t("close");
        closeAction.onclick = () => dlg.destroy();
        (dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement).hidden = false;

        // 1. 摘要头部（状态胶囊 + 关键信息速览）
        const summaryHead = document.createElement("div");
        summaryHead.className = "lv-drawer-summary-head";
        const summarySub = document.createElement("div");
        summarySub.className = "lv-drawer-summary-sub";
        const warnDays = plugin?.schemaCatalog?.[active]?.reminders?.[0]?.leadDays ?? 30;
        const tone = calculateLedgerTone(row, ref.columns, warnDays);
        const statusBadge = document.createElement("span");
        statusBadge.className = `lv-pill-badge ${tone === "danger" ? "lv-pill-badge--danger" : tone === "warn" ? "lv-pill-badge--warn" : "lv-pill-badge--fresh"}`;
        const statusVal = ref.columns?.status ? cellTextFn(row.cells?.[ref.columns.status], "status") : "";
        const expiryVal = ref.columns?.expiry ? cellTextFn(row.cells?.[ref.columns.expiry], "expiry") : "";
        const memberVal = ref.columns?.member ? cellTextFn(row.cells?.[ref.columns.member], "member") : "";
        statusBadge.textContent = statusVal && statusVal !== "—"
            ? statusVal
            : (tone === "danger" || tone === "warn" ? t("ledger.statusSoon") : t("ledger.statusOk"));
        summarySub.appendChild(statusBadge);
        const summaryParts = [
            t(`module.${active}`) !== `module.${active}` ? t(`module.${active}`) : active,
            memberVal && memberVal !== "—" ? memberVal : "",
            rowCategory && rowCategory !== "—" ? cellTextFn(row.cells?.[ref.columns.category ?? ""], "category") : "",
            expiryVal && expiryVal !== "—" ? expiryVal : "",
        ].filter(Boolean);
        if (summaryParts.length > 0) {
            const metaSpan = document.createElement("span");
            metaSpan.textContent = summaryParts.join(" · ");
            summarySub.appendChild(metaSpan);
        }
        summaryHead.appendChild(summarySub);
        body.appendChild(summaryHead);

        if (active === "vehicles") {
            const quick = document.createElement("section");
            quick.className = "lv-vehicle-quick-actions lv-quick-bar";
            const label = document.createElement("b"); label.textContent = t("vehicle.quickActions"); label.className = "lv-domain-title";
            quick.appendChild(label);
            for (const action of ["fuel", "charging", "maintenance"] as const) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "b3-button b3-button--outline";
                button.textContent = t(`vehicle.quick.${action}`);
                if (plugin.runtime?.guestModeActive) {
                    button.disabled = true;
                    button.title = t("guest.writeBlocked");
                }
                button.onclick = () => {
                    if (plugin.runtime?.guestModeActive) {
                        showMessageFn(t("guest.writeBlocked"), 3500, "info");
                        return;
                    }
                    requestVehicleAction(action);
                };
                quick.appendChild(button);
            }
            body.appendChild(quick);
        }

        // 2. 分区页签（核心信息 / 关联记录与附件）
        const tabsBar = document.createElement("div");
        tabsBar.className = "lv-drawer-tabs";
        tabsBar.setAttribute("role", "tablist");
        const tabCore = document.createElement("button");
        tabCore.type = "button";
        tabCore.className = `lv-d-tab${activeTab === "core" ? " on" : ""}`;
        tabCore.dataset.dtab = "core";
        tabCore.setAttribute("role", "tab");
        tabCore.setAttribute("aria-selected", String(activeTab === "core"));
        tabCore.textContent = t("drawer.tabCore");

        const tabHistory = document.createElement("button");
        tabHistory.type = "button";
        tabHistory.className = `lv-d-tab${activeTab === "history" ? " on" : ""}`;
        tabHistory.dataset.dtab = "history";
        tabHistory.setAttribute("role", "tab");
        tabHistory.setAttribute("aria-selected", String(activeTab === "history"));
        tabHistory.textContent = t("drawer.tabHistory");
        tabsBar.append(tabCore, tabHistory);
        body.appendChild(tabsBar);

        const paneCore = document.createElement("div");
        paneCore.id = "lv-detail-pane-core";
        paneCore.classList.toggle("lv-drawer-pane--hidden", activeTab !== "core");
        const paneHistory = document.createElement("div");
        paneHistory.id = "lv-detail-pane-history";
        paneHistory.classList.toggle("lv-drawer-pane--hidden", activeTab !== "history");
        body.append(paneCore, paneHistory);

        const setDrawerTab = (next: "core" | "history") => {
            activeTab = next;
            tabCore.classList.toggle("on", next === "core");
            tabCore.setAttribute("aria-selected", String(next === "core"));
            tabHistory.classList.toggle("on", next === "history");
            tabHistory.setAttribute("aria-selected", String(next === "history"));
            paneCore.classList.toggle("lv-drawer-pane--hidden", next !== "core");
            paneHistory.classList.toggle("lv-drawer-pane--hidden", next !== "history");
        };
        tabCore.onclick = () => setDrawerTab("core");
        tabHistory.onclick = () => setDrawerTab("history");

        const intro = document.createElement("p");
        intro.className = "lv-detail-wide lv-detail-intro";
        intro.textContent = inlineEditHint();
        paneCore.appendChild(intro);

        const filledContainer = document.createElement("div");
        filledContainer.className = "lv-kv-grid";
        const emptyContainer = document.createElement("div");
        emptyContainer.className = "lv-empty-fold-list" + (emptyFieldsExpanded ? "" : " lv-drawer-pane--hidden");
        let emptyCount = 0;

        for (const col of schemaCols) {
            const keyID = ref.columns?.[col.key];
            if (!keyID) continue;
            if (col.type === "mAsset") continue; // 附件统一归入「关联记录与附件」分区
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
            if (active === "certs" && (SENSITIVE_ID_KEYS.has(col.key) || SENSITIVE_CREDENTIAL_KEYS.has(col.key))) {
                const full = String(rawFromValue("text", cell) ?? "").trim();
                if (full) {
                    const mask = col.key === "x_cert_id_number" ? maskIdNumber(full) : maskCredentialNumber(full);
                    v.textContent = mask;
                    const reveal = document.createElement("button");
                    reveal.type = "button";
                    reveal.className = "b3-button b3-button--text lv-btn-text-sm";
                    reveal.textContent = t("ledger.idNumberShow");
                    let shown = false;
                    reveal.onclick = () => {
                        shown = !shown;
                        v.textContent = shown ? full : mask;
                        reveal.textContent = shown ? t("ledger.idNumberHide") : t("ledger.idNumberShow");
                    };
                    const copy = document.createElement("button");
                    copy.type = "button";
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
                        birthFill.type = "button";
                        birthFill.className = "b3-button b3-button--text lv-btn-text-sm";
                        birthFill.textContent = t("ledger.idBirthFill").replace("${birth}", parsedId.birth);
                        if (plugin.runtime?.guestModeActive) {
                            birthFill.disabled = true;
                            birthFill.title = t("guest.writeBlocked");
                        }
                        birthFill.onclick = async () => {
                            if (plugin.runtime?.guestModeActive) {
                                showMessageFn(t("guest.writeBlocked"), 3500, "info");
                                return;
                            }
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
                                showMessageFn(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                            }
                        };
                        line.append(birthFill);
                    }
                }
            }
            const fieldEmpty = isDrawerFieldEmpty(String(v.textContent ?? ""), t("ledger.detailEmpty"));
            if (EDITABLE.has(col.type)) {
                if (fieldEmpty) {
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

            // 物品存放位置专项：同处空间关联速查
            if ((col.key === "location" || col.key === "copy_location" || col.key === "store_place") && cell) {
                const rawLoc = cellTextFn(cell, col.key);
                if (rawLoc && rawLoc !== "—" && !v.classList.contains("is-empty")) {
                    const siblingBtn = document.createElement("button");
                    siblingBtn.type = "button";
                    siblingBtn.className = "b3-button b3-button--text lv-btn-text-sm";
                    siblingBtn.innerHTML = `${uiIcon("mapPin", "", 12)} ${t("ledger.locSiblings")}`;
                    siblingBtn.onclick = async () => {
                        try {
                            const { findSiblingItemsInSameLocation } = await import("./location-index");
                            const res = await renderLedgerAllFn(ref.avId!);
                            const nameCol = ref.columns?.name;
                            const locCol = ref.columns?.[col.key];
                            if (!nameCol || !locCol) return;
                            const inputs = res.rows.map((r) => ({
                                rowId: r.itemID,
                                moduleId: active,
                                name: cellTextFn(r.cells[nameCol], "name"),
                                location: cellTextFn(r.cells[locCol], col.key),
                            })).filter((it) => it.name && it.location);
                            const match = findSiblingItemsInSameLocation(row.itemID, inputs);
                            if (match && match.siblings.length > 0) {
                                const siblingNames = match.siblings.map((s) => s.name).join("、");
                                showMessageFn(`${match.location} 存放的其他物品 (${match.siblings.length}): ${siblingNames}`, 5000, "info");
                            } else {
                                showMessageFn(t("ledger.locNoSiblings"), 3000, "info");
                            }
                        } catch {
                            showMessageFn(t("ledger.locNoSiblings"), 3000, "info");
                        }
                    };
                    line.append(siblingBtn);
                }
            }

            if (fieldEmpty) {
                emptyCount++;
                emptyContainer.appendChild(line);
            } else {
                filledContainer.appendChild(line);
            }
            cardRows.push({ key: col.key, label: colLabel(col), value: v.classList.contains("is-empty") ? "—" : String(v.textContent) });
        }

        const schemaKeyIDs = new Set(Object.values<string>(ref.columns ?? {}));
        const customCols = avCols.filter((c: any) => c?.id && !schemaKeyIDs.has(c.id) && String(c.name ?? "").trim() !== "");
        const customFilledLines: HTMLElement[] = [];
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
            const customEmpty = isDrawerFieldEmpty(String(v.textContent ?? ""), t("ledger.detailEmpty"));
            if (EDITABLE.has(c.type)) {
                if (customEmpty) { v.textContent = t("ledger.detailEmpty"); v.classList.add("is-empty"); }
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
            if (customEmpty) {
                emptyCount++;
                emptyContainer.appendChild(line);
            } else {
                customFilledLines.push(line);
            }
            cardRows.push({ label: String(c.name), value: cellTextFn(row.cells[c.id]) });
        }
        if (customFilledLines.length > 0) {
            const head = document.createElement("div");
            head.className = "ft__on-surface lv-dialog-sec-head";
            head.textContent = t("ledger.customCols");
            filledContainer.appendChild(head);
            for (const line of customFilledLines) filledContainer.appendChild(line);
        }

        paneCore.appendChild(filledContainer);
        if (emptyCount > 0) {
            const foldWrap = document.createElement("div");
            foldWrap.className = "lv-empty-fold";
            const foldBtn = document.createElement("button");
            foldBtn.type = "button";
            foldBtn.className = "lv-empty-fold-btn";
            foldBtn.setAttribute("aria-expanded", String(emptyFieldsExpanded));
            const renderFoldLabel = () => {
                foldBtn.innerHTML = `<span>${t("drawer.emptyFoldTitle").replace("${n}", String(emptyCount))}</span><span>${emptyFieldsExpanded ? t("drawer.emptyFoldCollapse") : t("drawer.emptyFoldExpand")} ${uiIcon(emptyFieldsExpanded ? "chevronUp" : "chevronDown", "", 12)}</span>`;
            };
            renderFoldLabel();
            foldBtn.onclick = () => {
                emptyFieldsExpanded = !emptyFieldsExpanded;
                foldBtn.setAttribute("aria-expanded", String(emptyFieldsExpanded));
                emptyContainer.classList.toggle("lv-drawer-pane--hidden", !emptyFieldsExpanded);
                renderFoldLabel();
            };
            foldWrap.appendChild(foldBtn);
            foldWrap.appendChild(emptyContainer);
            paneCore.appendChild(foldWrap);
        }

        // 3. 关联记录与附件分区（paneHistory）
        const addRowLogSection = (opts: any) => renderRowLogSection({
            body: paneHistory,
            row,
            active,
            plugin,
            activityTarget,
            t,
            showMessageFn,
            ...opts,
        });

        const addHistoryToPane = () => {
            const history = (plugin.runtime?.renewHistory?.[row.itemID] ?? []) as { from: string; to: string; at: string }[];
            if (history.length === 0) return;
            const head = document.createElement("div");
            head.className = "ft__on-surface lv-dialog-sec-head";
            head.textContent = t("ledger.renewHistory");
            paneHistory.appendChild(head);
            for (const h of history) {
                const line = document.createElement("div");
                line.className = active === "vehicles" ? "lv-dialog-row-text lv-detail-wide" : "lv-dialog-row-text";
                line.innerHTML = `${escapeHtml(h.from)} ${uiIcon("forward", "", 12)} ${escapeHtml(h.to)} · <span class="lv-dialog-row-sub">${escapeHtml(h.at.slice(0, 10))}</span>`;
                paneHistory.appendChild(line);
            }
        };

        const addAttachmentsToPane = () => {
            const assetCols = schemaCols.filter((col) => col.type === "mAsset" && ref.columns?.[col.key]);
            if (!assetCols.length) return;
            import("./attachment-drawer").then(({ renderAttachmentDrawerSection }) => {
                renderAttachmentDrawerSection({
                    body: paneHistory,
                    assetCols,
                    ref,
                    row,
                    active,
                    plugin,
                    t,
                    DialogCls,
                    showMessageFn,
                    onUploadSuccess: async () => {
                        dlg.destroy();
                        await onReload();
                    },
                });
            });
        };

        addHistoryToPane();
        addAttachmentsToPane();
        renderDrawerQrSection({ body: paneHistory, row, ref, active, t });

        // 跨模块业务时间线与子记录
        (async () => {
            if (active === "vehicles") {
                const { renderVehicleDetailSections } = await import("./vehicle-drawer");
                await renderVehicleDetailSections({
                    body: paneHistory,
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
                body: paneHistory,
                active,
                row,
                ref,
                plugin,
                t,
                DialogCls,
                dlg,
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
            body: paneHistory,
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

        import("./drawer-sections").then(async ({
            renderRxToMedicineButton,
            renderStockInButton,
            renderShoppingToAssetButton,
            renderRenewChainSection,
            renderFavorsSyncSection,
        }) => {
            renderRxToMedicineButton({ body: paneHistory, row, ref, active, plugin, t, showMessageFn, cellTextFn });
            renderStockInButton({ body: paneHistory, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn });
            renderShoppingToAssetButton({ body: paneHistory, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn });
            const certRows = active === "certs" && ref.columns?.renewed_to
                ? (Array.isArray(options.rows) && options.rows.length > 0
                    ? options.rows
                    : ((await renderLedgerAllFn(ref.avId!).catch(() => ({ rows: [] }))).rows ?? []))
                : [];
            renderRenewChainSection({
                body: paneHistory,
                row,
                rows: certRows,
                ref,
                active,
                plugin,
                t,
                DialogCls,
                showMessageFn,
                cellTextFn,
                onChainUpdated: async (targetRowId: string) => {
                    const stillOpenBeforeReload = !drawerClosed && dlg.element?.isConnected !== false;
                    await onReload();
                    try { await plugin.refreshHub([active]); } catch { /* ignore */ }
                    if (!stillOpenBeforeReload || drawerClosed || dlg.element?.isConnected === false) return;
                    dlg.destroy();
                    const allRows = (await renderLedgerAllFn(ref.avId!)).rows;
                    const fresh = allRows.find((x) => x.itemID === targetRowId);
                    if (fresh && !plugin.isUnloading) void openLedgerDetailDrawer({ ...options, row: fresh, rows: allRows });
                },
            });

            renderFavorsSyncSection({
                body: paneHistory,
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

    const moreDetails = dlg.element?.querySelector?.(".lv-detail-more") as HTMLDetailsElement | null;
    moreDetails?.addEventListener?.("toggle", () => {
        if (!moreDetails.open) return;
        const actionsBar = dlg.element?.querySelector?.(".lv-detail-actions") as HTMLElement | null;
        const menuEl = moreDetails.querySelector<HTMLElement>(".lv-detail-more-menu");
        if (actionsBar && menuEl && typeof actionsBar.getBoundingClientRect === "function" && typeof window !== "undefined") {
            const rect = actionsBar.getBoundingClientRect();
            const bottomPx = Math.max(68, Math.round(window.innerHeight - rect.top + 8));
            menuEl.style.setProperty("--lv-detail-more-bottom", `${bottomPx}px`);
        }
    });
    dlg.element?.addEventListener?.("click", (event: Event) => {
        if (!moreDetails?.open) return;
        const target = event.target as Node | null;
        if (target && typeof moreDetails.contains === "function" && !moreDetails.contains(target)) {
            moreDetails.open = false;
        }
    });

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
            plugin,
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
