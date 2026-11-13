<script lang="ts">
    import { showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { addMember, updateMember } from "@/core/members";
    import { newSiYuanId } from "@/core/siyuan";
    import UiIcon from "@/ui/icon.svelte";
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
        onPickAvatar,
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
        onPickAvatar?: () => void;
    } = $props();

    let nameInput: HTMLInputElement | undefined = $state();
    let memberSaving = $state(false);
    let nameError = $state(false);
    let pendingNewMemberId = $state<string | undefined>();
    const roles: MemberRole[] = ["self", "spouse", "partner", "child", "elder", "kin", "other"];

    const ROLE_NAME_SUGGESTIONS: Record<string, Record<string, string[]>> = {
        spouse: {
            male: ["老公", "先生", "孩他爸"],
            female: ["老婆", "妻子", "孩他妈"],
            any: ["配偶", "伴侣", "爱人"],
        },
        child: {
            male: ["儿子", "大宝", "小宝"],
            female: ["女儿", "大宝", "小宝"],
            any: ["孩子", "宝贝", "宝宝"],
        },
        elder: {
            male: ["爷爷", "外公", "爸爸", "公公", "岳父"],
            female: ["奶奶", "外婆", "妈妈", "婆婆", "岳母"],
            any: ["长辈"],
        },
        kin: {
            male: ["哥哥", "弟弟", "叔叔", "舅舅"],
            female: ["姐姐", "妹妹", "姑姑", "阿姨"],
            any: ["亲戚", "亲属"],
        },
        self: {
            any: ["本人", "我"],
        },
    };

    const suggestedNames = $derived.by(() => {
        const pool = ROLE_NAME_SUGGESTIONS[role];
        if (!pool) return [];
        const sexKey = sex === "male" || sex === "female" ? sex : "any";
        const res = [...(pool[sexKey] ?? []), ...(sexKey !== "any" ? (pool["any"] ?? []) : [])];
        return res.slice(0, 4);
    });

    $effect(() => {
        if (editorOpen) {
            requestAnimationFrame(() => {
                document.getElementById("lv-member-editor")?.scrollIntoView?.({ behavior: (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth", block: "nearest" });
                nameInput?.focus();
            });
        } else {
            nameError = false;
        }
    });

    export function focusName() {
        document.getElementById("lv-member-editor")?.scrollIntoView?.({ behavior: (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth", block: "nearest" });
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
        nameError = false;
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
            nameError = true;
            nameInput?.focus();
            showMessage(t("ledger.nameRequired"), 4000, "info");
            return;
        }
        nameError = false;
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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div id="lv-member-editor" class="lv-card lv-member-editor" role="region" aria-labelledby="lv-member-editor-title" hidden={!editorOpen} onkeydown={(e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}>
    <div class="lv-member-editor-head">
        <div>
            <h2 id="lv-member-editor-title">{editId ? t("members.editing") : t("add")}</h2>
            <p>{editId ? t("members.editing") : t("settings.membersHint")}</p>
        </div>
        <button type="button" class="lv-iconbtn lv-member-editor-close" aria-label={t("cancel")} title={t("cancel")} onclick={cancelEdit} disabled={memberSaving}><UiIcon name="close" size={16} /></button>
    </div>
    <div class="lv-member-editor-fields">
        <div class="lv-member-field">
            <label for="lv-member-name-input">{t("members.name")} *</label>
            <input bind:this={nameInput} id="lv-member-name-input" type="text" class="b3-text-field" placeholder={t("members.name")} aria-label={t("members.name")} bind:value={name} disabled={memberSaving}
                aria-invalid={nameError} aria-describedby={nameError ? "lv-member-name-error" : undefined}
                oninput={() => { if (nameError) nameError = false; }}
                onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) save(); }} />
            {#if suggestedNames.length > 0 && !editId}
                <div class="lv-member-suggest-chips" aria-label={t("members.suggestAppellations")}>
                    {#each suggestedNames as sug (sug)}
                        <button type="button" class="lv-chip sm lv-member-sug-btn" onclick={() => { name = sug; nameInput?.focus(); }}>
                            {sug}
                        </button>
                    {/each}
                </div>
            {/if}
            {#if nameError}
                <small id="lv-member-name-error" class="lv-record-field-error" role="alert">{t("ledger.nameRequired")}</small>
            {/if}
        </div>
        <div class="lv-member-field">
            <label for="lv-member-role-select">{t("members.role")}</label>
            <select id="lv-member-role-select" class="b3-select" bind:value={role} aria-label={t("members.role")} disabled={memberSaving}>
                {#each roles as r (r)}<option value={r}>{t(`role.${r}`)}</option>{/each}
            </select>
        </div>
        <div class="lv-member-field">
            <label for="lv-member-sex-select">{t("members.sex")}</label>
            <select id="lv-member-sex-select" class="b3-select" bind:value={sex} aria-label={t("members.sex")} disabled={memberSaving}>
                <option value="">{t("members.sex.unknown")}</option>
                <option value="male">{t("members.sex.male")}</option>
                <option value="female">{t("members.sex.female")}</option>
            </select>
        </div>
        <div class="lv-member-field">
            <label for="lv-member-birthday-input">{t("members.birthday")}</label>
            <input id="lv-member-birthday-input" class="b3-text-field" type="date" title={t("members.birthday")} aria-label={t("members.birthday")} bind:value={birthday} disabled={memberSaving} />
        </div>
        <label class="lv-member-check" for="lv-member-lunar-checkbox">
            <input id="lv-member-lunar-checkbox" type="checkbox" class="b3-checkbox" bind:checked={lunar} aria-label={t("members.lunar")} disabled={memberSaving} />{t("members.lunar")}
        </label>
        <div class="lv-member-field lv-member-field-wide">
            <label for="lv-member-notes-input">{t("members.notes")}</label>
            <textarea id="lv-member-notes-input" class="b3-text-field" rows="2" bind:value={notes} aria-label={t("members.notes")} disabled={memberSaving}></textarea>
        </div>
        <div class="lv-member-editor-actions">
            {#if editId && onPickAvatar}
                <button type="button" class="b3-button b3-button--outline lv-btn-text-sm"
                    title={t("members.uploadAvatar")}
                    aria-label={t("members.uploadAvatar")}
                    onclick={onPickAvatar}
                    disabled={memberSaving}>
                    <UiIcon name="camera" size={12} /> {t("field.avatar")}
                </button>
            {/if}
            {#if editId}
                {@const editingMember = (plugin.settings?.members ?? []).find((m: any) => m.id === editId)}
                {@const contactMatch = editingMember?.contactSnapshot?.match(/\[(.*?)\]$/)}
                {#if contactMatch && contactMatch[1]}
                    <button type="button" class="b3-button b3-button--text lv-tx-accent lv-btn-text-sm"
                        title={t("members.openContactDoc")}
                        onclick={() => plugin.showTabDocs?.(contactMatch[1])}>
                        <UiIcon name="link" size={12} /> {t("members.openContactDoc")}
                    </button>
                {/if}
            {/if}
            <span class="fn__flex-1"></span>
            {#if editorOpen}
                <button type="button" class="b3-button b3-button--outline" onclick={cancelEdit} disabled={memberSaving}>{t("cancel")}</button>
            {/if}
            <button type="button" class="lv-btn primary sm" onclick={save} disabled={memberSaving} aria-busy={memberSaving}>
                {#if !editId}<UiIcon name="add" size={13} /> {/if}{memberSaving ? t("ledger.saving") : editId ? t("save") : t("add")}
            </button>
        </div>
    </div>
</div>

