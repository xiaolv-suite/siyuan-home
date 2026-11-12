<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { DayPulseItem, FamilyAchievement } from "@/core/pulse-and-achievements";

    let {
        weeklyPulse = [] as DayPulseItem[],
        achievements = [] as FamilyAchievement[],
        pulseDateFilter = $bindable<string | undefined>(undefined),
        t,
    }: {
        weeklyPulse?: DayPulseItem[];
        achievements?: FamilyAchievement[];
        pulseDateFilter?: string;
        t?: (k: string) => string;
    } = $props();

    const tr = (k: string) => (t ? t(k) : k);

    function handlePulseKeydown(e: KeyboardEvent) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const target = e.target as HTMLElement;
        const pillGroup = e.currentTarget as HTMLElement;
        const pills = Array.from(pillGroup.querySelectorAll<HTMLButtonElement>(".lv-pulse-pill"));
        const idx = pills.indexOf(target as HTMLButtonElement);
        if (idx === -1) return;

        e.preventDefault();
        if (e.key === "ArrowRight") {
            pills[(idx + 1) % pills.length]?.focus();
        } else if (e.key === "ArrowLeft") {
            pills[(idx - 1 + pills.length) % pills.length]?.focus();
        } else if (e.key === "Home") {
            pills[0]?.focus();
        } else if (e.key === "End") {
            pills[pills.length - 1]?.focus();
        }
    }
</script>

<!-- 原型参考图生活律动周条（Weekly Pulse Strip） -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="lv-pulse-strip" role="region" aria-label={tr("overview.weeklyPulse")} onkeydown={handlePulseKeydown}>
    {#each weeklyPulse as p (p.date)}
        {@const tip = tr("overview.filterDayTip").replace("${date}", p.date).replace("${weekday}", p.weekday).replace("${count}", String(p.dueCount))}
        <button type="button" class="lv-pulse-pill" class:is-today={p.isToday} class:is-selected={pulseDateFilter === p.date}
            aria-pressed={pulseDateFilter === p.date}
            aria-label={tip}
            onclick={() => { pulseDateFilter = pulseDateFilter === p.date ? undefined : p.date; }}
            title={tip}>
            <span class="lv-pulse-weekday">{p.weekday}</span>
            <span class="lv-pulse-day lv-num">{p.dayNum}</span>
            <span class="lv-pulse-status" class:has-due={p.dueCount > 0} class:is-past-ok={p.isPast && p.dueCount === 0}>
                {#if p.isToday}
                    <UiIcon name="clock" size={10} />
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
    <div class="lv-achievements-row" role="group" aria-label={tr("overview.achievements")}>
        {#each achievements.filter((a) => a.achieved) as ach (ach.id)}
            <div class="lv-achievement-chip" title={ach.desc} role="group" aria-label={`${ach.title}：${ach.desc}`}>
                <UiIcon name={ach.icon as any} size={15} />
                <span>{ach.title}</span>
            </div>
        {/each}
    </div>
{/if}
