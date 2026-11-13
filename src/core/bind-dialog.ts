const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * 绑定已有思源文档为台账向导弹窗（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { sql } from "./siyuan";
import { bindExistingDoc } from "./provisioner";
import { saveSettings } from "./settings";
import type { ModuleSchema } from "./schema";
import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";

export interface BindExistingDocDialogOptions {
    active: string;
    schema: ModuleSchema;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    onSuccess?: () => Promise<void>;
}

export function openBindExistingDocDialog(options: BindExistingDocDialogOptions): void {
    if (typeof document === "undefined") return;
    const { active, schema, plugin, t, DialogCls, showMessageFn, onSuccess } = options;
    if (!schema) return;

    const dlg = new DialogCls({
        title: t("ledger.bindDocTitle"),
        content: `
            <div class="b3-dialog__content lv-dialog-scroll-body">
                <span class="lv-caption">${t("ledger.bindDocHint")}</span>
                <label class="lv-form-group">
                    <span class="lv-caption">${t("ledger.bindDocTitle")}：</span>
                    <input class="b3-text-field" id="lv-bind-doc-input" placeholder="siyuan://blocks/20261021... / ((20261021...))" />
                </label>
                <div id="lv-bind-candidates" class="lv-candidates-list"></div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">${t("cancel")}</button>
                <button class="b3-button" id="lv-bind-doc-ok">${t("save")}</button>
            </div>
        `,
        width: "480px",
    });

    const cancelBtn = dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();

    const bindInput = dlg.element.querySelector("#lv-bind-doc-input") as HTMLInputElement | null;
    bindDialogA11y({ dlg, defaultFocus: bindInput });
    if (bindInput) {
        bindInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.isComposing) (dlg.element.querySelector("#lv-bind-doc-ok") as HTMLButtonElement)?.click();
        });
    }

    void (async () => {
        const listEl = dlg.element.querySelector("#lv-bind-candidates") as HTMLElement | null;
        if (!listEl) return;
        try {
            const modName = t(`module.${active}`);
            const escActive = String(active).replace(/'/g, "''");
            const escModName = String(modName).replace(/'/g, "''");
            const rows = await sql<{ id: string; hpath: string }>(
                `SELECT id, hpath FROM blocks WHERE type='d' AND (hpath LIKE '%${escActive}%' OR hpath LIKE '%${escModName}%') ORDER BY updated DESC LIMIT 5`
            );
            if (rows.length === 0 || !dlg.element.isConnected) return;
            listEl.innerHTML = `<span class="lv-caption" style="color:var(--lv-tx-3);margin-top:4px;display:flex;align-items:center;gap:4px">${uiIcon("sparkle", "", 13)} 推荐候选文档（点击直接填入）：</span>`;
            for (const r of rows) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline lv-bind-candidate-btn";
                btn.innerHTML = `${uiIcon("note", "", 13)} <span>${esc(r.hpath)}</span>`;
                btn.onclick = () => {
                    const inp = dlg.element.querySelector("#lv-bind-doc-input") as HTMLInputElement;
                    if (inp) {
                        inp.value = r.id;
                        inp.focus();
                    }
                };
                listEl.appendChild(btn);
            }
        } catch { /* soft query */ }
    })();

    const okBtn = dlg.element.querySelector("#lv-bind-doc-ok") as HTMLButtonElement | null;
    if (okBtn) {
        okBtn.onclick = async function (this: HTMLButtonElement) {
            const inputVal = (dlg.element.querySelector("#lv-bind-doc-input") as HTMLInputElement)?.value.trim();
            if (!inputVal) {
                showMessageFn(t("ledger.bindDocRequired"), 3000, "info");
                (dlg.element.querySelector("#lv-bind-doc-input") as HTMLInputElement)?.focus();
                return;
            }
            this.disabled = true;
            try {
                await bindExistingDoc(plugin.settings, active, inputVal, schema, {
                    resolveName: (k: string) => t(`field.${k}`),
                });
                await saveSettings(plugin, plugin.settings);
                dlg.destroy();
                showMessageFn(t("ledger.bindDocSuccess").replace("${module}", t(`module.${active}`)), 3000, "info");
                if (onSuccess) await onSuccess();
            } catch (e) {
                this.disabled = false;
                showMessageFn(String(e), 5000, "error");
            }
        };
    }
}
