<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        membersCount,
        memberAlertCount,
        reassignBusy,
        exportingVcf,
        editorOpen,
        membersDocId,
        hasContactsBridge = false,
        onReassign,
        onExportVcf,
        onOpenMembersDoc,
        onImportFromContacts,
        onToggleEditor,
    }: {
        t: (k: string) => string;
        membersCount: number;
        memberAlertCount: number;
        reassignBusy: boolean;
        exportingVcf: boolean;
        editorOpen: boolean;
        membersDocId?: string;
        hasContactsBridge?: boolean;
        onReassign: () => void;
        onExportVcf: () => void;
        onOpenMembersDoc?: () => void;
        onImportFromContacts?: () => void;
        onToggleEditor: () => void;
    } = $props();

    let mobileToolsOpen = $state(false);
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
    <div id="lv-member-secondary-tools" class="lv-member-secondary-tools" class:is-open={mobileToolsOpen}>
        <button type="button" class="b3-button b3-button--outline" onclick={onReassign} disabled={membersCount === 0 || reassignBusy} aria-busy={reassignBusy}>
            {reassignBusy ? t("ledger.saving") : t("members.reassign")}
        </button>
        <button type="button" class="b3-button b3-button--outline" onclick={onExportVcf} disabled={membersCount === 0 || exportingVcf} aria-busy={exportingVcf}>
            {exportingVcf ? t("ledger.saving") : t("members.exportVcf")}
        </button>
        {#if membersDocId && onOpenMembersDoc}
            <button type="button" class="b3-button b3-button--outline" onclick={onOpenMembersDoc} title={t("members.openLedger")}>
                <UiIcon name="folder" size={14} /> {t("members.openLedger")}
            </button>
        {/if}
        {#if hasContactsBridge && onImportFromContacts}
            <button type="button" class="b3-button b3-button--outline" onclick={onImportFromContacts} title={t("members.importFromContacts")}>
                <UiIcon name="link" size={14} /> {t("members.importFromContacts")}
            </button>
        {/if}
    </div>
    <span class="fn__flex-1"></span>
    <div class="lv-member-primary-actions">
        <button type="button" class={editorOpen ? "b3-button b3-button--outline" : "lv-btn primary"}
            aria-expanded={editorOpen} aria-controls="lv-member-editor"
            onclick={onToggleEditor}>
            {#if !editorOpen}<UiIcon name="add" size={15} />{/if}{editorOpen ? t("cancel") : t("add")}
        </button>
        <button
            type="button"
            class="b3-button b3-button--outline lv-member-more-toggle"
            class:is-active={mobileToolsOpen}
            aria-expanded={mobileToolsOpen}
            aria-controls="lv-member-secondary-tools"
            onclick={() => (mobileToolsOpen = !mobileToolsOpen)}
        >
            <UiIcon name="moreHorizontal" size={14} />
            <span>{t("ledger.moreActions")}</span>
            <UiIcon name={mobileToolsOpen ? "chevronUp" : "chevronDown"} size={12} />
        </button>
    </div>
</div>
