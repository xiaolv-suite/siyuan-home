<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        rescanning,
        onRescan,
    }: {
        t: (k: string) => string;
        rescanning: boolean;
        onRescan: () => void;
    } = $props();
</script>

<div class="lv-card lv-alert-banner" role="alert">
    <UiIcon name="alert" size={18} />
    <span class="lv-alert-text">{t("permission.body")}</span>
    <button
        type="button"
        class="b3-button b3-button--outline"
        disabled={rescanning}
        aria-busy={rescanning}
        onclick={onRescan}
    >
        {rescanning ? t("diag.rebuilding") : t("hub.rescan")}
    </button>
</div>
