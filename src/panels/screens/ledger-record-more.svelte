<script lang="ts">
    import type { ColumnDef } from "@/core/schema";
    import { memberChips } from "@/core/members";

    let {
        form = $bindable(),
        additionalCols,
        defaultOpen = false,
        members,
        columnSuggestions,
        saving,
        identityPending,
        t,
        fieldLabel,
        fieldMetaPlaceholder,
        formFieldError,
    }: {
        form: Record<string, any>;
        additionalCols: ColumnDef[];
        defaultOpen?: boolean;
        members: any[];
        columnSuggestions: Record<string, string[]>;
        saving: boolean;
        identityPending: boolean;
        t: (k: string) => string;
        fieldLabel: (k: string) => string;
        fieldMetaPlaceholder: (e: ColumnDef) => string;
        formFieldError: (e: ColumnDef) => string;
    } = $props();

    const filledCount = $derived(
        additionalCols.filter((col) => {
            const v = form[col.key];
            return v !== undefined && v !== null && v !== "" && (typeof v !== "string" || v.trim() !== "");
        }).length
    );
    const isOpen = $derived(defaultOpen || filledCount > 0);
</script>

{#if additionalCols.length > 0}
    <details class="lv-record-more" open={isOpen}>
        <summary>
            {t("ledger.additionalFields")} <span>{additionalCols.length}</span>
            {#if filledCount > 0}
                <span class="lv-badge blue lv-badge--xs" style="margin-left: 6px;">
                    {t("ledger.filledCount").replace("${n}", String(filledCount))}
                </span>
            {/if}
        </summary>
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
                            <div class="lv-record-relation-box" use:memberChips={{ id: `lv-new-${e.key}`, members, value: form[e.key], disabled: saving || identityPending, useAvItemId: true, allText: t("members.allFamily"), onChange: (v) => { form[e.key] = v; } }}></div>
                        {:else if e.type === "date"}
                            <input id="lv-new-{e.key}" class="b3-text-field" type="date" bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
                        {:else if e.type === "number"}
                            <input id="lv-new-{e.key}" class="b3-text-field" type="number" inputMode="numeric" min={e.min} max={e.max} step={e.step ?? "any"} placeholder={fieldMetaPlaceholder(e)} bind:value={form[e.key]} disabled={saving || identityPending} aria-invalid={!!formFieldError(e)} aria-describedby={formFieldError(e) ? `lv-new-${e.key}-error` : undefined} />
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
