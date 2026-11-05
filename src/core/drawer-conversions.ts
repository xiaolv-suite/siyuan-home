/**
 * 台账行详情抽屉跨模块流转与快捷入库流
 * 包含：
 * 1. 处方流转入药箱 (Rx to Medicine)
 * 2. 采购条目药箱入库加减库存 (Shopping Stock-In)
 * 3. 采购条目转固定资产档案 (Shopping to Asset-Real)
 */

import { confirm } from "@/libs/dialog";
import { bindDialogA11y } from "./dialog-a11y";
import { uiIcon } from "@/ui/icons";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/**
 * 就医台账：处方流转入药箱快捷按钮
 */
export function renderRxToMedicineButton(options: RxToMedicineButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, showMessageFn, cellTextFn } = options;
    if (active !== "health" || !ref?.columns) return;
    const medRef = plugin.settings?.dbRefs?.["medicine"];
    if (!medRef?.avId) return;
    const name = String(cellTextFn(row.cells?.[ref.columns.name]));
    if (!name || name === "—") return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "b3-button b3-button--outline lv-att-upload-btn";
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
                const relBlock = row.cells?.[ref.columns!.member]?.relation?.blockIDs?.[0];
                if (memKey && relBlock) await setCell(medRef.avId!, memKey, itemID, { type: "relation", relation: { blockIDs: [relBlock], contents: null } }, {
                    idempotencyKey: `${medicineOperationKey}:member`,
                    retries: 1,
                });
                showMessageFn(t("ledger.rxToMedicineDone").replace("${name}", name), 3000, "info");
                pendingMedicineID = null;
                medicineOperationKey = null;
            } catch (e) {
                showMessageFn(t("ledger.rxToMedicineFailed").replace("${msg}", errMsg(e)), 6000, "error");
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

/**
 * 采购清单：药箱入库加减库存按钮与对齐弹窗
 */
export function renderStockInButton(options: StockInButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn } = options;
    if (active !== "shopping" || !ref?.columns) return;
    const medRef = plugin.settings?.dbRefs?.["medicine"];
    if (!medRef?.avId) return;
    const name = String(cellTextFn(row.cells?.[ref.columns.name]));
    if (!name || name === "—") return;
    const qtyRaw = cellTextFn(row.cells?.[ref.columns.qty]);
    const qty = qtyRaw !== "—" && qtyRaw !== "" && Number.isFinite(Number(qtyRaw)) && Number(qtyRaw) > 0 ? Number(qtyRaw) : 1;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "b3-button b3-button--outline lv-att-upload-btn";
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

            const matches = res.rows.filter((r) => String(cellTextFn(r.cells?.[nameKey])).trim() === name);
            const dialog = new DialogCls({
                title: t("ledger.stockIn"),
                content: `<div class="b3-dialog__content lv-dialog-col"><p class="ft__on-surface" id="lv-stockin-body"></p></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-stockin-cancel">${t("cancel")}</button><button class="b3-button" id="lv-stockin-ok">${t("save")}</button></div>`,
                width: "420px",
                destroyCallback: () => {
                    if (!stockCommitted) {
                        stockInBusy = false;
                        btn.disabled = false;
                    }
                },
            });
            bindDialogA11y({ dlg: dialog });
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
                        const latestMatches = nameKey ? latest.rows.filter((r) => String(r.cells?.[nameKey]?.text?.content ?? "").trim() === name) : [];
                        const target = stockWrite ? { itemID: stockWrite.itemID, cells: {} as any } : latestMatches[0];
                        if (!stockOperationKey) stockOperationKey = `ledger:stock-in:${row.itemID}:${Date.now()}`;
                        if (target) {
                            if (!stockWrite) {
                                const cur = target.cells?.[stockKey]?.number;
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
                        showMessageFn(t("ledger.stockInFailed").replace("${msg}", errMsg(e)), 6000, "error");
                        ok.disabled = false;
                        if (cancel) cancel.disabled = false;
                    } finally {
                        stockInBusy = false;
                        btn.disabled = false;
                    }
                };
            }
        } catch (e) {
            showMessageFn(t("ledger.stockInFailed").replace("${msg}", errMsg(e)), 6000, "error");
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

/**
 * 采购清单：一键转固定资产档案
 */
export function renderShoppingToAssetButton(options: ShoppingToAssetButtonOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, DialogCls, showMessageFn, cellTextFn } = options;
    if (active !== "shopping" || !ref?.columns) return;
    const assetsRef = plugin.settings?.dbRefs?.["assets-real"];
    if (!assetsRef?.avId || !assetsRef.columns) return;
    const name = String(cellTextFn(row.cells?.[ref.columns.name]));
    if (!name || name === "—") return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "b3-button b3-button--outline lv-att-upload-btn lv-ml-6";
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
                "digital",
                "appliance",
                "furniture",
                "apparel",
                "collection",
                "sports",
                "other_ar",
            ].map((val) => `<option value="${val}" ${val === draft.suggestedCategory ? "selected" : ""}>${t(`field.category.opt.${val}`)}</option>`).join("");

            const dlg = new DialogCls({
                title: t("ledger.shoppingToAssetTitle"),
                content: `<div class="b3-dialog__content lv-dialog-col">
                    <p class="lv-caption">${t("ledger.shoppingToAssetIntro")}</p>
                    <label class="lv-form-group">
                        <span class="lv-caption">${t("field.name")}</span>
                        <input class="b3-text-field" id="lv-s2a-name" value="${draft.name}" />
                    </label>
                    <label class="lv-form-group">
                        <span class="lv-caption">${t("field.category")}</span>
                        <select class="b3-select" id="lv-s2a-cat">${catOptions}</select>
                    </label>
                    <label class="lv-form-group">
                        <span class="lv-caption">${t("field.amount")}</span>
                        <input class="b3-text-field" id="lv-s2a-amount" type="number" inputMode="numeric" value="${draft.amount ?? ""}" />
                    </label>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="lv-s2a-cancel">${t("cancel")}</button>
                    <button class="b3-button" id="lv-s2a-save">${t("save")}</button>
                </div>`,
                width: "420px",
            });

            let s2aSaving = false;
            bindDialogA11y({
                dlg,
                defaultFocus: "#lv-s2a-name",
                onClose: () => {
                    if (!s2aSaving) {
                        busy = false;
                        btn.disabled = false;
                    }
                },
            });
            const cancelBtn = dlg.element.querySelector("#lv-s2a-cancel") as HTMLButtonElement | null;
            if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();

            const saveBtn = dlg.element.querySelector("#lv-s2a-save") as HTMLButtonElement | null;
            if (saveBtn) {
                saveBtn.onclick = async function (this: HTMLButtonElement) {
                    s2aSaving = true;
                    const nameVal = (dlg.element.querySelector("#lv-s2a-name") as HTMLInputElement)?.value.trim() || draft.name;
                    const catVal = (dlg.element.querySelector("#lv-s2a-cat") as HTMLSelectElement)?.value || draft.suggestedCategory;
                    const amtVal = Number((dlg.element.querySelector("#lv-s2a-amount") as HTMLInputElement)?.value) || draft.amount;

                    this.disabled = true;
                    dlg.destroy();
                    try {
                        // 经写入网关：分类 select 双形态、购买日转时间戳（此前单形态 + 日期字符串，分类与日期落盘为空）
                        const { writeLedgerRow } = await import("./ledger-writer");
                        const { failed } = await writeLedgerRow({
                            moduleId: "assets-real",
                            target: assetsRef,
                            name: nameVal,
                            fields: {
                                category: catVal,
                                amount: Number.isFinite(amtVal) ? amtVal : undefined,
                                date: draft.date,
                                channel: draft.channel,
                                member: draft.memberId,
                                note: draft.note ? `${draft.note} (来自购物记录)` : "来自购物记录",
                            },
                        });
                        if (failed.length > 0) {
                            showMessageFn(t("ledger.writePartialFailed").replace("${fields}", failed.map((k) => t(`field.${k}`)).join("、")), 6000, "error");
                        }
                        showMessageFn(t("ledger.shoppingToAssetDone").replace("${name}", nameVal), 3500, "info");
                        btn.innerHTML = `${uiIcon("check", "", 13)} ${t("ledger.shoppingToAssetDoneShort")}`;
                        btn.disabled = true;
                    } catch (err) {
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", errMsg(err)), 6000, "error");
                        busy = false;
                        btn.disabled = false;
                    }
                };
            }
        } catch (e) {
            showMessageFn(t("ledger.logReadFailed").replace("${msg}", errMsg(e)), 6000, "error");
            busy = false;
            btn.disabled = false;
        }
    };
    body.appendChild(btn);
}
