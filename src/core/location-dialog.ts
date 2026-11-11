/**
 * 存放位置全局检索对话框（313 波，G4）：
 * 遍历全已启用模块中含 location / copy_location 的台账，
 * 按位置归集，提供实时关键词搜索、点击直达原文文档、一键复制文本。
 * 独立于页面存在，避免页面膨胀。
 */
import { modalWarningHtml } from "./modal-shell";
import {
    buildLocationIndex,
    searchLocations,
    formatLocationIndexText,
    renderLocationCapsuleHtml,
    buildLocationTree,
    formatLocationTreeText,
    type LocationRowInput,
} from "./location-index";
import type { AvRow } from "./siyuan";
import type { AvCellLike } from "./avcell";
import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";

export interface LocationDialogOptions {
    t: (k: string) => string;
    plugin: {
        settings: {
            enabledModules?: string[];
            dbRefs: Record<string, { avId?: string; docId?: string; columns?: Record<string, string> }>;
            members?: Array<{ id: string; avItemId?: string; name: string }>;
        };
        showTabDocs: (docId?: string) => void;
    };
    DialogCls: new (options: { title: string; content: string; width?: string }) => { element: HTMLElement; destroy: () => void };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: AvRow[] }>;
    cellTextFn: (v: AvCellLike | null | undefined, k?: string) => string;
}

