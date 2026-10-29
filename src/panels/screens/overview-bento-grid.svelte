<script lang="ts">
    import type { Reminder } from "@/types";
    import UiIcon from "@/ui/icon.svelte";

    let {
        urgentDueReminder,
        overdueCount,
        soon7Count,
        syncErrCount,
        memberOf,
        t,
        onGoto,
        onOpenLedger,
    }: {
        urgentDueReminder?: Reminder;
        overdueCount: number;
        soon7Count: number;
        syncErrCount: number;
        memberOf: (id: string | undefined) => { name: string } | undefined;
        t: (k: string) => string;
        onGoto: (s: string) => void;
        onOpenLedger: (moduleId: string) => void;
    } = $props();

    function handleHeroClick() {
        if (!urgentDueReminder) {
            onGoto("reminders");
            return;
        }
        if (urgentDueReminder.moduleId !== "adhoc") {
            onOpenLedger(urgentDueReminder.moduleId);
        } else {
            onGoto("reminders");
        }
    }
</script>

<div class="lv-focus lv-bento-grid" aria-label={t("dash.focusLabel")}>
    <!-- 324波：中枢规范大方块 Bento 特征卡（最近到期与倒计时核心看板） -->
    <button type="button" class="lv-bento-card lv-bento-card--hero" onclick={handleHeroClick}
        aria-label={urgentDueReminder ? `${urgentDueReminder.title}：${urgentDueReminder.daysLeft}天` : t("dash.bentoAllGood")}>
        <div class="lv-bento-hero-header">
            <span class="lv-badge {urgentDueReminder && urgentDueReminder.daysLeft <= 0 ? 'red' : urgentDueReminder && urgentDueReminder.daysLeft <= 7 ? 'orange' : 'amber'}">
                {#if urgentDueReminder}
                    ⏱️ {t("dash.bentoUrgentTitle")} · {t(`module.${urgentDueReminder.moduleId}`) !== `module.${urgentDueReminder.moduleId}` ? t(`module.${urgentDueReminder.moduleId}`) : t("adhoc.name")}
                {:else}
                    🛡️ {t("dash.bentoAllGood")}
                {/if}
            </span>
            {#if urgentDueReminder}
                <span class="lv-bento-hero-badge lv-num">
                    {urgentDueReminder.daysLeft < 0 ? t("days.overdue").replace("${n}", String(-urgentDueReminder.daysLeft)) : urgentDueReminder.daysLeft === 0 ? t("days.today") : t("days.after").replace("${n}", String(urgentDueReminder.daysLeft))}
                </span>
            {/if}
        </div>
        <div class="lv-bento-hero-body">
            {#if urgentDueReminder}
                <h3 class="lv-bento-hero-title">{urgentDueReminder.title}</h3>
                <p class="lv-bento-hero-sub">
                    {#if memberOf(urgentDueReminder.memberId)}
                        <span class="lv-caption">👤 {memberOf(urgentDueReminder.memberId)?.name} · </span>
                    {/if}
                    <span class="lv-caption">📅 {urgentDueReminder.dueDate}</span>
                </p>
            {:else}
                <h3 class="lv-bento-hero-title" style="font-size:16px;color:var(--lv-ok)">{t("dash.bentoAllGood")}</h3>
                <p class="lv-bento-hero-sub">{t("dash.bentoAllGoodSub")}</p>
            {/if}
        </div>
        <div class="lv-bento-hero-footer">
            <span class="lv-link" style="font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px">
                {t("dash.handleNow")} →
            </span>
        </div>
    </button>

    <!-- 双小方块 Bento 副卡：今日待办与资料核对 -->
    <div class="lv-bento-side">
        <button type="button" class="lv-focus-card lv-focus-card--today" onclick={() => onGoto("reminders")} aria-label={`${t("dash.focusToday")}：${overdueCount + soon7Count}`}>
            <div class="lv-focus-copy">
                <span class="lv-focus-label">{t("dash.focusToday")}</span>
                <strong class="lv-focus-num lv-num">{overdueCount + soon7Count}</strong>
                <span class="lv-focus-sub">{t("dash.focusTodayBody").replace("${od}", String(overdueCount)).replace("${s}", String(soon7Count))}</span>
            </div>
            <span class="lv-focus-icon" aria-hidden="true"><UiIcon name="clock" size={20} /></span>
        </button>
        <button type="button" class="lv-focus-card lv-focus-card--review" onclick={() => onGoto("members")} aria-label={`${t("dash.focusReview")}：${syncErrCount}`}>
            <div class="lv-focus-copy">
                <span class="lv-focus-label">{t("dash.focusReview")}</span>
                <strong class="lv-focus-num lv-num">{syncErrCount}</strong>
                <span class="lv-focus-sub">{syncErrCount > 0 ? t("dash.focusReviewBody").replace("${n}", String(syncErrCount)) : t("dash.focusReviewOk")}</span>
            </div>
            <span class="lv-focus-icon" aria-hidden="true"><UiIcon name="users" size={20} /></span>
        </button>
    </div>
</div>
