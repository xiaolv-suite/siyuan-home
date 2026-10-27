/**
 * 台账详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：证件换证链 (Certs Renew Chain)、人情转人脉 (Favors to Contacts)、购物转资产 (Shopping to Asset)
 */

import { setCell } from "./siyuan";
import { saveRuntime } from "./hub/runtime";
import { confirm } from "@/libs/dialog";

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
        btn.className = "b3-button b3-button--outline";
        btn.style.cssText = "margin-top:8px;font-size:12px";
        btn.textContent = t("ledger.linkNew");
        btn.onclick = () => {
            const picker = new DialogCls({
                title: t("ledger.pickNew"),
                content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-pick-body" style="max-height:50vh;overflow:auto;padding:12px"></div>`,
                width: "420px",
            });
            const list = picker.element.querySelector("#lv-pick-body") as HTMLElement;
            for (const r of rows) {
                if (r.itemID === row.itemID) continue;
                const b = document.createElement("button");
                b.className = "b3-button b3-button--text";
                b.style.cssText = "display:block;width:100%;text-align:left;font-size:13px;padding:6px 8px";
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
                        showMessageFn(t("ledger.renewLinkFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                        b.disabled = false;
                    }
                };
                list.appendChild(b);
            }
            if (!list.children.length) list.innerHTML = `<div class="ft__on-surface" style="font-size:13px">${t("ledger.noOtherRows")}</div>`;
        };
        return btn;
    };

    if (forward.length === 0 && backward.length === 0) {
        body.appendChild(linkBtn());
        return;
    }

    const head = document.createElement("div");
    head.className = "ft__on-surface";
    head.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px;font-weight:600";
    head.textContent = t("ledger.renewChain");
    body.appendChild(head);

    for (const id of forward) {
        const line = document.createElement("div");
        line.style.cssText = "padding:2px 0;font-size:12.5px;color:var(--lv-tx-2)";
        line.textContent = `→ ${nameOf(id)} (${t("ledger.newCert")})`;
        body.appendChild(line);
    }
    for (const r of backward) {
        const line = document.createElement("div");
        line.style.cssText = "padding:2px 0;font-size:12.5px;color:var(--lv-tx-2)";
        line.textContent = `← ${String(cellTextFn(r.cells[ref.columns!.name]))} (${t("ledger.oldCert")})`;
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
    head.className = "ft__on-surface";
    head.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px;font-weight:600";
    head.textContent = t("ec15.title");
    body.appendChild(head);

    const btn = document.createElement("button");
    btn.className = "b3-button b3-button--outline";
    btn.style.cssText = "margin-top:8px;font-size:12px";
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
            showMessageFn(t("ec15.failed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            btn.disabled = false;
        }
    };

    if (synced) {
        const tag = document.createElement("span");
        tag.className = "lv-caption";
        tag.style.cssText = "margin-left:8px;color:var(--lv-accent);font-weight:normal";
        tag.textContent = t("ec15.synced");
        head.appendChild(tag);
    }

    body.appendChild(btn);
}

export interface RxToMedicineButtonOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
}

