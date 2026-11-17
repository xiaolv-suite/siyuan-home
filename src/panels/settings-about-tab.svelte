<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        t,
        formatLocalDateTime,
        rerunBusy = false,
        saving = false,
        migrationBusy = false,
        demoBusy = false,
        exportingDiagnostics = false,
        diagnosticsBusy = null as string | null,
        onRerunOnboarding,
        onPreviewDiagnostics,
        onExportDiagnostics,
        onRunBackfill,
        onRunDuplicateCheck,
        onRunDeepHealthCheck,
        onRunAdoptHistory,
        onRebuildAll,
    }: {
        plugin: any;
        t: (k: string) => string;
        formatLocalDateTime: (t: number | undefined) => string | undefined;
        rerunBusy?: boolean;
        saving?: boolean;
        migrationBusy?: boolean;
        demoBusy?: boolean;
        exportingDiagnostics?: boolean;
        diagnosticsBusy?: string | null;
        onRerunOnboarding: () => void;
        onPreviewDiagnostics: () => void;
        onExportDiagnostics: () => void;
        onRunBackfill: () => void;
        onRunDuplicateCheck: () => void;
        onRunDeepHealthCheck: () => void;
        onRunAdoptHistory: () => void;
        onRebuildAll: () => void;
    } = $props();

    const diag = $derived(plugin?.getDiagnostics?.());
</script>

<div class="lv-settings__pane-title">{t("tabAbout")}</div>
<div class="lv-settings__scroll">
    <div class="lv-card lv-setcard">
        <div class="lv-settings__about">
            <p>{t("about.line1")}</p>
            <p>{t("about.tagline")}</p>
            <p class="ft__on-surface">{t("about.principles")}</p>
            <button type="button" class="b3-button b3-button--outline lv-setcard__action"
                disabled={rerunBusy || saving || migrationBusy || demoBusy}
                onclick={onRerunOnboarding}>{rerunBusy ? t("ledger.saving") : t("wiz.rerun")}</button>
            <button type="button" class="b3-button b3-button--outline lv-mt-8 lv-ml-6"
                onclick={() => window.open("https://github.com/xiaolv-suite/siyuan-home", "_blank")}>{t("about.repo")}</button>
        </div>
    </div>
    {#if diag}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("diag.title")} · v{diag.version}</div>
            <p class="lv-caption lv-caption-time">{t("hub.scannedAt")} {formatLocalDateTime(diag.scannedAt) ?? "—"}</p>
            {#each diag.ledgers as l (l.id)}
                <p class="lv-caption">
                    {t(`module.${l.id}`)}：
                    {l.provisioned ? (l.provisional ? t("diag.provisional") : t("diag.ok")) : t("diag.missing")}
                    · {t("diag.columns")} {l.columns}
                </p>
            {/each}
            {#each diag.ledgers.filter((l: any) => l.error) as l (l.id)}
                <p class="lv-caption lv-tx-danger">{t(`module.${l.id}`)}: {l.error}</p>
            {/each}
            {#if diag.errors.length > 0}
                {#each diag.errors as e (e.moduleId)}
                    <p class="lv-caption lv-tx-danger">{e.moduleId}: {e.message}</p>
                {/each}
            {/if}
            {#if diag.contracts.length > 0}
                {#each diag.contracts as c (c)}
                    <p class="lv-caption lv-tx-danger">{c}</p>
                {/each}
            {/if}
            <div class="lv-setcard__actions lv-mt-8">
                <button type="button" class="b3-button b3-button--outline" onclick={onPreviewDiagnostics}><UiIcon name="search" size={13} /> {t("settings.diagPreview")}</button>
                <button type="button" class="b3-button b3-button--outline" disabled={exportingDiagnostics || diagnosticsBusy !== null} onclick={onExportDiagnostics}>{exportingDiagnostics ? t("ledger.saving") : t("settings.diagExport")}</button>
                {#if (plugin.settings?.members ?? []).some((m: any) => !m.avItemId || m.syncError)}
                    <button type="button" class="b3-button b3-button--outline"
                        disabled={diagnosticsBusy !== null || exportingDiagnostics}
                        aria-busy={diagnosticsBusy === "backfill"}
                        onclick={onRunBackfill}>{diagnosticsBusy === "backfill" ? t("ledger.saving") : t("diag.backfill")}</button>
                {/if}
                <button type="button" class="b3-button b3-button--outline"
                    disabled={diagnosticsBusy !== null || exportingDiagnostics}
                    aria-busy={diagnosticsBusy === "duplicates"}
                    onclick={onRunDuplicateCheck}>{diagnosticsBusy === "duplicates" ? t("ledger.saving") : t("diag.dupCheck")}</button>
                <!-- D12 最小健康检查：实际读取每个启用模块，登记存在≠健康 -->
                <button type="button" class="b3-button b3-button--outline"
                    disabled={diagnosticsBusy !== null || exportingDiagnostics}
                    aria-busy={diagnosticsBusy === "health"}
                    onclick={onRunDeepHealthCheck}>{diagnosticsBusy === "health" ? t("ledger.saving") : t("diag.health")}</button>
                <!-- §15 一键重建全部启用台账文档与视图 -->
                <button type="button" class="b3-button b3-button--outline"
                    disabled={diagnosticsBusy !== null || exportingDiagnostics}
                    aria-busy={diagnosticsBusy === "adopt"}
                    onclick={onRunAdoptHistory}>{diagnosticsBusy === "adopt" ? t("ledger.saving") : t("diag.adoptHistory")}</button>
                <button type="button" class="b3-button b3-button--outline"
                    disabled={diagnosticsBusy !== null || exportingDiagnostics}
                    aria-busy={diagnosticsBusy === "rebuild"}
                    onclick={onRebuildAll}>{diagnosticsBusy === "rebuild" ? t("ledger.saving") : t("diag.rebuildAll")}</button>
            </div>
        </div>
    {/if}
</div>
