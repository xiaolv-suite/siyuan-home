<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        membersCount,
        memberAlertCount,
        reassignBusy,
        exportingVcf,
        editorOpen,
        onReassign,
        onExportVcf,
        onToggleEditor,
    }: {
        t: (k: string) => string;
        membersCount: number;
        memberAlertCount: number;
        reassignBusy: boolean;
        exportingVcf: boolean;
        editorOpen: boolean;
        onReassign: () => void;
        onExportVcf: () => void;
        onToggleEditor: () => void;
    } = $props();
</script>

<div class="lv-hero lv-members-hero">
    <div class="lv-hero-copy">
        <h1>{t("members.title")}</h1>
        <p class="lv-hero-lead">{t("settings.membersHint")}</p>
    </div>
    <div class="lv-hero-tools lv-members-tools-wrap">
        <div class="lv-members-hero-count">
            <b class="lv-num">{membersCount}</b><span>{t("members.title")}</span>
        </div>
        {#if memberAlertCount > 0}
            <div class="lv-members-hero-count is-alert">
                <b class="lv-num lv-tx-warn">{memberAlertCount}</b><span>{t("dash.needAttention")}</span>
            </div>
        {/if}
    </div>
</div>

<div class="lv-member-tools">
    <button class="b3-button b3-button--outline" onclick={onReassign} disabled={membersCount === 0 || reassignBusy} aria-busy={reassignBusy}>
        {reassignBusy ? t("ledger.saving") : t("members.reassign")}
    </button>
    <button class="b3-button b3-button--outline" onclick={onExportVcf} disabled={membersCount === 0 || exportingVcf} aria-busy={exportingVcf}>
        {exportingVcf ? t("ledger.saving") : t("members.exportVcf")}
    </button>
    <span class="fn__flex-1"></span>
    <button class={editorOpen ? "b3-button b3-button--outline" : "lv-btn primary"}
        aria-expanded={editorOpen} aria-controls="lv-member-editor"
        onclick={onToggleEditor}>
        {#if !editorOpen}<UiIcon name="add" size={15} />{/if}{editorOpen ? t("cancel") : t("add")}
    </button>
</div>

<style>
    .lv-members-hero {
        margin-top: 10px;
        margin-bottom: 0;
        align-items: center;
    }

    .lv-members-tools-wrap {
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .lv-members-hero-count {
        display: flex;
        align-items: baseline;
        gap: 7px;
        margin-left: auto;
        color: var(--lv-tx-3);
    }
    .lv-members-hero-count.is-alert {
        border-left: 1px solid var(--lv-line);
        padding-left: 16px;
    }

    .lv-members-hero-count b { color: var(--lv-tx); font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .lv-members-hero-count span { font-size: 12px; }

    .lv-member-tools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin: 0 2px 14px; }
    .lv-member-tools > button { min-height: 40px; }

    @container lv-home (max-width: 420px) {
        .lv-members-hero-count { display: none; }
        .lv-member-tools > button { min-height: 44px; }
    }
</style>
