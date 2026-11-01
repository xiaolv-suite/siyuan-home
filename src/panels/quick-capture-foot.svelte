<script lang="ts">
    let {
        captureTab,
        saving,
        identityPending,
        pendingRowId,
        canSubmitLedger,
        t,
        onClose,
        onSubmitEvent,
        onOpenPendingLedger,
        onSaveLedger,
    }: {
        captureTab: "event" | "ledger";
        saving: boolean;
        identityPending: boolean;
        pendingRowId?: string;
        canSubmitLedger: boolean;
        t: (k: string) => string;
        onClose: () => void;
        onSubmitEvent: (continueAfter?: boolean) => void;
        onOpenPendingLedger: () => void;
        onSaveLedger: (continueAfter: boolean) => void;
    } = $props();
</script>

<div class="lv-sheet-foot">
    <button type="button" class="b3-button b3-button--cancel" onclick={onClose} disabled={saving}>{t("cancel")}</button>
    <span class="fn__flex-1"></span>
    {#if captureTab === "event"}
        <button type="button" class="lv-btn" onclick={() => onSubmitEvent(true)} disabled={saving}>
            {saving ? t("ledger.saving") : t("capture.saveContinue")}
        </button>
        <button type="button" class="lv-btn primary" title="Ctrl+Enter" onclick={() => onSubmitEvent(false)} disabled={saving}>
            {saving ? t("ledger.saving") : t("capture.saveClose")}
        </button>
    {:else}
        {#if identityPending}
            <button type="button" class="lv-btn ghost" onclick={onOpenPendingLedger} disabled={saving}>{t("capture.checkLedger")}</button>
        {/if}
        <!-- 268 波：连续录入（家庭数据常成批）——保存后清空字段保留弹层，焦点回名称 -->
        <button type="button" class="lv-btn" onclick={() => onSaveLedger(true)} disabled={saving || !canSubmitLedger}>
            {saving ? t("ledger.saving") : (pendingRowId || identityPending) ? t("capture.retryContinue") : t("capture.saveContinue")}
        </button>
        <button type="button" class="lv-btn primary" title="Ctrl+Enter" onclick={() => onSaveLedger(false)} disabled={saving || !canSubmitLedger}>
            {saving ? t("ledger.saving") : (pendingRowId || identityPending) ? t("capture.retryClose") : t("capture.saveClose")}
        </button>
    {/if}
</div>
