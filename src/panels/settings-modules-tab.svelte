<script lang="ts">
    import { showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import { MODULE_GROUPS, modulesByGroup, BUILT_IN_MODULES } from "@/core/modules";
    import UiIcon from "@/ui/icon.svelte";
    import type { FamilyMember, ModuleGroupId } from "@/types";

    let {
        draftEnabled = $bindable(),
        draftMembers,
        t,
    }: {
        draftEnabled: string[];
        draftMembers: FamilyMember[];
        t: (k: string) => string;
    } = $props();

    let moduleGroup: ModuleGroupId = $state("people");
    let moduleSearch = $state("");

    const enabledIds = $derived(new Set(draftEnabled));
    const currentModules = $derived(
        moduleSearch.trim()
            ? BUILT_IN_MODULES.filter((m) => (t(`module.${m.id}`) + m.id).toLowerCase().includes(moduleSearch.trim().toLowerCase()))
            : modulesByGroup(moduleGroup)
    );

    function toggleModule(id: string, alwaysOn?: boolean) {
        if (alwaysOn) return;
        if (enabledIds.has(id)) {
            confirm(t("settings.disableTitle"), t("settings.disableBody").replace("${name}", t(`module.${id}`)), () => {
                draftEnabled = draftEnabled.filter((x) => x !== id);
            });
        } else {
            draftEnabled = [...draftEnabled, id];
            const mod = modulesByGroup("kids").find((m) => m.id === id);
            if (mod?.suggestRoles?.length) {
                const has = draftMembers.some((m) => mod.suggestRoles!.includes(m.role));
                if (!has) showMessage(t("members.suggestOn"), 3200, "info");
            }
        }
    }
</script>

<div class="lv-settings__pane-header">
    <div class="lv-settings__pane-title">{t("tabModules")}</div>
    <div class="lv-set-search-wrap">
        <input
            class="b3-text-field lv-set-search-input"
            type="search"
            placeholder={t("dash.moduleSearch")}
            aria-label={t("dash.moduleSearch")}
            bind:value={moduleSearch}
        />
        {#if moduleSearch}
            <button
                type="button"
                class="b3-button b3-button--text lv-set-search-clear"
                aria-label={t("clear")}
                onclick={() => { moduleSearch = ""; }}
            ><UiIcon name="close" size={12} /></button>
        {/if}
    </div>
</div>

{#if !moduleSearch.trim()}
    <nav class="lv-settings__subnav" aria-label={t("settings.moduleCategory")}>
        {#each MODULE_GROUPS as gid (gid)}
            <button
                type="button"
                class="lv-setnav__item {moduleGroup === gid ? 'on' : ''}"
                aria-current={moduleGroup === gid ? 'true' : undefined}
                onclick={() => (moduleGroup = gid)}
            >{t(`group.${gid}`)}</button>
        {/each}
    </nav>
{/if}

<div class="lv-settings__scroll" aria-label={moduleSearch.trim() ? t("dash.moduleSearch") : t(`group.${moduleGroup}`)}>
    <div class="lv-card lv-setcard lv-setcard--hint">{t("settings.modulesHint")}</div>
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{moduleSearch.trim() ? `${t("dash.moduleSearch")} · ${currentModules.length}` : t(`group.${moduleGroup}`)}</div>
        {#if currentModules.length === 0}
            <div class="lv-caption lv-tx-muted lv-dialog-empty">{t("ledger.searchEmpty")}</div>
        {:else}
            {#each currentModules as mod (mod.id)}
                <div class="fn__flex lv-settings__row">
                    <input
                        type="checkbox"
                        class="b3-switch"
                        aria-label={t(`module.${mod.id}`)}
                        checked={enabledIds.has(mod.id)}
                        disabled={mod.alwaysOn}
                        onchange={() => toggleModule(mod.id, mod.alwaysOn)}
                    />
                    <div class="fn__flex-1 fn__flex-column">
                        <span>
                            {t(`module.${mod.id}`)}
                            {#if mod.alwaysOn}<span class="lv-badge gray">{t("alwaysOn")}</span>{/if}
                            {#if mod.devStatus === "skeleton"}<span class="lv-badge gray">{t("skeleton")}</span>{/if}
                        </span>
                        <span class="b3-card__info-meta">{t(`module.${mod.id}.desc`)}</span>
                        {#if mod.suggestRoles?.length && !enabledIds.has(mod.id)}
                            <span class="ft__smaller ft__on-surface">
                                {t("settings.suggestRoles")}
                                {mod.suggestRoles.map((r) => t(`role.${r}`)).join(" / ")}
                            </span>
                        {/if}
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
