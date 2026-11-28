<script lang="ts">
    import { BUILT_IN_MODULES, MODULE_GROUPS, modulesByGroup } from "@/core/modules";
    import { resolvePinnedLedgers } from "@/core/navigation-prefs";
    import { createDefaultGuestConfig, filterGuestVisibleModules } from "@/core/guest-mode";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import type { ModuleGroupId } from "@/types";
    import type { PluginScreen } from "./panel-session";

    let {
        plugin,
        screen,
        activeLedger = "",
        pendingTotal,
        version = 0,
        t,
        onGotoScreen,
        onOpenLedger,
        onOpenCapture,
        onOpenSpotlight,
        onOpenSetting,
    }: {
        plugin: any;
        screen: PluginScreen;
        activeLedger?: string;
        pendingTotal: number;
        version?: number;
        t: (k: string) => string;
        onGotoScreen: (s: PluginScreen) => void;
        onOpenLedger: (moduleId: string) => void;
        onOpenCapture: (e: MouseEvent) => void;
        onOpenSpotlight: () => void;
        onOpenSetting: () => void;
    } = $props();

    let expandedScenes = $state<Record<ModuleGroupId, boolean>>({
        people: true,
        assets: false,
        living: false,
        kids: false,
        travel: false,
        media: false,
    });

    const isGuest = $derived.by(() => {
        void version;
        return Boolean(plugin?.runtime?.guestModeActive);
    });

    const enabledModules = $derived.by(() => {
        void version;
        const base = (plugin?.settings?.enabledModules ?? []) as string[];
        return isGuest ? filterGuestVisibleModules(base, createDefaultGuestConfig(true)) : base;
    });

    const pinnedModules = $derived.by(() => {
        void version;
        return resolvePinnedLedgers(plugin?.settings ?? { enabledModules }, enabledModules);
    });

    const sceneGroups = $derived.by(() => {
        void version;
        const enabledSet = new Set(enabledModules);
        return MODULE_GROUPS.map((gid) => ({
            groupId: gid,
            modules: modulesByGroup(gid).filter((m) => m.id !== "members" && enabledSet.has(m.id)),
        })).filter((g) => g.modules.length > 0);
    });

    const disabledCount = $derived.by(() => {
        const enabledSet = new Set(enabledModules);
        return BUILT_IN_MODULES.filter((m) => !enabledSet.has(m.id)).length;
    });

    const memberCount = $derived.by(() => {
        void version;
        return plugin?.settings?.members?.length ?? 0;
    });

    const statsByModule = $derived.by(() => {
        void version;
        return (plugin?.runtime?.cache?.byModule ?? {}) as Record<string, { rowCount?: number }>;
    });

    function rowCountLabel(mid: string): string {
        const count = statsByModule[mid]?.rowCount;
        return typeof count === "number" ? String(count) : "";
    }

    function toggleScene(gid: ModuleGroupId) {
        expandedScenes = { ...expandedScenes, [gid]: !expandedScenes[gid] };
    }
</script>