export function renderRxToMedicineButton(options: RxToMedicineButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, showMessageFn, cellTextFn } = options;
    if (active !== "health" || !ref?.columns) return;
    const medRef = plugin.settings.dbRefs?.["medicine"];
    if (!medRef?.avId) return;
    const name = String(cellTextFn(row.cells[ref.columns.name]));
    if (!name || name === "—") return;

    const btn = document.createElement("button");
    btn.className = "b3-button b3-button--outline";
    btn.style.cssText = "margin-top:8px;font-size:12px";
    btn.textContent = t("ledger.rxToMedicine");

    let pendingMedicineID: string | null = null;
    let medicineOperationKey: string | null = null;

    btn.onclick = () => {
        if (btn.disabled) return;
        confirm(t("ledger.rxToMedicine"), t("ledger.rxToMedicineBody").replace("${name}", name), async () => {
            btn.disabled = true;
            try {
                const { addDetachedRow, setCell } = await import("./siyuan");
                const { selectCellValue } = await import("./avcell");
                if (!medicineOperationKey) medicineOperationKey = `ledger:rx-to-medicine:${row.itemID}:${Date.now()}`;
                const itemID = pendingMedicineID ?? await addDetachedRow(medRef.avId!, name, {
                    idempotencyKey: `${medicineOperationKey}:row`,
                    retries: 1,
                });
                pendingMedicineID = itemID;
                const catKey = medRef.columns?.category;
                if (catKey) await setCell(medRef.avId!, catKey, itemID, selectCellValue("rx"), {
                    idempotencyKey: `${medicineOperationKey}:category`,
                    retries: 1,
                });
                const memKey = medRef.columns?.member;
                const relBlock = row.cells[ref.columns!.member]?.relation?.blockIDs?.[0];
                if (memKey && relBlock) await setCell(medRef.avId!, memKey, itemID, { type: "relation", relation: { blockIDs: [relBlock], contents: null } }, {
                    idempotencyKey: `${medicineOperationKey}:member`,
                    retries: 1,
                });
                showMessageFn(t("ledger.rxToMedicineDone").replace("${name}", name), 3000, "info");
                pendingMedicineID = null;
                medicineOperationKey = null;
            } catch (e) {
                showMessageFn(t("ledger.rxToMedicineFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                btn.disabled = false;
            }
        });
    };
    body.appendChild(btn);
}

export interface StockInButtonOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
}

