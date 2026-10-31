<script lang="ts">
    let {
        t,
        allCount,
        overdueCount,
    }: {
        t: (k: string) => string;
        allCount: number;
        overdueCount: number;
    } = $props();
</script>

<div class="lv-hero lv-hub-hero" aria-labelledby="lv-hub-title">
    <div class="lv-hero-copy">
        <span class="lv-hub-eyebrow">{t("dash.upcoming")}</span>
        <h1 id="lv-hub-title">{t("hub.title")}</h1>
        <p class="lv-hero-lead">{t("hub.subtitle")}</p>
    </div>
    <div class="lv-hero-tools">
        <div class="lv-hub-summary" aria-label={t("hub.title")}>
            <div class="lv-hub-summary__item"><span>{t("hub.filterAll")}</span><b class="lv-num">{allCount}</b></div>
            <div class="lv-hub-summary__item is-overdue"><span>{t("hub.groupOverdue")}</span><b class="lv-num">{overdueCount}</b></div>
        </div>
    </div>
</div>
