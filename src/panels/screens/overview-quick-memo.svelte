<script lang="ts">
    import { showMessage } from "siyuan";
    import { parseNaturalDate } from "@/core/dateparse";
    import { localDateKey } from "@/core/hub/rule";
    import UiIcon from "@/ui/icon.svelte";

    let {
        plugin,
        t,
    }: {
        plugin: any;
        t: (k: string) => string;
    } = $props();

    let memoTitle = $state("");
    let memoDue = $state("");
    let memoInput: HTMLInputElement | undefined = $state();
    let savingMemo = $state(false);

    const memoParsed = $derived.by(() => {
        if (!memoTitle.trim() || memoDue) return null;
        return parseNaturalDate(memoTitle);
    });

    async function addMemo() {
        if (savingMemo) return;
        if (!memoTitle.trim()) {
            memoInput?.focus();
            showMessage(t("memo.titleRequired"), 4000, "info");
            return;
        }
        // 16 组/214 波：智能日期解析（滴答清单规格）——标题命中日期表达式则剥离进到期日；
        // 显式选择的日期优先于解析（用户选了日期选择器即为明确意图）。
        const parsed = parseNaturalDate(memoTitle);
        let title = memoTitle.trim();
        let due = memoDue;
        if (parsed && parsed.rest) {
            if (!due) due = parsed.date;
            title = parsed.rest;
            showMessage(t("memo.dateParsed").replace("${d}", parsed.date), 2500, "info");
        }
        if (!title) return;
        // 默认到期日走本地时区（33.3：禁 toISOString，UTC+8 夜间会偏一天）
        const d = due || localDateKey(new Date(Date.now() + 3 * 86400000));
        savingMemo = true;
        try {
            await plugin.addMemo(title, d);
            memoTitle = ""; memoDue = "";
        } catch (e) {
            showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            savingMemo = false;
        }
    }
</script>

<div class="lv-sec"><h2 class="lv-title-sec">{t("memo.quick")}</h2><span class="lv-sub">{t("memo.quickSub")}</span></div>
<div class="lv-card lv-memo">
    <!-- 261 波：回车提交（isComposing 守卫——中文输入法选词的 Enter 不算提交） -->
    <input bind:this={memoInput} class="b3-text-field fn__flex-1 lv-memo-input" placeholder={t("memo.placeholder")} aria-label={t("memo.placeholder")} bind:value={memoTitle}
        disabled={savingMemo} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <!-- 262 波（Todoist 式即时预览）：解析命中即亮 chip，提交前就知道日期去哪了 -->
    {#if memoParsed}
        <span class="lv-parsechip" role="status"><UiIcon name="calendar" size={13} /> <span class="lv-num">{memoParsed.date}</span></span>
    {/if}
    <input class="b3-text-field" type="date" aria-label={t("hub.planDateLabel")} bind:value={memoDue} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
    <button class="lv-btn primary" disabled={savingMemo || !memoTitle.trim()} onclick={() => void addMemo()}>{savingMemo ? t("ledger.saving") : t("memo.add")}</button>
</div>

<style>
    .lv-memo-input {
        min-width: 180px;
    }
</style>
