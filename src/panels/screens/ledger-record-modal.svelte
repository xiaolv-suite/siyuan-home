<script lang="ts">
    import { RowIdentityPendingError } from "@/core/siyuan";
    import { showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { localDateKey } from "@/core/hub/rule";
    import type { HomePluginLike } from "@/types/plugin";
    import { parseIdNumber } from "@/core/idcard";
    import { getCertificateProfile, type ColumnDef } from "@/core/schema";
    import { getCaptureFields, getFormFields, getFieldPlaceholder } from "@/core/capture";
    import { executeLedgerRecordSave, smartExtractTitleFields } from "@/core/ledger-record-saver";
    import {
        getCertificateScalarCols,
        getQuickAssetCols,
        hasAnyFormInput,
        canSubmitRecord,
        prepareCategoryChange,
        validateFieldInput,
    } from "@/core/ledger-record-view-model";
    import LedgerRecordAttachments from "./ledger-record-attachments.svelte";
    import LedgerRecordMore from "./ledger-record-more.svelte";
    import LedgerRecordFoot from "./ledger-record-foot.svelte";
    import UiIcon from "@/ui/icon.svelte";
    import { memberChips } from "@/core/members";

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
    let rowIdentity = $state.raw<import("@/core/siyuan").DetachedRowIdentity | undefined>(undefined);
    let duplicateConfirmPending = $state(false);

    let wasOpen = false;
    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true;
            document.querySelector(".lv-home")?.classList.add("lv-scroll-locked");
            if (!newRecordTrigger && document.activeElement instanceof HTMLElement) {
                newRecordTrigger = document.activeElement;
            }
            requestAnimationFrame(() => nameInput?.focus());
        } else if (!open && wasOpen) {
            wasOpen = false;
            document.querySelector(".lv-home")?.classList.remove("lv-scroll-locked");
            restoreNewRecordFocus();
        }
    });

    const certificateProfile = $derived(active === "certs" && form.category ? getCertificateProfile(String(form.category)) : null);
    const certificateScalarCols = $derived(getCertificateScalarCols(plugin.schemaCatalog?.certs?.columns, certificateProfile));

    const idcardCheck = $derived.by(() => {
        const v = String(form.x_cert_id_number ?? "").trim();
        return v ? parseIdNumber(v) : null;
    });

    $effect(() => {
        const check = idcardCheck;
        if (check?.ok && check.sex && !form.x_cert_id_gender) form.x_cert_id_gender = check.sex;
    });

    const quickAssetCols = $derived(getQuickAssetCols(schemaCols, certificateProfile, active));

    let certificateFiles: Record<string, File[]> = $state({});
    let uploadedCertificateFiles: Record<string, { name: string; content: string }[]> = $state({});
    let lastCertificateCategory = $state("");

    function handleCertificateCategoryChange(category: string) {
        const hasDraft = active === "certs" && (
            Object.entries(form).some(([key, value]) => key !== "category" && value !== undefined && value !== "" && value !== false)
            || Object.values(certificateFiles).some((files) => files.length > 0)
            || Object.values(uploadedCertificateFiles).some((files) => files.length > 0)
            || !!pendingItemID
        );
        const res = prepareCategoryChange(category, lastCertificateCategory, hasDraft, form, certificateFiles, uploadedCertificateFiles);
        if (res.blocked) {
            showMessage(t("ledger.categoryChangeBlocked"), 5000, "error");
            form = { ...form, category: lastCertificateCategory };
            return;
        }
        lastCertificateCategory = category;
        if (res.newForm) form = res.newForm;
        if (res.newFiles) certificateFiles = res.newFiles;
        if (res.newUploaded) uploadedCertificateFiles = res.newUploaded;
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
    function formFieldError(field: ColumnDef): string {
        if (!validationAttempted) return "";
        return validateFieldInput(field, form[field.key], plugin.settings.members, t);
    }

    function applyDatePreset(key: string, daysAhead: number) {
        const d = new Date();
        if (daysAhead) d.setDate(d.getDate() + daysAhead);
        form[key] = localDateKey(d);
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

    const hasAnyInput = $derived(hasAnyFormInput(supportableCols, certificateScalarCols, quickAssetCols, form, certificateFiles, uploadedCertificateFiles));
    const nameMissing = $derived(hasAnyInput && !(form.name && String(form.name).trim()));
    const canSubmitNewRecord = $derived(canSubmitRecord(saving, form.name, hasAnyInput, active, form.category));

    function resetForm() {
        form = {};
        lastCertificateCategory = "";
        certificateFiles = {};
        uploadedCertificateFiles = {};
        saveError = ""; validationAttempted = false; identityPending = false; pendingItemID = null; recordOperationKey = null; rowIdentity = undefined;
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
            const previous = certificateFiles["attachments"] ?? [];
            certificateFiles = { ...certificateFiles, attachments: [...previous, ...tpl.files] };
        }
        nameInput?.focus();
    }

    function handleNewRecordNameBlur() {
        if (!form.name || typeof form.name !== "string") return;
        const res = smartExtractTitleFields(form.name, schemaCols);
        if (res.cleanTitle !== form.name) {
            form.name = res.cleanTitle;
            if (res.dateColKey && res.extractedDate && !form[res.dateColKey]) {
                form[res.dateColKey] = res.extractedDate;
            }
            if (res.numColKey && res.extractedAmount !== undefined && !form[res.numColKey]) {
                form[res.numColKey] = res.extractedAmount;
            }
        }
    }

    async function createRow() {
        handleNewRecordNameBlur();
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
        if (dupName && !pendingItemID && !rowIdentity?.submitted && nameKey) {
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
        if (!recordOperationKey) {
            try { recordOperationKey = `ledger:${crypto.randomUUID()}`; }
            catch { recordOperationKey = `ledger:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
        }
        rowIdentity ??= { avID: ref.avId, desiredItemID: "", before: [], submitted: false };
        identityPending = false;
        saving = true;
        saveError = "";

        try {
            const res = await executeLedgerRecordSave({
                plugin,
                active,
                ref: ref as { avId: string; docId?: string; columns?: Record<string, string> },
                form,
                supportableCols,
                certificateScalarCols,
                quickAssetCols,
                certificateFiles,
                uploadedCertificateFiles,
                missingSchemaCols,
                pendingItemID,
                hadIdentityPending,
                recordOperationKey,
                rowIdentity,
                t,
            });

            pendingItemID = res.itemID ?? pendingItemID;
            recordOperationKey = res.recordOperationKey;
            if (res.remainingFiles) certificateFiles = res.remainingFiles;
            if (res.uploadedFiles) uploadedCertificateFiles = res.uploadedFiles;

            if (!res.success && res.failedFields.length > 0) {
                saveError = t("ledger.savePartial").replace("${fields}", res.failedFields.join(", "));
                const { coalescedNotify } = await import("@/libs/notify-queue");
                coalescedNotify("ledger-save-error", () => showMessage(saveError, 6000, "error"));
            } else {
                const savedName = res.savedName;
                resetForm();
                if (closeAfterSave) {
                    open = false;
                    restoreNewRecordFocus();
                } else {
                    showMessage(t("capture.savedEvent") + (savedName ? ` (${savedName})` : ""), 2500, "info");
                }
                if (onRecordSaved) {
                    await onRecordSaved({ docId: ref?.docId, name: savedName, module: active });
                }
            }
        } catch (e) {
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
        if (event.key === "Tab") {
            if (saving) {
                event.preventDefault();
                document.querySelector<HTMLElement>(".lv-record-modal.open[role='dialog']")?.focus();
                return;
            }
            const sheet = document.querySelector(".lv-record-modal.open .lv-sheet");
            if (sheet) {
                const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                    .filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
                if (focusables.length > 0) {
                    const first = focusables[0];
                    const last = focusables[focusables.length - 1];
                    if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
                        event.preventDefault();
                        last.focus();
                        return;
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                        return;
                    }
                }
            }
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
            <button type="button" class="lv-iconbtn" aria-label={t("ledger.closeKeepDraft")} title={t("ledger.closeKeepDraft")} onclick={closeNewRecord} disabled={saving}><UiIcon name="close" size={16} /></button>
        </div>
        <div class="lv-sheet-body lv-record-body">
            <section class="lv-record-section">
                <h3>{t("ledger.newRecordBasic")}</h3>
                {#if currentLedgerTemplates.length > 0}
                    <div class="lv-template-bar">
                        <span class="lv-caption lv-tx-3"><UiIcon name="sparkle" size={13} /> {t("capture.frequentTemplates")}:</span>
                        {#each currentLedgerTemplates as tpl (tpl.id)}
                            <button type="button" class="lv-preset-tag" onclick={() => applyLedgerTemplate(tpl)} disabled={saving}>
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
                                <div class="lv-record-relation-box" use:memberChips={{ id: `lv-new-${e.key}`, members: plugin.settings?.members, value: form[e.key], disabled: saving || identityPending, useAvItemId: true, allText: t("members.allFamily"), onChange: (v) => { form[e.key] = v; } }}></div>
                            {:else if e.type === "date"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                                <div class="lv-preset-tags">
                                    <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(e.key, 0)}>{t("capture.presetToday")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(e.key, 1)}>{t("capture.presetTomorrow")}</button>
                                    <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(e.key, 7)}>{t("capture.presetNextWeek")}</button>
                                </div>
                            {:else if e.type === "number"}
                                <input id="lv-new-{e.key}" class="b3-text-field" type="number" inputMode="numeric" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
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

            <LedgerRecordMore
                bind:form
                additionalCols={active === "certs" ? [...(certificateScalarCols as ColumnDef[]).filter((c) => !captureKeys.has(c.key)), ...additionalCols] : additionalCols}
                defaultOpen={active === "certs" && certificateScalarCols.length > 0}
                members={plugin.settings.members}
                {columnSuggestions}
                {saving}
                {identityPending}
                {t}
                {fieldLabel}
                {fieldMetaPlaceholder}
                {formFieldError}
            />

            <LedgerRecordAttachments
                bind:certificateFiles
                bind:uploadedCertificateFiles
                {quickAssetCols}
                {active}
                {pendingItemID}
                {ref}
                {saving}
                {identityPending}
                {t}
                {fieldLabel}
            />

            {#if saveError}
                <div class="lv-record-error" role="alert">{saveError}</div>
            {/if}
        </div>
        <LedgerRecordFoot
            {saving}
            {identityPending}
            {pendingItemID}
            {canSubmitNewRecord}
            {t}
            onClose={closeNewRecord}
            onOpenPendingLedger={openPendingLedger}
            onDiscardUncertainDraft={discardUncertainDraft}
            onClearNewRecord={clearNewRecord}
            onSaveNewRecord={saveNewRecord}
        />
    </div>
</div>
