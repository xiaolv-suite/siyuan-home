<script lang="ts">
    import { showMessage } from "siyuan";
    import { parseQuickAdd } from "@/core/quick-add";
    import { parseQuickEntryWithAi } from "@/core/ai-nlp";
    import { localDateKey } from "@/core/hub/rule";
    import { lvLaunchpad } from "@/libs/notice";
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
    let aiParsing = $state(false);

    type SyntaxMode = "none" | "date" | "priority" | "category" | "amount";
    let activeSyntaxMode = $state<SyntaxMode>("none");

    const DATE_CHIPS = ["明天", "后天", "下周一", "+3天", "+7天", "今天"];
    const PRIORITY_CHIPS = [
        { label: "高", value: "高", p: "high" },
        { label: "中", value: "中", p: "medium" },
        { label: "低", value: "低", p: "low" },
    ];
    const CATEGORY_CHIPS = ["家庭", "工作", "健康", "财务", "购物", "车辆"];
    const AMOUNT_CHIPS = ["10", "20", "50", "100", "200", "500", "1000"];

    const isGuest = $derived(Boolean(plugin.runtime?.guestModeActive));

    const quickParsed = $derived.by(() => {
        if (!memoTitle.trim()) return null;
        return parseQuickAdd(memoTitle);
    });

    function detectSyntaxMode() {
        if (!memoInput) return;
        const pos = memoInput.selectionStart ?? memoTitle.length;
        const before = memoTitle.slice(0, pos);
        const match = before.match(/(?:^|\s)([@!#$])([^\s@!#$]*)$/);
        if (match) {
            const sym = match[1];
            if (sym === "@") activeSyntaxMode = "date";
            else if (sym === "!") activeSyntaxMode = "priority";
            else if (sym === "#") activeSyntaxMode = "category";
            else if (sym === "$") activeSyntaxMode = "amount";
        } else {
            activeSyntaxMode = "none";
        }
    }

    function insertSyntaxChip(prefix: "@" | "!" | "#" | "$", val: string) {
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        if (!memoInput) return;
        const pos = memoInput.selectionStart ?? memoTitle.length;
        const before = memoTitle.slice(0, pos);
        const after = memoTitle.slice(pos);

        const regex = new RegExp(`(?:^|\\s)\\${prefix}[^\\s@!#$]*$`);
        const match = before.match(regex);
        let newBefore = before;
        if (match) {
            const startIdx = before.lastIndexOf(prefix);
            newBefore = before.slice(0, startIdx) + `${prefix}${val} `;
        } else {
            const needSpace = before.length > 0 && !before.endsWith(" ");
            newBefore = before + (needSpace ? " " : "") + `${prefix}${val} `;
        }

        memoTitle = newBefore + after;
        activeSyntaxMode = "none";

        requestAnimationFrame(() => {
            memoInput?.focus();
            const newCursor = newBefore.length;
            memoInput?.setSelectionRange(newCursor, newCursor);
        });
    }

    function openSyntaxPicker(mode: "date" | "priority" | "category" | "amount") {
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        activeSyntaxMode = mode;
        if (!memoInput) return;
        const symbol = mode === "date" ? "@" : mode === "priority" ? "!" : mode === "category" ? "#" : "$";
        const pos = memoInput.selectionStart ?? memoTitle.length;
        const before = memoTitle.slice(0, pos);
        const after = memoTitle.slice(pos);
        if (!before.endsWith(symbol)) {
            const needSpace = before.length > 0 && !before.endsWith(" ");
            memoTitle = before + (needSpace ? " " : "") + symbol + after;
            requestAnimationFrame(() => {
                memoInput?.focus();
                const newPos = (before + (needSpace ? " " : "") + symbol).length;
                memoInput?.setSelectionRange(newPos, newPos);
            });
        }
    }

    async function triggerAiParse() {
        if (aiParsing || !memoTitle.trim() || isGuest) return;
        aiParsing = true;
        try {
            const res = await parseQuickEntryWithAi(memoTitle);
            if (res.cleanTitle) memoTitle = res.cleanTitle;
            if (res.dueDate) memoDue = res.dueDate;
            if (res.isAiParsed) {
                showMessage(t("memo.aiParseSuccess"), 2500, "info");
            }
        } catch {
            /* soft */
        } finally {
            aiParsing = false;
        }
    }

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

        savingMemo = true;
        try {
            try {
                lvLaunchpad.haptic(10);
            } catch {
                /* soft */
            }
            // 自然语言智能极速解析（大模型优先，本地规则兜底）
            const parsed = await parseQuickEntryWithAi(memoTitle);
            let title = parsed.cleanTitle || memoTitle.trim();
            let due = memoDue || parsed.dueDate;
            if (parsed.dueDate && !memoDue) {
                showMessage(t("memo.dateParsed").replace("${d}", parsed.dueDate), 2500, "info");
            }
            if (!title) return;
            // 默认到期日走本地时区（33.3：禁 toISOString，UTC+8 夜间会偏一天）
            const d = due || localDateKey(new Date(Date.now() + 3 * 86400000));

            await plugin.addMemo(title, d, {
                priority: parsed.priority,
                category: parsed.category,
                cycle: parsed.cycle,
                recurrenceAnchor: parsed.recurrenceAnchor,
                amount: parsed.amount,
            });
            memoTitle = "";
            memoDue = "";
            activeSyntaxMode = "none";
            showMessage(t("memo.added"), 2500, "info");
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
    <div class="lv-memo-row">
        <!-- 261 波：回车提交（isComposing 守卫——中文输入法选词的 Enter 不算提交） -->
        <input
            bind:this={memoInput}
            type="text"
            class="b3-text-field fn__flex-1 lv-memo-input"
            placeholder={isGuest ? t("guest.writeBlocked") : t("memo.placeholder")}
            aria-label={t("memo.placeholder")}
            bind:value={memoTitle}
            disabled={savingMemo || isGuest}
            oninput={detectSyntaxMode}
            onclick={detectSyntaxMode}
            onkeyup={detectSyntaxMode}
            onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter" && !e.isComposing) void addMemo();
            }}
        />
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
            {#if quickParsed.amount}
                <span class="lv-parsechip lv-parsechip--amount" role="status" title={`¥${quickParsed.amount}`}>
                    <UiIcon name="money" size={12} /> ¥{quickParsed.amount}
                </span>
            {/if}
        {/if}
        <input class="b3-text-field lv-memo-date" type="date" aria-label={t("hub.planDateLabel")} bind:value={memoDue} disabled={savingMemo || isGuest} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void addMemo(); }} />
        <button type="button" class="b3-button b3-button--text" title={t("memo.aiParse")} aria-label={t("memo.aiParse")} disabled={aiParsing || !memoTitle.trim() || isGuest} onclick={() => void triggerAiParse()}>
            <UiIcon name="sparkle" size={13} />
        </button>
        <button type="button" class="lv-btn primary" disabled={savingMemo || !memoTitle.trim() || isGuest} onclick={() => void addMemo()}>{savingMemo ? t("ledger.saving") : t("memo.add")}</button>
    </div>

    <!-- 手机键盘语法提示条 (Mobile Spec v1: 快速备忘 @日期 / !优先级 / #分类 chips) -->
    <div class="lv-syntax-bar" role="toolbar" aria-label={t("memo.syntaxToolbar")}>
        {#if activeSyntaxMode === "date"}
            <span class="lv-syntax-tag active"><UiIcon name="calendar" size={12} /> {t("memo.syntaxDate")}:</span>
            {#each DATE_CHIPS as chip (chip)}
                <button type="button" class="lv-syntax-chip date" onclick={() => insertSyntaxChip("@", chip)}>
                    {chip}
                </button>
            {/each}
        {:else if activeSyntaxMode === "priority"}
            <span class="lv-syntax-tag active"><UiIcon name="alert" size={12} /> {t("memo.syntaxPriority")}:</span>
            {#each PRIORITY_CHIPS as chip (chip.value)}
                <button type="button" class="lv-syntax-chip priority {chip.p}" onclick={() => insertSyntaxChip("!", chip.value)}>
                    !{chip.label}
                </button>
            {/each}
        {:else if activeSyntaxMode === "category"}
            <span class="lv-syntax-tag active"><UiIcon name="bookmark" size={12} /> {t("memo.syntaxCategory")}:</span>
            {#each CATEGORY_CHIPS as chip (chip)}
                <button type="button" class="lv-syntax-chip category" onclick={() => insertSyntaxChip("#", chip)}>
                    #{chip}
                </button>
            {/each}
        {:else if activeSyntaxMode === "amount"}
            <span class="lv-syntax-tag active"><UiIcon name="money" size={12} /> {t("memo.syntaxAmount")}:</span>
            {#each AMOUNT_CHIPS as chip (chip)}
                <button type="button" class="lv-syntax-chip amount" onclick={() => insertSyntaxChip("$", chip)}>
                    ¥{chip}
                </button>
            {/each}
        {:else}
            <!-- 默认语法快速唤出按钮 -->
            <button type="button" class="lv-syntax-guide-btn" onclick={() => openSyntaxPicker("date")}>
                <UiIcon name="calendar" size={12} /> <span>{t("memo.syntaxDate")}</span>
            </button>
            <button type="button" class="lv-syntax-guide-btn" onclick={() => openSyntaxPicker("priority")}>
                <UiIcon name="alert" size={12} /> <span>{t("memo.syntaxPriority")}</span>
            </button>
            <button type="button" class="lv-syntax-guide-btn" onclick={() => openSyntaxPicker("category")}>
                <UiIcon name="bookmark" size={12} /> <span>{t("memo.syntaxCategory")}</span>
            </button>
            <button type="button" class="lv-syntax-guide-btn" onclick={() => openSyntaxPicker("amount")}>
                <UiIcon name="money" size={12} /> <span>{t("memo.syntaxAmount")}</span>
            </button>
        {/if}
    </div>
</div>
