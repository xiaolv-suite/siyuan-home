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
