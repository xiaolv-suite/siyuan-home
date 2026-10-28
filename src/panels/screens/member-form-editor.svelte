<script lang="ts">
    import { showMessage } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import { addMember, updateMember } from "@/core/members";
    import { newSiYuanId } from "@/core/siyuan";
    import type { MemberRole } from "@/types";

    let {
        editorOpen = $bindable(false),
        editId = $bindable<string | null>(null),
        name = $bindable(""),
        role = $bindable<MemberRole>("self"),
        sex = $bindable<"male" | "female" | undefined>(undefined),
        birthday = $bindable(""),
        lunar = $bindable(false),
        notes = $bindable(""),
        plugin,
        t,
        onSaved,
        onCancel,
    }: {
        editorOpen?: boolean;
        editId?: string | null;
        name?: string;
        role?: MemberRole;
        sex?: "male" | "female" | undefined;
        birthday?: string;
        lunar?: boolean;
        notes?: string;
        plugin: any;
        t: (k: string) => string;
        onSaved?: () => Promise<void>;
        onCancel?: () => void;
    } = $props();

    let nameInput: HTMLInputElement | undefined = $state();
    let memberSaving = $state(false);
    let pendingNewMemberId = $state<string | undefined>();
    const roles: MemberRole[] = ["self", "spouse", "partner", "child", "elder", "kin", "other"];

    export function focusName() {
        nameInput?.focus();
    }

    function cancelEdit() {
        editId = null;
        pendingNewMemberId = undefined;
        name = "";
        role = "self";
        sex = undefined;
        birthday = "";
        lunar = false;
        notes = "";
        editorOpen = false;
        if (onCancel) onCancel();
    }

    async function save() {
        if (memberSaving) return;
        // 297 波：访客模式写保护拦截
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        if (!name.trim()) {
            nameInput?.focus();
            showMessage(t("ledger.nameRequired"), 4000, "info");
            return;
        }
        // D06 配套：同名成员会让按姓名回填产生歧义——新增时提示确认（编辑不受影响）
        const dup = !editId && (plugin.settings.members ?? []).some((m: any) => m.name.trim() === name.trim());
        if (dup) {
            confirm(t("members.dupTitle"), t("members.dupBody").replace("${name}", name.trim()), () => { void doSave(true); });
            return;
        }
        await doSave(true);
    }

    async function doSave(clearAfterCreate = true) {
        if (!name.trim() || memberSaving) return;
        memberSaving = true;
        try {
            try {
                if (editId) {
                    const target = (plugin.settings.members ?? []).find((m: any) => m.id === editId);
                    if (target) {
                        await updateMember(plugin, plugin.settings, {
                            ...target,
                            name: name.trim(),
                            role,
                            sex: sex || undefined,
                            birthday: birthday || undefined,
                            lunarBirthday: lunar,
                            notes: notes.trim() || undefined,
                        });
                    }
                    cancelEdit();
                } else {
                    const submittedName = name.trim();
                    pendingNewMemberId ??= newSiYuanId();
                    await addMember(plugin, plugin.settings, {
                        id: pendingNewMemberId,
                        name: submittedName,
                        role,
                        sex: sex || undefined,
                        birthday: birthday || undefined,
                        lunarBirthday: lunar,
                        notes: notes.trim() || undefined,
                        createdAt: new Date().toISOString(),
                    });
                    pendingNewMemberId = undefined;
                    if (clearAfterCreate) {
                        name = "";
                        role = "self";
                        sex = undefined;
                        birthday = "";
                        lunar = false;
                        notes = "";
                    }
                }
            } catch (e) {
                showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
                return;
            }
            try {
                if (onSaved) {
                    await onSaved();
                } else {
                    await plugin.refreshHub?.(undefined, true);
                }
            } catch (e) {
                showMessage(t("members.saveRefreshFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            }
        } finally {
            memberSaving = false;
        }
    }
</script>

<div id="lv-member-editor" class="lv-card lv-member-editor" hidden={!editorOpen}>
    <div class="lv-member-editor-head">
        <div>
            <h2>{editId ? t("members.editing") : t("add")}</h2>
            <p>{editId ? t("members.editing") : t("settings.membersHint")}</p>
        </div>
    </div>
    <div class="lv-member-editor-fields">
        <label class="lv-member-field">
            <span>{t("members.name")}</span>
            <input bind:this={nameInput} class="b3-text-field" placeholder={t("members.name")} aria-label={t("members.name")} bind:value={name} disabled={memberSaving}
                onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) save(); }} />
        </label>
        <label class="lv-member-field">
            <span>{t("members.role")}</span>
            <select class="b3-select" bind:value={role} aria-label={t("members.role")} disabled={memberSaving}>
                {#each roles as r (r)}<option value={r}>{t(`role.${r}`)}</option>{/each}
            </select>
        </label>
        <label class="lv-member-field">
            <span>{t("members.sex")}</span>
            <select class="b3-select" bind:value={sex} aria-label={t("members.sex")} disabled={memberSaving}>
                <option value="">{t("members.sex.unknown")}</option>
                <option value="male">{t("members.sex.male")}</option>
                <option value="female">{t("members.sex.female")}</option>
            </select>
        </label>
        <label class="lv-member-field">
            <span>{t("members.birthday")}</span>
            <input class="b3-text-field" type="date" title={t("members.birthday")} aria-label={t("members.birthday")} bind:value={birthday} disabled={memberSaving} />
        </label>
        <label class="lv-member-check">
            <input type="checkbox" bind:checked={lunar} disabled={memberSaving} />{t("members.lunar")}
        </label>
        <label class="lv-member-field lv-member-field-wide">
            <span>{t("members.notes")}</span>
            <textarea class="b3-text-field" rows="2" bind:value={notes} aria-label={t("members.notes")} disabled={memberSaving}></textarea>
        </label>
        <div class="lv-member-editor-actions">
            <button type="button" class="lv-btn primary sm" onclick={save} disabled={memberSaving} aria-busy={memberSaving}>
                {memberSaving ? t("ledger.saving") : editId ? t("save") : `＋ ${t("add")}`}
            </button>
            {#if editId}
                <button type="button" class="b3-button b3-button--outline" onclick={cancelEdit} disabled={memberSaving}>{t("cancel")}</button>
            {/if}
        </div>
    </div>
</div>

<style>
    .lv-member-editor { padding: 16px; margin-bottom: 12px; }
    .lv-member-editor[hidden] { display: none !important; }
    .lv-member-editor-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .lv-member-editor-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
    .lv-member-editor-head p { margin: 3px 0 0; color: var(--lv-tx-3); font-size: 11.5px; line-height: 1.45; }
    .lv-member-editor-fields { display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(120px, .9fr) minmax(135px, 1fr) auto auto; align-items: end; gap: 10px; }
    .lv-member-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .lv-member-field > span { color: var(--lv-tx-3); font-size: 11.5px; }
    .lv-member-field .b3-text-field, .lv-member-field .b3-select { width: 100%; min-width: 0; box-sizing: border-box; }
    .lv-member-field-wide { grid-column: 1 / -1; }
    .lv-member-check { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding-bottom: 1px; color: var(--lv-tx-2); font-size: 12px; white-space: nowrap; cursor: pointer; }
    .lv-member-editor-actions { display: flex; gap: 7px; align-items: center; min-height: 32px; }

    @container lv-home (max-width: 680px) {
        .lv-member-editor-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .lv-member-editor-actions { grid-column: 1 / -1; }
    }

    @container lv-home (max-width: 420px) {
        .lv-member-editor-fields { grid-template-columns: 1fr; }
        .lv-member-editor-actions { grid-column: auto; }
    }
</style>
