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

<style>
    .lv-settings-member {
        padding: 16px;
        margin-top: 12px;
        border: 1px solid var(--lv-line);
        border-radius: 14px;
        background: var(--lv-surface);
        min-width: 0;
    }

    .lv-settings-member__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
    }

    .lv-settings-member__head h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        margin: 0;
        color: var(--lv-tx);
        font-size: 13px;
        font-weight: 600;
    }

    .lv-settings-member__head h3 > span:last-child {
        overflow-wrap: anywhere;
    }

    .lv-settings-member__number {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        border-radius: 8px;
        background: var(--lv-surface-2);
        color: var(--lv-tx-3);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .lv-settings-member__delete {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 36px;
        color: var(--lv-tx-3);
    }

    .lv-settings-member__delete:hover {
        color: var(--lv-danger);
        background: var(--lv-danger-soft);
    }

    .lv-settings-member__fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px 16px;
    }

    .lv-settings-member__field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        color: var(--lv-tx-2);
        font-size: 12px;
    }

    .lv-settings-member__field :is(input, select) {
        width: 100%;
        min-width: 0;
        min-height: 40px;
        box-sizing: border-box;
    }

    .lv-settings-member__calendar {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 40px;
        padding-top: 10px;
        border-top: 1px solid var(--lv-line);
        color: var(--lv-tx-2);
        font-size: 12px;
        cursor: pointer;
    }

    .lv-settings-member__calendar input { flex: none; }

    .lv-settings-member__add {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
    }

    @container lv-home (max-width: 480px) {
        .lv-settings-member { padding: 12px; }
        .lv-settings-member__fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .lv-settings-member__field :is(input, select),
        .lv-settings-member__delete,
        .lv-settings-member__add { min-height: 44px; }
    }

    @media (max-width: 480px) {
        .lv-settings-member { padding: 12px; }
        .lv-settings-member__fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .lv-settings-member__field :is(input, select),
        .lv-settings-member__delete,
        .lv-settings-member__add { min-height: 44px; }
    }
</style>
