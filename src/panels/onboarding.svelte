<script lang="ts">
    import type { HomePluginLike } from "@/types/plugin";
    import UiIcon from "@/ui/icon.svelte";
    let { plugin, t, onGoto, onCapture }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        onGoto?: (s: string) => void;
        onCapture?: (moduleId?: string) => void;
    } = $props();

    let step = $state(1);
    let provisioning = $state(false);
    let provisionError = $state("");
    let skipFailed = $state(false);
    const roleOptions = ["spouse", "partner", "child", "elder", "kin"];
    let picked: string[] = $state(["self"]);
    let children = $state(0);
    const roleIcon: Record<string, import("@/ui/icons").UiIconName> = {
        spouse: "users",
        partner: "heartPulse",
        child: "child",
        elder: "users",
        kin: "users",
    };

    // 推荐模块（C7b：按家庭构成预选）
    const recommended = $derived<string[]>(
        picked.flatMap((r) => (r === "child" && children > 0 ? ["parenting", "schooling", "allowance"] : r === "elder" ? ["social"] : [])),
    );

    function toggle(role: string) {
        const nextPicked = picked.includes(role) ? picked.filter((r) => r !== role) : [...picked, role];
        picked = nextPicked;
        if (!nextPicked.includes("child")) children = 0;
    }

    async function runOnboarding(roles: string[], moduleIds: string[], goToCapture: boolean) {
        if (provisioning) return;
        provisioning = true;
        provisionError = "";
        skipFailed = false;
        const timeout = window.setTimeout(() => {
            provisionError = t("wiz.provisionStillRunning");
        }, 120_000);
        try {
            await plugin.finishOnboarding({ roles, children }, moduleIds);
            if (goToCapture) {
                // Prefer newly recommended ledgers, then fall back to any
                // enabled ledger that was successfully provisioned.
                const enabled = plugin.settings.enabledModules ?? [];
                const target = [...recommended.filter((id) => enabled.includes(id)), ...enabled]
                    .filter((id) => id !== "members" && id !== "adhoc")
                    .find((id) => !!plugin.schemaCatalog?.[id]?.capture?.length && !!plugin.settings.dbRefs?.[id]?.avId);
                if (target) {
                    if (onCapture) onCapture(target);
                    else {
                        plugin.setActiveLedger(target);
                        onGoto?.("ledger");
                    }
                } else {
                    onGoto?.("overview");
                }
            }
        } catch (e) {
            provisionError = e instanceof Error ? e.message : String(e);
            skipFailed = !goToCapture;
        } finally {
            window.clearTimeout(timeout);
            provisioning = false;
        }
    }
    // C7 向导 CTA：完成后直达快速记录（优先预选刚推荐并已建库的台账）。超时只提示仍在处理中，
    // 保持 busy 锁直到建库流程实际结束，避免超时后再次点击并发建库。
    async function finishAndCapture() {
        await runOnboarding(Array.from(new Set(["self", ...picked])), recommended, true);
    }
    function goToStep(next: number) {
        step = next;
        requestAnimationFrame(() => document.getElementById("lv-wiz-title")?.focus());
    }
    // 完成=建库+直达快速记录（C7 CTA）；skip 路径同样经 finishOnboarding（需容错）
    async function skip() {
        children = 0;
        await runOnboarding(["self"], [], false);
    }
</script>

