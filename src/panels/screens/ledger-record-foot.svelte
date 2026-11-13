<script lang="ts">
    let {
        saving,
        identityPending,
        pendingItemID,
        canSubmitNewRecord,
        t,
        onClose,
        onOpenPendingLedger,
        onDiscardUncertainDraft,
        onClearNewRecord,
        onSaveNewRecord,
    }: {
        saving: boolean;
        identityPending: boolean;
        pendingItemID: string | null;
        canSubmitNewRecord: boolean;
        t: (k: string) => string;
        onClose: () => void;
        onOpenPendingLedger: () => void;
        onDiscardUncertainDraft: () => void;
        onClearNewRecord: () => void;
        onSaveNewRecord: (continueAfter: boolean) => void;
    } = $props();
</script>

<div class="lv-sheet-foot">
    <button type="button" class="b3-button b3-button--cancel" onclick={onClose} disabled={saving}>
        {t("cancel")}
    </button>
    {#if identityPending}
        <button type="button" class="lv-btn ghost" onclick={onOpenPendingLedger}>
            {t("ledger.checkPending")}
        </button>
        <button type="button" class="lv-btn ghost" onclick={onDiscardUncertainDraft}>
            {t("ledger.discardUncertain")}
        </button>
    {/if}
    <button type="button" class="b3-button b3-button--text" onclick={onClearNewRecord} disabled={saving}>
        {pendingItemID ? t("ledger.discardPartial") : t("ledger.clearDraft")}
    </button>
    <span class="fn__flex-1"></span>
    <button type="button" class="lv-btn" onclick={() => onSaveNewRecord(true)} disabled={saving || !canSubmitNewRecord} aria-busy={saving}>
        {saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryContinue") : t("ledger.saveContinue")}
    </button>
    <button type="button" class="lv-btn primary" title="Ctrl+Enter" onclick={() => onSaveNewRecord(false)} disabled={saving || !canSubmitNewRecord} aria-busy={saving}>
        {saving ? t("ledger.saving") : (pendingItemID || identityPending) ? t("capture.retryClose") : t("save")}
    </button>
</div>
