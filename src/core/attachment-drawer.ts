/**
 * 台账详情抽屉附件预览、下载、思源OCR识别与文件上传引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
import { assetHref, downloadAsset, isImageAsset, isEncryptedNotebookAsset, compressImageTo300KB } from "./assets";
import { bindDialogA11y } from "./dialog-a11y";
import { getOCRConfig, getImageOCRText, recognizeAsset, isKernelError, setCell, uploadAsset } from "./siyuan";
import { confirm } from "@/libs/dialog";
import { lvLaunchpad } from "@/libs/lv-notice-kit";
import { uiIcon } from "@/ui/icons";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
        bindDialogA11y({ dlg: guide });
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
        bindDialogA11y({ dlg: result });
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
            else showMessageFn(t("ledger.ocrConfigFailed").replace("${msg}", errMsg(error)), 7000, "error");
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
                showMessageFn(t("ledger.ocrFailed").replace("${msg}", errMsg(error)), 7000, "error");
            } finally {
                button.disabled = false;
                button.textContent = previousLabel;
            }
        }
    }

    for (const attCol of assetCols) {
        const attKeyID = ref.columns[attCol.key];
        if (!attKeyID) continue;

        const isVeh = active === "vehicles";
        body.appendChild(mk("div", isVeh ? "ft__on-surface lv-dialog-sec-head lv-detail-wide" : "ft__on-surface lv-dialog-sec-head", colLabel(attCol)));

        const existing = (row.cells[attKeyID]?.mAsset ?? []) as { name?: string; content?: string }[];
        for (const f of existing) {
            const line = mk("div", isVeh ? "lv-att-row lv-detail-wide" : "lv-att-row");
            const name = mk("span", "lv-att-name");
            name.innerHTML = `${uiIcon("paperclip", "", 13)} <span> ${esc(f.name ?? f.content ?? "?")}</span>`;
            line.appendChild(name);

            if (f.content) {
                try {
                    const preview = mk("a", "b3-button b3-button--text lv-att-btn", t("ledger.previewAttachment")) as HTMLAnchorElement;
                    preview.href = assetHref(f.content);
                    preview.target = "_blank";
                    preview.rel = "noopener noreferrer";
                    line.appendChild(preview);
                } catch {
                    /* safe */
                }

                const download = mk("button", "b3-button b3-button--text lv-att-btn", t("ledger.downloadAttachment")) as HTMLButtonElement;
                download.onclick = async () => {
                    download.disabled = true;
                    try {
                        await downloadAsset(f);
                    } catch (e) {
                        showMessageFn(t("ledger.downloadFailed").replace("${msg}", errMsg(e)), 6000, "error");
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
                    ocr.type = "button";
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
                            else showMessageFn(t("ledger.ocrConfigFailed").replace("${msg}", errMsg(error)), 7000, "error");
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
        uploadBtn.type = "button";
        uploadBtn.className = `b3-button b3-button--outline lv-att-upload-btn${active === "vehicles" ? " lv-detail-wide" : ""}`;
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
                        failed.push(`${f.name}: ${errMsg(e)}`);
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
                        showMessageFn(t("ledger.saveFailed").replace("${msg}", errMsg(e)), 6000, "error");
                    }
                }
            } finally {
                uploadBtn.disabled = false;
            }
        };

        body.appendChild(uploadBtn);

        // 移动端/证件专项：拍照留存直起相机拍摄并压缩 ≤300KB
        if (active === "certs") {
            const cameraBtn = document.createElement("button");
            cameraBtn.type = "button";
            cameraBtn.className = "b3-button b3-button--outline lv-att-camera-btn";
            cameraBtn.textContent = `📷 ${t("certs.capturePhoto") || "拍照留存"}`;

            const cameraInput = document.createElement("input");
            cameraInput.type = "file";
            cameraInput.accept = "image/*";
            cameraInput.setAttribute("capture", "environment");
            cameraInput.style.display = "none";
            cameraBtn.onclick = () => cameraInput.click();

            cameraInput.onchange = async () => {
                const files = Array.from(cameraInput.files ?? []);
                if (files.length === 0) return;
                const defaultLabel = `📷 ${t("certs.capturePhoto") || "拍照留存"}`;
                cameraBtn.disabled = true;
                cameraBtn.textContent = `⏳ ${t("certs.compressing") || "压缩处理中..."}`;
                try {
                    const rawFile = files[0];
                    let targetFile = rawFile;
                    let isCompressed = false;
                    try {
                        const compressed = await compressImageTo300KB(rawFile);
                        if (compressed) {
                            targetFile = compressed;
                            isCompressed = true;
                        }
                    } catch {
                        targetFile = rawFile;
                    }
                    cameraBtn.textContent = `☁️ ${t("certs.uploading") || "上传保存中..."}`;
                    const { name, path } = await uploadAsset(targetFile, "/assets/siyuan-home/", {
                        idempotencyKey: `ledger:detail-photo:${row.itemID}:${attCol.key}:${targetFile.name}:${targetFile.size}`,
                        retries: 1,
                    });
                    const appended = [...existing, { name, content: path }];
                    await setCell(ref.avId!, attKeyID, row.itemID, { type: "mAsset", mAsset: appended }, {
                        idempotencyKey: `ledger:detail-photo-cell:${row.itemID}:${attCol.key}:${appended.map((asset) => asset.content).join("|")}`,
                        retries: 1,
                    });
                    try {
                        lvLaunchpad.haptic(10);
                    } catch {
                        /* soft */
                    }
                    const successTip = isCompressed && targetFile.size <= 300 * 1024
                        ? (t("certs.photoSaved") || "证件照片已拍照并压缩留存（≤300KB）")
                        : (t("ledger.uploadDone") || "已保存原始照片");
                    showMessageFn(successTip, 4000, "info");
                    if (onUploadSuccess) await onUploadSuccess();
                } catch (e) {
                    showMessageFn(t("ledger.saveFailed").replace("${msg}", errMsg(e)), 6000, "error");
                } finally {
                    cameraBtn.disabled = false;
                    cameraBtn.textContent = defaultLabel;
                }
            };

            body.appendChild(cameraBtn);
        }
    }
}
