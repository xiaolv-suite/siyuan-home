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

<div class="lv-kpi-row" role="region" aria-label="核心生活指标">
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="clock" size={13} /> {t("dash.bentoUrgentTitle") || "临期关注"}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiUrgentCount}</b>
            <span class="lv-kpi-row__badge {kpiUrgentCount > 0 ? 'warn' : 'accent'}">{kpiUrgentCount > 0 ? '需留意' : '已就绪'}</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="checkCircle" size={13} /> {t("dash.monthlyDoneTitle") || "本月进度"}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiMonthlyRatio}</b>
            <span class="lv-kpi-row__badge accent">按期办</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="archive" size={13} /> {t("tab.ledger") || "台账事实"}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiRecordsTotal}</b>
            <span class="lv-kpi-row__badge neutral">条记录</span>
        </div>
    </div>
    <div class="lv-kpi-row__item">
        <span class="lv-kpi-row__label"><UiIcon name="users" size={13} /> {t("tabMembers") || "家庭成员"}</span>
        <div class="lv-kpi-row__num-wrap">
            <b class="lv-kpi-row__num">{kpiMemberCount}</b>
            <span class="lv-kpi-row__badge accent">位档案</span>
        </div>
    </div>
</div>
