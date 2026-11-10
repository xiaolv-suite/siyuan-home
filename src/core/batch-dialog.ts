/**
 * 表格行批量改派成员与存放位置弹窗（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { setCell } from "./siyuan";
import type { FamilyMember } from "@/types";
import { bindDialogA11y } from "./dialog-a11y";

export interface BatchMemberDialogOptions {
    targetCol: string;
    membersList: FamilyMember[];
    selectedItemIds: string[];
    avId: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    onBatchSuccess?: (count: number) => Promise<void>;
}

export function openBatchMemberDialog(options: BatchMemberDialogOptions): void {
    if (typeof document === "undefined") return;
    const { targetCol, membersList, selectedItemIds, avId, t, DialogCls, showMessageFn, onBatchSuccess } = options;
    if (!membersList.length || !selectedItemIds.length || !avId) return;

    const dlg = new DialogCls({
        title: t("ledger.batchMemberTitle"),
        content: `
            <div class="b3-dialog__content lv-dialog-col" id="lv-batch-member-dialog">
                <label class="lv-caption">${t("ledger.batchMemberTitle")}：</label>
                <div class="lv-chips-wrap">
                    ${membersList.map((m) => `<button type="button" class="lv-preset-tag lv-batch-mem-tag" data-id="${m.avItemId}">${m.name}</button>`).join("")}
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">${t("cancel")}</button>
            </div>
        `,
        width: "380px",
    });

    const cancelBtn = dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();
    bindDialogA11y({ dlg, defaultFocus: cancelBtn });

    dlg.element.querySelectorAll(".lv-batch-mem-tag").forEach((btn: any) => {
        btn.onclick = async () => {
            const memId = btn.getAttribute("data-id");
            if (!memId) return;
            dlg.destroy();
            const count = selectedItemIds.length;
            showMessageFn(t("ledger.saving"), 2000, "info");
            try {
                for (const rowId of selectedItemIds) {
                    await setCell(avId, targetCol, rowId, { type: "relation", relation: { blockIDs: [memId] } });
                }
                showMessageFn(t("ledger.batchMember") + ` (${count})`, 3000, "info");
                if (onBatchSuccess) await onBatchSuccess(count);
            } catch (e) {
                showMessageFn(String(e), 5000, "error");
            }
        };
    });
}

export interface BatchLocationDialogOptions {
    targetCol: string;
    selectedItemIds: string[];
    locOptions: string[];
    avId: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    onBatchSuccess?: (count: number) => Promise<void>;
}

export function openBatchLocationDialog(options: BatchLocationDialogOptions): void {
    if (typeof document === "undefined") return;
    const { targetCol, selectedItemIds, locOptions, avId, t, DialogCls, showMessageFn, onBatchSuccess } = options;
    if (!selectedItemIds.length || !avId) return;

    const dlg = new DialogCls({
        title: t("ledger.batchLocationTitle"),
        content: `
            <div class="b3-dialog__content lv-dialog-col" id="lv-batch-loc-dialog">
                <label class="lv-caption">${t("ledger.batchLocationTitle")}：</label>
                <input class="b3-text-field fn__block" id="lv-batch-loc-input" placeholder="${t("capture.presetLocations")}" />
                <div class="lv-chips-wrap">
                    ${locOptions.map((loc) => `<button type="button" class="lv-preset-tag lv-batch-loc-tag" data-loc="${loc}">${loc}</button>`).join("")}
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">${t("cancel")}</button>
                <button class="b3-button" id="lv-batch-loc-ok">${t("save")}</button>
            </div>
        `,
        width: "420px",
    });

    const inp = dlg.element.querySelector("#lv-batch-loc-input") as HTMLInputElement | null;
    dlg.element.querySelectorAll(".lv-batch-loc-tag").forEach((btn: any) => {
        btn.onclick = () => {
            if (inp) inp.value = btn.getAttribute("data-loc") ?? "";
        };
    });

    if (inp) {
        inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) (dlg.element.querySelector("#lv-batch-loc-ok") as HTMLButtonElement)?.click();
        });
    }

    const cancelBtn = dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();
    bindDialogA11y({ dlg, defaultFocus: inp });

    const okBtn = dlg.element.querySelector("#lv-batch-loc-ok") as HTMLButtonElement | null;
    if (okBtn) {
        okBtn.onclick = async function (this: HTMLButtonElement) {
            const locVal = inp?.value.trim() ?? "";
            if (!locVal) {
                showMessageFn(t("form.required"), 2500, "info");
                inp?.focus();
                return;
            }
            this.disabled = true;
            try {
                const count = selectedItemIds.length;
                for (const rowId of selectedItemIds) {
                    await setCell(avId, targetCol, rowId, { type: "text", text: { content: locVal } });
                }
                dlg.destroy();
                showMessageFn(t("ledger.batchLocation") + ` (${count})`, 3000, "info");
                if (onBatchSuccess) await onBatchSuccess(count);
            } catch (e) {
                this.disabled = false;
                showMessageFn(String(e), 5000, "error");
            }
        };
    }
}