export async function openLocationIndexDialog(opts: LocationDialogOptions): Promise<void> {
    const { t, plugin, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = opts;
    const enabled = (plugin.settings.enabledModules ?? []).filter((id) => id !== "members" && id !== "adhoc");
    const memberMap = new Map((plugin.settings.members ?? []).map((m) => [m.avItemId ?? m.id, m.name]));

    const inputs: LocationRowInput[] = [];
    const errors: string[] = [];

    for (const mod of enabled) {
        const ref = plugin.settings.dbRefs[mod];
        if (!ref?.avId || !ref.columns?.name) continue;
        const locCol = ref.columns.location;
        const storeCol = ref.columns.store_place;
        const copyCol = ref.columns.copy_location;
        if (!locCol && !storeCol && !copyCol) continue;

        try {
            const res = await renderLedgerAllFn(ref.avId);
            // 未读完整也用已读到的行，但记入错误让弹窗如实提示
            if (!res.complete) errors.push(`${mod}: incomplete`);
            for (const r of res.rows) {
                const name = cellTextFn(r.cells[ref.columns.name]);
                if (!name) continue;
                const memberCell = ref.columns.member ? r.cells[ref.columns.member] : undefined;
                const memberId = String(memberCell?.relation?.blockIDs?.[0] ?? "");
                const memberName = memberId ? memberMap.get(memberId) : undefined;
                const hint = ref.columns.note ? cellTextFn(r.cells[ref.columns.note]) : undefined;

                if (locCol) {
                    const loc = cellTextFn(r.cells[locCol]);
                    if (loc) inputs.push({ rowId: r.itemID, moduleId: mod, name, location: loc, source: "location", memberName, hint });
                }
                if (storeCol && storeCol !== locCol) {
                    const storeLoc = cellTextFn(r.cells[storeCol]);
                    if (storeLoc) inputs.push({ rowId: r.itemID, moduleId: mod, name, location: storeLoc, source: "location", memberName, hint });
                }
                if (copyCol) {
                    const copyLoc = cellTextFn(r.cells[copyCol]);
                    if (copyLoc) inputs.push({ rowId: r.itemID, moduleId: mod, name, location: copyLoc, source: "copy_location", memberName, hint });
                }
            }
        } catch (e) {
            errors.push(`${mod}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // 此前 errors 只收集不展示：读取失败时直接显示“没有存放位置”，现在如实告知
    const failedModules = [...new Set(errors.map((e) => e.split(":")[0]))];
    const readWarning = failedModules.length
        ? t("modal.readIncomplete").replace("${modules}", failedModules.map((m) => (t(`module.${m}`) !== `module.${m}` ? t(`module.${m}`) : m)).join("、"))
        : "";
    if (inputs.length === 0) {
        showMessageFn(readWarning || t("ledger.locEmptyAll"), readWarning ? 6000 : 4000, readWarning ? "error" : "info");
        return;
    }

    const index = buildLocationIndex(inputs);
    const modLabel = (m: string) => (t(`module.${m}`) !== `module.${m}` ? t(`module.${m}`) : m);

    const dlg = new DialogCls({
        title: t("ledger.locTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-loc-body">${modalWarningHtml(readWarning ? [readWarning] : [])}
  <div>
    <input class="b3-text-field fn__block" id="lv-loc-search" placeholder="${t("ledger.locSearchPlaceholder")}" />
  </div>
  <div id="lv-loc-results" class="lv-ecard-list"></div>
</div>
<div class="b3-dialog__action">
  <span class="lv-caption fn__flex-1" id="lv-loc-total"></span>
  <button class="b3-button b3-button--cancel" id="lv-loc-close">${t("close")}</button>
  <button class="b3-button b3-button--outline" id="lv-loc-copy-tree">${t("ledger.locCopyTree")}</button>
  <button class="b3-button" id="lv-loc-copy">${t("ledger.locCopy")}</button>
</div>`,
        width: "600px",
    });

    const resultsEl = dlg.element.querySelector("#lv-loc-results") as HTMLElement;
    const totalEl = dlg.element.querySelector("#lv-loc-total") as HTMLElement;
    const searchInp = dlg.element.querySelector("#lv-loc-search") as HTMLInputElement;
    const closeBtn = dlg.element.querySelector("#lv-loc-close") as HTMLButtonElement;
    closeBtn.onclick = () => dlg.destroy();

    bindDialogA11y({
        dlg,
        defaultFocus: searchInp,
    });

    totalEl.textContent = t("ledger.locCount").replace("${n}", String(index.total)).replace("${groups}", String(index.groups.length));

    const renderList = (entries: typeof inputs) => {
        resultsEl.replaceChildren();
        if (entries.length === 0) {
            const none = document.createElement("div");
            none.className = "ft__on-surface lv-dialog-empty";
            none.style.padding = "12px 0";
            none.textContent = t("activity.noMatch");
            resultsEl.appendChild(none);
            return;
        }
        const byLoc = new Map<string, typeof inputs>();
        for (const e of entries) {
            const list = byLoc.get(e.location) ?? [];
            list.push(e);
            byLoc.set(e.location, list);
        }
        for (const [loc, list] of byLoc) {
            const grp = document.createElement("div");
            grp.className = "lv-dialog-summary-card";
            grp.style.display = "block";
            const head = document.createElement("div");
            head.className = "lv-dialog-row lv-domain-title lv-tx-accent";
            head.style.marginBottom = "6px";
            head.style.alignItems = "center";
            const capsuleHtml = renderLocationCapsuleHtml(loc);
            head.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">${capsuleHtml}</span><span class="lv-caption">${list.length} 件</span>`;
            grp.appendChild(head);
            for (const it of list) {
                const line = document.createElement("div");
                line.className = "lv-dialog-row";
                line.style.padding = "3px 0";
                const left = document.createElement("span");
                const copyTag = it.source === "copy_location" ? ` <span class="lv-badge gray">${t("ledger.locCopyTag")}</span>` : "";
                const safeName = String(it.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const safeOwner = it.memberName ? ` · ${String(it.memberName).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}` : "";
                left.innerHTML = `<b>${safeName}</b>${copyTag}<span class="lv-caption" style="margin-left:6px">${modLabel(it.moduleId)}${safeOwner}</span>`;
                const gotoBtn = document.createElement("button");
                gotoBtn.type = "button";
                gotoBtn.className = "b3-button b3-button--text lv-btn-text-sm";
                gotoBtn.innerHTML = `${t("ledger.openDoc")} ${uiIcon("forward", "", 12)}`;
                gotoBtn.onclick = () => {
                    const docId = plugin.settings.dbRefs[it.moduleId]?.docId;
                    if (docId) {
                        dlg.destroy();
                        plugin.showTabDocs(docId);
                    }
                };
                line.append(left, gotoBtn);
                grp.appendChild(line);
            }
            resultsEl.appendChild(grp);
        }
    };
    renderList(inputs);

    searchInp.oninput = () => {
        const q = searchInp.value.trim();
        if (!q) { renderList(inputs); return; }
        renderList(searchLocations(inputs, q));
    };

    const copyTreeBtn = dlg.element.querySelector("#lv-loc-copy-tree") as HTMLButtonElement | null;
    if (copyTreeBtn) {
        copyTreeBtn.onclick = async () => {
            const tree = buildLocationTree(inputs);
            const text = formatLocationTreeText(tree, modLabel);
            try {
                await navigator.clipboard.writeText(text);
                showMessageFn(t("ledger.locTreeCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.shopCopyFailed"), 4000, "error");
            }
        };
    }

    (dlg.element.querySelector("#lv-loc-copy") as HTMLButtonElement).onclick = async () => {
        const text = formatLocationIndexText(index, modLabel);
        try {
            await navigator.clipboard.writeText(text);
            showMessageFn(t("ledger.shopCopied"), 2500, "info");
        } catch {
            showMessageFn(t("ledger.shopCopyFailed"), 4000, "error");
        }
    };
}
