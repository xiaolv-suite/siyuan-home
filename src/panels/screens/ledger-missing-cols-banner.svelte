<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { ColumnDef } from "@/core/schema";
    import type { SchemaColumnIssue } from "@/types";

    let {
        missingSchemaCols = [],
        schemaIssues = [],
        rebuilding,
        fixingIssueKey = "",
        t,
        fieldLabel,
        onRebuild,
        onFixSchemaIssue,
    }: {
        missingSchemaCols?: ColumnDef[];
        schemaIssues?: SchemaColumnIssue[];
        rebuilding: boolean;
        fixingIssueKey?: string;
        t: (k: string) => string;
        fieldLabel: (key: string) => string;
        onRebuild: () => void;
        onFixSchemaIssue?: (issue: SchemaColumnIssue) => void;
    } = $props();
</script>

{#if missingSchemaCols.length > 0}
    <div class="lv-card lv-notice-card">
        <span class="lv-tx-warn"><UiIcon name="alert" size={16} /></span>
        <span class="fn__flex-1 lv-tx-2">
            {t("ledger.missingColumnsPrompt")} <b>{missingSchemaCols.map((c) => fieldLabel(c.key)).join("、")}</b>
        </span>
        <button type="button" class="b3-button b3-button--outline lv-btn-text-sm" disabled={rebuilding} onclick={onRebuild}>
            {rebuilding ? t("diag.rebuilding") : t("ledger.autoFixColumns")}
        </button>
    </div>
{/if}

{#if schemaIssues.length > 0}
    <div class="lv-card lv-notice-card lv-schema-drift-banner" role="status">
        <span class="lv-tx-warn"><UiIcon name="alert" size={16} /></span>
        <span class="fn__flex-1 lv-tx-2">
            {t("ledger.schemaDriftPrompt")}
            <b>
                {schemaIssues
                    .map((issue) =>
                        t("ledger.schemaDriftDetail")
                            .replace("${field}", fieldLabel(issue.colKey))
                            .replace("${actual}", issue.actualType)
                            .replace("${expected}", issue.expectedType),
                    )
                    .join("、")}
            </b>
        </span>
        {#if onFixSchemaIssue}
            {#each schemaIssues as issue (`${issue.moduleId}:${issue.colKey}`)}
                <button
                    type="button"
                    class="b3-button b3-button--outline lv-btn-text-sm"
                    disabled={fixingIssueKey === issue.colKey}
                    onclick={() => onFixSchemaIssue(issue)}
                >
                    {fixingIssueKey === issue.colKey
                        ? t("ledger.schemaDriftFixing")
                        : `${t("ledger.schemaDriftFixBtn")} (${fieldLabel(issue.colKey)})`}
                </button>
            {/each}
        {/if}
    </div>
{/if}
