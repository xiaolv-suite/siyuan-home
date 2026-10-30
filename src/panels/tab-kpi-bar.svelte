<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        kpiUrgentCount,
        kpiMonthlyRatio,
        kpiRecordsTotal,
        kpiMemberCount,
    }: {
        t: (k: string) => string;
        kpiUrgentCount: number;
        kpiMonthlyRatio: string;
        kpiRecordsTotal: number;
        kpiMemberCount: number;
    } = $props();
</script>

<div class="lv-kpi-row" role="region" aria-label={t("dash.kpiRegion")}>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="clock" size={13} /> {t("dash.bentoUrgentTitle")}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiUrgentCount}</b>
            <span class="lv-kpi-row__badge {kpiUrgentCount > 0 ? 'warn' : 'accent'}">{kpiUrgentCount > 0 ? t("dash.kpiUrgentNeedAttention") : t("dash.kpiUrgentAllReady")}</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="checkCircle" size={13} /> {t("dash.kpiMonthlyProgress")}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiMonthlyRatio}</b>
            <span class="lv-kpi-row__badge accent">{t("dash.kpiMonthlyOnTrack")}</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="archive" size={13} /> {t("tab.ledger")}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiRecordsTotal}</b>
            <span class="lv-kpi-row__badge neutral">{t("dash.kpiRecords")}</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="users" size={13} /> {t("tabMembers")}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiMemberCount}</b>
            <span class="lv-kpi-row__badge accent">{t("dash.kpiProfiles")}</span>
        </div>
    </div>
</div>
