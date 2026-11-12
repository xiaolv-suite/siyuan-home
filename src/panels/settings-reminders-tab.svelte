<script lang="ts">
    import { showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import UiIcon from "@/ui/icon.svelte";
    import type { HomeSettings, FamilyMember, CheckinBinding } from "@/types";

    let {
        draftNotifyHour = $bindable(8),
        draftSilentFrom = $bindable(22),
        draftSilentTo = $bindable(8),
        draftWebhookEnabled = $bindable(false),
        draftWebhookMode = $bindable<"bark" | "ntfy">("bark"),
        draftWebhookUrl = $bindable(""),
        draftLeads = $bindable<Record<string, string>>({}),
        draftBindings = $bindable<CheckinBinding[]>([]),
        draftMembers = [] as FamilyMember[],
        leadRules = [] as { key: string; moduleId: string; ruleKey: string; def: number }[],
        enabledIds = new Set<string>(),
        settings,
        t,
        onSwitchArea,
    }: {
        draftNotifyHour?: number;
        draftSilentFrom?: number;
        draftSilentTo?: number;
        draftWebhookEnabled?: boolean;
        draftWebhookMode?: "bark" | "ntfy";
        draftWebhookUrl?: string;
        draftLeads?: Record<string, string>;
        draftBindings?: CheckinBinding[];
        draftMembers?: FamilyMember[];
        leadRules?: { key: string; moduleId: string; ruleKey: string; def: number }[];
        enabledIds?: Set<string>;
        settings: HomeSettings;
        t: (k: string) => string;
        onSwitchArea?: (area: "modules" | "members" | "reminders" | "data" | "about") => void;
    } = $props();

    let reminderSection: "schedule" | "webhook" | "leads" | "checkin" = $state("schedule");
    let testingWebhook = $state(false);

    async function testWebhook() {
        if (testingWebhook) return;
        testingWebhook = true;
        try {
            const { sendWebhook } = await import("@/core/webhook");
            const r = await sendWebhook({
                ...settings,
                webhookEnabled: true,
                webhookUrl: draftWebhookUrl,
                webhookMode: draftWebhookMode,
            } as HomeSettings, { title: t("hub.title"), body: t("settings.webhookTestBody") });
            showMessage(r === "ok" ? t("settings.webhookTestOk") : t("settings.webhookTestFail"), 3000, r === "ok" ? "info" : "error");
        } catch (error) {
            showMessage(`${t("settings.webhookTestFail")}${error instanceof Error ? ` (${error.message})` : ""}`, 5000, "error");
        } finally {
            testingWebhook = false;
        }
    }

    let showAllLeads = $state(false);
    const enabledLeadRules = $derived(leadRules.filter((lr) => enabledIds.has(lr.moduleId)));
    const visibleLeadRules = $derived(showAllLeads ? leadRules : enabledLeadRules);

    const METRICS: CheckinBinding["metric"][] = ["count", "quantity", "duration"];
    let checkinItems: { id: string; name: string; kind: string }[] = $state([]);
    let checkinPresent = $state<boolean | null>(null); // null=探测中
    let checkinProbe = $state(0);

    $effect(() => {
        void checkinProbe;
        let alive = true;
        (async () => {
            try {
                const ck = (window as { siyuanCheckin?: { whenReady?: () => Promise<boolean>; queryItems?: (o?: { limit?: number }) => { id: string; name: string; kind: string }[] } }).siyuanCheckin;
                if (!ck?.whenReady || !ck?.queryItems) { if (alive) checkinPresent = false; return; }
                const ready = await ck.whenReady();
                if (!alive) return;
                checkinPresent = !!ready;
                if (ready) checkinItems = (ck.queryItems({ limit: 200 }) ?? []).map((it) => ({ id: String(it.id), name: String(it.name), kind: String(it.kind) }));
            } catch { if (alive) checkinPresent = false; }
        })();
        return () => { alive = false; };
    });

    /** kind → 默认指标（binary/count→次数；duration→时长；quantity/custom→数量） */
    function defaultMetric(kind: string): CheckinBinding["metric"] {
        if (kind === "duration") return "duration";
        if (kind === "quantity" || kind === "custom") return "quantity";
        return "count";
    }

    function addBinding() {
        const pair = availableBindingPair;
        if (!pair) {
            showMessage(t(draftMembers.length ? "settings.checkinAllBound" : "settings.checkinNeedMember"), 3500, "info");
            return;
        }
        const { item: it, member } = pair;
        draftBindings = [...draftBindings, {
            itemId: it.id, itemName: it.name,
            memberId: member.id,
            metric: defaultMetric(it.kind),
        }];
    }

    const availableBindingPair = $derived.by(() => {
        for (const item of checkinItems) {
            const member = draftMembers.find((m) => !draftBindings.some((b) => b.itemId === item.id && b.memberId === m.id));
            if (member) return { item, member };
        }
        return undefined;
    });

    function removeBinding(i: number) {
        const binding = draftBindings[i];
        if (!binding) return;
        confirm(
            t("settings.bindingRemoveTitle"),
            t("settings.bindingRemoveBody").replace("${item}", binding.itemName).replace("${member}", draftMembers.find((m) => m.id === binding.memberId)?.name?.trim() || t("members.name")),
            () => { draftBindings = draftBindings.filter((_, idx) => idx !== i); },
        );
    }

    function syncBindingItem(b: CheckinBinding) {
        const it = checkinItems.find((x) => x.id === b.itemId);
        if (it) { b.itemName = it.name; b.metric = defaultMetric(it.kind); }
    }
</script>

<div class="lv-settings__pane-title">{t("tabReminders")}</div>
<nav class="lv-settings__subnav" aria-label={t("tabReminders")}>
    <button type="button" class="lv-setnav__item {reminderSection === 'schedule' ? 'on' : ''}" aria-current={reminderSection === 'schedule' ? 'true' : undefined} onclick={() => (reminderSection = "schedule")}>{t("settings.reminderSchedule")}</button>
    <button type="button" class="lv-setnav__item {reminderSection === 'webhook' ? 'on' : ''}" aria-current={reminderSection === 'webhook' ? 'true' : undefined} onclick={() => (reminderSection = "webhook")}>{t("settings.webhookTitle")}</button>
    <button type="button" class="lv-setnav__item {reminderSection === 'leads' ? 'on' : ''}" aria-current={reminderSection === 'leads' ? 'true' : undefined} onclick={() => (reminderSection = "leads")}>{t("settings.leadsTitle")}</button>
    <button type="button" class="lv-setnav__item {reminderSection === 'checkin' ? 'on' : ''}" aria-current={reminderSection === 'checkin' ? 'true' : undefined} onclick={() => (reminderSection = "checkin")}>{t("settings.checkinBindingsTitle")}</button>
</nav>

<div class="lv-settings__scroll">
    {#if reminderSection === "schedule"}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("tabReminders")}</div>
            <div class="lv-setcard__hint">{t("settings.remindersHint")}</div>
            <div class="fn__flex lv-settings__row">
                <span class="lv-settings__label">{t("settings.notifyHour")}</span>
                <input class="b3-text-field lv-input-hour" type="number" inputMode="numeric" min="0" max="23" aria-label={t("settings.notifyHour")} bind:value={draftNotifyHour} />
                <span class="lv-caption fn__flex-1">{t("settings.notifyHourHint")}</span>
            </div>
            <div class="fn__flex lv-settings__row">
                <span class="lv-settings__label">{t("settings.silentHours")}</span>
                <input class="b3-text-field lv-input-time-sm" type="number" inputMode="numeric" min="0" max="23" aria-label={t("settings.silentFromLabel")} bind:value={draftSilentFrom} />
                <span class="lv-caption lv-arrow-sep" aria-hidden="true"><UiIcon name="forward" size={11} /></span>
                <input class="b3-text-field lv-input-time-sm" type="number" inputMode="numeric" min="0" max="23" aria-label={t("settings.silentToLabel")} bind:value={draftSilentTo} />
                <span class="lv-caption fn__flex-1">{t("settings.silentHoursHint")}</span>
            </div>
            <div class="lv-mt-10">
                <button type="button" class="b3-button b3-button--text lv-tx-muted lv-btn-text-sm"
                    onclick={() => {
                        draftNotifyHour = 8;
                        draftSilentFrom = 22;
                        draftSilentTo = 8;
                        showMessage(t("settings.scheduleResetDone"), 2500, "info");
                    }}>
                    <UiIcon name="repeat" size={11} /> {t("settings.resetDefault")}
                </button>
            </div>
        </div>
    {:else if reminderSection === "webhook"}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.webhookTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.webhookHint")}</div>
            <div class="fn__flex lv-settings__row">
                <span class="lv-settings__label">{t("settings.webhookEnable")}</span>
                <input type="checkbox" class="b3-switch" aria-label={t("settings.webhookEnable")} bind:checked={draftWebhookEnabled} />
                <span class="lv-caption fn__flex-1"></span>
            </div>
            <div class="fn__flex lv-settings__row">
                <span class="lv-settings__label">{t("settings.webhookMode")}</span>
                <select class="b3-select" aria-label={t("settings.webhookMode")} bind:value={draftWebhookMode}>
                    <option value="bark">Bark</option>
                    <option value="ntfy">ntfy</option>
                </select>
                <span class="lv-caption fn__flex-1"></span>
            </div>
            <div class="fn__flex lv-settings__row">
                <span class="lv-settings__label">{t("settings.webhookUrl")}</span>
                <input class="b3-text-field fn__flex-1" aria-label={t("settings.webhookUrl")} bind:value={draftWebhookUrl}
                    placeholder="https://api.day.app/yourkey" />
            </div>
            <button type="button" class="b3-button b3-button--outline lv-setcard__action" disabled={testingWebhook || !draftWebhookUrl.trim()}
                onclick={testWebhook}>{testingWebhook ? t("settings.webhookTesting") : t("settings.webhookTest")}</button>
        </div>
    {:else if reminderSection === "leads"}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.leadsTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.leadsHint")}</div>
            <div class="lv-dialog-row__left lv-mb-8">
                {#if enabledLeadRules.length < leadRules.length}
                    <button type="button" class="b3-button b3-button--text lv-setcard__action" onclick={() => (showAllLeads = !showAllLeads)}>
                        {showAllLeads ? t("settings.leadsEnabledOnly") : t("settings.leadsShowAll").replace("${n}", String(leadRules.length - enabledLeadRules.length))}
                    </button>
                {/if}
                {#if Object.keys(draftLeads).length > 0}
                    <button type="button" class="b3-button b3-button--text lv-tx-muted lv-setcard__action" onclick={() => {
                        draftLeads = {};
                        showMessage(t("settings.leadsResetDone"), 2500, "info");
                    }}>
                        <UiIcon name="repeat" size={12} /> {t("settings.resetLeadsDefault")}
                    </button>
                {/if}
            </div>
            {#each visibleLeadRules as lr (lr.key)}
                <div class="fn__flex lv-settings__row" style={enabledIds.has(lr.moduleId) ? "" : "opacity:.55"}>
                    <span class="lv-settings__label-wide">{t(`module.${lr.moduleId}`)} · {t(`rule.${lr.ruleKey}`) !== `rule.${lr.ruleKey}` ? t(`rule.${lr.ruleKey}`) : lr.ruleKey}</span>
                    <input class="b3-text-field lv-input-hour" type="number" inputMode="numeric" min="0" max="3650"
                        aria-label={`${t(`module.${lr.moduleId}`)} · ${t(`rule.${lr.ruleKey}`) !== `rule.${lr.ruleKey}` ? t(`rule.${lr.ruleKey}`) : lr.ruleKey}`}
                        placeholder={String(lr.def)}
                        bind:value={draftLeads[lr.key]} />
                    <span class="lv-caption fn__flex-1">{t("settings.leadDefault").replace("${n}", String(lr.def))}{#if !enabledIds.has(lr.moduleId)} · {t("settings.leadDisabled")}{/if}</span>
                </div>
            {/each}
        </div>
    {:else}
        <!-- EC09（D20）：打卡习惯 → 成员指标绑定（只读消费） -->
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.checkinBindingsTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.checkinBindingsHint")}</div>
            {#if checkinPresent === false}
                <p class="lv-setcard__hint lv-tx-warn">{t("settings.checkinAbsent")}</p>
            {:else if checkinPresent === null}
                <p class="lv-setcard__hint" role="status">{t("settings.checkinLoading")}</p>
                <button type="button" class="b3-button b3-button--outline lv-setcard__action" onclick={() => { checkinItems = []; checkinPresent = null; checkinProbe += 1; }}>{t("settings.checkinRetry")}</button>
            {:else if checkinPresent === true}
                {#if draftMembers.length === 0}
                    <p class="lv-setcard__hint" role="status">{t("settings.checkinNeedMember")}</p>
                    <button type="button" class="b3-button b3-button--outline lv-setcard__action" onclick={() => onSwitchArea?.("members")}>{t("tabMembers")}</button>
                {/if}
                {#each draftBindings as b, i}
                    <div class="fn__flex lv-settings__row lv-gap-6">
                        <select class="b3-select" bind:value={b.memberId} aria-label={t("settings.metricMember")}>
                            {#each draftMembers as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
                        </select>
                        <span class="lv-caption">·</span>
                        <select class="b3-select" bind:value={b.itemId} onchange={() => syncBindingItem(b)} aria-label={t("settings.metricItem")}>
                            {#each checkinItems as it (it.id)}<option value={it.id}>{it.name}</option>{/each}
                        </select>
                        <select class="b3-select" bind:value={b.metric} aria-label={t("settings.metricKind")}>
                            {#each METRICS as mt (mt)}<option value={mt}>{t(`settings.metric.${mt}`)}</option>{/each}
                        </select>
                        <button type="button" class="b3-button b3-button--text" title={t("delete")} aria-label={`${t("delete")} · ${b.itemName}`} onclick={() => removeBinding(i)}><UiIcon name="close" size={12} /></button>
                    </div>
                {/each}
                {#if draftBindings.length === 0}
                    <p class="lv-setcard__hint ft__on-surface">{t("settings.checkinEmpty")}</p>
                {/if}
                {#if checkinItems.length === 0}
                    <p class="lv-setcard__hint" role="status">{t("settings.checkinNoItems")}</p>
                {/if}
                {#if checkinItems.length > 0 && draftMembers.length > 0 && !availableBindingPair}
                    <p class="lv-setcard__hint" role="status">{t("settings.checkinAllBound")}</p>
                {/if}
                <button type="button" class="b3-button b3-button--outline lv-setcard__action" disabled={!availableBindingPair} onclick={addBinding}><UiIcon name="add" size={13} /> {t("settings.checkinAdd")}</button>
            {/if}
        </div>
    {/if}
</div>
