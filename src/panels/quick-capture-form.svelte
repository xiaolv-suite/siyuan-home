<script lang="ts">
    import { Dialog } from "siyuan";
    import { showMessage } from "@/libs/notice";
    import type { ColumnDef } from "@/core/schema";
    import { SCHEMA_CATALOG } from "@/core/schema-catalog";
    import { localDateKey } from "@/core/hub/rule";
    import { getCaptureAssetFields, getFieldPlaceholder } from "@/core/capture";
    import { capturePhotoFromDevice, preparePhotoFile } from "@/core/camera-capture";
    import { smartExtractFieldsFromTitle } from "@/core/block-capture";
    import UiIcon from "@/ui/icon.svelte";
    import { memberChips } from "@/core/members";
    import { DEFAULT_LOCATIONS } from "@/core/ledger-view-model";

    let {
        moduleId,
        captureFields,
        activeTarget,
        plugin,
        t,
        saving,
        saveError,
        fieldErrors = $bindable({}),
        values = $bindable({}),
        keepContext = $bindable(false),
        identityPending = false,
        nameEl = $bindable(),
        onSave,
        onClearFieldError,
        onDiscardUncertain,
    }: {
        moduleId: string;
        captureFields: ColumnDef[];
        activeTarget: any;
        plugin: any;
        t: (k: string) => string;
        saving: boolean;
        saveError: string;
        fieldErrors: Record<string, string>;
        values: Record<string, any>;
        keepContext: boolean;
        identityPending: boolean;
        nameEl?: HTMLInputElement;
        onSave: (continueAfter: boolean) => void;
        onClearFieldError: (key: string) => void;
        onDiscardUncertain: () => void;
    } = $props();

    const modLabel = (id: string) => (t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id);

    function fieldLabel(field: ColumnDef): string {
        const key = field.labelKey ?? `field.${field.key}`;
        return t(key) !== key ? t(key) : field.key;
    }
    function fieldPlaceholder(field: ColumnDef): string {
        return getFieldPlaceholder(field, moduleId, t);
    }
    function fieldDetail(key: string | undefined): string {
        if (!key) return "";
        const value = t(key);
        return value === key ? "" : value;
    }
    function fieldRequired(field: ColumnDef): boolean {
        return field.required === true;
    }

    function applyDatePreset(key: string, daysAhead: number) {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        values[key] = localDateKey(d);
        onClearFieldError(key);
    }

    function applyLocationPreset(key: string, loc: string) {
        values[key] = loc;
        onClearFieldError(key);
    }

    function handleNameBlur() {
        if (!values.name || typeof values.name !== "string") return;
        const res = smartExtractFieldsFromTitle(values.name);
        if (res.cleanTitle !== values.name) {
            values.name = res.cleanTitle;
            const dateField = captureFields.find((f) => f.type === "date");
            if (dateField && res.extractedDate && !values[dateField.key]) {
                values[dateField.key] = res.extractedDate;
                onClearFieldError(dateField.key);
            }
            const numField = captureFields.find((f) => f.type === "number" && ["amount", "price", "cost"].includes(f.key));
            if (numField && res.extractedAmount !== undefined && !values[numField.key]) {
                values[numField.key] = res.extractedAmount;
                onClearFieldError(numField.key);
            }
        }
    }

    const assetFields = $derived.by(() => {
        const schema = plugin?.schemaCatalog?.[moduleId] ?? SCHEMA_CATALOG[moduleId];
        const declared = new Set(captureFields.map((c) => c.key));
        return getCaptureAssetFields(schema).filter((c) => !declared.has(c.key));
    });

    function addAssetFiles(key: string, incoming: File[]) {
        if (!incoming.length) return;
        const current: File[] = Array.isArray(values[key]) ? values[key] : [];
        const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
        const next = [...current];
        for (const f of incoming) {
            const fp = `${f.name}:${f.size}:${f.lastModified}`;
            if (!seen.has(fp)) {
                seen.add(fp);
                next.push(f);
            }
        }
        values[key] = next;
        onClearFieldError(key);
    }

    function removeAssetFile(key: string, idx: number) {
        const current: File[] = Array.isArray(values[key]) ? values[key] : [];
        values[key] = current.filter((_, i) => i !== idx);
    }

    function triggerQuickCaptureCamera(key: string) {
        const inputEl = document.getElementById(`lv-cap-camera-${key}`) as HTMLInputElement | null;
        void capturePhotoFromDevice({
            DialogCls: Dialog,
            t,
            showMessageFn: showMessage,
            fallbackFileInput: () => inputEl?.click(),
            onFileCaptured: async (file) => {
                const prepared = await preparePhotoFile(file);
                addAssetFiles(key, [prepared]);
            },
        });
    }

    function previewThumb(node: HTMLImageElement, file: File) {
        let url = "";
        const bind = (f: File) => {
            if (url) { try { URL.revokeObjectURL(url); } catch { /* soft */ } url = ""; }
            if (f?.type?.startsWith("image/") && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
                try { url = URL.createObjectURL(f); node.src = url; } catch { /* soft */ }
            }
        };
        bind(file);
        return {
            update(nextFile: File) { bind(nextFile); },
            destroy() { if (url) { try { URL.revokeObjectURL(url); } catch { /* soft */ } } },
        };
    }

    const filledCaptureCount = $derived.by(() => captureFields.filter((field: any) => {
        const value = values[field.key];
        return value !== undefined && value !== null && value !== "" && value !== false;
    }).length);

    function fieldDescriptionIds(field: ColumnDef): string | undefined {
        const ids = new Set<string>();
        if ((field.helpKey && fieldDetail(field.helpKey)) || (field.unitKey && fieldDetail(field.unitKey))) ids.add(`lv-cap-help-${field.key}`);
        if (fieldErrors[field.key]) ids.add(`lv-cap-error-${field.key}`);
        return ids.size ? [...ids].join(" ") : undefined;
    }
