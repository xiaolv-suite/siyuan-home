/**
 * 台账详情抽屉附件预览、下载、思源OCR识别与文件上传引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { assetHref, downloadAsset, isImageAsset, isEncryptedNotebookAsset } from "./assets";
import { getOCRConfig, getImageOCRText, recognizeAsset, isKernelError, setCell, uploadAsset } from "./siyuan";
import { confirm } from "@/libs/dialog";

export interface AttachmentDrawerSectionOptions {
    body: HTMLElement;
    assetCols: any[];
    ref: { avId?: string; columns?: Record<string, string> };
    row: any;
    active: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    onUploadSuccess?: () => Promise<void>;
}

export function renderAttachmentDrawerSection(options: AttachmentDrawerSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, assetCols, ref, row, active, t, DialogCls, showMessageFn, onUploadSuccess } = options;
    if (!ref.columns) return;

    const colLabel = (col: any) => (t(`field.${col.key}`) !== `field.${col.key}` ? t(`field.${col.key}`) : col.name || col.key);

    function showOCRGuide() {
        const guide = new DialogCls({
            title: t("ledger.ocrSetupTitle"),
            content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body"><p>${t("ledger.ocrSetupIntro")}</p><ol><li>${t("ledger.ocrSetupStep1")}</li><li>${t("ledger.ocrSetupStep2")}</li><li>${t("ledger.ocrSetupStep3")}</li></ol><p>${t("ledger.ocrSetupStorage")}</p><p>${t("ledger.ocrSetupAI")}</p></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-ocr-guide-close">${t("close")}</button></div>`,
            width: "460px",
        });
        guide.element.querySelector("#lv-ocr-guide-close")?.addEventListener("click", () => guide.destroy());
    }

    function showOCRText(fileName: string, text: string, onRerun?: () => void) {
        const result = new DialogCls({
            title: t("ledger.ocrResultTitle"),
            content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-col"><div class="ft__on-surface fn__break-word" id="lv-ocr-result-name"></div><textarea id="lv-ocr-result-text" class="b3-text-field fn__block" readonly></textarea><div class="ft__on-surface" style="font-size:12px">${t("ledger.ocrResultStored")}</div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-ocr-close">${t("close")}</button><span class="fn__flex-1"></span><button class="b3-button b3-button--outline" id="lv-ocr-rerun">${t("ledger.ocrRerun")}</button><button class="b3-button" id="lv-ocr-copy" ${text ? "" : "disabled"}>${t("ledger.ocrCopy")}</button></div>`,
            width: "520px",
        });
        const nameEl = result.element.querySelector("#lv-ocr-result-name") as HTMLElement | null;
        if (nameEl) nameEl.textContent = fileName;
        const textEl = result.element.querySelector("#lv-ocr-result-text") as HTMLTextAreaElement | null;
        if (textEl) textEl.value = text || t("ledger.ocrNoText");

        result.element.querySelector("#lv-ocr-close")?.addEventListener("click", () => result.destroy());
        result.element.querySelector("#lv-ocr-copy")?.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(text);
                showMessageFn(t("ledger.ocrCopyDone"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.ocrCopyFailed"), 4000, "error");
            }
        });
        if (onRerun) {
            result.element.querySelector("#lv-ocr-rerun")?.addEventListener("click", () => {
                result.destroy();
                onRerun();
            });
        }
    }

    async function recognizeImage(path: string, fileName: string, button: HTMLButtonElement) {
        const previousLabel = button.textContent;
        button.disabled = true;
        try {
            const config = await getOCRConfig();
            const provider = config?.config?.provider;
            const providerState = config?.providers?.find((item) => item.id === provider);
            if (!providerState?.available) {
                showOCRGuide();
                return;
            }
            if (provider === "ai") {
                const model = config.config.aiModelId
                    ? config.aiModels?.find((item) => item.id === config.config.aiModelId)
                    : undefined;
                if (!model) {
                    showOCRGuide();
                    return;
                }
                confirm(
                    t("ledger.ocrAIConfirmTitle"),
                    t("ledger.ocrAIConfirmBody").replace("${engine}", model.name || provider),
                    () => { void runRecognition(); },
                    () => { button.disabled = false; button.textContent = previousLabel; }
                );
            } else if (provider === "tesseract" || provider === "paddleocr") {
                await runRecognition();
            } else {
                showOCRGuide();
            }
        } catch (error) {
            if (isKernelError(error)) showOCRGuide();
            else showMessageFn(t("ledger.ocrConfigFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 7000, "error");
        } finally {
            button.disabled = false;
            button.textContent = previousLabel;
        }

        async function runRecognition() {
            button.disabled = true;
            button.textContent = t("ledger.ocrRunning");
            try {
                const result = await recognizeAsset(path);
                showOCRText(fileName, result.text, () => { void recognizeImage(path, fileName, button); });
            } catch (error) {
                showMessageFn(t("ledger.ocrFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 7000, "error");
            } finally {
                button.disabled = false;
                button.textContent = previousLabel;
            }
        }
    }

    for (const attCol of assetCols) {
        const attKeyID = ref.columns[attCol.key];
        if (!attKeyID) continue;

        const attHead = document.createElement("div");
        attHead.className = active === "vehicles" ? "ft__on-surface lv-dialog-sec-head lv-detail-wide" : "ft__on-surface lv-dialog-sec-head";
        attHead.textContent = colLabel(attCol);
        body.appendChild(attHead);

        const existing = (row.cells[attKeyID]?.mAsset ?? []) as { name?: string; content?: string }[];
        for (const f of existing) {
            const line = document.createElement("div");
            line.className = active === "vehicles" ? "lv-att-row lv-detail-wide" : "lv-att-row";

            const name = document.createElement("span");
            name.className = "lv-att-name";
            name.textContent = `📎 ${f.name ?? f.content ?? "?"}`;
            line.appendChild(name);

            if (f.content) {
                try {
                    const preview = document.createElement("a");
                    preview.className = "b3-button b3-button--text lv-att-btn";
                    preview.textContent = t("ledger.previewAttachment");
                    preview.href = assetHref(f.content);
                    preview.target = "_blank";
                    preview.rel = "noopener noreferrer";
                    line.appendChild(preview);
                } catch {
                    /* safe */
                }

                const download = document.createElement("button");
                download.className = "b3-button b3-button--text lv-att-btn";
                download.textContent = t("ledger.downloadAttachment");
                download.onclick = async () => {
                    download.disabled = true;
                    try {
                        await downloadAsset(f);
                    } catch (e) {
                        showMessageFn(t("ledger.downloadFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                    } finally {
                        download.disabled = false;
                    }
                };
                line.appendChild(download);

                const w = typeof window !== "undefined" ? (window as any) : {};
                if (isImageAsset(f.content) && isEncryptedNotebookAsset(f.content, w.siyuan?.notebooks ?? [])) {
                    const encryptedHint = document.createElement("span");
                    encryptedHint.className = "ft__on-surface lv-att-btn";
                    encryptedHint.textContent = t("ledger.ocrEncrypted");
                    line.appendChild(encryptedHint);
                } else if (isImageAsset(f.content)) {
                    const ocr = document.createElement("button");
                    ocr.className = "b3-button b3-button--text lv-att-btn";
                    ocr.textContent = t("ledger.ocrOpen");
                    ocr.onclick = async () => {
                        ocr.disabled = true;
                        try {
                            const text = await getImageOCRText(f.content!);
                            if (text) showOCRText(f.name ?? f.content!, text, () => { void recognizeImage(f.content!, f.name ?? f.content!, ocr); });
                            else await recognizeImage(f.content!, f.name ?? f.content!, ocr);
                        } catch (error) {
                            if (isKernelError(error)) showOCRGuide();
                            else showMessageFn(t("ledger.ocrConfigFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 7000, "error");
                        } finally {
                            ocr.disabled = false;
                        }
                    };
                    line.appendChild(ocr);
                }
            }
            body.appendChild(line);
        }

        if (existing.length === 0) {
            const none = document.createElement("div");
            none.className = active === "vehicles" ? "ft__on-surface lv-att-none lv-detail-wide" : "ft__on-surface lv-att-none";
            none.textContent = t("ledger.noAttachments");
            body.appendChild(none);
        }

        const uploadBtn = document.createElement("button");
        uploadBtn.className = `b3-button b3-button--outline lv-att-upload-btn${active === "vehicles" ? " lv-detail-wide" : ""}`;
        uploadBtn.style.cssText = "margin-top:8px;font-size:12px";
        uploadBtn.textContent = t("ledger.upload");

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = active === "vehicles" && attCol.key === "attachments" ? "image/*" : "image/*,.pdf";
        fileInput.multiple = attCol.key === "attachments";
        if (active === "certs" && attCol.key !== "attachments") fileInput.setAttribute("capture", "environment");
        fileInput.style.display = "none";
        uploadBtn.onclick = () => fileInput.click();

        fileInput.onchange = async () => {
            let files = Array.from(fileInput.files ?? []);
            if (files.length === 0) return;
            if (active === "vehicles" && attCol.key === "attachments") {
                const valid = files.filter((file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024);
                if (valid.length !== files.length) showMessageFn(t("vehicle.photoInvalid"), 4500, "error");
                files = valid.slice(0, 1);
            }
            if (files.length === 0) return;
            uploadBtn.disabled = true;
            const failed: string[] = [];
            try {
                const appended = [...existing];
                for (const f of files) {
                    try {
                        const { name, path } = await uploadAsset(f, "/assets/siyuan-home/", {
                            idempotencyKey: `ledger:detail-asset:${row.itemID}:${attCol.key}:${f.name}:${f.size}`,
                            retries: 1,
                        });
                        appended.push({ name, content: path });
                    } catch (e) {
                        failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                if (appended.length !== existing.length) {
                    try {
                        await setCell(ref.avId!, attKeyID, row.itemID, { type: "mAsset", mAsset: appended }, {
                            idempotencyKey: `ledger:detail-asset-cell:${row.itemID}:${attCol.key}:${appended.map((asset) => asset.content).join("|")}`,
                            retries: 1,
                        });
                        const msg = failed.length ? t("ledger.uploadFailed").replace("${msg}", failed.join("; ")) : t("ledger.uploadDone");
                        showMessageFn(msg, 5000, failed.length ? "error" : "info");
                        if (onUploadSuccess) await onUploadSuccess();
                    } catch (e) {
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                    }
                }
            } finally {
                uploadBtn.disabled = false;
            }
        };

        body.appendChild(uploadBtn);
    }
}
