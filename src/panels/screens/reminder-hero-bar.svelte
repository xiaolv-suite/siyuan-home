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

<style>
    /* 提醒页局部视觉层级：页头负责摘要，控制区分成筛选与动作两层，避免长工具条抢占内容。 */
    .lv-hub-eyebrow {
        display: block;
        color: var(--lv-accent);
        font-size: 11px;
        font-weight: 650;
        letter-spacing: .08em;
        text-transform: uppercase;
        margin-bottom: 2px;
    }
    .lv-hub-summary {
        display: flex;
        align-items: stretch;
        gap: 1px;
        flex: none;
        overflow: hidden;
        border: 1px solid var(--lv-line);
        border-radius: var(--lv-r-2);
        background: var(--lv-surface-2);
        box-shadow: var(--lv-shadow-1);
    }
    .lv-hub-summary__item {
        min-width: 74px;
        padding: 8px 14px;
        display: flex;
        flex-direction: column-reverse;
        gap: 2px;
        text-align: right;
        background: var(--lv-surface);
    }
    .lv-hub-summary__item + .lv-hub-summary__item { border-left: 1px solid var(--lv-line); }
    .lv-hub-summary__item span { color: var(--lv-tx-3); font-size: 11px; white-space: nowrap; }
    .lv-hub-summary__item b { font-size: 20px; line-height: 1.1; font-weight: 650; color: var(--lv-tx); }
    .lv-hub-summary__item.is-overdue b { color: var(--lv-danger); }
    @media (max-width: 760px) {
        .lv-hub-summary { align-self: stretch; width: 100%; }
        .lv-hub-summary__item { flex: 1; min-width: 0; text-align: left; }
    }
    /* 嵌入思源侧栏时 viewport 仍可能很宽，使用面板容器宽度复用移动布局。 */
    @container lv-home (max-width: 760px) {
        .lv-hub-summary { align-self: stretch; width: 100%; }
        .lv-hub-summary__item { flex: 1; min-width: 0; text-align: left; }
    }
    @container lv-home (max-width: 420px) {
        .lv-hub-summary__item { padding-inline: 9px; }
        .lv-hub-summary__item b { font-size: 17px; }
    }
</style>