<!-- 251 波（对齐原型 .aura 品牌时刻）：双漂移辉光容器 + 居中向导 + rolechip -->
<section class="lv-card lv-aura lv-onboarding" aria-labelledby="lv-wiz-title">
    <div class="lv-wiz">
        <div class="lv-wiz__intro">
            <div class="lv-wiz__intro-icon" aria-hidden="true"><UiIcon name="home" size={20} /></div>
            <div class="lv-wiz__intro-main">
                <div class="lv-wiz__eyebrow">{t("wiz.welcomeEyebrow")}</div>
                <h2 class="lv-wiz__welcome">{t("wiz.welcomeTitle")}</h2>
                <p class="lv-sub">{t("wiz.welcomeHint")}</p>
            </div>
            <div class="lv-wiz__progress" aria-label={t("wiz.step").replace("${n}", String(step))}>
                <span class="lv-wiz__step" aria-live="polite">{t("wiz.step").replace("${n}", String(step))}</span>
                <div class="lv-wiz__progress-track" role="progressbar" aria-valuemin="1" aria-valuemax="2" aria-valuenow={step}
                    aria-valuetext={t("wiz.step").replace("${n}", String(step))}>
                    <span class:active={step >= 1}></span><span class:active={step >= 2}></span>
                </div>
            </div>
        </div>
        <details class="lv-wiz__overview">
            <summary>{t("wiz.featuresLabel")}</summary>
            <div class="lv-wiz__overview-body">
                <p>{t("wiz.intro")}</p>
            </div>
        </details>
        {#if step === 1}
            <div class="lv-wiz__current">
                <h3 id="lv-wiz-title" class="lv-wiz__title" tabindex="-1">{t("wiz.s1Title")}</h3>
                <p class="lv-sub lv-wiz__hint">{t("wiz.s1Hint")}</p>
            </div>
            <div class="lv-roles">
                {#each roleOptions as r (r)}
                    <button type="button" class="lv-rolechip" class:on={picked.includes(r)} aria-pressed={picked.includes(r)} disabled={provisioning} onclick={() => toggle(r)}>
                        <UiIcon name={roleIcon[r]} size={13} />
                        <span>{t(`role.${r}`)}</span>
                    </button>
                {/each}
            </div>
            {#if picked.includes("child")}
                <div class="lv-wiz__children">
                    <span class="lv-sub">{t("wiz.children")}</span>
                    <button type="button" class="b3-button b3-button--outline lv-wiz__step-btn" aria-label={t("wiz.childrenDecrease")} disabled={provisioning || children <= 0} onclick={() => (children = Math.max(0, children - 1))}><UiIcon name="minus" size={12} /></button>
                    <b class="lv-num" aria-live="polite">{children}</b>
                    <button type="button" class="b3-button b3-button--outline lv-wiz__step-btn" aria-label={t("wiz.childrenIncrease")} disabled={provisioning} onclick={() => (children += 1)}><UiIcon name="add" size={12} /></button>
                </div>
            {/if}
            <div class="lv-wiz__actions">
                <button type="button" class="lv-btn ghost" disabled={provisioning} onclick={skip}>{provisioning ? t("wiz.provisioningShort") : t("wiz.skip")}</button>
                <button type="button" class="lv-btn primary" disabled={provisioning} onclick={() => goToStep(2)}><span>{t("wiz.next")}</span> <UiIcon name="forward" size={12} /></button>
            </div>
            {#if provisionError}<p class="lv-caption lv-wiz__error" role="alert"><UiIcon name="alert" size={13} /> {skipFailed ? `${t("wiz.skipFailed")}: ${provisionError}` : provisionError}</p>{/if}
        {:else}
            <div class="lv-wiz__current">
                <h3 id="lv-wiz-title" class="lv-wiz__title" tabindex="-1">{t("wiz.s2Title")}</h3>
                <p class="lv-wiz__lead">{t("wiz.moduleIntro")}</p>
                <p class="lv-sub lv-wiz__hint">{t("wiz.s2Hint")}</p>
            </div>
            <div class="lv-roles">
                {#each recommended as mid (mid)}
                    <span class="lv-rolechip on">{t(`module.${mid}`)}</span>
                {/each}
                {#if recommended.length === 0}<span class="lv-sub">{t("wiz.noExtra")}</span>{/if}
            </div>
            {#if picked.includes("child") && children > 0}
                <!-- N3（重估后方案 A）：向导不建成员实体，性别只读不写不问——完成页引导去成员页补（D23 生长带依赖） -->
                <p class="lv-caption lv-wiz__note" role="note"><UiIcon name="info" size={13} /> {t("wiz.sexHint")}</p>
            {/if}
            <div class="lv-wiz__actions lv-wiz__actions--split">
                <button type="button" class="lv-btn" disabled={provisioning} onclick={() => goToStep(1)}><UiIcon name="back" size={12} /> <span>{t("wiz.back")}</span></button>
                {#if provisionError}
                    <span class="lv-caption lv-wiz__error" role="alert"><UiIcon name="alert" size={13} /> {skipFailed ? `${t("wiz.skipFailed")}: ${provisionError}` : provisionError}</span>
                {/if}
                <button type="button" class="lv-btn primary" disabled={provisioning}
                    title={t("wiz.finishCta")} onclick={finishAndCapture}>
                    {provisioning ? t("wiz.provisioningShort") : t("wiz.finishAndCapture")}
                </button>
            </div>
        {/if}
    </div>
</section>