</script>

<div class="lv-capture-context" role="status" aria-live="polite">
    <div class="lv-capture-context__main">
        <span class="lv-capture-context__eyebrow">{t("capture.contextTitle")}</span>
        <strong>{modLabel(moduleId)}</strong>
    </div>
    <span class="lv-capture-context__count">{t("capture.fieldCount").replace("${filled}", String(filledCaptureCount)).replace("${total}", String(captureFields.length))}</span>
    <span class="lv-capture-context__hint">
        {activeTarget?.avId
            ? t("capture.contextHint").replace("${module}", modLabel(moduleId))
            : t("capture.noTarget").replace("${module}", modLabel(moduleId))}
    </span>
</div>
{#each captureFields as f (f.key)}
    <div class="lv-frow">
        {#if f.key === "name"}
            <label for="lv-cap-name">{fieldLabel(f)} <small class="lv-capture-required">{t("capture.required")}</small></label>
            <input bind:this={nameEl} id="lv-cap-name" class="b3-text-field" type="text"
                placeholder={fieldPlaceholder(f)} bind:value={values.name} disabled={saving} required={fieldRequired(f)}
                aria-invalid={fieldErrors.name ? "true" : undefined}
                aria-describedby={fieldDescriptionIds(f)}
                oninput={() => onClearFieldError(f.key)}
                onblur={handleNameBlur}
                onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) onSave(false); }} />
        {:else}
            <label for="lv-cap-{f.key}">{fieldLabel(f)}{#if fieldRequired(f)} <small class="lv-capture-required">{t("capture.required")}</small>{/if}</label>
        {/if}
        {#if f.key !== "name" && f.type === "select"}
            <select id="lv-cap-{f.key}" class="b3-select" bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} onchange={() => onClearFieldError(f.key)}>
                <option value="">{t("capture.selectOptional")}</option>
                {#each f.options ?? [] as opt (opt)}
                    <option value={opt}>{t(`field.${f.key}.opt.${opt}`) !== `field.${f.key}.opt.${opt}` ? t(`field.${f.key}.opt.${opt}`) : opt}</option>
                {/each}
            </select>
        {:else if f.key !== "name" && f.type === "relation"}
            <div id="lv-cap-chips-{f.key}" use:memberChips={{ id: `lv-cap-${f.key}`, members: plugin.settings?.members, value: values[f.key], disabled: saving, useAvItemId: true, allText: t("members.allFamily"), onChange: (v) => { values[f.key] = v; onClearFieldError(f.key); } }}></div>
        {:else if f.key !== "name" && f.type === "date"}
            <input id="lv-cap-{f.key}" class="b3-text-field" type="date" bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => onClearFieldError(f.key)} />
            <div class="lv-preset-tags">
                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 0)}>{t("capture.presetToday")}</button>
                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 1)}>{t("capture.presetTomorrow")}</button>
                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 7)}>{t("capture.presetNextWeek")}</button>
            </div>
        {:else if f.key !== "name" && f.type === "number"}
            <input id="lv-cap-{f.key}" class="b3-text-field" type="number" inputMode="numeric" min={f.min} max={f.max} step={f.step ?? "any"} placeholder={fieldPlaceholder(f)} bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => onClearFieldError(f.key)} />
        {:else if f.key !== "name" && f.type === "checkbox"}
            <input id="lv-cap-{f.key}" class="b3-switch" type="checkbox" checked={values[f.key] === true} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} onchange={(event) => { values[f.key] = event.currentTarget.checked; onClearFieldError(f.key); }} />
        {:else if f.key !== "name" && f.type === "mAsset"}
            <div class="lv-record-file-picker" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button type="button" class="b3-button b3-button--outline" disabled={saving} onclick={() => triggerQuickCaptureCamera(f.key)}>
                    <UiIcon name="camera" size={13} /> <span>{t("ledger.takePhoto")}</span>
                </button>
                <input id="lv-cap-camera-{f.key}" type="file" accept="image/*" capture="environment" aria-label={t("ledger.takePhoto")} style="display:none;" disabled={saving} onchange={async (event) => {
                    const raw = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                    (event.currentTarget as HTMLInputElement).value = "";
                    const prepared = await Promise.all(raw.map((file) => preparePhotoFile(file)));
                    addAssetFiles(f.key, prepared);
                }} />
                <label class="b3-button b3-button--outline lv-record-file-btn" for="lv-cap-{f.key}">
                    <UiIcon name="upload" size={13} /> <span>{t("ledger.uploadLocal")}</span>
                </label>
                <input id="lv-cap-{f.key}" type="file" multiple accept={moduleId === "vehicles" && f.key === "attachments" ? "image/*" : "image/*,.pdf"} style="display:none;" disabled={saving} onchange={async (event) => {
                    const raw = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                    (event.currentTarget as HTMLInputElement).value = "";
                    const prepared = await Promise.all(raw.map((file) => preparePhotoFile(file)));
                    addAssetFiles(f.key, prepared);
                }} />
            </div>
            {#if Array.isArray(values[f.key]) && values[f.key].length > 0}
                <div class="lv-record-file-list">
                    {#each values[f.key] as file, idx (`${file.name}:${file.size}:${idx}`)}
                        <div class="lv-record-file-item">
                            {#if file.type?.startsWith("image/")}
                                <img use:previewThumb={file} alt={t("capture.cameraPreviewAlt")} style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex:none;" />
                            {/if}
                            <span>{file.name}</span>
                            <button type="button" class="b3-button b3-button--text" onclick={() => removeAssetFile(f.key, idx)} disabled={saving}>{t("delete")}</button>
                        </div>
                    {/each}
                </div>
            {/if}
        {:else if f.key !== "name"}
            <input id="lv-cap-{f.key}" class="b3-text-field" type={f.type === "url" ? "url" : "text"} placeholder={fieldPlaceholder(f)} bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => onClearFieldError(f.key)} />
            {#if f.key === "location" || f.key === "store_place"}
                <div class="lv-preset-tags">
                    {#each DEFAULT_LOCATIONS as loc (loc)}
                        <button type="button" class="lv-preset-tag" onclick={() => applyLocationPreset(f.key, loc)}>{loc}</button>
                    {/each}
                </div>
            {/if}
        {/if}
        {#if f.key !== "name" && (fieldDetail(f.helpKey) || fieldDetail(f.unitKey))}
            <small id="lv-cap-help-{f.key}" class="lv-capture-field-hint">
                {fieldDetail(f.helpKey)}{#if fieldDetail(f.helpKey) && fieldDetail(f.unitKey)} · {/if}{#if fieldDetail(f.unitKey)}{t("capture.unitLabel")}：{fieldDetail(f.unitKey)}{/if}
            </small>
        {/if}
        {#if fieldErrors[f.key]}<small id="lv-cap-error-{f.key}" class="lv-capture-field-error">{fieldErrors[f.key]}</small>{/if}
    </div>
{/each}
{#each assetFields as af (af.key)}
    <div class="lv-frow">
        <label for="lv-cap-{af.key}">{fieldLabel(af)}</label>
        <div class="lv-col-stretch" style="width:100%;">
            <div class="lv-record-file-picker" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button type="button" class="b3-button b3-button--outline" disabled={saving} onclick={() => triggerQuickCaptureCamera(af.key)}>
                    <UiIcon name="camera" size={13} /> <span>{t("ledger.takePhoto")}</span>
                </button>
                <input id="lv-cap-camera-{af.key}" type="file" accept="image/*" capture="environment" aria-label={t("ledger.takePhoto")} style="display:none;" disabled={saving} onchange={async (event) => {
                    const raw = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                    (event.currentTarget as HTMLInputElement).value = "";
                    const prepared = await Promise.all(raw.map((file) => preparePhotoFile(file)));
                    addAssetFiles(af.key, prepared);
                }} />
                <label class="b3-button b3-button--outline lv-record-file-btn" for="lv-cap-{af.key}">
                    <UiIcon name="upload" size={13} /> <span>{t("ledger.uploadLocal")}</span>
                </label>
                <input id="lv-cap-{af.key}" type="file" multiple accept={moduleId === "vehicles" && af.key === "attachments" ? "image/*" : "image/*,.pdf"} style="display:none;" disabled={saving} onchange={async (event) => {
                    const raw = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
                    (event.currentTarget as HTMLInputElement).value = "";
                    const prepared = await Promise.all(raw.map((file) => preparePhotoFile(file)));
                    addAssetFiles(af.key, prepared);
                }} />
            </div>
            {#if Array.isArray(values[af.key]) && values[af.key].length > 0}
                <div class="lv-record-file-list" style="margin-top:6px;">
                    {#each values[af.key] as file, idx (`${file.name}:${file.size}:${idx}`)}
                        <div class="lv-record-file-item">
                            {#if file.type?.startsWith("image/")}
                                <img use:previewThumb={file} alt={t("capture.cameraPreviewAlt")} style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex:none;" />
                            {/if}
                            <span>{file.name}</span>
                            <button type="button" class="b3-button b3-button--text" onclick={() => removeAssetFile(af.key, idx)} disabled={saving}>{t("delete")}</button>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/each}
{#if saving}<span class="lv-caption lv-capture-saving" role="status" aria-live="polite">{t("ledger.saving")}</span>{/if}
{#if saveError}
    <span class="lv-caption lv-capture-error-summary" role="alert" aria-live="assertive"><UiIcon name="alert" size={13} /> {saveError}</span>
{/if}
<div class="lv-keep-context-wrap">
    <label class="lv-keep-context-label" title={`${t("capture.keepContext")} (Alt+K)`}>
        <input type="checkbox" class="b3-switch lv-keep-context-switch" bind:checked={keepContext} aria-label={`${t("capture.keepContext")} (Alt+K)`} />
        <span class="lv-caption lv-keep-context-text">{t("capture.keepContext")} <span class="lv-keep-context-sub">(Alt+K)</span></span>
    </label>
    {#if identityPending}
        <button type="button" class="b3-button b3-button--text lv-discard-uncertain" onclick={onDiscardUncertain}>{t("capture.discardUncertain")}</button>
    {/if}
</div>
