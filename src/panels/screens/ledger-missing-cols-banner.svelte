<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { ColumnDef } from "@/core/schema";

    let {
        missingSchemaCols,
        rebuilding,
        t,
        fieldLabel,
        onRebuild,
    }: {
        missingSchemaCols: ColumnDef[];
        rebuilding: boolean;
        t: (k: string) => string;
        fieldLabel: (key: string) => string;
        onRebuild: () => void;
    } = $props();
</script>

<div class="lv-card lv-notice-card">
    <span class="lv-tx-warn"><UiIcon name="alert" size={16} /></span>
    <span class="fn__flex-1 lv-tx-2">
        {t("ledger.missingColumnsPrompt")} <b>{missingSchemaCols.map((c) => fieldLabel(c.key)).join("、")}</b>
    </span>
    <button type="button" class="b3-button b3-button--outline lv-btn-text-sm" disabled={rebuilding} onclick={onRebuild}>
        {rebuilding ? t("diag.rebuilding") : t("ledger.autoFixColumns")}
    </button>
</div>
