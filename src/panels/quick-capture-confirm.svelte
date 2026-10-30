<script lang="ts">
    import { onMount } from "svelte";
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

    let cancelBtn = $state<HTMLButtonElement>();

    onMount(() => {
        cancelBtn?.focus();
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="lv-sheet-confirm-mask" role="dialog" aria-modal="true" aria-labelledby="lv-discard-title" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <div class="lv-sheet-confirm-card">
        <b id="lv-discard-title">
            <UiIcon name="alert" size={16} /> {t("capture.discardUncertain")}
        </b>
        <p class="lv-caption">
            {t("capture.discardUncertainConfirm").replace("${module}", moduleName)}
        </p>
        <div class="actions">
            <button bind:this={cancelBtn} type="button" class="b3-button b3-button--cancel" onclick={onCancel}>
                {t("cancel")}
            </button>
            <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger lv-tx-strong" onclick={onConfirm}>
                {t("capture.discardUncertain")}
            </button>
        </div>
    </div>
</div>
