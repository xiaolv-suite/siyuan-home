<script module lang="ts">
    export function fileFingerprint(file: File): string {
        return `${file.name}:${file.size}:${file.lastModified}`;
    }
</script>

<script lang="ts">
    import { Dialog } from "siyuan";
    import { showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { setCellResilient } from "@/core/siyuan";
    import { assetHref, isImageAsset } from "@/core/assets";
    import { capturePhotoFromDevice, preparePhotoFile } from "@/core/camera-capture";
    import { openNativeAssetPicker } from "@/libs/lv-notice-kit";
    import UiIcon from "@/ui/icon.svelte";

    let {
        certificateFiles = $bindable<Record<string, File[]>>({}),
        uploadedCertificateFiles = $bindable<Record<string, { name: string; content: string }[]>>({}),
        quickAssetCols = [] as any[],
        active = "",
        pendingItemID = null as string | null,
        ref,
        saving = false,
        identityPending = false,
        t,
        fieldLabel,
    }: {
        certificateFiles?: Record<string, File[]>;
        uploadedCertificateFiles?: Record<string, { name: string; content: string }[]>;
        quickAssetCols?: any[];
        active?: string;
        pendingItemID?: string | null;
        ref?: { avId?: string; columns?: Record<string, string> };
        saving?: boolean;
        identityPending?: boolean;
        t: (k: string) => string;
        fieldLabel: (k: string) => string;
    } = $props();

    const attachmentWriteKeys = new Map<string, { signature: string; key: string }>();

    function newOperationKey(prefix: string): string {
        try { return `${prefix}:${crypto.randomUUID()}`; }
        catch { return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    }

    export function setCertificateFiles(key: string, files: File[]) {
        const vehiclePhoto = active === "vehicles" && key === "attachments";
        if (vehiclePhoto) {
            const invalid = files.filter((file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024);
            if (invalid.length) showMessage(t("vehicle.photoInvalid"), 4500, "error");
            files = files.filter((file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024).slice(0, 1);
        }
        const previous = certificateFiles[key] ?? [];
        const seen = new Set(previous.map(fileFingerprint));
        const unique = files.filter((file) => {
            const fingerprint = fileFingerprint(file);
            if (seen.has(fingerprint)) return false;
            seen.add(fingerprint);
            return true;
        });
        certificateFiles = { ...certificateFiles, [key]: [...previous, ...unique] };
    }

    export async function removeCertificateFile(key: string, source: "local" | "uploaded", index: number, confirmed = false) {
        if (source === "uploaded" && !confirmed) {
            confirm(t("ledger.removeAttachment"), t("ledger.removeAttachmentConfirm"), () => {
                void removeCertificateFile(key, source, index, true);
            });
            return;
        }
        if (source === "local") {
            certificateFiles = { ...certificateFiles, [key]: (certificateFiles[key] ?? []).filter((_, i) => i !== index) };
        } else {
            const next = (uploadedCertificateFiles[key] ?? []).filter((_, i) => i !== index);
            if (pendingItemID && ref?.avId && ref.columns?.[key]) {
                try {
                    const signature = JSON.stringify(next.map(({ name, content }) => ({ name, content })));
                    const slot = `${pendingItemID}:${key}`;
                    let operation = attachmentWriteKeys.get(slot);
                    if (!operation || operation.signature !== signature) {
                        operation = { signature, key: newOperationKey(`ledger:${pendingItemID}:attachment:${key}`) };
                        attachmentWriteKeys.set(slot, operation);
                    }
                    await setCellResilient({
                        avID: ref.avId,
                        keyID: ref.columns[key],
                        itemID: pendingItemID,
                        value: {
                            type: "mAsset",
                            mAsset: next.map(({ name, content }) => ({ name, content })),
                        },
                        moduleId: active,
                        colKey: key,
                        ref: ref as any,
                        schemaCol: { key, type: "mAsset" },
                        requestOptions: { idempotencyKey: operation.key, retries: 1 },
                    });
                    attachmentWriteKeys.delete(slot);
                } catch (e) {
                    showMessage(t("ledger.attachmentRemoveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                    return;
                }
            }
            uploadedCertificateFiles = { ...uploadedCertificateFiles, [key]: next };
        }
    }

    function previewThumb(node: HTMLImageElement, file: File) {
        let objectUrl = "";
        const bind = (f: File) => {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch { /* soft */ }
                objectUrl = "";
            }
            if (f?.type?.startsWith("image/") && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
                try {
                    objectUrl = URL.createObjectURL(f);
                    node.src = objectUrl;
                } catch { /* soft */ }
            }
        };
        bind(file);
        return {
            update(nextFile: File) { bind(nextFile); },
            destroy() {
                if (objectUrl) {
                    try { URL.revokeObjectURL(objectUrl); } catch { /* soft */ }
                }
            },
        };
    }

    function selectedFileText(key: string): string {
        const count = (certificateFiles[key]?.length ?? 0) + (uploadedCertificateFiles[key]?.length ?? 0);
        return count > 0 ? t("ledger.selectedFiles").replace("${n}", String(count)) : t("ledger.uploadLocal");
    }

    function triggerCameraCapture(key: string) {
        const inputEl = document.getElementById(`lv-new-camera-${key}`) as HTMLInputElement | null;
        void capturePhotoFromDevice({
            DialogCls: Dialog,
            t,
            showMessageFn: showMessage,
            fallbackFileInput: () => inputEl?.click(),
            onFileCaptured: async (file) => {
                const compressed = await preparePhotoFile(file);
                setCertificateFiles(key, [compressed]);
            },
        });
    }
</script>

{#if quickAssetCols.length > 0}
    <section class="lv-record-section">
        <h3>{t("field.attachments")}</h3>
        <div class="lv-record-grid">
            {#each quickAssetCols as target (target.key)}
                {@const localFiles = certificateFiles[target.key] ?? []}
                {@const uploadedFiles = uploadedCertificateFiles[target.key] ?? []}
                <div class="lv-record-field lv-record-field-wide">
                    <label for="lv-new-file-{target.key}">{target.labelKey ? t(target.labelKey) : fieldLabel(target.key)}</label>
                    <div class="lv-record-file-picker" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button
                            type="button"
                            class="b3-button b3-button--outline"
                            disabled={saving || identityPending}
                            onclick={() => triggerCameraCapture(target.key)}
                        >
                            <UiIcon name="camera" size={13} /> <span>{t("ledger.takePhoto")}</span>
                        </button>
                        <input
                            id="lv-new-camera-{target.key}"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            aria-label={t("ledger.takePhoto")}
                            style="display:none;"
                            disabled={saving || identityPending}
                            onchange={async (event) => {
                                const raw = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                                (event.currentTarget as HTMLInputElement).value = "";
                                if (raw.length === 0) return;
                                const prepared = await Promise.all(raw.map((f) => preparePhotoFile(f)));
                                setCertificateFiles(target.key, prepared);
                            }}
                        />
                        <label class="b3-button b3-button--outline lv-record-file-btn" for="lv-new-file-{target.key}">
                            <UiIcon name="upload" size={13} /> <span>{selectedFileText(target.key)}</span>
                        </label>
                        <input id="lv-new-file-{target.key}" type="file" multiple accept={active === "vehicles" && target.key === "attachments" ? "image/*" : "image/*,.pdf"} disabled={saving || identityPending} onchange={(event) => {
                            const files = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                            (event.currentTarget as HTMLInputElement).value = "";
                            setCertificateFiles(target.key, files);
                        }} />
                        <button
                            type="button"
                            class="b3-button b3-button--text"
                            title={t("ledger.pickFromAssets")}
                            disabled={saving || identityPending}
                            onclick={async () => {
                                const res = await openNativeAssetPicker();
                                if (res && res.path) {
                                    const cleanPath = res.path.trim();
                                    const assetName = cleanPath.replace(/^.*[\\/]/, "") || "asset";
                                    const current = uploadedCertificateFiles[target.key] ?? [];
                                    uploadedCertificateFiles = {
                                        ...uploadedCertificateFiles,
                                        [target.key]: [...current, { name: assetName, content: cleanPath }]
                                    };
                                }
                            }}
                        ><UiIcon name="link" size={12} /> <span>{t("ledger.pickExistingAsset")}</span></button>
                    </div>
                    {#if localFiles.length > 0 || uploadedFiles.length > 0}
                        <div class="lv-record-file-list" aria-label={target.labelKey ? t(target.labelKey) : fieldLabel(target.key)}>
                            {#each uploadedFiles as file, index (`uploaded:${target.key}:${file.content}`)}
                                <div class="lv-record-file-item">
                                    {#if isImageAsset(file.content)}
                                        <img src={assetHref(file.content)} alt={file.name} style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex:none;" />
                                    {/if}
                                    <span>{file.name}</span>
                                    <button type="button" class="b3-button b3-button--text" onclick={() => void removeCertificateFile(target.key, "uploaded", index)} disabled={saving || identityPending}>{t("delete")}</button>
                                </div>
                            {/each}
                            {#each localFiles as file, index (`local:${target.key}:${fileFingerprint(file)}`)}
                                <div class="lv-record-file-item">
                                    {#if file.type?.startsWith("image/")}
                                        <img use:previewThumb={file} alt={file.name} style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex:none;" />
                                    {/if}
                                    <span>{file.name}</span>
                                    <button type="button" class="b3-button b3-button--text" onclick={() => void removeCertificateFile(target.key, "local", index)} disabled={saving || identityPending}>{t("delete")}</button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </section>
{/if}