export function renderStockInButton(options: StockInButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn } = options;
    if (active !== "shopping" || !ref?.columns) return;
    const medRef = plugin.settings.dbRefs?.["medicine"];
    if (!medRef?.avId) return;
    const name = String(cellTextFn(row.cells[ref.columns.name]));
    if (!name || name === "—") return;
    const qtyRaw = cellTextFn(row.cells[ref.columns.qty]);
    const qty = qtyRaw !== "—" && qtyRaw !== "" && Number.isFinite(Number(qtyRaw)) && Number(qtyRaw) > 0 ? Number(qtyRaw) : 1;

    const btn = document.createElement("button");
    btn.className = "b3-button b3-button--outline";
    btn.style.cssText = "margin-top:8px;font-size:12px";
    btn.textContent = t("ledger.stockIn");

    let pendingStockItemID: string | null = null;
    let stockOperationKey: string | null = null;
    let stockWrite: { itemID: string; value: number; idempotencyKey: string } | null = null;
    let stockInBusy = false;

    btn.onclick = async () => {
        if (stockInBusy) return;
        stockInBusy = true;
        btn.disabled = true;
        try {
            const { renderLedgerAll, addDetachedRow, setCell } = await import("./siyuan");
            const res = await renderLedgerAll(medRef.avId!);
            if (!res.complete) throw new Error(t("ledger.loadIncomplete"));
            const nameKey = medRef.columns?.name;
            const stockKey = medRef.columns?.stock ?? medRef.columns?.stock_qty;
            if (!nameKey || !stockKey) throw new Error("stock column is unavailable");

            const matches = res.rows.filter((r) => String(cellTextFn(r.cells[nameKey])).trim() === name);
            const dialog = new DialogCls({
                title: t("ledger.stockIn"),
                content: `<div class="b3-dialog__content"><p class="ft__on-surface" id="lv-stockin-body" style="font-size:13px;line-height:1.6"></p></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-stockin-cancel">${t("cancel")}</button><button class="b3-button" id="lv-stockin-ok">${t("save")}</button></div>`,
                width: "420px",
                destroyCallback: () => {
                    if (!stockCommitted) {
                        stockInBusy = false;
                        btn.disabled = false;
                    }
                },
            });
            let stockCommitted = false;
            const bodyEl = dialog.element.querySelector("#lv-stockin-body") as HTMLElement;
            if (bodyEl) bodyEl.textContent = t("ledger.stockInBody").replace("${name}", name).replace("${qty}", String(qty)).replace("${n}", String(matches.length));
            const cancel = dialog.element.querySelector("#lv-stockin-cancel") as HTMLButtonElement;
            const ok = dialog.element.querySelector("#lv-stockin-ok") as HTMLButtonElement;
            if (cancel) cancel.onclick = () => { dialog.destroy(); stockInBusy = false; btn.disabled = false; };
            if (ok) {
                ok.onclick = async () => {
                    if (ok.disabled) return;
                    ok.disabled = true;
                    if (cancel) cancel.disabled = true;
                    try {
                        const latest = await renderLedgerAll(medRef.avId!);
                        if (!latest.complete) throw new Error(t("ledger.loadIncomplete"));
                        const latestMatches = nameKey ? latest.rows.filter((r) => String(r.cells[nameKey]?.text?.content ?? "").trim() === name) : [];
                        const target = stockWrite ? { itemID: stockWrite.itemID, cells: {} } : latestMatches[0];
                        if (!stockOperationKey) stockOperationKey = `ledger:stock-in:${row.itemID}:${Date.now()}`;
                        if (target) {
                            if (!stockWrite) {
                                const cur = target.cells[stockKey]?.number;
                                const curVal = cur?.isNotEmpty && typeof cur.content === "number" ? cur.content : 0;
                                stockWrite = { itemID: target.itemID, value: curVal + qty, idempotencyKey: `${stockOperationKey}:cell:${target.itemID}` };
                            }
                            await setCell(medRef.avId!, stockKey, stockWrite.itemID, { type: "number", number: { content: stockWrite.value, isNotEmpty: true } }, {
                                idempotencyKey: stockWrite.idempotencyKey,
                                retries: 1,
                            });
                        } else {
                            const itemID = pendingStockItemID ?? await addDetachedRow(medRef.avId!, name, {
                                idempotencyKey: `${stockOperationKey}:row`,
                                retries: 1,
                            });
                            pendingStockItemID = itemID;
                            if (!stockWrite) stockWrite = { itemID, value: qty, idempotencyKey: `${stockOperationKey}:cell:${itemID}` };
                            await setCell(medRef.avId!, stockKey, stockWrite.itemID, { type: "number", number: { content: stockWrite.value, isNotEmpty: true } }, {
                                idempotencyKey: stockWrite.idempotencyKey,
                                retries: 1,
                            });
                            pendingStockItemID = null;
                        }
                        stockCommitted = true;
                        stockOperationKey = null;
                        stockWrite = null;
                        dialog.destroy();
                        try {
                            await plugin.refreshHub?.(["medicine"]);
                        } catch { /* soft */ }
                        showMessageFn(t("ledger.stockInDone"), 3000, "info");
                    } catch (e) {
                        showMessageFn(t("ledger.stockInFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                        ok.disabled = false;
                        if (cancel) cancel.disabled = false;
                    } finally {
                        stockInBusy = false;
                        btn.disabled = false;
                    }
                };
            }
        } catch (e) {
            showMessageFn(t("ledger.stockInFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            stockInBusy = false;
            btn.disabled = false;
        }
    };
    body.appendChild(btn);
}

export interface ShoppingToAssetButtonOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
}

export function renderShoppingToAssetButton(options: ShoppingToAssetButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn } = options;
    if (active !== "shopping" || !ref?.columns) return;
    const assetsRef = plugin.settings.dbRefs?.["assets-real"];
    if (!assetsRef?.avId || !assetsRef.columns) return;
    const name = String(cellTextFn(row.cells[ref.columns.name]));
    if (!name || name === "—") return;

    const btn = document.createElement("button");
    btn.className = "b3-button b3-button--outline";
    btn.style.cssText = "margin-top:8px;margin-left:6px;font-size:12px";
    btn.textContent = t("ledger.shoppingToAsset");

    let busy = false;
    btn.onclick = async () => {
        if (busy) return;
        busy = true;
        btn.disabled = true;
        try {
            const { mapShoppingToAssetReal } = await import("./valuation");
            const draft = mapShoppingToAssetReal(row, ref.columns!);

            const catOptions = [
                { val: "digital", label: "数码电子" },
                { val: "appliance", label: "家用电器" },
                { val: "furniture", label: "家具家居" },
                { val: "apparel", label: "服饰箱包" },
                { val: "collection", label: "潮玩收藏" },
                { val: "sports", label: "运动户外" },
                { val: "other_ar", label: "其他资产" },
            ].map((c) => `<option value="${c.val}" ${c.val === draft.suggestedCategory ? "selected" : ""}>${c.label}</option>`).join("");

            const dlg = new DialogCls({
                title: t("ledger.shoppingToAssetTitle"),
                content: `<div class="b3-dialog__content lv-dialog-col" style="display:flex;flex-direction:column;gap:10px;padding:12px">
                    <p class="lv-caption" style="margin:0">${t("ledger.shoppingToAssetIntro")}</p>
                    <label style="display:flex;flex-direction:column;gap:4px">
                        <span class="lv-caption">${t("field.name")}</span>
                        <input class="b3-text-field" id="lv-s2a-name" value="${draft.name}" style="width:100%" />
                    </label>
                    <label style="display:flex;flex-direction:column;gap:4px">
                        <span class="lv-caption">${t("field.category")}</span>
                        <select class="b3-select" id="lv-s2a-cat" style="width:100%">${catOptions}</select>
                    </label>
                    <label style="display:flex;flex-direction:column;gap:4px">
                        <span class="lv-caption">${t("field.amount")}</span>
                        <input class="b3-text-field" id="lv-s2a-amount" type="number" value="${draft.amount ?? ""}" style="width:100%" />
                    </label>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="lv-s2a-cancel">${t("cancel")}</button>
                    <button class="b3-button" id="lv-s2a-save">${t("save")}</button>
                </div>`,
                width: "420px",
            });

            const cancelBtn = dlg.element.querySelector("#lv-s2a-cancel") as HTMLButtonElement | null;
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    dlg.destroy();
                    busy = false;
                    btn.disabled = false;
                };
            }

            const saveBtn = dlg.element.querySelector("#lv-s2a-save") as HTMLButtonElement | null;
            if (saveBtn) {
                saveBtn.onclick = async function (this: HTMLButtonElement) {
                    const nameVal = (dlg.element.querySelector("#lv-s2a-name") as HTMLInputElement)?.value.trim() || draft.name;
                    const catVal = (dlg.element.querySelector("#lv-s2a-cat") as HTMLSelectElement)?.value || draft.suggestedCategory;
                    const amtVal = Number((dlg.element.querySelector("#lv-s2a-amount") as HTMLInputElement)?.value) || draft.amount;

                    this.disabled = true;
                    dlg.destroy();
                    try {
                        const { addDetachedRow, setCell } = await import("./siyuan");
                        const rowId = await addDetachedRow(assetsRef.avId!, nameVal);
                        if (assetsRef.columns.category) {
                            await setCell(assetsRef.avId!, assetsRef.columns.category, rowId, {
                                type: "select", select: { content: catVal },
                            });
                        }
                        if (assetsRef.columns.amount && typeof amtVal === "number" && Number.isFinite(amtVal)) {
                            await setCell(assetsRef.avId!, assetsRef.columns.amount, rowId, {
                                type: "number", number: { content: amtVal, isNotEmpty: true },
                            });
                        }
                        if (assetsRef.columns.date && draft.date) {
                            await setCell(assetsRef.avId!, assetsRef.columns.date, rowId, {
                                type: "date", date: { content: draft.date, isNotEmpty: true },
                            });
                        }
                        if (assetsRef.columns.channel && draft.channel) {
                            await setCell(assetsRef.avId!, assetsRef.columns.channel, rowId, {
                                type: "text", text: { content: draft.channel },
                            });
                        }
                        if (assetsRef.columns.member && draft.memberId) {
                            await setCell(assetsRef.avId!, assetsRef.columns.member, rowId, {
                                type: "relation", relation: { blockIDs: [draft.memberId] },
                            });
                        }
                        if (assetsRef.columns.note) {
                            const noteContent = draft.note ? `${draft.note} (来自购物记录)` : "来自购物记录";
                            await setCell(assetsRef.avId!, assetsRef.columns.note, rowId, {
                                type: "text", text: { content: noteContent },
                            });
                        }
                        showMessageFn(t("ledger.shoppingToAssetDone").replace("${name}", nameVal), 3500, "info");
                        btn.textContent = `✓ ${t("ledger.shoppingToAssetDoneShort")}`;
                        btn.disabled = true;
                    } catch (err) {
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                        busy = false;
                        btn.disabled = false;
                    }
                };
            }
        } catch (e) {
            showMessageFn(t("ledger.logReadFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            busy = false;
            btn.disabled = false;
        }
    };
    body.appendChild(btn);
}

