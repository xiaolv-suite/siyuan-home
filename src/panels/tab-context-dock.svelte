<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { PluginScreen } from "./panel-session";

    let {
        screen,
        t,
        plugin,
        kpiUrgentCount,
        kpiMonthlyRatio,
        kpiRecordsTotal,
        kpiMemberCount,
        onToggleDock,
        onOpenCapture,
        onOpenSpotlight,
        onRefreshScan,
    }: {
        screen: PluginScreen;
        t: (k: string) => string;
        plugin: any;
        kpiUrgentCount: number;
        kpiMonthlyRatio: string;
        kpiRecordsTotal: number;
        kpiMemberCount: number;
        onToggleDock: () => void;
        onOpenCapture: (moduleId?: string) => void;
        onOpenSpotlight: () => void;
        onRefreshScan: () => void;
    } = $props();
</script>

<aside class="lv-context-dock" aria-label={t("dash.contextDock")}>
    <div class="lv-context-dock__head">
        <span>
            {#if screen === "overview"}
                <UiIcon name="layout" size={13} /> {t("tab.overview")}
            {:else if screen === "reminders"}
                <UiIcon name="clock" size={13} /> {t("tab.reminders")}
            {:else if screen === "ledger"}
                <UiIcon name="archive" size={13} /> {t("tab.ledger")}
            {:else}
                <UiIcon name="users" size={13} /> {t("tab.members")}
            {/if}
        </span>
        <button type="button" class="b3-button b3-button--text lv-caption" aria-label={t("close")} onclick={onToggleDock}><UiIcon name="close" size={13} /></button>
    </div>
    <div class="lv-context-dock__body">
        {#if screen === "overview"}
            <div class="lv-context-card">
                <b><UiIcon name="bolt" size={13} /> {t("dash.contextShortcuts")}</b>
                <p class="lv-caption">{t("dash.contextShortcutsHint")}</p>
                <div class="lv-context-actions">
                    <button type="button" class="lv-btn ghost sm" onclick={() => onOpenCapture()}><UiIcon name="add" size={13} /> {t("dash.quickRecord")}</button>
                    <button type="button" class="lv-btn ghost sm" onclick={onOpenSpotlight}><UiIcon name="search" size={13} /> {t("spotlight.title")}</button>
                </div>
            </div>
            <div class="lv-context-card">
                <b><UiIcon name="shield" size={13} /> {t("dash.contextFamilyShield")}</b>
                <p class="lv-caption">{t("dash.contextFamilyShieldBody").replace("${m}", String(kpiMemberCount)).replace("${r}", String(kpiRecordsTotal))}</p>
            </div>
        {:else if screen === "reminders"}
            <div class="lv-context-card">
                <b><UiIcon name="bookmark" size={13} /> {t("dash.contextRemindersFocus")}</b>
                <p class="lv-caption">{t("dash.contextRemindersFocusBody").replace("${u}", String(kpiUrgentCount)).replace("${p}", kpiMonthlyRatio)}</p>
                <div class="lv-context-actions">
                    <button type="button" class="lv-btn ghost sm" onclick={onRefreshScan}><UiIcon name="repeat" size={13} /> {t("hub.rescan")}</button>
                </div>
            </div>
        {:else if screen === "ledger"}
            <div class="lv-context-card">
                <b><UiIcon name="archive" size={13} /> {t("dash.contextLedgerFact")}</b>
                <p class="lv-caption">{t("dash.contextLedgerFactBody").replace("${r}", String(kpiRecordsTotal))}</p>
                <div class="lv-context-actions">
                    <button type="button" class="lv-btn ghost sm" onclick={() => onOpenCapture(plugin.activeLedger)}><UiIcon name="add" size={13} /> {t("ledger.newRecord")}</button>
                </div>
            </div>
        {:else}
            <div class="lv-context-card">
                <b><UiIcon name="users" size={13} /> {t("dash.contextMembersCenter")}</b>
                <p class="lv-caption">{t("dash.contextMembersCenterBody").replace("${m}", String(kpiMemberCount))}</p>
            </div>
        {/if}
    </div>
</aside>
