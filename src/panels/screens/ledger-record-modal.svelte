<script lang="ts">
    import { addDetachedRow, setCell, RowIdentityPendingError, renderLedgerAll } from "@/core/siyuan";
    import { selectCellValue } from "@/core/avcell";
    import { localDateKey } from "@/core/hub/rule";
    import { smartExtractFieldsFromTitle } from "@/core/block-capture";
    import { showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import type { HomePluginLike } from "@/types/plugin";
    import { parseIdNumber } from "@/core/idcard";
    import { getCertificateProfile, getCertificateReminderField, type ColumnDef } from "@/core/schema";
    import { getCaptureFields, getFormFields, validateCaptureInput, getFieldPlaceholder, type CaptureInputError } from "@/core/capture";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        active,
        ref,
        rows = [],
        avCols = [],
        dynamicLocations = [],
        columnSuggestions = {},
        currentLedgerTemplates = [],
        t,
        open = $bindable(false),
        onRecordSaved,
    }: {
        plugin: HomePluginLike;
        active: string;
        ref?: { avId?: string; docId?: string; columns?: Record<string, string> };
        rows?: any[];
        avCols?: any[];
        dynamicLocations?: string[];
        columnSuggestions?: Record<string, string[]>;
        currentLedgerTemplates?: any[];
        t: (k: string) => string;
        open: boolean;
        onRecordSaved?: (info: { docId?: string; name: string; module: string }) => Promise<void> | void;
    } = $props();

    const captureCols = $derived.by(() => getCaptureFields(plugin.schemaCatalog?.[active]));
    const schemaCols = $derived(plugin.schemaCatalog?.[active]?.columns ?? []);
    const missingSchemaCols = $derived.by(() => {
        if (!ref?.columns || avCols.length === 0) return [] as ColumnDef[];
        const existingIds = new Set(avCols.map((c: any) => c?.id));
        return schemaCols.filter((sc) => {
            const registeredId = ref.columns?.[sc.key];
            return !registeredId || !existingIds.has(registeredId);
        });
    });
    const supportableCols = $derived(getFormFields(plugin.schemaCatalog?.[active]).filter((field) =>
        !(active === "certs" && field.key.startsWith("x_cert_"))
        && !(field.type === "relation" && field.key !== "member")));
    const captureKeys = $derived(new Set(captureCols.map((field) => field.key)));
    const additionalCols = $derived(supportableCols.filter((field) =>
        !captureKeys.has(field.key)
        && !(active === "certs" && (field.key.startsWith("x_cert_")
            || ["holder_no", "issue_date", "issuance_rule", "store_place", "location", "copy_location", "note", "due"].includes(field.key)))));

    let form: Record<string, any> = $state({});
    let nameInput: HTMLInputElement | undefined = $state();
    let closeAfterSave = $state(true);
    let newRecordTrigger: HTMLElement | null = null;
    let saving = $state(false);
    let saveError = $state("");
    let validationAttempted = $state(false);
    let identityPending = $state(false);
    let pendingItemID = $state<string | null>(null);
    let recordOperationKey = $state<string | null>(null);
    let duplicateConfirmPending = $state(false);

    const certificateProfile = $derived(active === "certs" && form.category ? getCertificateProfile(String(form.category)) : null);
    const certificateScalarCols = $derived.by(() => {
        if (!certificateProfile) return [] as { key: string; type: string; options?: string[] }[];
        const schemaColsLocal: any[] = plugin.schemaCatalog?.certs?.columns ?? [];
        const keys = new Set(["x_cert_holder_name", "holder_no", "x_cert_id_number", "issue_date", "x_cert_valid_from", "issuance_rule", "store_place", "location", "copy_location", "note", ...certificateProfile.fieldKeys]);
        if (!getCertificateReminderField(certificateProfile.category)) keys.add("due");
        if (certificateProfile.category === "id") keys.delete("holder_no");
        return schemaColsLocal.filter((col: any) => keys.has(col.key) && col.type !== "mAsset")
            .map((col: any) => ({ key: col.key, type: col.type, options: col.options }));
    });

    const idcardCheck = $derived.by(() => {
        const v = String(form.x_cert_id_number ?? "").trim();
        return v ? parseIdNumber(v) : null;
    });

    $effect(() => {
        const check = idcardCheck;
        if (check?.ok && check.sex && !form.x_cert_id_gender) form.x_cert_id_gender = check.sex;
    });

    const certificateAssetCols = $derived.by(() => active === "certs"
        ? [
            ...schemaCols.filter((col) => col.key === "attachments" && col.type === "mAsset"),
            ...(certificateProfile?.columns.filter((col) => col.type === "mAsset") ?? []),
        ]
        : []);

    const quickAssetCols = $derived.by(() => {
        const seen = new Set<string>();
        const out: { key: string; type: string; labelKey?: string }[] = [];
        const genericAssetCols = schemaCols.filter((entry) => entry.type === "mAsset" && !entry.key.startsWith("x_cert_"));
        for (const col of [...genericAssetCols, ...certificateAssetCols]) {
            if (seen.has(col.key)) continue;
            seen.add(col.key);
            out.push({ key: col.key, type: "mAsset", labelKey: col.labelKey });
        }
        return out;
    });

    let certificateFiles: Record<string, File[]> = $state({});
    let uploadedCertificateFiles: Record<string, { name: string; content: string }[]> = $state({});
    const attachmentWriteKeys = new Map<string, { signature: string; key: string }>();
    let lastCertificateCategory = $state("");

    function fileFingerprint(file: File): string {
        return `${file.name}:${file.size}:${file.lastModified}`;
    }

    function newOperationKey(prefix: string): string {
        try { return `${prefix}:${crypto.randomUUID()}`; }
        catch { return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    }

    function setCertificateFiles(key: string, files: File[]) {
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

    async function removeCertificateFile(key: string, source: "local" | "uploaded", index: number, confirmed = false) {
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

    function handleCertificateCategoryChange(category: string) {
        const hasDraft = active === "certs" && (
            Object.entries(form).some(([key, value]) => key !== "category" && value !== undefined && value !== "" && value !== false)
            || Object.values(certificateFiles).some((files) => files.length > 0)
            || Object.values(uploadedCertificateFiles).some((files) => files.length > 0)
            || !!pendingItemID
        );
        if (lastCertificateCategory && category !== lastCertificateCategory && hasDraft) {
            showMessage(t("ledger.categoryChangeBlocked"), 5000, "error");
            form = { ...form, category: lastCertificateCategory };
            return;
        }
        lastCertificateCategory = category;
        const keep = new Set(["name", "member", "expiry", "status", "x_cert_holder_name", "holder_no", "issue_date", "x_cert_valid_from", "issuance_rule", "store_place", "location", "copy_location", "note"]);
        form = { ...Object.fromEntries(Object.entries(form).filter(([key]) => keep.has(key))), category };
        certificateFiles = Object.fromEntries(Object.entries(certificateFiles).filter(([key]) => key === "attachments"));
        uploadedCertificateFiles = Object.fromEntries(Object.entries(uploadedCertificateFiles).filter(([key]) => key === "attachments"));
    }

    function fieldLabel(key: string): string {
        return t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key;
    }
    function fieldMetaText(key: string | undefined): string {
        if (!key) return "";
        const value = t(key);
        return value === key ? "" : value;
    }
    function fieldMetaPlaceholder(field: ColumnDef): string {
        return getFieldPlaceholder(field, active, t);
    }
    function captureValidationMessage(field: ColumnDef, issue: CaptureInputError): string {
        return t(`capture.validation.${issue}`)
            .replace("${field}", fieldLabel(field.key))
            .replace("${min}", String(field.min ?? ""))
            .replace("${max}", String(field.max ?? ""));
    }
    function formFieldError(field: ColumnDef): string {
        if (!validationAttempted) return "";
        const issue = validateCaptureInput(field, form[field.key]);
        if (issue) return captureValidationMessage(field, issue);
        if (field.type === "relation") {
            const relationID = String(form[field.key] ?? "").trim();
            if (relationID && !(plugin.settings.members ?? []).some((member) => member.avItemId === relationID)) return t("members.notLinked");
        }
        return "";
    }
    function focusCaptureField(key: string) {
        const control = document.getElementById(`lv-new-${key}`);
        const collapsed = control?.closest("details");
        if (collapsed instanceof HTMLDetailsElement) collapsed.open = true;
        requestAnimationFrame(() => control?.focus());
    }

    export function openNewRecordModal(initialForm?: Record<string, any>) {
        if (!ref?.avId) {
            showMessage(t("ledger.notProvisionedHint"), 4500, "info");
            return;
        }
        newRecordTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        validationAttempted = false;
        saveError = "";
        if (initialForm) form = { ...initialForm };
        open = true;
        requestAnimationFrame(() => nameInput?.focus());
    }

    function restoreNewRecordFocus() {
        const trigger = newRecordTrigger;
        newRecordTrigger = null;
        requestAnimationFrame(() => {
            if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus();
        });
    }

    export function closeNewRecord() {
        if (saving) return;
        open = false;
        restoreNewRecordFocus();
    }

    function openPendingLedger() {
        if (!ref?.docId) return;
        closeNewRecord();
        plugin.showTabDocs(ref.docId);
    }

    function discardUncertainDraft() {
        resetForm();
        showMessage(t("ledger.uncertainDraftDiscarded"), 6000, "error");
    }

    function clearNewRecord() {
        if (pendingItemID) {
            void discardPartialRecord();
            return;
        }
        if (!hasAnyInput) {
            resetForm();
            return;
        }
        confirm(t("ledger.clearDraft"), t("ledger.clearDraftConfirm"), () => resetForm());
    }

    async function discardPartialRecord() {
        if (!pendingItemID || !ref?.avId || saving || identityPending) return;
        confirm(t("ledger.discardPartial"), t("ledger.discardPartialConfirm"), async () => {
            saving = true;
            try {
                const { removeLedgerRows } = await import("@/core/siyuan");
                await removeLedgerRows(ref!.avId!, [pendingItemID!], { idempotencyKey: `ledger:discard:${pendingItemID}` });
                resetForm();
                if (onRecordSaved) await onRecordSaved({ docId: ref?.docId, name: "", module: active });
                showMessage(t("ledger.discardPartialDone"), 3000, "info");
            } catch (e) {
                showMessage(t("ledger.discardPartialFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            } finally {
                saving = false;
            }
        });
    }

    function saveNewRecord(continueAfter: boolean) {
        if (saving) return;
        identityPending = false;
        closeAfterSave = !continueAfter;
        void createRow();
    }

    function cellValue(type: string, v: any): unknown | null {
        switch (type) {
            case "select": return selectCellValue(v);
            case "relation": {
                const relationID = typeof v === "string" ? v.trim() : "";
                const linked = relationID && (plugin.settings.members ?? []).some((m) => m.avItemId === relationID);
                return linked ? { type: "relation", relation: { blockIDs: [relationID], contents: null } } : null;
            }
            case "date": return v === "" ? { type: "date", date: { isNotEmpty: false } } : { type: "date", date: { content: new Date(`${v}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } };
            case "number": return v === "" || v === null ? { type: "number", number: { isNotEmpty: false } } : { type: "number", number: { content: Number(v), isNotEmpty: true } };
            case "url": return { type: "url", url: { content: v } };
            case "checkbox": return { type: "checkbox", checkbox: { checked: !!v } };
            default: return { type: "text", text: { content: String(v) } };
        }
    }

    const hasAnyInput = $derived(supportableCols.some((e) => {
        const v = form[e.key];
        return e.key === "name" ? !!(v && String(v).trim()) : v !== undefined && v !== "" && v !== false;
    }) || certificateScalarCols.some((e) => form[e.key] !== undefined && form[e.key] !== "" && form[e.key] !== false)
        || quickAssetCols.some((e) => (certificateFiles[e.key]?.length ?? 0) > 0 || (uploadedCertificateFiles[e.key]?.length ?? 0) > 0));

    const nameMissing = $derived(hasAnyInput && !(form.name && String(form.name).trim()));
    const canSubmitNewRecord = $derived(!saving && !nameMissing && !(active === "certs" && !form.category));

    function resetForm() {
        form = {};
        lastCertificateCategory = "";
        certificateFiles = {};
        uploadedCertificateFiles = {};
        saveError = ""; validationAttempted = false; identityPending = false; pendingItemID = null; recordOperationKey = null;
    }

    function applyLedgerTemplate(tpl: any) {
        if (tpl.values) {
            form = { ...form, ...tpl.values };
        } else if (tpl.fields) {
            form = { ...form, ...tpl.fields };
        }
        if (active === "certs" && (tpl.values?.category || tpl.fields?.category)) {
            handleCertificateCategoryChange(String(tpl.values?.category ?? tpl.fields?.category));
        }
        if (tpl.files?.length && active === "certs") {
            setCertificateFiles("attachments", tpl.files);
        }
        nameInput?.focus();
    }

    function handleNewRecordNameBlur() {
        if (!form.name || typeof form.name !== "string") return;
        const res = smartExtractFieldsFromTitle(form.name);
        if (res.cleanTitle !== form.name) {
            form.name = res.cleanTitle;
            const dateCol = schemaCols.find((c) => c.type === "date" && ["expiry", "due", "date"].includes(c.key));
            if (dateCol && res.extractedDate && !form[dateCol.key]) {
                form[dateCol.key] = res.extractedDate;
            }
            const numCol = schemaCols.find((c) => c.type === "number" && ["amount", "price", "deposit"].includes(c.key));
            if (numCol && res.extractedAmount !== undefined && !form[numCol.key]) {
                form[numCol.key] = res.extractedAmount;
            }
        }
    }

    async function createRow() {
        if (!ref?.avId || saving || identityPending || duplicateConfirmPending) return;
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        validationAttempted = true;
        if (!hasAnyInput) {
            nameInput?.focus();
            showMessage(t("ledger.nameRequired"), 4000, "info");
            return;
        }
        if (nameMissing) {
            saveError = t("ledger.nameRequired");
            showMessage(saveError, 4000, "error");
            return;
        }
        if (active === "certs" && !String(form.category ?? "").trim()) {
            saveError = t("ledger.categoryRequired");
            showMessage(saveError, 4000, "info");
            return;
        }
        if (active === "certs" && form.x_cert_id_number && idcardCheck && !idcardCheck.ok) {
            saveError = t("ledger.idcardBad").replace("${reason}", t(`ledger.idcardReason.${idcardCheck.reason ?? "format"}`));
            focusCaptureField("x_cert_id_number");
            showMessage(saveError, 4500, "error");
            return;
        }
        for (const field of supportableCols) {
            const error = formFieldError(field);
            if (!error) continue;
            saveError = error;
            focusCaptureField(field.key);
            showMessage(saveError, 4500, "error");
            return;
        }
        const dupName = String(form.name ?? "").trim();
        const nameKey = ref.columns?.name;
        if (dupName && !pendingItemID && nameKey) {
            const dupCount = rows.filter((r) => String(r.cells?.[nameKey]?.text?.content ?? "").trim() === dupName).length;
            if (dupCount > 0) {
                duplicateConfirmPending = true;
                confirm(
                    t("ledger.dupTitle"),
                    t("ledger.dupBody").replace("${name}", dupName).replace("${n}", String(dupCount)),
                    () => { duplicateConfirmPending = false; void doCreateRow(); },
                    () => { duplicateConfirmPending = false; },
                );
                return;
            }
        }
        await doCreateRow();
    }

    async function doCreateRow() {
        if (!ref?.avId || saving) return;
        const hadIdentityPending = identityPending;
        identityPending = false;
        saving = true;
        saveError = "";
        if (missingSchemaCols.length > 0 && ref?.avId) {
            try { await plugin.repairModule?.(active); } catch { /* soft heal */ }
        }
        if (!recordOperationKey) {
            try { recordOperationKey = `ledger:${crypto.randomUUID()}`; }
            catch { recordOperationKey = `ledger:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
        }
        try {
            let itemID = pendingItemID;
            if (!itemID && hadIdentityPending) {
                try {
                    const all = await renderLedgerAll(ref.avId, 50);
                    const nameCol = ref.columns?.name;
                    const title = String(form.name ?? "").trim();
                    if (nameCol && title) {
                        const matched = all.rows.find((row) => {
                            const val = String(row.cells?.[nameCol]?.text?.content ?? row.cells?.[nameCol]?.block?.content ?? "").trim();
                            return val === title;
                        });
                        if (matched) {
                            itemID = matched.itemID;
                            pendingItemID = itemID;
                        }
                    }
                } catch { /* soft reconciliation */ }
            }
            if (!itemID) {
                itemID = await addDetachedRow(ref.avId, String(form.name ?? "").trim() || t("ledger.unnamed"), {
                    idempotencyKey: `${recordOperationKey}:row`,
                });
                pendingItemID = itemID;
            }
            const cols = plugin.settings.dbRefs[active]?.columns ?? ref.columns ?? {};
            const failed: string[] = [];
            const tryCell = async (label: string, key: string | undefined, value: unknown) => {
                if (!key) { failed.push(label); return; }
                if (value === null) { failed.push(label); return; }
                try {
                    await setCell(ref!.avId!, key, itemID, value, {
                        idempotencyKey: `${recordOperationKey}:cell:${key}`,
                    });
                } catch {
                    failed.push(label);
                }
            };
            for (const e of supportableCols) {
                const v = form[e.key];
                if (e.key !== "name" && (v === undefined || v === "" || v === false)) continue;
                if (e.key === "name" && !(v && String(v).trim()) && pendingItemID) continue;
                if (e.type === "number" && (v === undefined || isNaN(Number(v)))) continue;
                await tryCell(t(`field.${e.key}`), cols[e.key], cellValue(e.type, e.key === "name" ? String(v ?? "").trim() : v));
            }
            for (const e of certificateScalarCols) {
                const v = form[e.key];
                if (v === undefined || v === "" || v === false) continue;
                if (e.type === "number" && isNaN(Number(v))) continue;
                await tryCell(t(`field.${e.key}`), cols[e.key], cellValue(e.type, v));
            }
            if (quickAssetCols.length > 0) {
                for (const target of quickAssetCols) {
                    const previous = uploadedCertificateFiles[target.key] ?? [];
                    const uploaded = [...previous];
                    const failedFiles: File[] = [];
                    if (!cols[target.key]) {
                        failed.push(t(`field.${target.key}`));
                        continue;
                    }
                    for (const file of certificateFiles[target.key] ?? []) {
                        try {
                            const { uploadAsset } = await import("@/core/siyuan");
                            const { name, path } = await uploadAsset(file, "/assets/siyuan-home/", {
                                idempotencyKey: `${recordOperationKey}:asset:${target.key}:${fileFingerprint(file)}`,
                            });
                            uploaded.push({ name, content: path });
                        } catch (e) {
                            failed.push(`${t(`field.${target.key}`)}: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
                            failedFiles.push(file);
                        }
                    }
                    certificateFiles = { ...certificateFiles, [target.key]: failedFiles };
                    if (uploaded.length === 0) continue;
                    uploadedCertificateFiles = { ...uploadedCertificateFiles, [target.key]: uploaded };
                    await tryCell(t(`field.${target.key}`), cols[target.key], {
                        type: "mAsset",
                        mAsset: uploaded.map(({ name, content }) => ({ name, content })),
                    });
                }
            }
            const statusCol = (plugin.schemaCatalog?.[active]?.columns ?? []).find((c: any) => c.key === "status");
            if (statusCol?.options?.length && (form.status === undefined || form.status === "")) {
                await tryCell(t("field.status"), cols.status, selectCellValue(statusCol.default ?? statusCol.options[0]));
            }
            if (failed.length > 0) {
                saveError = t("ledger.savePartial").replace("${fields}", failed.join(", "));
                const { coalescedNotify } = await import("@/libs/notify-queue");
                coalescedNotify("ledger-save-error", () => showMessage(saveError, 6000, "error"));
            } else {
                const savedName = String(form.name ?? "").trim();
                resetForm();
                if (closeAfterSave) {
                    open = false;
                    restoreNewRecordFocus();
                }
                if (onRecordSaved) {
                    await onRecordSaved({ docId: ref?.docId, name: savedName, module: active });
                }
            }
        } catch (e) {
            recordOperationKey = null;
            if (e instanceof RowIdentityPendingError) {
                identityPending = true;
                saveError = t("ledger.savePending");
            } else {
                saveError = t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e));
            }
            showMessage(saveError, 6000, "error");
        } finally {
            saving = false;
        }
    }

    function onNewRecordKeydown(event: KeyboardEvent) {
        if (!open) return;
        if (duplicateConfirmPending) return;
        if (event.key === "Tab" && saving) {
            event.preventDefault();
            document.querySelector<HTMLElement>(".lv-record-modal.open[role='dialog']")?.focus();
            return;
        }
        if (saving) return;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (canSubmitNewRecord) void saveNewRecord(event.altKey);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeNewRecord();
            return;
        }
    }
</script>

<svelte:window onkeydown={onNewRecordKeydown} />
<div class="lv-mask" class:open aria-hidden="true" onclick={closeNewRecord}></div>
<div class="lv-modal lv-record-modal" class:open role="dialog" aria-modal="true" aria-labelledby="lv-new-record-title" aria-busy={saving || duplicateConfirmPending} tabindex="-1" inert={!open || duplicateConfirmPending}>
    <div class="lv-sheet lv-record-sheet">
        <div class="lv-sheet-head">
            <div class="lv-record-title">
                <b id="lv-new-record-title">{t("ledger.newRecordTitle").replace("${module}", t(`module.${active}`) !== `module.${active}` ? t(`module.${active}`) : active)}</b>
                <span>{t("ledger.newRecordIntro")}</span>
            </div>
            <button class="lv-iconbtn" aria-label={t("ledger.closeKeepDraft")} title={t("ledger.closeKeepDraft")} onclick={closeNewRecord} disabled={saving}><UiIcon name="close" size={16} /></button>
        </div>
        <div class="lv-sheet-body lv-record-body">
            <section class="lv-record-section">
                <h3>{t("ledger.newRecordBasic")}</h3>
                {#if currentLedgerTemplates.length > 0}
                    <div class="lv-template-bar" style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;font-size:11.5px;margin-bottom:12px">
                        <span class="lv-caption" style="color:var(--lv-tx-3);font-size:11px">✨ {t("capture.frequentTemplates")}:</span>
                        {#each currentLedgerTemplates as tpl (tpl.id)}
                            <button type="button" class="lv-preset-tag" onclick={() => applyLedgerTemplate(tpl)} disabled={saving} style="font-size:11.5px;padding:2px 8px">
                                {#if tpl.icon}<span>{tpl.icon}</span>{/if}
                                <span>{tpl.label}</span>
                            </button>
                        {/each}
                    </div>
                {/if}
                <div class="lv-record-grid">
                    {#each captureCols as e (e.key)}
                        <div class="lv-record-field" class:lv-record-field-wide={e.key === "name" || e.type === "url"}>
                            {#if e.type !== "checkbox"}<label for="lv-new-{e.key}">{fieldLabel(e.key)}{e.required || (active === "certs" && e.key === "category") ? " *" : ""}</label>{/if}
                            {#if e.type === "select"}
                                <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} onfocus={active === "certs" && e.key === "category" ? () => { lastCertificateCategory = String(form.category ?? ""); } : undefined} onchange={active === "certs" && e.key === "category" ? (event) => handleCertificateCategoryChange((event.currentTarget as HTMLSelectElement).value) : undefined} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                    <option value="">{fieldLabel(e.key)}</option>
                                    {#each e.options ?? [] as opt (opt)}
                                        <option value={opt}>{t(`field.${e.key}.opt.${opt}`) !== `field.${e.key}.opt.${opt}` ? t(`field.${e.key}.opt.${opt}`) : opt}</option>
                                    {/each}
                                </select>
                            {:else if e.type === "relation"}
                                <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                    <option value="">{fieldLabel(e.key)}: {t("members.all")}</option>
                                    {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                                        <option value={m.avItemId ?? ""} disabled={!m.avItemId}>{m.name}{m.avItemId ? "" : ` · ${t("members.notLinked")}`}</option>
                                    {/each}
                                </select>
                            {:else if e.type === "date"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                <div class="lv-preset-tags">
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); form[e.key] = localDateKey(d); }}>{t("capture.presetToday")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 1); form[e.key] = localDateKey(d); }}>{t("capture.presetTomorrow")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 7); form[e.key] = localDateKey(d); }}>{t("capture.presetNextWeek")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 30); form[e.key] = localDateKey(d); }}>{t("capture.presetNextMonth")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => { const d = new Date(); d.setDate(d.getDate() + 365); form[e.key] = localDateKey(d); }}>{t("capture.presetNextYear")}</button>
                                </div>
                            {:else if e.type === "number"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="number" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                            {:else if e.type === "url"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="url" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                            {:else if e.type === "checkbox"}
                                <label class="lv-record-check"><input id="lv-new-{e.key}" type="checkbox" class="b3-switch" bind:checked={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />{fieldLabel(e.key)}{e.required ? " *" : ""}</label>
                            {:else if e.key === "name"}
                                <input bind:this={nameInput} id="lv-new-{e.key}" class="b3-text-field" type="text" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} onblur={handleNewRecordNameBlur} onkeydown={(event: KeyboardEvent) => { if (event.key === "Enter" && !event.isComposing) saveNewRecord(false); }} />
                            {:else if ["note", "violations", "diagnosis"].includes(e.key)}
                                <textarea id="lv-new-{e.key}" class="b3-text-field lv-record-textarea" rows="3" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}></textarea>
                            {:else}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="text" list={columnSuggestions[e.key] ? `lv-datalist-${e.key}` : undefined} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                {#if columnSuggestions[e.key]}
                                    <datalist id="lv-datalist-{e.key}">
                                        {#each columnSuggestions[e.key] as suggestion (suggestion)}
                                            <option value={suggestion}></option>
                                        {/each}
                                    </datalist>
                                {/if}
                                {#if e.key === "location" || e.key === "store_place" || e.key === "copy_location"}
                                    <div class="lv-preset-tags">
                                        {#each dynamicLocations as loc (loc)}
                                            <button type="button" class="lv-preset-tag" onclick={() => { form[e.key] = loc; }}>{loc}</button>
                                        {/each}
                                    </div>
                                {/if}
                            {/if}
                            {#if fieldMetaText(e.helpKey) || fieldMetaText(e.unitKey)}
                                <small class="lv-capture-field-hint">
                                    {fieldMetaText(e.helpKey)}{#if fieldMetaText(e.helpKey) && fieldMetaText(e.unitKey)} · {/if}{#if fieldMetaText(e.unitKey)}{t("capture.unitLabel")}：{fieldMetaText(e.unitKey)}{/if}
                                </small>
                            {/if}
                            {#if formFieldError(e)}<small class="lv-record-field-error" id="lv-new-{e.key}-error" role="alert">{formFieldError(e)}</small>{/if}
                        </div>
                    {/each}
                </div>
            </section>

            {#if additionalCols.length > 0}
                <details class="lv-record-more">
                    <summary>{t("ledger.additionalFields")} <span>{additionalCols.length}</span></summary>
                    <section class="lv-record-section lv-record-section--nested">
                        <div class="lv-record-grid">
                            {#each additionalCols as e (e.key)}
                                <div class="lv-record-field" class:lv-record-field-wide={e.key === "name" || e.type === "url" || ["note", "violations", "diagnosis"].includes(e.key)}>
                                    {#if e.type !== "checkbox"}<label for="lv-new-{e.key}">{fieldLabel(e.key)}{e.required ? " *" : ""}</label>{/if}
                                    {#if e.type === "select"}
                                        <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                            <option value="">{fieldLabel(e.key)}</option>
                                            {#each e.options ?? [] as opt (opt)}
                                                <option value={opt}>{t(`field.${e.key}.opt.${opt}`) !== `field.${e.key}.opt.${opt}` ? t(`field.${e.key}.opt.${opt}`) : opt}</option>
                                            {/each}
                                        </select>
                                    {:else if e.type === "relation"}
                                        <select id="lv-new-{e.key}" class="b3-select" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}>
                                            <option value="">{fieldLabel(e.key)}: {t("members.all")}</option>
                                            {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                                                <option value={m.avItemId ?? ""} disabled={!m.avItemId}>{m.name}{m.avItemId ? "" : ` · ${t("members.notLinked")}`}</option>
                                            {/each}
                                        </select>
                                    {:else if e.type === "date"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "number"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="number" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "url"}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="url" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {:else if e.type === "checkbox"}
                                        <label class="lv-record-check"><input id="lv-new-{e.key}" type="checkbox" class="b3-switch" bind:checked={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />{fieldLabel(e.key)}{e.required ? " *" : ""}</label>
                                    {:else if ["note", "violations", "diagnosis"].includes(e.key)}
                                        <textarea id="lv-new-{e.key}" class="b3-text-field lv-record-textarea" rows="3" placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined}></textarea>
                                    {:else}
                                        <input id="lv-new-{e.key}" class="b3-text-field" type="text" list={columnSuggestions[e.key] ? `lv-datalist-${e.key}` : undefined} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                    {/if}
                                    {#if formFieldError(e)}<small class="lv-record-field-error" id="lv-new-{e.key}-error" role="alert">{formFieldError(e)}</small>{/if}
                                </div>
                            {/each}
                        </div>
                    </section>
                </details>
            {/if}

            {#if quickAssetCols.length > 0}
                <section class="lv-record-section">
                    <h3>{t("field.attachments")}</h3>
                    <div class="lv-record-grid">
                        {#each quickAssetCols as target (target.key)}
                            {@const localFiles = certificateFiles[target.key] ?? []}
                            {@const uploadedFiles = uploadedCertificateFiles[target.key] ?? []}
                            <div class="lv-record-field lv-record-field-wide">
                                <label for="lv-new-file-{target.key}">{target.labelKey ? t(target.labelKey) : fieldLabel(target.key)}</label>
                                <div class="lv-record-file-picker">
                                    <label class="b3-button b3-button--outline lv-record-file-btn" for="lv-new-file-{target.key}">
                                        {selectedFileText(target.key)}
                                    </label>
                                    <input id="lv-new-file-{target.key}" type="file" multiple accept={active === "vehicles" && target.key === "attachments" ? "image/*" : "image/*,.pdf"} disabled={saving || identityPending} onchange={(event) => setCertificateFiles(target.key, Array.from((event.currentTarget as HTMLInputElement).files ?? []))} />
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

            {#if saveError}
                <div class="lv-record-error" role="alert">{saveError}</div>
            {/if}
        </div>
        <div class="lv-sheet-foot">
            <button class="b3-button b3-button--cancel" onclick={closeNewRecord} disabled={saving}>{t("cancel")}</button>
            {#if identityPending}
                <button class="lv-btn ghost" onclick={openPendingLedger}>{t("ledger.checkPending")}</button>
                <button class="lv-btn ghost" onclick={discardUncertainDraft}>{t("ledger.discardUncertain")}</button>
            {/if}
            <button class="b3-button b3-button--text" onclick={clearNewRecord} disabled={saving}>{pendingItemID ? t("ledger.discardPartial") : t("ledger.clearDraft")}</button>
            <span class="fn__flex-1"></span>
            <button class="lv-btn" onclick={() => saveNewRecord(true)} disabled={!canSubmitNewRecord}>{saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryContinue") : t("ledger.saveContinue")}</button>
            <button class="lv-btn primary" title="Ctrl+Enter" onclick={() => saveNewRecord(false)} disabled={!canSubmitNewRecord}>{saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryClose") : t("save")}</button>
        </div>
    </div>
</div>
