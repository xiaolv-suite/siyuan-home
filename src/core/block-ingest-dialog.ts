/**
 * 思源文档块收录对话框（319波）：
 * 输入或粘贴思源块链接/ID及内容，智能提炼字段并收录至指定台账，
 * 创建成功后自动将反向引用标签复制到剪贴板，方便在原笔记中形成闭环。
 * 独立模块，按需延迟加载以降低主包负担。
 */

import { extractBlockId, parseBlockToLedgerRow, formatBlockIngestSnippet } from "./block-ingest";
import { bindDialogA11y } from "./dialog-a11y";
import { uiIcon } from "@/ui/icons";

export interface BlockIngestDialogOptions {
    t: (k: string) => string;
    currentModule?: string;
    plugin: {
        settings: {
            enabledModules?: string[];
            dbRefs: Record<string, { avId?: string; columns?: Record<string, string> }>;
        };
    };
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    addDetachedRowFn: (avId: string, name: string) => Promise<string>;
    setCellFn: (avId: string, colId: string, itemId: string, val: unknown) => Promise<unknown>;
    onSuccessCallback?: () => Promise<void> | void;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function openBlockIngestDialog(opts: BlockIngestDialogOptions): void {
    const { t, currentModule, plugin, DialogCls, showMessageFn, addDetachedRowFn, setCellFn, onSuccessCallback } = opts;

    const enabled = (plugin.settings.enabledModules ?? []).filter((id) => id !== "members" && id !== "adhoc");
    const modLabel = (m: string) => (t(`module.${m}`) !== `module.${m}` ? t(`module.${m}`) : m);

    let moduleOptionsHtml = "";
    for (const m of enabled) {
        const isSel = m === currentModule ? "selected" : "";
        moduleOptionsHtml += `<option value="${m}" ${isSel}>${modLabel(m)}</option>`;
    }

    const dlg = new DialogCls({
        title: t("capture.ingestTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-ingest-body">
  <div class="lv-caption">${t("capture.ingestHint")}</div>
  <label class="lv-form-group">
    <span class="lv-caption">${t("capture.ingestBlockLink")}</span>
    <input class="b3-text-field" id="lv-ingest-link" placeholder="siyuan://blocks/20261020... / ((20261020...))" />
  </label>
  <label class="lv-form-group">
    <span class="lv-caption">${t("capture.ingestModule")}</span>
    <select class="b3-select" id="lv-ingest-mod">${moduleOptionsHtml}</select>
  </label>
  <label class="lv-form-group">
    <span class="lv-caption">${t("capture.ingestContent")}</span>
    <textarea class="b3-text-field" id="lv-ingest-content" placeholder="${t("capture.ingestContentPlaceholder")}"></textarea>
  </label>
  <div id="lv-ingest-preview" class="lv-metric-item" style="display:none"></div>
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("close")}</button>
  <button class="b3-button" id="lv-ingest-submit">${t("capture.ingestSubmit")}</button>
</div>`,
        width: "560px",
    });

    const linkInp = dlg.element.querySelector("#lv-ingest-link") as HTMLInputElement;
    const modSel = dlg.element.querySelector("#lv-ingest-mod") as HTMLSelectElement;
    const contentInp = dlg.element.querySelector("#lv-ingest-content") as HTMLTextAreaElement;
    const previewEl = dlg.element.querySelector("#lv-ingest-preview") as HTMLElement;
    const submitBtn = dlg.element.querySelector("#lv-ingest-submit") as HTMLButtonElement;
    (dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg, defaultFocus: "#lv-ingest-link" });

    const updatePreview = () => {
        const rawLink = linkInp.value.trim();
        const blockId = extractBlockId(rawLink);
        const text = contentInp.value.trim();
        if (!blockId || !text) {
            previewEl.style.display = "none";
            return;
        }
        const targetMod = modSel.value;
        const res = parseBlockToLedgerRow({ blockId, content: text, targetModule: targetMod });
        previewEl.style.display = "flex";
        const safeName = escapeHtml(res.rowPayload.name);
        const safeMod = escapeHtml(modLabel(res.suggestedModule));
        const safeBlockId = escapeHtml(res.blockId);
        const safeDate = res.rowPayload.date ? escapeHtml(res.rowPayload.date) : "";
        previewEl.innerHTML = `
            <div style="display:flex;justify-content:space-between">
                <b>${safeName}</b>
                <span class="lv-badge green">${safeMod}</span>
            </div>
            <div class="lv-caption" style="display:flex;gap:8px;flex-wrap:wrap">
                ${safeDate ? `<span>${uiIcon("calendar", "", 12)} ${safeDate}</span>` : ""}
                ${res.rowPayload.amount !== undefined ? `<span>${uiIcon("money", "", 12)} ¥${res.rowPayload.amount}</span>` : ""}
                <span>${uiIcon("link", "", 12)} ${safeBlockId}</span>
            </div>
        `;
    };

    linkInp.oninput = updatePreview;
    modSel.onchange = updatePreview;
    contentInp.oninput = updatePreview;

    submitBtn.onclick = async () => {
        const blockId = extractBlockId(linkInp.value.trim());
        if (!blockId) {
            showMessageFn(t("capture.ingestInvalidLink"), 4000, "error");
            linkInp.focus();
            return;
        }
        const content = contentInp.value.trim();
        if (!content) {
            showMessageFn(t("capture.ingestContentRequired"), 4000, "error");
            contentInp.focus();
            return;
        }

        const targetMod = modSel.value;
        const dbRef = plugin.settings.dbRefs[targetMod];
        if (!dbRef?.avId || !dbRef.columns?.name) {
            showMessageFn(t("triage.needProvision"), 4000, "error");
            return;
        }

        submitBtn.disabled = true;
        try {
            const res = parseBlockToLedgerRow({ blockId, content, targetModule: targetMod });
            const rowId = await addDetachedRowFn(dbRef.avId, res.rowPayload.name);
            if (!rowId) throw new Error("Failed to create ledger row");

            if (res.rowPayload.date) {
                const dateKey = dbRef.columns.expiry || dbRef.columns.date || dbRef.columns.due;
                if (dateKey) await setCellFn(dbRef.avId, dateKey, rowId, { type: "date", date: { content: new Date(`${res.rowPayload.date}T00:00:00`).getTime(), isNotEmpty: true } });
            }
            if (res.rowPayload.amount !== undefined) {
                const amtKey = dbRef.columns.amount || dbRef.columns.deposit || dbRef.columns.premium;
                if (amtKey) await setCellFn(dbRef.avId, amtKey, rowId, { type: "number", number: { content: res.rowPayload.amount, isNotEmpty: true } });
            }
            if (res.rowPayload.note && dbRef.columns.note) {
                await setCellFn(dbRef.avId, dbRef.columns.note, rowId, { type: "text", text: { content: res.rowPayload.note } });
            }

            // 复制反向收录标注
            const snippet = formatBlockIngestSnippet(modLabel(targetMod), res.rowPayload.name);
            try {
                await navigator.clipboard.writeText(snippet);
                showMessageFn(t("capture.ingestSuccessWithSnippet"), 4500, "info");
            } catch {
                showMessageFn(t("capture.ingestSuccess"), 3500, "info");
            }

            dlg.destroy();
            await onSuccessCallback?.();
        } catch (e) {
            showMessageFn(t("capture.failed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            submitBtn.disabled = false;
        }
    };
}
