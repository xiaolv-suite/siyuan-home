<script lang="ts">
    import { BUILT_IN_MODULES, getModule } from "@/core/modules";
    import {
        computeLibraryGroups,
        isLedgerPinned,
        resolvePinnedLedgers,
        toggleModuleEnabled,
        togglePinnedLedger,
    } from "@/core/navigation-prefs";
    import { createDefaultGuestConfig, filterGuestVisibleModules } from "@/core/guest-mode";
    import { saveSettings } from "@/core/settings";
    import { homeNotify as showMessage } from "@/libs/notice";
    import type { HomePluginLike } from "@/types/plugin";
    import type { ModuleGroupId } from "@/types";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";

    let {
        plugin,
        t,
        version,
        onGoto,
    }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        version?: number;
        onGoto?: (s: any) => void;
    } = $props();

    let searchQuery = $state("");
    let libFilter = $state<"all" | "enabled" | "disabled">("all");
    let busyModuleId = $state<string | null>(null);
    let expandedGroups = $state<Record<ModuleGroupId, boolean>>({
        people: true,
        assets: true,
        living: true,
        kids: false,
        travel: false,
        media: false,
    });

    const isGuest = $derived.by(() => {
        void version;
        return Boolean(plugin.runtime?.guestModeActive);
    });

    const enabledModules = $derived.by(() => {
        void version;
        const base = plugin.settings?.enabledModules ?? [];
        return isGuest ? filterGuestVisibleModules(base, createDefaultGuestConfig(true)) : base;
    });

    const pinnedIds = $derived.by(() => {
        void version;
        return resolvePinnedLedgers(plugin.settings, enabledModules);
    });

    const groups = $derived.by(() => {
        void version;
        return computeLibraryGroups({
            enabledModules,
            query: searchQuery,
            filter: libFilter,
            t,
        });
    });

    function toggleGroup(gid: ModuleGroupId) {
        expandedGroups = { ...expandedGroups, [gid]: !expandedGroups[gid] };
    }

    async function handleTogglePin(moduleId: string) {
        if (isGuest) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const prev = plugin.settings.pinnedLedgers ? [...plugin.settings.pinnedLedgers] : undefined;
        togglePinnedLedger(plugin.settings, moduleId);
        try {
            await saveSettings(plugin as any, plugin.settings);
            plugin.emitHubChanged?.();
        } catch (err) {
            plugin.settings.pinnedLedgers = prev;
            showMessage(t("settings.saveFailed") + ` (${err instanceof Error ? err.message : String(err)})`, 5000, "error");
        }
    }

    async function handleToggleEnable(moduleId: string) {
        if (isGuest) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const mod = getModule(moduleId);
        if (!mod || mod.alwaysOn || busyModuleId) return;

        const prevEnabled = [...(plugin.settings.enabledModules ?? [])];
        const prevPinned = plugin.settings.pinnedLedgers ? [...plugin.settings.pinnedLedgers] : undefined;
        const { enabled, changed } = toggleModuleEnabled(plugin.settings, moduleId);
        if (!changed) return;

        busyModuleId = moduleId;
        try {
            await saveSettings(plugin as any, plugin.settings);
            if (enabled) {
                try {
                    if (!plugin.settings.dbRefs?.[moduleId]?.avId && typeof plugin.repairModule === "function") {
                        await plugin.repairModule(moduleId);
                    } else {
                        await plugin.ensureCoreLedgers?.();
                    }
                } catch { /* soft provisioning */ }
            }
            await plugin.refreshHub?.(undefined, true).catch(() => undefined);
            plugin.emitHubChanged?.();
            const name = t(`module.${moduleId}`);
            showMessage(
                t(enabled ? "lib.enabledToast" : "lib.disabledToast").replace("${name}", name),
                2600,
                "info",
            );
        } catch (err) {
            plugin.settings.enabledModules = prevEnabled;
            plugin.settings.pinnedLedgers = prevPinned;
            showMessage(t("settings.saveFailed") + ` (${err instanceof Error ? err.message : String(err)})`, 5000, "error");
        } finally {
            busyModuleId = null;
        }
    }

    function openModule(moduleId: string) {
        if (moduleId === "members") {
            onGoto?.("members");
            return;
        }
        plugin.setActiveLedger(moduleId);
        onGoto?.("ledger");
    }
</script>

<div class="lv-lib-head">
    <div>
        <h1>{t("lib.title")}</h1>
        <p>{t("lib.subtitle").replace("${total}", String(BUILT_IN_MODULES.length))}</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="lv-pill-badge lv-pill-badge--accent">
            {t("lib.summaryBadge")
                .replace("${on}", String(enabledModules.length))
                .replace("${total}", String(BUILT_IN_MODULES.length))
                .replace("${pin}", String(pinnedIds.length))}
        </span>
        <button type="button" class="lv-btn ghost sm" onclick={() => onGoto?.("reminders")}>
            <UiIcon name="bell" size={14} /> <span>{t("nav.allReminders")}</span>
        </button>
        <button type="button" class="lv-btn ghost sm" onclick={() => onGoto?.("members")}>
            <UiIcon name="users" size={14} /> <span>{t("tab.members")}</span>
        </button>
    </div>
</div>

