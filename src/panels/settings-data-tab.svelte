<script lang="ts">
    import { showMessage } from "siyuan";
    import { saveSettings } from "@/core/settings";
    import UiIcon from "@/ui/icon.svelte";
    import { lvBackup, lvEcosystem, homeNotify } from "@/libs/notice";

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
        onExportHtmlManual,
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
        onExportHtmlManual?: () => void;
        onImportSettings: (e: Event) => Promise<void>;
        onRestorePreImport: () => Promise<void>;
        onGenerateDemo: () => Promise<void>;
        onClearDemo: () => void;
    } = $props();

    let dataSection: "migration" | "trash" | "demo" | "ecosystem" | "shortcuts" = $state("migration");
    let importInput: HTMLInputElement | undefined = $state();
    let ecoImportInput: HTMLInputElement | undefined = $state();
    let ecoBackupBusy = $state(false);
    let trashRevision = $state(0);
    const trashItems = $derived.by(() => {
        void trashRevision;
        return plugin.runtime?.trash ?? [];
    });

    async function handleExportEcoFull() {
        if (ecoBackupBusy) return;
        ecoBackupBusy = true;
        try {
            const bundle = await lvBackup.exportFull();
            const jsonStr = JSON.stringify(bundle, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const today = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `lv-ecosystem-backup-${today}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            homeNotify(t("settings.exportEcoFullOk"), 3000, "info");
        } catch (err) {
            homeNotify(String(err instanceof Error ? err.message : err), 4000, "error");
        } finally {
            ecoBackupBusy = false;
        }
    }

    async function handleImportEcoFull(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target?.files?.[0];
        if (!file) return;
        if (ecoBackupBusy) return;
        ecoBackupBusy = true;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const res = await lvBackup.restoreFull(parsed);
            const msg = t("settings.importEcoFullOk")
                .replace("${s}", String(res.success.length))
                .replace("${f}", String(res.failed.length));
            homeNotify(msg, 4000, res.failed.length > 0 ? "error" : "info");
            plugin.emitHubChanged?.();
            plugin.refreshHub?.(undefined, true).catch(() => undefined);
        } catch (err) {
            homeNotify(t("settings.importEcoFullFail") + ": " + String(err instanceof Error ? err.message : err), 4000, "error");
        } finally {
            ecoBackupBusy = false;
            if (target) target.value = "";
        }
    }
</script>

<div class="lv-settings__pane-title">{t("settings.dataTitle")}</div>
<nav class="lv-settings__subnav" aria-label={t("settings.dataTitle")}>
    <button type="button" class="lv-setnav__item {dataSection === 'migration' ? 'on' : ''}" aria-current={dataSection === 'migration' ? 'true' : undefined} onclick={() => (dataSection = "migration")}>{t("settings.migrateTitle")}</button>
    <button type="button" class="lv-setnav__item {dataSection === 'trash' ? 'on' : ''}" aria-current={dataSection === 'trash' ? 'true' : undefined} onclick={() => (dataSection = "trash")}>{t("settings.trashTitle")}</button>
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
        <div class="lv-setcard__title">{t("settings.energyPresetsTitle")}</div>
        <div class="lv-setcard__hint">{t("settings.energyPresetsHint")}</div>
        <div class="lv-mt-10" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <label style="min-width: 100px; font-size: 13px;" for="lv-set-fuel-presets">{t("settings.fuelPresets")}:</label>
                <input id="lv-set-fuel-presets" class="b3-text-field fn__flex-1" style="min-width: 120px;"
                    value={(plugin.settings?.fuelPresetAmounts ?? [200, 300, 500]).join(", ")}
                    onchange={async (e) => {
                        const vals = (e.currentTarget as HTMLInputElement).value
                            .split(/[,，\s]+/)
                            .map((s) => Number(s.trim()))
                            .filter((n) => Number.isFinite(n) && n > 0);
                        if (vals.length > 0) {
                            if (!plugin.settings) return;
                            plugin.settings.fuelPresetAmounts = vals;
                            await saveSettings(plugin, plugin.settings);
                            showMessage(t("saved"), 2000, "info");
                        }
                    }}
                />
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <label style="min-width: 100px; font-size: 13px;" for="lv-set-charge-presets">{t("settings.chargePresets")}:</label>
                <input id="lv-set-charge-presets" class="b3-text-field fn__flex-1" style="min-width: 120px;"
                    value={(plugin.settings?.chargePresetAmounts ?? [30, 50, 100]).join(", ")}
                    onchange={async (e) => {
                        const vals = (e.currentTarget as HTMLInputElement).value
                            .split(/[,，\s]+/)
                            .map((s) => Number(s.trim()))
                            .filter((n) => Number.isFinite(n) && n > 0);
                        if (vals.length > 0) {
                            if (!plugin.settings) return;
                            plugin.settings.chargePresetAmounts = vals;
                            await saveSettings(plugin, plugin.settings);
                            showMessage(t("saved"), 2000, "info");
                        }
                    }}
                />
            </div>
        </div>
    </div>
    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.migrateTitle")}</div>
        <div class="lv-setcard__hint lv-tx-warn"><UiIcon name="alert" size={13} /> {t("settings.migratePrivacy")}</div>
        <div class="lv-setcard__actions">
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onExportSettings}>{t("settings.export")}</button>
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} title={t("settings.exportHtmlManualTip")} onclick={onExportHtmlManual}>{t("settings.exportHtmlManual")}</button>
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={() => importInput?.click()}>{migrationAction === "import" ? t("ledger.saving") : t("settings.import")}</button>
            <input type="file" accept="application/json,.json" class="fn__none"
                aria-label={t("settings.import")}
                bind:this={importInput} onchange={(e) => onImportSettings(e)} />
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving || ecoBackupBusy} onclick={handleExportEcoFull}>🐴 {t("settings.exportEcoFull")}</button>
            <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving || ecoBackupBusy} onclick={() => ecoImportInput?.click()}>🐴 {t("settings.importEcoFull")}</button>
            <input type="file" accept="application/json,.json" class="fn__none"
                aria-label={t("settings.importEcoFull")}
                bind:this={ecoImportInput} onchange={(e) => handleImportEcoFull(e)} />
            {#if preImportBackupExists}
                <button type="button" class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={onRestorePreImport}>{migrationAction === "restore" ? t("ledger.saving") : t("settings.restoreBtn")}</button>
            {/if}
        </div>
    </div>
    {:else if dataSection === "trash"}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title"><UiIcon name="archive" size={15} /> {t("settings.trashTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.trashHint")}</div>
            <div class="lv-mt-10 lv-dialog-list">
                {#if trashItems.length === 0}
                    <div class="lv-caption lv-tx-muted lv-dialog-empty">{t("settings.trashEmpty")}</div>
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
                                        showMessage(t("settings.trashRestored"), 3000, "info");
                                    } else {
                                        showMessage(res.error || t("ledger.saveFailed"), 5000, "error");
                                    }
                                }}>
                                    {t("settings.trashRestore")}
                                </button>
                            </div>
                        </div>
                    {/each}
                    <button type="button" class="b3-button b3-button--text ft__error lv-tx-danger lv-self-start lv-mt-8" onclick={async () => {
                        const { confirm } = await import("@/libs/dialog");
                        confirm(
                            t("settings.trashClear"),
                            t("settings.trashClearConfirm"),
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
                        {t("settings.trashClear")}
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
        <div class="lv-setcard__title">{t("overview.ecoStatusBadge")}</div>
        <div class="lv-ecosystem-status-banner" style="margin-top:8px; padding:10px 14px; background:var(--lv-surface); border:1px solid var(--lv-accent-line); border-radius:var(--lv-r-card); font-size:12.5px; color:var(--lv-tx-1); display:flex; align-items:center; gap:8px;">
            <UiIcon name="sparkle" size={16} />
            <b style="color:var(--lv-accent);">{lvEcosystem.getStatusBadgeText()}</b>
        </div>
    </div>

    <div class="lv-card lv-setcard">
        <div class="lv-setcard__title">{t("settings.ecoBackupTitle")}</div>
        <div class="lv-setcard__hint">{t("settings.ecoBackupHint")}</div>
        <div class="lv-setcard__actions">
            <button type="button" class="b3-button b3-button--outline" disabled={ecoBackupBusy} onclick={handleExportEcoFull}>
                <UiIcon name="archive" size={13} /> {t("settings.exportEcoFull")}
            </button>
            <button type="button" class="b3-button b3-button--outline" disabled={ecoBackupBusy} onclick={() => ecoImportInput?.click()}>
                <UiIcon name="history" size={13} /> {t("settings.importEcoFull")}
            </button>
        </div>
    </div>

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
