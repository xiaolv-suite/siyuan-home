/**
 * 台账详情抽屉更多操作菜单与快捷键动作绑定器（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { renderRecordCardPng, copyPngToClipboard, downloadPng } from "./sharecard";
import { formatAsTaskBlock } from "./block-capture";

export interface BindDrawerMoreActionsOptions {
    dlg: any;
    row: any;
    cardTitle: string;
    cardDeepLink: string;
    cardRows: { key?: string; label: string; value: string }[];
    active: string;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
}

export function bindDrawerMoreActions(options: BindDrawerMoreActionsOptions): void {
    if (typeof document === "undefined") return;
    const { dlg, row, cardTitle, cardDeepLink, cardRows, active, ref, t, showMessageFn, cellTextFn } = options;

    const more = dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement | null;
    const closeMore = () => { if (more) more.open = false; };

    const buildCard = async () => renderRecordCardPng({
        title: cardTitle,
        moduleLabel: t(`module.${active}`) !== `module.${active}` ? t(`module.${active}`) : active,
        rows: cardRows,
        deepLink: cardDeepLink,
    });

    // 1. 复制为卡片图片 (PNG)
    const copyCardBtn = dlg.element.querySelector("#lv-detail-card-copy") as HTMLButtonElement | null;
    if (copyCardBtn) {
        copyCardBtn.onclick = async function (this: HTMLButtonElement) {
            closeMore();
            this.disabled = true;
            try {
                const blob = await buildCard();
                const ok = await copyPngToClipboard(blob);
                if (ok) showMessageFn(t("ledger.copyAsImageOk"), 2500, "info");
                else {
                    downloadPng(blob, `${cardTitle.slice(0, 20) || "lvhome"}.png`);
                    showMessageFn(t("ledger.copyAsImageFail"), 4000, "info");
                }
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
            } finally {
                this.disabled = false;
            }
        };
    }

    // 2. 下载卡片 PNG
    const downloadCardBtn = dlg.element.querySelector("#lv-detail-card-png") as HTMLButtonElement | null;
    if (downloadCardBtn) {
        downloadCardBtn.onclick = async function (this: HTMLButtonElement) {
            closeMore();
            this.disabled = true;
            try {
                const blob = await buildCard();
                downloadPng(blob, `${cardTitle.slice(0, 20) || "lvhome"}.png`);
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
            } finally {
                this.disabled = false;
            }
        };
    }

    // 3. 复制卡片纯文本
    const copyTextBtn = dlg.element.querySelector("#lv-detail-card-text") as HTMLButtonElement | null;
    if (copyTextBtn) {
        copyTextBtn.onclick = async () => {
            closeMore();
            const text = cardRows.map((r) => `${r.label}: ${r.value}`).join("\n");
            try {
                await navigator.clipboard.writeText(`${cardTitle}\n${text}`);
                showMessageFn(t("ledger.copyAsTextOk"), 2500, "info");
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
            }
        };
    }

    // 4. 复制卡片脱敏文本
    const copyMaskedBtn = dlg.element.querySelector("#lv-detail-card-masked-text") as HTMLButtonElement | null;
    if (copyMaskedBtn) {
        copyMaskedBtn.onclick = async () => {
            closeMore();
            const { formatMaskedRecordText } = await import("./format");
            const text = formatMaskedRecordText(cardTitle, cardRows);
            try {
                await navigator.clipboard.writeText(text);
                showMessageFn(t("ledger.copyAsMaskedTextOk"), 2500, "info");
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
            }
        };
    }

    // 5. 复制思源块引用 ((blockId "title"))
    const copyRefBtn = dlg.element.querySelector("#lv-detail-copy-ref") as HTMLButtonElement | null;
    if (copyRefBtn) {
        copyRefBtn.onclick = async () => {
            closeMore();
            const blockRefText = `((${row.itemID} "${cardTitle}"))`;
            try {
                await navigator.clipboard.writeText(blockRefText);
                showMessageFn(t("ledger.blockRefCopied"), 2500, "info");
            } catch (e) {
                showMessageFn(String(e), 5000, "error");
            }
        };
    }

    // 6. 复制为思源任务清单块 - [ ] ((blockId "title"))
    const copyTaskBtn = dlg.element.querySelector("#lv-detail-copy-task") as HTMLButtonElement | null;
    if (copyTaskBtn) {
        copyTaskBtn.onclick = async () => {
            closeMore();
            const taskText = formatAsTaskBlock(cardTitle, undefined, row.itemID);
            try {
                await navigator.clipboard.writeText(taskText);
                showMessageFn(t("ledger.taskBlockCopied"), 2500, "info");
            } catch (e) {
                showMessageFn(String(e), 5000, "error");
            }
        };
    }

    // 7. 推入小驴拾遗渐进阅读流
    const pushGleanBtn = dlg.element.querySelector("#lv-detail-push-glean") as HTMLButtonElement | null;
    if (pushGleanBtn) {
        pushGleanBtn.onclick = async () => {
            closeMore();
            try {
                const { pushToGleanReadingSafely } = await import("@/libs/ecosystem-bridge-kit");
                const res = await pushToGleanReadingSafely({
                    title: cardTitle,
                    module: active,
                    docId: ref.docId,
                    blockId: row.itemID,
                    summary: ref.columns?.note ? cellTextFn(row.cells?.[ref.columns.note], "note") : undefined,
                });
                if (res.mode === "bridge") {
                    showMessageFn(t("ledger.pushToGleanSuccess"), 3500, "info");
                } else {
                    await navigator.clipboard.writeText(res.text);
                    showMessageFn(t("ledger.pushToGleanFallback"), 3500, "info");
                }
            } catch (e) {
                showMessageFn(String(e), 5000, "error");
            }
        };
    }

    // 8. 复制思源块嵌入 {{select * from blocks where id='blockId'}}
    const copyEmbedBtn = dlg.element.querySelector("#lv-detail-copy-embed") as HTMLButtonElement | null;
    if (copyEmbedBtn) {
        copyEmbedBtn.onclick = async () => {
            closeMore();
            const blockEmbedText = `{{select * from blocks where id='${row.itemID}'}}`;
            try {
                await navigator.clipboard.writeText(blockEmbedText);
                showMessageFn(t("ledger.blockEmbedCopied"), 2500, "info");
            } catch (e) {
                showMessageFn(String(e), 5000, "error");
            }
        };
    }
}

export interface RenderDrawerEditModeOptions {
    body: HTMLElement;
    dlg: any;
    row: any;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    active: string;
    schemaCols: any[];
    plugin: any;
    t: (k: string) => string;
    rawFromValueFn: (type: string, cell: any) => any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    pickFromContactsFn?: (callback: (snapshot: string) => void) => void;
    onCancel: () => void;
    onReload: () => Promise<void>;
}

/** 渲染详情抽屉整行全量编辑表单模式，并处理修改比对与增量落盘事务 */
export function renderDrawerEditMode(options: RenderDrawerEditModeOptions): void {
    if (typeof document === "undefined") return;
    const {
        body,
        dlg,
        row,
        ref,
        active,
        schemaCols,
        plugin,
        t,
        rawFromValueFn,
        showMessageFn,
        pickFromContactsFn,
        onCancel,
        onReload,
    } = options;

    body.innerHTML = "";
    body.scrollTop = 0;
    const more = dlg.element.querySelector(".lv-detail-more") as HTMLDetailsElement | null;
    if (more) {
        more.open = false;
        more.hidden = true;
    }

    import("./record-form").then(({ renderEditableFormFields }) => {
        const inputs = renderEditableFormFields({
            container: body,
            schemaCols,
            columns: ref.columns!,
            rowCells: row.cells,
            t,
            rawFromValueFn,
            hasContactsBridge: true,
            onPickContact: pickFromContactsFn,
        });

        const errorBox = document.createElement("div");
        errorBox.className = "lv-record-error";
        errorBox.setAttribute("role", "alert");
        errorBox.style.display = "none";
        body.appendChild(errorBox);

        const save = dlg.element.querySelector("#lv-detail-edit") as HTMLButtonElement | null;
        if (save) save.textContent = t("save");
        const cancel = dlg.element.querySelector("#lv-detail-close") as HTMLButtonElement | null;
        if (cancel) {
            cancel.textContent = t("cancel");
            cancel.onclick = () => onCancel();
        }

        if (!save) return;
        save.onclick = async () => {
            if (save.disabled) return;
            save.disabled = true;
            if (cancel) cancel.disabled = true;
            errorBox.style.display = "none";
            const failed: string[] = [];
            let changed = 0;
            let personChanged = false;
            const personKeyID = ref.columns?.person;
            const previousFavorSync = plugin.runtime?.favorSyncs?.[row.itemID];

            try {
                for (const e of inputs) {
                    const v = e.get();
                    const orig = rawFromValueFn(e.type, row.cells[e.keyID]);
                    const same = e.type === "checkbox" ? v === orig : String(v) === String(orig);
                    if (same) continue;

                    try {
                        const { cellValue } = await import("./avcell");
                        const { setCell } = await import("./siyuan");
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
                                    const { setCell } = await import("./siyuan");
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
                        const { saveRuntime } = await import("./hub/runtime");
                        await saveRuntime(plugin, plugin.runtime);
                    } catch (err) {
                        plugin.runtime.favorSyncs = { ...(plugin.runtime.favorSyncs ?? {}), [row.itemID]: previousFavorSync };
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                    }
                }

                if (failed.length > 0) {
                    if (changed > 0) {
                        await onReload();
                        try { await plugin.refreshHub?.([active]); } catch { /* soft */ }
                    }
                    errorBox.textContent = t("ledger.editSavePartial").replace("${fields}", failed.join(", "));
                    errorBox.style.display = "block";
                    save.disabled = false;
                    if (cancel) cancel.disabled = false;
                    return;
                }

                dlg.destroy();
                if (changed > 0) {
                    await onReload();
                    try { await plugin.refreshHub?.([active]); } catch { /* soft */ }
                    showMessageFn(t("ledger.editSaved"), 2500, "info");
                }
            } catch (err) {
                showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                save.disabled = false;
                if (cancel) cancel.disabled = false;
            }
        };
    });
}

