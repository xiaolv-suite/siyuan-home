<script lang="ts">
    import { showMessage } from "siyuan";
    import { parseQuickAdd } from "@/core/quick-add";
    import { localDateKey } from "@/core/hub/rule";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        t,
        embedded = false,
    }: {
        plugin: any;
        t: (k: string) => string;
        embedded?: boolean;
    } = $props();

    let memoTitle = $state("");
    let memoDue = $state("");
    let memoInput: HTMLInputElement | undefined = $state();
    let savingMemo = $state(false);

    const quickParsed = $derived.by(() => {
        if (!memoTitle.trim()) return null;
        return parseQuickAdd(memoTitle);
    });

    async function addMemo() {
        if (savingMemo) return;
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        if (!memoTitle.trim()) {
            memoInput?.focus();
            showMessage(t("memo.titleRequired"), 4000, "info");
            return;
        }
        // Quick Add Magic：解析日期、优先级、分类标签
        const parsed = parseQuickAdd(memoTitle);
        let title = parsed.cleanTitle || memoTitle.trim();
        let due = memoDue || parsed.dueDate;
        if (parsed.dueDate && !memoDue) {
            showMessage(t("memo.dateParsed").replace("${d}", parsed.dueDate), 2500, "info");
        }
        if (!title) return;
        // 默认到期日走本地时区（33.3：禁 toISOString，UTC+8 夜间会偏一天）
        const d = due || localDateKey(new Date(Date.now() + 3 * 86400000));
        savingMemo = true;
        try {
            await plugin.addMemo(title, d, {
                priority: parsed.priority,
                category: parsed.category,
                cycle: parsed.cycle,
                recurrenceAnchor: parsed.recurrenceAnchor,
            });
            memoTitle = ""; memoDue = "";
        } catch (e) {
            showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            savingMemo = false;
        }
    }
</script>

{#if !embedded}
    <div class="lv-sec"><h2 class="lv-title-sec">{t("memo.quick")}</h2><span class="lv-sub">{t("memo.quickSub")}</span></div>
{/if}
<div class={embedded ? "lv-memo lv-memo--embedded" : "lv-card lv-memo"}>
    <!-- 261 波：回车提交（isComposing 守卫——中文输入法选词的 Enter 不算提交） -->
    <input bind:this={memoInput} type="text" class="b3-text-field fn__flex-1 lv-memo-input" placeholder={t("memo.placeholder")} aria-label={t("memo.placeholder")} bind:value={memoTitle}
        disabled={savingMemo} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <!-- Quick Add Magic 即时预览胶囊 (Vikunja / Todoist 规格) -->
    {#if quickParsed}
        {#if quickParsed.dueDate && !memoDue}
            <span class="lv-parsechip lv-parsechip--date" role="status" title={t("memo.dateParsed").replace("${d}", quickParsed.dueDate)}>
                <UiIcon name="calendar" size={13} /> <span class="lv-num">{quickParsed.dueDate}</span>
            </span>
        {/if}
        {#if quickParsed.priority}
            <span class="lv-parsechip lv-parsechip--{quickParsed.priority}" role="status" title={quickParsed.priority === "high" ? t("hub.priorityHigh") : quickParsed.priority === "medium" ? t("hub.priorityMedium") : t("hub.priorityLow")}>
                <UiIcon name="alert" size={12} /> {quickParsed.priority === "high" ? t("hub.priorityHigh") : quickParsed.priority === "medium" ? t("hub.priorityMedium") : t("hub.priorityLow")}
            </span>
        {/if}
        {#if quickParsed.category}
            <span class="lv-parsechip lv-parsechip--cat" role="status" title={`#${quickParsed.category}`}>
                <UiIcon name="bookmark" size={12} /> #{quickParsed.category}
            </span>
        {/if}
        {#if quickParsed.cycle}
            <span class="lv-parsechip lv-parsechip--cycle" role="status" title={quickParsed.recurrenceAnchor === "completion" ? t("hub.recurrenceAnchorCompletion") : t("hub.recurrenceAnchorDue")}>
                <UiIcon name="repeat" size={12} /> {quickParsed.cycleToken || quickParsed.cycle}
            </span>
        {/if}
    {/if}
    <input class="b3-text-field" type="date" aria-label={t("hub.planDateLabel")} bind:value={memoDue} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <button type="button" class="lv-btn primary" disabled={savingMemo || !memoTitle.trim()} onclick={() => void addMemo()}>{savingMemo ? t("ledger.saving") : t("memo.add")}</button>
</div>

<style>
    .lv-memo-input {
        min-width: min(180px, 100%);
    }
</style>
