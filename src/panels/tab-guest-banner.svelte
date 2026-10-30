<script lang="ts">
    let {
        t,
        onOpenEmergencyCard,
        onToggleGuestMode,
    }: {
        t: (k: string) => string;
        onOpenEmergencyCard: () => void;
        onToggleGuestMode: () => void;
    } = $props();
</script>

<div class="lv-guest-banner" role="status">
    <div class="lv-guest-banner__left">
        <span class="lv-badge orange">{t("guest.bannerTitle")}</span>
        <span class="lv-caption">{t("guest.bannerDesc")}</span>
    </div>
    <div class="lv-guest-banner__right">
        <button class="b3-button b3-button--text" onclick={onOpenEmergencyCard}>
            🚨 {t("overview.emergencyCard")}
        </button>
        <button class="b3-button b3-button--text" onclick={onToggleGuestMode}>
            {t("guest.exitMode")}
        </button>
    </div>
</div>
