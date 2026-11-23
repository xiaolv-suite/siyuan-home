<script lang="ts">
    import { onMount } from "svelte";
    // DL2 阶段0：生态统一「外观与动效」偏好分组（庆祝/吉祥物/光效可关）
    import { mountLvUiPrefsSection } from "@/libs/lv-ui-prefs";

    let { t }: { t: (k: string) => string } = $props();

    let container: HTMLElement | undefined = $state();

    onMount(() => {
        if (container) mountLvUiPrefsSection(container, { title: t("tabAppearance") });
    });
</script>

<section class="lv-set-appearance" bind:this={container}></section>

<style>
    .lv-set-appearance {
        padding: 4px 2px;
    }
</style>
