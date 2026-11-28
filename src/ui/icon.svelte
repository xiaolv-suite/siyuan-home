<script lang="ts">
    import { UI_ICON_PATHS, SIYUAN_NATIVE_ICON_MAP, type UiIconName } from "./icons";

    let { name = "folder", size = 18, className = "", label }: {
        name?: UiIconName;
        size?: number;
        className?: string;
        label?: string;
    } = $props();

    const nativeSymbol = $derived(SIYUAN_NATIVE_ICON_MAP[name]);
    const path = $derived(UI_ICON_PATHS[name] ?? UI_ICON_PATHS.folder);
</script>

{#if nativeSymbol}
    <svg class={`lv-ui-icon lv-ui-icon--native ${className}`} width={size} height={size}
        style={`width:${size}px!important;height:${size}px!important;fill:currentColor!important;stroke:none!important;`}
        aria-hidden={label ? undefined : "true"} aria-label={label} role={label ? "img" : undefined} focusable="false">
        <use xlink:href={nativeSymbol}></use>
    </svg>
{:else}
    <svg class={`lv-ui-icon lv-ui-icon--custom ${className}`} width={size} height={size} viewBox="0 0 24 24"
        style={`width:${size}px!important;height:${size}px!important;fill:none!important;stroke:currentColor!important;`}
        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden={label ? undefined : "true"} aria-label={label} role={label ? "img" : undefined} focusable="false">
        <path d={path} fill="none"></path>
    </svg>
{/if}


