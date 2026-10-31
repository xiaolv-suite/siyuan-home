<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { PluginScreen } from "./panel-session";

    let {
        screens,
        screen,
        pendingTotal,
        t,
        onGotoScreen,
        onOpenCapture,
        onOpenSpotlight,
        onOpenSetting,
    }: {
        screens: Array<{ id: PluginScreen; key: string; icon: any }>;
        screen: PluginScreen;
        pendingTotal: number;
        t: (k: string) => string;
        onGotoScreen: (s: PluginScreen) => void;
        onOpenCapture: (e: MouseEvent) => void;
        onOpenSpotlight: () => void;
        onOpenSetting: () => void;
    } = $props();

    function onRailKeydown(event: KeyboardEvent, index: number) {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? screens.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + screens.length) % screens.length;
        onGotoScreen(screens[next].id);
        requestAnimationFrame(() => (document.getElementById(`lv-rail-tab-${screens[next].id}`) as HTMLButtonElement | null)?.focus());
    }
</script>

<nav class="lv-rail-nav" aria-label={t("tab.title")}>
    <button type="button" class="lv-rail-nav__brand" title={t("butler")} onclick={() => onGotoScreen("overview")}>
        <UiIcon name="home" size={20} />
    </button>
    <div class="lv-rail-nav__menu" role="tablist" aria-orientation="vertical">
        {#each screens as s, i (s.id)}
            <button
                type="button"
                id={`lv-rail-tab-${s.id}`}
                data-s={s.id}
                class="lv-rail-nav__item"
                class:on={screen === s.id}
                role="tab"
                aria-selected={screen === s.id}
                aria-controls={`lv-panel-${s.id}`}
                tabindex={screen === s.id ? 0 : -1}
                title={t(s.key)}
                aria-label={s.id === "reminders" && pendingTotal > 0 ? t("tab.remindersPending").replace("${label}", t(s.key)).replace("${n}", String(pendingTotal)) : t(s.key)}
                onkeydown={(e) => onRailKeydown(e, i)}
                onclick={() => onGotoScreen(s.id)}
            >
                <UiIcon name={s.icon} size={18} />
                <span>{t(s.key)}</span>
                {#if s.id === "reminders" && pendingTotal > 0}<i class="lv-dot" aria-hidden="true"></i>{/if}
            </button>
        {/each}
    </div>
    <div class="lv-rail-nav__foot">
        <button
            type="button"
            class="lv-iconbtn is-primary"
            aria-label={t("capture.title")}
            title={`${t("capture.title")} (N)`}
            onclick={onOpenCapture}
        >
            <UiIcon name="bolt" size={17} />
        </button>
        <button
            type="button"
            class="lv-iconbtn"
            aria-label={t("spotlight.title")}
            title={`${t("spotlight.title")} (Ctrl+K)`}
            onclick={onOpenSpotlight}
        >
            <UiIcon name="search" size={16} />
        </button>
        <button
            type="button"
            class="lv-iconbtn"
            aria-label={t("tab.settings")}
            title={t("tab.settings")}
            onclick={onOpenSetting}
        >
            <UiIcon name="settings" size={16} />
        </button>
    </div>
</nav>
