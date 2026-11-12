/**
 * 家庭成员业务弹窗中枢（解耦抽取自 members.svelte）
 * 包含：成员台账归属批量改派、vCard 4.0 格式导出
 */

import { escapeHtml } from "./modal-shell";
import { bindDialogA11y } from "./dialog-a11y";
import type { FamilyMember } from "@/types";

export interface OpenMemberReassignDialogOptions {
    members: FamilyMember[];
    fromMember?: FamilyMember;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    onReassigned?: () => Promise<void>;
}

export function openMemberReassignDialog(options: OpenMemberReassignDialogOptions): void {
    const { members, fromMember, plugin, t, DialogCls, showMessageFn, onReassigned } = options;
    const activeMembers = members.filter((m) => m.avItemId);
    if (activeMembers.length === 0) {
        showMessageFn(t("members.reassignNoTargets"), 4000, "error");
        return;
    }
    if (typeof document === "undefined") return;
    const fromOptions = [
        `<option value="unassigned">${t("members.unassignedOrStale")}</option>`,
        ...members.filter((m) => m.avItemId).map((m) => `<option value="${escapeHtml(m.avItemId)}" ${fromMember?.id === m.id ? "selected" : ""}>${escapeHtml(m.name)}（${t(`role.${m.role}`) !== `role.${m.role}` ? t(`role.${m.role}`) : m.role}）</option>`),
    ].join("");
    const toOptions = members
        .filter((m) => m.avItemId && m.id !== fromMember?.id)
        .map((m) => `<option value="${escapeHtml(m.avItemId)}">${escapeHtml(m.name)}（${t(`role.${m.role}`) !== `role.${m.role}` ? t(`role.${m.role}`) : m.role}）</option>`)
        .join("");

    const dlg = new DialogCls({
        title: t("members.reassignTitle"),
        content: `<div class="b3-dialog__content lv-dialog-col">
            <p class="lv-caption">${t("members.reassignIntro")}</p>
            <label class="lv-form-group">
                <span class="lv-caption ft__on-surface">${t("members.reassignFrom")}</span>
                <select class="b3-select" id="lv-reassign-from">${fromOptions}</select>
            </label>
            <label class="lv-form-group">
                <span class="lv-caption ft__on-surface">${t("members.reassignTo")}</span>
                <select class="b3-select" id="lv-reassign-to">${toOptions}</select>
            </label>
        </div>
        <div class="b3-dialog__action">
            <button class="b3-button b3-button--cancel" id="lv-reassign-cancel">${t("cancel")}</button>
            <button class="b3-button" id="lv-reassign-confirm">${t("save")}</button>
        </div>`,
        width: "440px",
    });

    bindDialogA11y({ dlg });
    const cancelBtn = dlg.element.querySelector("#lv-reassign-cancel") as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();

    const confirmBtn = dlg.element.querySelector("#lv-reassign-confirm") as HTMLButtonElement | null;
    if (confirmBtn) {
        confirmBtn.onclick = async function (this: HTMLButtonElement) {
            const fromSelect = dlg.element.querySelector("#lv-reassign-from") as HTMLSelectElement | null;
            const toSelect = dlg.element.querySelector("#lv-reassign-to") as HTMLSelectElement | null;
            const fromVal = fromSelect?.value || "";
            const toVal = toSelect?.value || "";
            if (!toVal) {
                showMessageFn(t("members.reassignSelectTo"), 3000, "error");
                return;
            }
            if (fromVal === toVal) {
                showMessageFn(t("members.reassignSameError"), 3000, "error");
                return;
            }
            this.disabled = true;
            try {
                const { reassignMemberRows } = await import("./members");
                const res = await reassignMemberRows(plugin, plugin.settings, {
                    fromAvItemId: fromVal === "unassigned" ? "unassigned" : fromVal,
                    toAvItemId: toVal,
                });
                dlg.destroy();
                if (res.updated > 0) {
                    const modNames = res.modules.map((m) => t(`module.${m}`) !== `module.${m}` ? t(`module.${m}`) : m).join("、");
                    showMessageFn(t("members.reassignDone").replace("${n}", String(res.updated)).replace("${modules}", modNames), 4000, "info");
                    if (onReassigned) {
                        await onReassigned();
                    } else {
                        await plugin.refreshHub?.(undefined, true);
                    }
                } else {
                    showMessageFn(t("members.reassignZero"), 3000, "info");
                }
            } catch (e) {
                this.disabled = false;
                showMessageFn(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            }
        };
    }
}

export interface ExportMemberVcfOptions {
    members: FamilyMember[];
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    confirmFn: (title: string, body: string, onConfirm: () => void) => void;
}

export function exportMemberVcf(options: ExportMemberVcfOptions): void {
    const { members, t, showMessageFn, confirmFn } = options;
    if (!members.length) return;

    confirmFn(t("members.exportVcf"), t("members.exportVcfBody").replace("${n}", String(members.length)), () => {
        if (typeof document === "undefined") return;
        import("./vcard").then(({ buildVCard }) => {
            const vcf = buildVCard(members.map((m) => ({
                uid: m.id,
                name: m.name,
                birthday: m.birthday,
                lunarBirthday: m.lunarBirthday,
                note: m.notes,
                category: t(`role.${m.role}`) !== `role.${m.role}` ? t(`role.${m.role}`) : m.role,
            })));
            if (!vcf) {
                showMessageFn(t("members.exportVcfEmpty"), 3000, "error");
                return;
            }
            const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lvhome-members-${new Date().toISOString().slice(0, 10)}.vcf`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 0);
            showMessageFn(t("members.exportVcfDone").replace("${n}", String(members.length)), 3000, "info");
        }).catch((e) => {
            showMessageFn(t("members.exportVcfFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        });
    });
}
