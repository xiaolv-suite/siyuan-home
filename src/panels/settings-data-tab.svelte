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

    let dataSection: "migration" | "trash" | "demo" | "ecosystem" | "shortcuts" = $state("migration");
    let importInput: HTMLInputElement | undefined = $state();
    let trashRevision = $state(0);
    const trashItems = $derived.by(() => {
        void trashRevision;
        return plugin.runtime?.trash ?? [];
    });
</script>

<div class="lv-settings__pane-title">{t("settings.dataTitle")}</div>
<nav class="lv-settings__subnav" aria-label={t("settings.dataTitle")}>
    <button type="button" class="lv-setnav__item {dataSection === 'migration' ? 'on' : ''}" aria-current={dataSection === 'migration' ? 'true' : undefined} onclick={() => (dataSection = "migration")}>{t("settings.migrateTitle")}</button>
    <button type="button" class="lv-setnav__item {dataSection === 'trash' ? 'on' : ''}" aria-current={dataSection === 'trash' ? 'true' : undefined} onclick={() => (dataSection = "trash")}>{t("settings.trashTitle") || "回收站"}</button>
    <button type="button" class="lv-setnav__item {dataSection === 'demo' ? 'on' : ''}" aria-current={dataSection === 'demo' ? 'true' : undefined} onclick={() => (dataSection = "demo")}>{t("settings.demoTitle")}</button>
    <button type="button" class="lv-setnav__item {dataSection === 'ecosystem' ? 'on' : ''}" aria-current={dataSection === 'ecosystem' ? 'true' : undefined} onclick={() => (dataSection = "ecosystem")}>{t("settings.ecoTitle")}</button>
    <button type="button" class="lv-setnav__item {dataSection === 'shortcuts' ? 'on' : ''}" aria-current={dataSection === 'shortcuts' ? 'true' : undefined} onclick={() => (dataSection = "shortcuts")}>{t("faq.shortcuts")}</button>
</nav>
<div class="lv-settings__scroll">
{#if dataSection === "migration"}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.targetNotebook")}</div>
        <div class="lv-setcard__hint">{t("settings.targetNotebookHint")}</div>
        <div class="lv-mt-10">
            <select class="b3-select lv-select-wide"
                value={plugin.settings?.targetNotebookId ?? ""}
                onchange={async (e) => {
                    const val = (e.currentTarget as HTMLSelectElement).value;
                    if (!plugin.settings) plugin.settings = {};
                    plugin.settings.targetNotebookId = val || undefined;
                    await saveSettings(plugin, plugin.settings);
                    showMessage(t("saved"), 2000, "info");
                }}>
                <option value="">🏠 {t("settings.targetNotebookHint")}</option>
                {#each notebookList as nb (nb.id)}
                    <option value={nb.id}>📚 {nb.name}</option>
                {/each}
            </select>
        </div>
    </div>
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.migrateTitle")}</div>
        <div class="lv-setcard__hint lv-tx-warn"><UiIcon name="alert" size={13} /> {t("settings.migratePrivacy")}</div>
        <div class="lv-setcard__actions">
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onExportSettings}>{t("settings.export")}</button>
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={() => importInput?.click()}>{migrationAction === "import" ? t("ledger.saving") : t("settings.import")}</button>
            <input type="file" accept="application/json,.json" class="fn__none"
                aria-label={t("settings.import")}
                bind:this={importInput} onchange={(e) => onImportSettings(e)} />
            {#if preImportBackupExists}
                <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onRestorePreImport}>{migrationAction === "restore" ? t("ledger.saving") : t("settings.restoreBtn")}</button>
            {/if}
        </div>
    </div>
    {:else if dataSection === "trash"}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title"><UiIcon name="archive" size={15} /> {t("settings.trashTitle") || "台账安全回收站"}</div>
            <div class="lv-setcard__hint">{t("settings.trashHint") || "最近删除的 50 条台账记录快照（包含单条删除与批量删除）。"}</div>
            <div class="lv-mt-10 lv-dialog-list">
                {#if trashItems.length === 0}
                    <div class="lv-caption lv-tx-muted lv-dialog-empty">{t("settings.trashEmpty") || "回收站空空如也，暂无删除快照"}</div>
                {:else}
                    {#each trashItems as item (item.id + item.deletedAt)}
                        <div class="lv-settings__row lv-trash-item">
                            <div class="lv-trash-info">
                                <b>{item.title}</b>
                                <span class="lv-caption lv-tx-muted">{item.moduleId} · {item.deletedAt.slice(0, 16).replace("T", " ")}</span>
                            </div>
                            <div class="lv-trash-ops">
                                <span class="lv-badge gray lv-badge--xs">{t("settings.trashTitle")}</span>
                                <button type="button" class="b3-button b3-button--outline lv-btn-xs" onclick={async () => {
                                    const { restoreTrashItem } = await import("@/core/trash");
                                    const res = await restoreTrashItem(plugin, item.id);
                                    if (res.success) {
                                        trashRevision += 1;
                                        plugin.emitHubChanged?.();
                                        showMessage(t("settings.trashRestored") || "已成功恢复该记录到台账！", 3000, "info");
                                    } else {
                                        showMessage(res.error || "恢复失败", 5000, "error");
                                    }
                                }}>
                                    {t("settings.trashRestore") || "恢复"}
                                </button>
                            </div>
                        </div>
                    {/each}
                    <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger lv-self-start lv-mt-8" onclick={async () => {
                        const { confirm } = await import("@/libs/dialog");
                        confirm(
                            t("settings.trashClear") || "清空回收站",
                            t("settings.trashClearConfirm") || "确定彻底清空安全回收站中的所有删除快照吗？清空后将无法恢复。",
                            async () => {
                                if (plugin.runtime) {
                                    plugin.runtime.trash = [];
                                    const { saveRuntime } = await import("@/core/hub/runtime");
                                    await saveRuntime(plugin, plugin.runtime);
                                    trashRevision += 1;
                                    plugin.emitHubChanged?.();
                                    showMessage(t("saved"), 2000, "info");
                                }
                            }
                        );
                    }}>
                        {t("settings.trashClear") || "清空回收站"}
                    </button>
                {/if}
            </div>
        </div>
    {:else if dataSection === "demo"}
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.demoTitle")}</div>
        <div class="lv-setcard__hint">{t("settings.demoHint")}</div>
        <div class="lv-setcard__actions">
            <button type="button" class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "generate"} onclick={onGenerateDemo}>{demoAction === "generate" ? t("ledger.saving") : t("settings.demoGenerate")}</button>
            <button type="button" class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "clear"} onclick={onClearDemo}>{demoAction === "clear" ? t("ledger.saving") : t("settings.demoClear")}</button>
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
        <p class="lv-caption lv-p-tight">· {t("openButler")}：{t("faq.topbarOrCommand")}</p>
        <p class="lv-caption lv-p-tight">· {t("faq.quickCapture")}：{t("faq.topbarBolt")}</p>
    </div>
{/if}
</div>
