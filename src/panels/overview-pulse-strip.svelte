<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { DayPulseItem, FamilyAchievement } from "@/core/pulse-and-achievements";

    let {
        weeklyPulse = [] as DayPulseItem[],
        achievements = [] as FamilyAchievement[],
        pulseDateFilter = $bindable<string | undefined>(undefined),
    }: {
        weeklyPulse?: DayPulseItem[];
        achievements?: FamilyAchievement[];
        pulseDateFilter?: string;
    } = $props();
</script>

<!-- 原型参考图生活律动周条（Weekly Pulse Strip） -->
<div class="lv-pulse-strip" role="region" aria-label="本周日程节奏">
    {#each weeklyPulse as p (p.date)}
        <button type="button" class="lv-pulse-pill" class:is-today={p.isToday} class:is-selected={pulseDateFilter === p.date}
            onclick={() => { pulseDateFilter = pulseDateFilter === p.date ? undefined : p.date; }}
            title={`${p.date} ${p.weekday}：${p.dueCount} 项待办（点击筛选该日）`}>
            <span class="lv-pulse-weekday">{p.weekday}</span>
            <span class="lv-pulse-day lv-num">{p.dayNum}</span>
            <span class="lv-pulse-status" class:has-due={p.dueCount > 0} class:is-past-ok={p.isPast && p.dueCount === 0}>
                {#if p.isToday}
                    ●
                {:else if p.isPast && p.dueCount === 0}
                    <UiIcon name="check" size={10} />
                {:else if p.dueCount > 0}
                    {p.dueCount}
                {:else}
                    ·
                {/if}
            </span>
        </button>
    {/each}
</div>

<!-- 原型参考图家庭生活就绪成就勋章（Achievements Badges） -->
{#if achievements.some((a) => a.achieved)}
    <div class="lv-achievements-row" aria-label="家庭生活就绪勋章">
        {#each achievements.filter((a) => a.achieved) as ach (ach.id)}
            <div class="lv-achievement-chip" title={ach.desc}>
                <UiIcon name={ach.icon as any} size={15} />
                <span>{ach.title}</span>
            </div>
        {/each}
    </div>
{/if}
