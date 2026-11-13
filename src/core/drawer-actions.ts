/**
 * 台账详情抽屉更多操作菜单与快捷键动作绑定器（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { renderRecordCardPng, copyPngToClipboard, downloadPng } from "./sharecard";
import { formatAsTaskBlock } from "./block-capture";
import { confirm } from "@/libs/dialog";
import { selectCellContent } from "./avcell";
import { localDateKey, parseDate } from "./hub/rule";
import { saveSettings } from "./settings";
import { saveRuntime } from "./hub/runtime";
import { homeInline } from "@/libs/notice";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface BindDrawerMoreActionsOptions {
    dlg: any;
    row: any;
    cardTitle: string;
    cardDeepLink: string;
    cardRows: { key?: string; label: string; value: string }[];
    active: string;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    plugin?: any;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
}

export function bindDrawerMoreActions(options: BindDrawerMoreActionsOptions): void {
    if (typeof document === "undefined") return;
    const { dlg, row, cardTitle, cardDeepLink, cardRows, active, ref, plugin, t, showMessageFn, cellTextFn } = options;

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
                showMessageFn(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${errMsg(e)})`, 5000, "error");
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
                showMessageFn(t("ledger.copyAsImageFail").replace(": Downloaded instead", "") + ` (${errMsg(e)})`, 5000, "error");
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
                homeInline(copyTextBtn, t("ledger.copyAsTextOk"));
                showMessageFn(t("ledger.copyAsTextOk"), 2500, "info");
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail") + ` (${errMsg(e)})`, 5000, "error");
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
                homeInline(copyMaskedBtn, t("ledger.copyAsMaskedTextOk"));
                showMessageFn(t("ledger.copyAsMaskedTextOk"), 2500, "info");
            } catch (e) {
                showMessageFn(t("ledger.copyAsImageFail") + ` (${errMsg(e)})`, 5000, "error");
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
                homeInline(copyRefBtn, t("ledger.blockRefCopied"));
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
                homeInline(copyTaskBtn, t("ledger.taskBlockCopied"));
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
                } else if (res.state === "unknown") {
                    showMessageFn(t("ledger.pushToGleanUnknown"), 5000, "error");
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

    // 9. 沉淀至小驴人脉互动记录 (Epoch 6 跨插件联邦规范)
    const recordContactBtn = dlg.element.querySelector("#lv-detail-record-contact") as HTMLButtonElement | null;
    if (recordContactBtn) {
        recordContactBtn.onclick = async () => {
            closeMore();
            try {
                const { getContactsBridge, logContactInteractionSafely, openContactPicker, parseContactSnapshot } = await import("@/libs/contact-picker");
                const bridge = getContactsBridge();
                if (!bridge) {
                    showMessageFn(t("ledger.contactsMissing"), 4000, "info");
                    return;
                }
                const dateKey = ref.columns?.date ? cellTextFn(row.cells?.[ref.columns.date], "date") : new Date().toISOString().slice(0, 10);
                const modName = t(`module.${active}`) !== `module.${active}` ? t(`module.${active}`) : active;
                const noteContent = `${modName} · ${cardTitle}`;

                let targetDocId: string | undefined;
                if (ref.columns?.contact) {
                    const snap = cellTextFn(row.cells?.[ref.columns.contact], "contact");
                    targetDocId = parseContactSnapshot(snap).docId;
                }
                if (!targetDocId && ref.columns?.member) {
                    const mId = row.cells?.[ref.columns.member]?.relation?.blockIDs?.[0];
                    const targetMember = (plugin.settings?.members ?? []).find((m: any) => m.avItemId === mId || m.id === mId);
                    if (targetMember?.contactSnapshot) {
                        targetDocId = parseContactSnapshot(targetMember.contactSnapshot).docId;
                    }
                }

                if (targetDocId) {
                    const ok = await logContactInteractionSafely({
                        personDocId: targetDocId,
                        date: dateKey,
                        note: noteContent,
                        ref: `home:ledger:${row.itemID}`,
                    });
                    if (ok) showMessageFn(t("ledger.contactInteractionRecorded"), 3000, "info");
                    else showMessageFn(t("ledger.contactInteractionFailed"), 4000, "error");
                } else {
                    openContactPicker({ showMessage: showMessageFn, t }, async (pickedSnapshot) => {
                        const parsed = parseContactSnapshot(pickedSnapshot);
                        if (!parsed.docId) return;
                        const ok = await logContactInteractionSafely({
                            personDocId: parsed.docId,
                            date: dateKey,
                            note: noteContent,
                            ref: `home:ledger:${row.itemID}`,
                        });
                        if (ok) showMessageFn(t("ledger.contactInteractionRecorded"), 3000, "info");
                        else showMessageFn(t("ledger.contactInteractionFailed"), 4000, "error");
                    });
                }
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
                        const msg = errMsg(err);
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
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", errMsg(err)), 6000, "error");
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
                }
                showMessageFn(t("ledger.editSaved"), 2500, "info");
            } catch (err) {
                showMessageFn(t("ledger.saveFailed").replace("${msg}", errMsg(err)), 6000, "error");
                save.disabled = false;
                if (cancel) cancel.disabled = false;
            }
        };
    });
}

export interface RenderDrawerDocTemplatesOptions {
    body: HTMLElement;
    dlg: any;
    row: any;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    active: string;
    schemaCols: any[];
    plugin: any;
    t: (k: string) => string;
    cellTextFn: (cell: any, key?: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

/** 渲染详情抽屉支持的文档模板生成按钮群 */
export function renderDrawerDocTemplates(options: RenderDrawerDocTemplatesOptions): void {
    if (typeof document === "undefined") return;
    const { body, dlg, row, ref, active, schemaCols, plugin, t, cellTextFn, showMessageFn } = options;
    const tplList = ((plugin.schemaCatalog?.[active] as any)?.templates ?? []) as { key: string; nameKey: string; file: string }[];
    for (const tp of tplList) {
        const label = t(tp.nameKey) !== tp.nameKey ? t(tp.nameKey) : tp.key;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "b3-button b3-button--outline lv-att-upload-btn";
        btn.textContent = `${t("ledger.genDoc")} · ${label}`;
        btn.onclick = async () => {
            try {
                const { getTemplate, renderTemplate, sanitizeDocTitle } = await import("./templates");
                const { sql, createDocWithMd } = await import("./siyuan");
                const file = getTemplate(tp.file);
                if (!file) throw new Error("template missing: " + tp.file);
                const rows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${ref.docId!.replace(/'/g, "''")}' LIMIT 1`);
                const notebook = rows[0]?.box;
                if (!notebook) throw new Error("notebook not found for " + ref.docId);
                const vars: Record<string, string> = { name: String(cellTextFn(row.cells[ref.columns!.name])), date: localDateKey(new Date()) };
                for (const c of schemaCols) vars[c.key] = cellTextFn(row.cells[ref.columns![c.key]]);
                const title = sanitizeDocTitle(`${vars.name} · ${label} · ${vars.date}`);
                confirm(t("ledger.genDoc"), t("ledger.genDocConfirm").replace("${title}", title), async () => {
                    try {
                        const rawRoot = String(plugin.settings?.rootPath || "/02-小驴管家").trim().replace(/\/+$/, "");
                        const targetHPath = rawRoot ? `${rawRoot}/05-成长与其它/生成文书/${title}` : `/${title}`;
                        const docId = await createDocWithMd(notebook, targetHPath, renderTemplate(file, vars));
                        showMessageFn(t("ledger.genDocDone").replace("${title}", title), 3000, "info");
                        dlg.destroy();
                        plugin.showTabDocs?.(docId);
                    } catch (e) {
                        showMessageFn(t("ledger.genDocFailed").replace("${msg}", errMsg(e)), 6000, "error");
                    }
                });
            } catch (e) {
                showMessageFn(t("ledger.genDocFailed").replace("${msg}", errMsg(e)), 6000, "error");
            }
        };
        body.appendChild(btn);
    }
}

export interface BindDrawerRowOperationsOptions {
    dlg: any;
    row: any;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    active: string;
    schemaCols: any[];
    plugin: any;
    t: (k: string) => string;
    cellTextFn: (cell: any, key?: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    openNewRecordFn: (initialForm?: Record<string, any>) => void;
    onReload: () => Promise<void>;
}

/** 绑定详情抽屉底栏的“克隆副本”与“删除条目”及其级联清理事务 */
export function bindDrawerRowOperations(options: BindDrawerRowOperationsOptions): void {
    if (typeof document === "undefined") return;
    const { dlg, row, ref, active, schemaCols, plugin, t, cellTextFn, showMessageFn, openNewRecordFn, onReload } = options;

    const dupBtn = dlg.element.querySelector("#lv-detail-duplicate") as HTMLButtonElement | null;
    if (dupBtn) {
        dupBtn.onclick = () => {
            if (plugin.runtime?.guestModeActive) {
                showMessageFn(t("guest.writeBlocked"), 3500, "info");
                return;
            }
            const rowName = (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || "";
            const cloneName = rowName ? `${rowName} (副本)` : "";
            const copiedValues: Record<string, any> = { name: cloneName };
            for (const col of schemaCols) {
                if (col.key === "name" || ["asset", "mAsset"].includes(col.type)) continue;
                const v = ref.columns?.[col.key] ? row.cells?.[ref.columns[col.key]] : undefined;
                if (v) {
                    if (col.type === "select") copiedValues[col.key] = selectCellContent(v);
                    else if (col.type === "number") {
                        const raw = v.number?.content ?? (v as any).content ?? (v as any).value?.number?.content ?? v;
                        const num = Number(raw);
                        copiedValues[col.key] = Number.isFinite(num) ? num : undefined;
                    } else if (col.type === "date") {
                        const raw = v.date?.content ?? (v as any).content ?? (v as any).value?.date?.content;
                        if (typeof raw === "number") copiedValues[col.key] = localDateKey(new Date(raw));
                        else if (typeof raw === "string" && raw.trim()) {
                            const parsed = parseDate(raw.trim());
                            copiedValues[col.key] = parsed ? localDateKey(parsed) : raw.trim();
                        }
                    } else if (col.type === "checkbox") {
                        copiedValues[col.key] = v.checkbox?.checked ?? (v as any).checked ?? (v as any).value?.checkbox?.checked;
                    } else if (col.type === "relation") {
                        copiedValues[col.key] = selectCellContent(v) || cellTextFn(v, col.key);
                    } else {
                        copiedValues[col.key] = cellTextFn(v, col.key);
                    }
                }
            }
            dlg.destroy();
            openNewRecordFn(copiedValues);
            showMessageFn(t("ledger.duplicateSuccess").replace("${name}", cloneName || rowName), 3000, "info");
        };
    }

    const delBtn = dlg.element.querySelector("#lv-detail-del") as HTMLButtonElement | null;
    if (delBtn) {
        delBtn.onclick = () => {
            if (plugin.runtime?.guestModeActive) {
                showMessageFn(t("guest.writeBlocked"), 4000, "info");
                return;
            }
            confirm(t("ledger.delTitle"), t("ledger.delBody").replace("${name}", (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || t("ledger.detail")), async () => {
                try {
                    // 安全回收站快照留存：先入回收站再行物理删除
                    if (plugin.runtime) {
                        const trashList = plugin.runtime.trash ?? [];
                        trashList.unshift({
                            id: row.itemID,
                            moduleId: active,
                            title: (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || t("ledger.detail"),
                            deletedAt: new Date().toISOString(),
                            rowSnapshot: JSON.parse(JSON.stringify(row)),
                        });
                        if (trashList.length > 50) trashList.length = 50; // 滚动上限 50 条
                        plugin.runtime.trash = trashList;
                    }
                    const { removeLedgerRows } = await import("./siyuan");
                    await removeLedgerRows(ref.avId!, [row.itemID], {
                        idempotencyKey: `ledger:delete:${ref.avId!}:${row.itemID}`,
                        retries: 1,
                    });
                } catch (e) {
                    showMessageFn(t("ledger.delFailed").replace("${msg}", errMsg(e)), 6000, "error");
                    return;
                }
                showMessageFn(t("ledger.delDone"), 2500, "info");
                dlg.destroy();
                const followupErrors: string[] = [];
                try {
                    const memberRef = plugin.settings?.dbRefs?.members;
                    if (memberRef?.avId === ref.avId) {
                        const linkedMembers = (plugin.settings?.members ?? []).filter((member: any) => member.avItemId === row.itemID);
                        if (linkedMembers.length) {
                            for (const member of linkedMembers) {
                                member.avItemId = undefined;
                                member.syncError = "ledger row deleted";
                                member.avRowCreatePending = undefined;
                            }
                            await saveSettings(plugin, plugin.settings);
                        }
                    }
                } catch (e) {
                    followupErrors.push(`${t("ledger.memberLinkCleanupFailed")} (${errMsg(e)})`);
                }
                try {
                    const { cleanupRowRuntimeData } = await import("./hub/runtime");
                    cleanupRowRuntimeData(plugin.runtime, row.itemID);
                    await saveRuntime(plugin, plugin.runtime);
                } catch (e) {
                    followupErrors.push(errMsg(e));
                }
                try {
                    const { updateRowLogs, removeRowLog } = await import("./rowlog");
                    await updateRowLogs(plugin, (current) => removeRowLog(current, ref.avId!, row.itemID));
                } catch (e) {
                    followupErrors.push(errMsg(e));
                }
                try {
                    await onReload();
                    await plugin.refreshHub?.([active]);
                } catch (e) {
                    followupErrors.push(errMsg(e));
                }
                if (followupErrors.length) showMessageFn(t("ledger.delFollowupFailed").replace("${msg}", followupErrors.join("; ")), 6000, "error");
            });
        };
    }
}