<nav class="lv-rail-nav" aria-label={t("tab.title")}>
    <button
        type="button"
        class="lv-rail-nav__brand"
        title={t("butler")}
        onclick={() => onGotoScreen("overview")}
    >
        <span class="lv-rail-nav__brand-mark" aria-hidden="true">
            <UiIcon name="home" size={14} />
        </span>
        <span class="lv-rail-nav__brand-text">
            <b>{t("butler")}</b>
            <small>{t("nav.subtitle")}</small>
        </span>
    </button>

    <button
        type="button"
        id="lv-rail-quick-btn"
        class="lv-rail-nav__quick-btn"
        title={`${t("capture.title")} (N)`}
        onclick={onOpenCapture}
    >
        <UiIcon name="add" size={14} />
        <span>{t("nav.quickEntry")}</span>
    </button>

    <div class="lv-rail-nav__menu">
        <button
            type="button"
            id="lv-rail-tab-overview"
            data-s="overview"
            class="lv-rail-nav__item"
            class:on={screen === "overview"}
            aria-current={screen === "overview" ? "page" : undefined}
            onclick={() => onGotoScreen("overview")}
        >
            <span class="lv-rail-nav__item-main">
                <UiIcon name="home" size={15} />
                <span>{t("nav.todayButler")}</span>
            </span>
            {#if pendingTotal > 0}
                <span class="lv-rail-nav__count">{pendingTotal}</span>
            {/if}
        </button>

        <button
            type="button"
            id="lv-rail-tab-reminders"
            data-s="reminders"
            class="lv-rail-nav__item"
            class:on={screen === "reminders"}
            aria-current={screen === "reminders" ? "page" : undefined}
            onclick={() => onGotoScreen("reminders")}
        >
            <span class="lv-rail-nav__item-main">
                <UiIcon name="bell" size={15} />
                <span>{t("nav.allReminders")}</span>
            </span>
            {#if pendingTotal > 0}
                <i class="lv-dot" aria-hidden="true"></i>
            {/if}
        </button>

        <div class="lv-rail-nav__sec-head">
            <span>{t("nav.pinnedTitle")}</span>
            <button type="button" class="lv-rail-nav__sec-link" onclick={() => onGotoScreen("library")}>
                {t("nav.manage")}
            </button>
        </div>

        {#each pinnedModules as mid (mid)}
            <button
                type="button"
                class="lv-rail-nav__item"
                class:on={screen === "ledger" && activeLedger === mid}
                aria-current={screen === "ledger" && activeLedger === mid ? "page" : undefined}
                onclick={() => onOpenLedger(mid)}
            >
                <span class="lv-rail-nav__item-main">
                    <UiIcon name={moduleUiIcon(mid)} size={14} />
                    <span>{t(`module.${mid}`)}</span>
                </span>
                {#if rowCountLabel(mid)}
                    <span class="lv-rail-nav__count">{rowCountLabel(mid)}</span>
                {/if}
            </button>
        {/each}

        <div class="lv-rail-nav__sec-head">
            <span>{t("nav.browseByScene")}</span>
        </div>

        {#each sceneGroups as grp (grp.groupId)}
            {@const isOpen = !!expandedScenes[grp.groupId]}
            <div class="lv-rail-nav__scene-group">
                <button
                    type="button"
                    class="lv-rail-nav__scene-toggle"
                    aria-expanded={isOpen}
                    onclick={() => toggleScene(grp.groupId)}
                >
                    <span class="lv-rail-nav__scene-left">
                        <UiIcon name={isOpen ? "chevronDown" : "forward"} size={11} />
                        <span>{t(`group.${grp.groupId}`)}</span>
                    </span>
                    <span class="lv-rail-nav__count">{grp.modules.length}</span>
                </button>
                {#if isOpen}
                    <div class="lv-rail-nav__scene-items">
                        {#each grp.modules as m (m.id)}
                            <button
                                type="button"
                                class="lv-rail-nav__sub-btn"
                                class:on={screen === "ledger" && activeLedger === m.id}
                                onclick={() => onOpenLedger(m.id)}
                            >
                                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{t(`module.${m.id}`)}</span>
                                {#if rowCountLabel(m.id)}
                                    <span class="lv-rail-nav__count">{rowCountLabel(m.id)}</span>
                                {/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}

        <button
            type="button"
            id="lv-rail-tab-library"
            data-s="library"
            class="lv-rail-nav__store-entry"
            class:on={screen === "library"}
            aria-current={screen === "library" ? "page" : undefined}
            onclick={() => onGotoScreen("library")}
        >
            <span>{t("nav.libraryEntry")}</span>
            <span class="lv-rail-nav__count">{t("nav.libraryCount").replace("${n}", String(disabledCount))}</span>
        </button>

        <div class="lv-rail-nav__spacer"></div>

        <div class="lv-rail-nav__foot">
            <button
                type="button"
                id="lv-rail-tab-members"
                data-s="members"
                class="lv-rail-nav__item"
                class:on={screen === "members"}
                aria-current={screen === "members" ? "page" : undefined}
                onclick={() => onGotoScreen("members")}
            >
                <span class="lv-rail-nav__item-main">
                    <UiIcon name="users" size={14} />
                    <span>{t("tab.members")} ({memberCount})</span>
                </span>
            </button>
            <button
                type="button"
                id="lv-rail-spotlight"
                class="lv-rail-nav__item"
                title={`${t("spotlight.title")} (Ctrl+K)`}
                onclick={onOpenSpotlight}
            >
                <span class="lv-rail-nav__item-main">
                    <UiIcon name="search" size={14} />
                    <span>{t("spotlight.title")}</span>
                </span>
            </button>
            <button
                type="button"
                id="lv-rail-settings"
                class="lv-rail-nav__item"
                onclick={onOpenSetting}
            >
                <span class="lv-rail-nav__item-main">
                    <UiIcon name="settings" size={14} />
                    <span>{t("nav.preferences")}</span>
                </span>
            </button>
        </div>
    </div>
</nav>
