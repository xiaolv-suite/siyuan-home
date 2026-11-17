<script module lang="ts">
    export function fileFingerprint(file: File): string {
        return `${file.name}:${file.size}:${file.lastModified}`;
    }
</script>

<script lang="ts">
    import { showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { setCell } from "@/core/siyuan";
    import { openNativeAssetPicker } from "@/libs/lv-notice-kit";

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
                    await setCell(ref.avId, ref.columns[key], pendingItemID, {
                        type: "mAsset",
                        mAsset: next.map(({ name, content }) => ({ name, content })),
                    }, { idempotencyKey: operation.key, retries: 1 });
                    attachmentWriteKeys.delete(slot);
                } catch (e) {
                    showMessage(t("ledger.attachmentRemoveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                    return;
                }
            }
            uploadedCertificateFiles = { ...uploadedCertificateFiles, [key]: next };
        }
    }

    function selectedFileText(key: string): string {
        const count = (certificateFiles[key]?.length ?? 0) + (uploadedCertificateFiles[key]?.length ?? 0);
        return count > 0 ? t("ledger.selectedFiles").replace("${n}", String(count)) : t("ledger.chooseAttachment");
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
                        <label class="b3-button b3-button--outline lv-record-file-btn" for="lv-new-file-{target.key}">
                            {selectedFileText(target.key)}
                        </label>
                        <input id="lv-new-file-{target.key}" type="file" multiple accept={active === "vehicles" && target.key === "attachments" ? "image/*" : "image/*,.pdf"} disabled={saving || identityPending} onchange={(event) => setCertificateFiles(target.key, Array.from((event.currentTarget as HTMLInputElement).files ?? []))} />
                        <button
                            type="button"
                            class="b3-button b3-button--outline"
                            title="从思源笔记本资源中选择"
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
                        >📁 选资源</button>
                    </div>
                    {#if localFiles.length > 0 || uploadedFiles.length > 0}
                        <div class="lv-record-file-list" aria-label={target.labelKey ? t(target.labelKey) : fieldLabel(target.key)}>
                            {#each uploadedFiles as file, index (`uploaded:${target.key}:${file.content}`)}
                                <div class="lv-record-file-item">
                                    <span>{file.name}</span>
                                    <button type="button" class="b3-button b3-button--text" onclick={() => void removeCertificateFile(target.key, "uploaded", index)} disabled={saving || identityPending}>{t("delete")}</button>
                                </div>
                            {/each}
                            {#each localFiles as file, index (`local:${target.key}:${fileFingerprint(file)}`)}
                                <div class="lv-record-file-item">
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
