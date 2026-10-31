<script lang="ts">
    import type { FamilyMember, MemberRole } from "@/types";
    import UiIcon from "@/ui/icon.svelte";

    let {
        draftMembers = $bindable([]),
        t,
        onAddMember,
        onRemoveMember,
    }: {
        draftMembers: FamilyMember[];
        t: (k: string) => string;
        onAddMember: () => void;
        onRemoveMember: (id: string) => void;
    } = $props();

    const ROLES: MemberRole[] = ["self", "spouse", "partner", "child", "elder", "kin", "other"];
</script>

<div class="lv-settings__pane-title">{t("tabMembers")}</div>
<div class="lv-settings__scroll">
<div class="lv-card lv-setcard">
    <div class="lv-setcard__hint">{t("settings.membersHint")}</div>
    {#if draftMembers.length === 0}
        <div class="lv-setcard__hint ft__on-surface">{t("members.empty")}</div>
    {/if}
    {#each draftMembers as m, i (m.id)}
        <section class="lv-settings-member" aria-labelledby={`lv-settings-member-${m.id}`}>
            <div class="lv-settings-member__head">
                <h3 id={`lv-settings-member-${m.id}`}>
                    <span class="lv-settings-member__number" aria-hidden="true">{i + 1}</span>
                    <span>{m.name.trim() || t("members.name")}</span>
                </h3>
                <button class="b3-button b3-button--text lv-settings-member__delete" type="button"
                    aria-label={`${t("delete")} ${m.name.trim() || t("members.name")}`} onclick={() => onRemoveMember(m.id)}>
                    {t("delete")}
                </button>
            </div>
            <div class="lv-settings-member__fields">
                <label class="lv-settings-member__field">
                    <span>{t("members.name")}</span>
                    <input class="b3-text-field" placeholder={t("members.name")} aria-label={t("members.name")} bind:value={draftMembers[i].name} />
                </label>
                <label class="lv-settings-member__field">
                    <span>{t("members.role")}</span>
                    <select class="b3-select" aria-label={t("members.role")} bind:value={draftMembers[i].role}>
                        {#each ROLES as r (r)}
                            <option value={r}>{t(`role.${r}`)}</option>
                        {/each}
                    </select>
                </label>
                <label class="lv-settings-member__field">
                    <span>{t("members.sex")}</span>
                    <select class="b3-select" aria-label={t("members.sex")} bind:value={draftMembers[i].sex}>
                        <option value="">{t("members.sex.unknown")}</option>
                        <option value="male">{t("members.sex.male")}</option>
                        <option value="female">{t("members.sex.female")}</option>
                    </select>
                </label>
                <label class="lv-settings-member__field">
                    <span>{t("members.birthday")}</span>
                    <input class="b3-text-field" type="date" aria-label={t("members.birthday")} bind:value={draftMembers[i].birthday} />
                </label>
                <label class="lv-settings-member__calendar">
                    <span>{t("members.lunar")}</span>
                    <input type="checkbox" class="b3-switch" aria-label={t("members.lunar")} bind:checked={draftMembers[i].lunarBirthday} />
                </label>
            </div>
        </section>
    {/each}
    <button class="b3-button b3-button--outline lv-setcard__action lv-settings-member__add" type="button" onclick={onAddMember}>
        <UiIcon name="add" size={15} /> {t("add")}
    </button>
</div>
</div>
