<script lang="ts">
    import { showMessage } from "siyuan";
    import { saveSettings } from "@/core/settings";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        t,
        notebookList = [],
        saving = false,
        migrationBusy = false,
        migrationAction = null,
        demoBusy = false,
        demoAction = null,
        preImportBackupExists = false,
        onExportSettings,
        onImportSettings,
        onRestorePreImport,
        onGenerateDemo,
        onClearDemo,
    }: {
        plugin: any;
        t: (k: string) => string;
        notebookList?: Array<{ id: string; name: string }>;
        saving?: boolean;
        migrationBusy?: boolean;
        migrationAction?: "import" | "restore" | null;
        demoBusy?: boolean;
        demoAction?: "generate" | "clear" | null;
        preImportBackupExists?: boolean;
        onExportSettings: () => void;
        onImportSettings: (e: Event) => Promise<void>;
        onRestorePreImport: () => Promise<void>;
        onGenerateDemo: () => Promise<void>;
        onClearDemo: () => void;
    } = $props();

    let dataSection: "migration" | "demo" | "ecosystem" | "shortcuts" = $state("migration");
    let importInput: HTMLInputElement | undefined = $state();
</script>

<div class="lv-settings__pane-title">{t("settings.dataTitle")}</div>
<nav class="lv-settings__subnav" aria-label={t("settings.dataTitle")}>
    <button class="lv-setnav__item {dataSection === 'migration' ? 'on' : ''}" aria-current={dataSection === 'migration' ? 'true' : undefined} onclick={() => (dataSection = "migration")}>{t("settings.migrateTitle")}</button>
    <button class="lv-setnav__item {dataSection === 'demo' ? 'on' : ''}" aria-current={dataSection === 'demo' ? 'true' : undefined} onclick={() => (dataSection = "demo")}>{t("settings.demoTitle")}</button>
    <button class="lv-setnav__item {dataSection === 'ecosystem' ? 'on' : ''}" aria-current={dataSection === 'ecosystem' ? 'true' : undefined} onclick={() => (dataSection = "ecosystem")}>{t("settings.ecoTitle")}</button>
    <button class="lv-setnav__item {dataSection === 'shortcuts' ? 'on' : ''}" aria-current={dataSection === 'shortcuts' ? 'true' : undefined} onclick={() => (dataSection = "shortcuts")}>{t("faq.shortcuts")}</button>
</nav>
<div class="lv-settings__scroll">
{#if dataSection === "migration"}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.targetNotebook")}</div>
        <div class="lv-setcard__hint">{t("settings.targetNotebookHint")}</div>
        <div style="margin-top:8px">
            <select class="b3-select" style="max-width:360px;width:100%"
                value={plugin.settings?.targetNotebookId ?? ""}
                onchange={async (e) => {
                    const val = (e.currentTarget as HTMLSelectElement).value;
                    if (!plugin.settings) plugin.settings = {};
                    plugin.settings.targetNotebookId = val || undefined;
                    await saveSettings(plugin, plugin.settings);
                    showMessage(t("diag.rebuildAllDone"), 2000, "info");
                }}>
                <option value="">🏠 默认（使用或自动创建「🏠 小驴管家」笔记本）</option>
                {#each notebookList as nb (nb.id)}
                    <option value={nb.id}>📚 {nb.name}</option>
                {/each}
            </select>
        </div>
    </div>
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.migrateTitle")}</div>
        <div class="lv-setcard__hint" style="color:var(--lv-warn)">⚠ {t("settings.migratePrivacy")}</div>
        <div class="lv-setcard__actions">
            <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onExportSettings}>{t("settings.export")}</button>
            <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={() => importInput?.click()}>{migrationAction === "import" ? t("ledger.saving") : t("settings.import")}</button>
            <input type="file" accept="application/json,.json" style="display:none"
                bind:this={importInput} onchange={(e) => onImportSettings(e)} />
            {#if preImportBackupExists}
                <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onRestorePreImport}>{migrationAction === "restore" ? t("ledger.saving") : t("settings.restoreBtn")}</button>
            {/if}
        </div>
    </div>
{:else if dataSection === "demo"}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.demoTitle")}</div>
        <div class="lv-setcard__hint">{t("settings.demoHint")}</div>
        <div class="lv-setcard__actions">
            <button class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "generate"} onclick={onGenerateDemo}>{demoAction === "generate" ? t("ledger.saving") : t("settings.demoGenerate")}</button>
            <button class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "clear"} onclick={onClearDemo}>{demoAction === "clear" ? t("ledger.saving") : t("settings.demoClear")}</button>
        </div>
    </div>
{:else if dataSection === "ecosystem"}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.ecoTitle")}</div>
        <div class="lv-setcard__hint">{t("settings.ecoHint")} · {t("settings.ecoPlanned")}</div>
        {#each ["qiandao", "contacts", "glean", "exam", "flashcard", "leiqie"] as eco (eco)}
            <div class="fn__flex lv-settings__row">
                <span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="repeat" size={14} /></span>
                <span class="fn__flex-1">{t(`eco.${eco}`)}</span>
                <span class="lv-badge gray">{t("settings.ecoPlanned")}</span>
            </div>
        {/each}
    </div>
{:else}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">⌨ {t("faq.shortcuts")}</div>
        <p class="lv-caption" style="margin:2px 0">· {t("openButler")}：{t("faq.topbarOrCommand")}</p>
        <p class="lv-caption" style="margin:2px 0">· {t("faq.quickCapture")}：{t("faq.topbarBolt")}</p>
    </div>
{/if}
</div>
