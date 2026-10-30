<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        moduleName,
        onCancel,
        onConfirm,
    }: {
        t: (k: string) => string;
        moduleName: string;
        onCancel: () => void;
        onConfirm: () => void;
    } = $props();
</script>

<div class="lv-sheet-confirm-mask" role="dialog" aria-modal="true">
    <div class="lv-sheet-confirm-card">
        <b>
            <UiIcon name="alert" size={16} /> {t("capture.discardUncertain")}
        </b>
        <p class="lv-caption">
            {t("capture.discardUncertainConfirm").replace("${module}", moduleName)}
        </p>
        <div class="actions">
            <button type="button" class="b3-button b3-button--cancel" onclick={onCancel}>
                {t("cancel")}
            </button>
            <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger lv-tx-strong" onclick={onConfirm}>
                {t("capture.discardUncertain")}
            </button>
        </div>
    </div>
</div>