<section class="lv-pinned-strip" aria-label={t("lib.pinnedHead")}>
    <div class="lv-pinned-strip__head">
        <b>{t("lib.pinnedHead")}</b>
        <span>{t("lib.pinnedHint")}</span>
    </div>
    <div class="lv-pinned-chips">
        {#if pinnedIds.length === 0}
            <span class="lv-caption">{t("lib.pinnedEmpty")}</span>
        {:else}
            {#each pinnedIds as pid (pid)}
                <span class="lv-pin-chip">
                    <UiIcon name={moduleUiIcon(pid)} size={13} />
                    <span>{t(`module.${pid}`)}</span>
                    <button
                        type="button"
                        aria-label={`${t("lib.unpin")} ${t(`module.${pid}`)}`}
                        title={t("lib.unpin")}
                        disabled={isGuest}
                        onclick={() => void handleTogglePin(pid)}
                    >
                        <UiIcon name="close" size={12} />
                    </button>
                </span>
            {/each}
        {/if}
    </div>
</section>

<div class="lv-lib-toolbar">
    <label class="lv-search-field">
        <UiIcon name="search" size={14} />
        <input
            type="search"
            bind:value={searchQuery}
            placeholder={t("lib.searchPlaceholder")}
            aria-label={t("lib.searchPlaceholder")}
        />
    </label>
    <div class="lv-seg" role="group" aria-label={t("filter")}>
        <button type="button" class="lv-seg-btn" class:on={libFilter === "all"} onclick={() => (libFilter = "all")}>
            {t("lib.filterAll").replace("${total}", String(BUILT_IN_MODULES.length))}
        </button>
        <button type="button" class="lv-seg-btn" class:on={libFilter === "enabled"} onclick={() => (libFilter = "enabled")}>
            {t("lib.filterEnabled")}
        </button>
        <button type="button" class="lv-seg-btn" class:on={libFilter === "disabled"} onclick={() => (libFilter = "disabled")}>
            {t("lib.filterDisabled")}
        </button>
    </div>
</div>

<div class="lv-lib-groups">
    {#if groups.length === 0}
        <div class="lv-lib-group" style="padding:22px;text-align:center;color:var(--lv-tx-3);font-size:13px;">
            {t("lib.emptySearch")}
        </div>
    {:else}
        {#each groups as grp (grp.groupId)}
            {@const isOpen = Boolean(searchQuery.trim() || libFilter !== "all" || expandedGroups[grp.groupId])}
            <section class="lv-lib-group" aria-label={t(`group.${grp.groupId}`)}>
                <button
                    type="button"
                    class="lv-lib-group__head"
                    class:is-collapsed={!isOpen}
                    aria-expanded={isOpen}
                    onclick={() => toggleGroup(grp.groupId)}
                >
                    <span class="lv-lib-group__left">
                        <b>{t(`group.${grp.groupId}`)}</b>
                        <span>
                            {t("lib.groupSummary")
                                .replace("${desc}", t(`group.${grp.groupId}.desc`))
                                .replace("${on}", String(grp.enabledCount))
                                .replace("${total}", String(grp.totalCount))}
                        </span>
                    </span>
                    <span class="lv-caption lv-lib-group__toggle" style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex-shrink:0;">
                        <span>{isOpen ? t("lib.collapse") : t("lib.expand")}</span>
                        <UiIcon name={isOpen ? "chevronUp" : "chevronDown"} size={12} />
                    </span>
                </button>
                {#if isOpen}
                    <div class="lv-lib-group-body">
                        {#each grp.modules as mod (mod.id)}
                            {@const enabled = enabledModules.includes(mod.id)}
                            {@const pinned = enabled && !mod.alwaysOn && isLedgerPinned(plugin.settings, mod.id, enabledModules)}
                            <div class="lv-lib-mod-row">
                                <div class="lv-lib-mod-info">
                                    <span class="lv-pinned-ic" aria-hidden="true">
                                        <UiIcon name={moduleUiIcon(mod.id)} size={15} />
                                    </span>
                                    <div class="lv-lib-mod-text">
                                        <b>{t(`module.${mod.id}`)}</b>
                                        <small>{t(`module.${mod.id}.desc`)}</small>
                                    </div>
                                </div>
                                <div class="lv-lib-mod-ctrl">
                                    {#if enabled}
                                        <button
                                            type="button"
                                            class="lv-btn ghost sm"
                                            style="min-height:28px;padding:0 8px;font-size:12px;"
                                            onclick={() => openModule(mod.id)}
                                        >
                                            {t("lib.openLedger")}
                                        </button>
                                    {/if}
                                    {#if enabled && !mod.alwaysOn}
                                        <button
                                            type="button"
                                            class="lv-pin-btn"
                                            class:on={pinned}
                                            disabled={isGuest}
                                            onclick={() => void handleTogglePin(mod.id)}
                                        >
                                            {pinned ? t("lib.pinned") : t("lib.pin")}
                                        </button>
                                    {/if}
                                    {#if mod.alwaysOn}
                                        <span class="lv-pill-badge">{t("lib.alwaysOnBadge")}</span>
                                    {:else}
                                        <button
                                            type="button"
                                            class="lv-switch-btn"
                                            class:on={enabled}
                                            role="switch"
                                            aria-checked={enabled}
                                            aria-label={t("lib.toggleEnableLabel").replace("${name}", t(`module.${mod.id}`))}
                                            disabled={isGuest || busyModuleId === mod.id}
                                            aria-busy={busyModuleId === mod.id}
                                            onclick={() => void handleToggleEnable(mod.id)}
                                        ></button>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </section>
        {/each}
    {/if}
</div>
