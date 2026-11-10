<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        t,
        starterModule,
        onGoto,
        onOpenStarterRecord,
        onOpenSettings,
    }: {
        t: (k: string) => string;
        starterModule?: string;
        onGoto: (screen: string) => void;
        onOpenStarterRecord: () => void;
        onOpenSettings: () => void;
    } = $props();
</script>

<details class="lv-start-guide" open aria-labelledby="lv-start-guide-title">
    <summary class="lv-start-guide__summary">
        <span class="lv-start-guide__copy">
            <span class="lv-kicker">{t("startGuide.kicker")}</span>
            <span id="lv-start-guide-title" class="lv-start-guide__title">{t("startGuide.title")}</span>
            <span class="lv-start-guide__intro">{t("startGuide.intro")}</span>
        </span>
        <span class="lv-start-guide__mark" aria-hidden="true"><UiIcon name="chevronDown" size={14} /></span>
    </summary>
    <div class="lv-start-guide__steps">
        <div class="lv-start-guide__step">
            <span class="lv-start-guide__num">1</span>
            <div><b>{t("startGuide.stepMembers")}</b><span>{t("startGuide.stepMembersHint")}</span></div>
            <button type="button" class="b3-button b3-button--outline" onclick={() => onGoto("members")}>{t("startGuide.openMembers")}</button>
        </div>
        <div class="lv-start-guide__step">
            <span class="lv-start-guide__num">2</span>
            <div><b>{t("startGuide.stepRecord")}</b><span>{starterModule ? t("startGuide.stepRecordHint") : t("startGuide.stepRecordNoModule")}</span></div>
            <button type="button" class="b3-button b3-button--outline" onclick={onOpenStarterRecord}>{starterModule ? t("startGuide.openLedger") : t("startGuide.openSettings")}</button>
        </div>
        <div class="lv-start-guide__step">
            <span class="lv-start-guide__num">3</span>
            <div><b>{t("startGuide.stepModules")}</b><span>{t("startGuide.stepModulesHint")}</span></div>
            <button type="button" class="b3-button b3-button--outline" onclick={onOpenSettings}>{t("startGuide.openSettings")}</button>
        </div>
        <div class="lv-start-guide__step">
            <span class="lv-start-guide__num">4</span>
            <div><b>{t("startGuide.stepReminders")}</b><span>{t("startGuide.stepRemindersHint")}</span></div>
            <button type="button" class="b3-button b3-button--outline" onclick={() => onGoto("reminders")}>{t("startGuide.openReminders")}</button>
        </div>
    </div>
</details>
