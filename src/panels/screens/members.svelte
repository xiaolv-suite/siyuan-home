<script lang="ts">
    import type { Reminder, FamilyMember } from "@/types";
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { removeMember } from "@/core/members";
    import { renderLedgerAll, setCell, uploadAsset } from "@/core/siyuan";
    import { openNativeAssetPicker } from "@/libs/lv-notice-kit";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { openContactPicker, getContactsBridge } from "@/libs/contact-picker";
    import MemberFormEditor from "./member-form-editor.svelte";
    import MemberCard from "./member-card.svelte";
    import MembersHeader from "./members-header.svelte";
    import { openMemberReassignDialog, exportMemberVcf } from "@/core/member-dialogs";
    import UiIcon from "@/ui/icon.svelte";

    let { plugin, t, version }: { plugin: HomePluginLike; t: (k: string) => string; version?: number } = $props();
    const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

    let orderVersion = $state(0);
    // version（H02）：hub 变更时递增，驱动派生重算（plugin.* 为普通对象引用）
    const members = $derived.by(() => {
        void version;
        void orderVersion;
        return plugin.settings.members ?? [];
    });
    const reminders = $derived.by(() => {
        void version;
        return plugin.scan?.reminders ?? [];
    });
    // 176 波性能：按成员一次预分组（模板内每卡多次调用 alertsFor，此前每次全量 filter）
    const alertsByMember = $derived.by(() => {
        void version;
        const map = new Map<string, Reminder[]>();
        for (const r of reminders) {
            if (!r.memberId) continue;
            let g = map.get(r.memberId);
            if (!g) { g = []; map.set(r.memberId, g); }
            g.push(r);
        }
        return map;
    });
    const alertsFor = (id: string) => alertsByMember.get(id) ?? [];
    const memberAlertCount = $derived.by(() => {
        void version;
        let count = 0;
        for (const m of members) count += alertsFor(m.id).length;
        return count;
    });
    // （215 波的 birthdaySoon 于 219 波并入下方 memberStats 单遍派生，附 0/1 天文案修正）

    // 17 组/192 波：成员头像（E14/E15 实测形状）——资产存成员台账行 mAsset 列（台账为事实源，settings 不存）。
    // avatars: memberId → 资产相对路径；version 驱动加载（成员行量小，全量读）。
    let avatars = $state<Record<string, string>>({});
    $effect(() => {
        void version;
        let alive = true;
        (async () => {
            const ref = plugin.settings.dbRefs?.members;
            const avatarKey = ref?.columns?.avatar;
            if (!ref?.avId || !avatarKey) return;
            try {
                const read = await renderLedgerAll(ref.avId);
                const map: Record<string, string> = {};
                for (const m of plugin.settings.members ?? []) {
                    if (!m.avItemId) continue;
                    const row = read.rows.find((r) => r.itemID === m.avItemId);
                    const p = row?.cells[avatarKey]?.mAsset?.[0]?.content;
                    if (p) map[m.id] = p;
                }
                if (alive) avatars = map;
            } catch { /* 读不到就维持首字母头像，不弹错 */ }
        })();
        return () => { alive = false; };
    });
    let avatarInput: HTMLInputElement | undefined = $state();
    let avatarTarget: FamilyMember | null = null;
    let avatarBusy = $state<Set<string>>(new Set());
    function pickAvatar(m: FamilyMember) {
        if (!m.avItemId) { showMessage(t("members.avatarNoRow"), 4000, "info"); return; }
        avatarTarget = m;
        avatarInput?.click();
    }
    async function onAvatarPicked(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        const m = avatarTarget;
        if (!file || !m?.avItemId) return;
        if (avatarBusy.has(m.id)) return;
        const ref = plugin.settings.dbRefs?.members;
        const avatarKey = ref?.columns?.avatar;
        if (!ref?.avId || !avatarKey) return;
        avatarBusy = new Set([...avatarBusy, m.id]);
        const operationKey = (() => {
            try { return `member-avatar:${crypto.randomUUID()}`; }
            catch { return `member-avatar:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
        })();
        try {
            const { name, path } = await uploadAsset(file, "/assets/siyuan-home/", { idempotencyKey: `${operationKey}:upload`, retries: 1 });
            await setCell(ref.avId, avatarKey, m.avItemId, { type: "mAsset", mAsset: [{ content: path, name }] }, {
                idempotencyKey: `${operationKey}:cell`,
                retries: 1,
            });
            avatars = { ...avatars, [m.id]: path };
            showMessage(t("members.avatarUploaded").replace("${name}", m.name), 2500, "info");
        } catch (e) {
            showMessage(t("members.avatarFailed").replace("${msg}", errText(e)), 5000, "error");
        } finally {
            const next = new Set(avatarBusy);
            next.delete(m.id);
            avatarBusy = next;
        }
    }
    async function pickAssetAvatar(m: FamilyMember) {
        if (!m.avItemId) { showMessage(t("members.avatarNoRow"), 4000, "info"); return; }
        const res = await openNativeAssetPicker();
        if (!res?.path) return;
        const path = res.path.trim();
        const name = path.replace(/^.*[\\/]/, "") || "avatar.png";
        const ref = plugin.settings.dbRefs?.members;
        const avatarKey = ref?.columns?.avatar;
        if (!ref?.avId || !avatarKey) return;
        avatarBusy = new Set([...avatarBusy, m.id]);
        try {
            await setCell(ref.avId, avatarKey, m.avItemId, { type: "mAsset", mAsset: [{ content: path, name }] });
            avatars = { ...avatars, [m.id]: path };
            showMessage(t("members.avatarUploaded").replace("${name}", m.name), 2500, "info");
        } catch (e) {
            showMessage(t("members.avatarFailed").replace("${msg}", errText(e)), 5000, "error");
        } finally {
            const next = new Set(avatarBusy);
            next.delete(m.id);
            avatarBusy = next;
        }
    }
    // C5a 统计 chips + 17 组/219 波生日倒计时：单遍预计算（原 statChips/birthdaySoon
    // 每成员每次渲染重复 filter+sort；现 alertsByMember 变化时单遍派生 Map）
    // 264 波：chips 语义升级——台账行数（档案数，对齐原型 person .stats 三格），
    // 数据源 cache.byModule[].memberCounts（随扫描快照）；此前只数"有提醒的"成员，无提醒即空卡
    interface MemberStat { chips: { label: string; n: number }[]; birthday: string | null; }
    const memberStats = $derived.by(() => {
        void version;
        const byModule = plugin.runtime?.cache?.byModule ?? {};
        const map = new Map<string, MemberStat>();
        for (const m of members) {
            const counts: { label: string; n: number }[] = [];
            for (const [mid, entry] of Object.entries(byModule)) {
                const n = entry?.memberCounts?.[m.id] ?? 0;
                if (n > 0) counts.push({ label: t(`module.${mid}`) !== `module.${mid}` ? t(`module.${mid}`) : mid, n });
            }
            counts.sort((a, b) => b.n - a.n);
            const chips = counts.slice(0, 3);
            // 生日倒计时仍走提醒派生（alertsByMember）
            const alerts = alertsByMember.get(m.id) ?? [];
            const hit = alerts
                .filter((r) => r.ruleKey === "birthday" && r.daysLeft <= 30)
                .sort((a, b) => a.daysLeft - b.daysLeft)[0];
            let birthday: string | null = null;
            if (hit) {
                birthday = hit.daysLeft < 0
                    ? t("days.overdue").replace("${n}", String(-hit.daysLeft))
                    : hit.daysLeft === 0 ? t("days.today")
                    : hit.daysLeft === 1 ? t("days.tomorrow")
                    : t("days.after").replace("${n}", String(hit.daysLeft));
            }
            map.set(m.id, { chips, birthday });
        }
        return map;
    });
    const statsOf = (id: string): MemberStat => memberStats.get(id) ?? { chips: [], birthday: null };
    let memberActionBusy = $state<Set<string>>(new Set());
    async function runMemberAction(key: string, action: () => Promise<void>) {
        if (memberActionBusy.has(key)) return;
        memberActionBusy = new Set([...memberActionBusy, key]);
        try { await action(); }
        catch (e) { showMessage(t("hub.actionFailed").replace("${msg}", errText(e)), 5000, "error"); }
        finally {
            const next = new Set(memberActionBusy);
            next.delete(key);
            memberActionBusy = next;
        }
    }
    let contactOverrides = $state<Record<string, string | null>>({});
    let contactBusy = $state<Record<string, boolean>>({});
    const contactOf = (m: FamilyMember) => Object.prototype.hasOwnProperty.call(contactOverrides, m.id)
        ? contactOverrides[m.id]
        : m.contactSnapshot;
    // C5b：卡片点击展开该成员提醒明细（含日期与动作）
    let expandedId = $state<string | null>(null);
    function toggleExpand(id: string) {
        expandedId = expandedId === id ? null : id;
    }

    let reorderBusy = $state(false);
    async function persistMemberOrder(ids: string[]) {
        if (reorderBusy) return;
        reorderBusy = true;
        const previous = [...plugin.settings.members];
        try {
            const { reorderMembers } = await import("@/core/members");
            await reorderMembers(plugin as any, plugin.settings, ids);
            orderVersion += 1;
        } catch (e) {
            plugin.settings.members = previous;
            orderVersion += 1;
            showMessage(t("members.reorderFailed").replace("${msg}", errText(e)), 5000, "error");
        } finally {
            reorderBusy = false;
        }
    }
    async function move(m: FamilyMember, delta: number) {
        const ids = members.map((x) => x.id);
        const i = ids.indexOf(m.id);
        const j = i + delta;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await persistMemberOrder(ids);
    }
    // 拖拽排序（17 组/197 波）：HTML5 DnD；drop 即持久化（reorderMembers）
    let dragId = $state<string | null>(null);
    let dragOverId = $state<string | null>(null);
    function onDragStart(m: FamilyMember, e: DragEvent) {
        if (reorderBusy) { e.preventDefault(); return; }
        dragId = m.id;
        e.dataTransfer?.setData("text/plain", m.id);
    }
    async function onDrop(m: FamilyMember, e: DragEvent) {
        e.preventDefault();
        if (reorderBusy) return;
        const src = dragId ?? e.dataTransfer?.getData("text/plain") ?? null;
        dragId = null; dragOverId = null;
        if (!src || src === m.id) return;
        const ids = members.map((x) => x.id);
        const from = ids.indexOf(src);
        const to = ids.indexOf(m.id);
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        await persistMemberOrder(ids);
    }
    // 拖拽异常中断或在卡片外越界释放时的全局防护，彻底消除拖拽状态与悬停高光卡死
    $effect(() => {
        const resetDragState = () => {
            dragId = null;
            dragOverId = null;
        };
        window.addEventListener("dragend", resetDragState);
        window.addEventListener("mouseup", resetDragState);
        return () => {
            window.removeEventListener("dragend", resetDragState);
            window.removeEventListener("mouseup", resetDragState);
        };
    });
    // 26.7 删除文案升级：说明数据保留语义（仅移除引用，台账行保留）
    // H16：删除成员后复位指向它的失效筛选（总览与提醒页）
    function confirmRemove(m: FamilyMember) {
        if (plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 4000, "info");
            return;
        }
        confirm(t("members.deleteTitle"), t("members.deleteBody").replace("${name}", m.name), async () => {
            let removed = false;
            try {
                await removeMember(plugin, plugin.settings, m.id);
                removed = true;
            } catch (e) {
                showMessage(t("ledger.saveFailed").replace("${msg}", errText(e)), 5000, "error");
                return;
            }
            let followupError: unknown;
            try {
                let dirty = false;
                if (plugin.runtime.filterMemberId === m.id) { plugin.runtime.filterMemberId = undefined; dirty = true; }
                if (plugin.runtime.hubMemberId === m.id) { plugin.runtime.hubMemberId = undefined; dirty = true; }
                if (dirty) await saveRuntime(plugin, plugin.runtime);
                // Member rows/settings affect birthday and member-linked
                // reminders; force a fresh scan after the write.
                await plugin.refreshHub(undefined, true);
            } catch (e) {
                followupError = e;
            }
            if (removed && followupError) showMessage(t("members.deleteFollowupFailed").replace("${msg}", errText(followupError)), 6000, "error");
        });
    }

    // D05 成员编辑：点"编辑"填入顶部表单，保存走 updateMember（av 行按 avItemId 精确写回）
    let name = $state("");
    let role = $state<import("@/types").MemberRole>("self");
    let sex = $state<"male" | "female" | undefined>(undefined);
    let birthday = $state("");
    let lunar = $state(false);
    let notes = $state("");
    let editId = $state<string | null>(null);
    let editorOpen = $state(false);
    let editorComp: any;

    function startEdit(m: FamilyMember) {
        editId = m.id;
        editorOpen = true;
        name = m.name;
        role = m.role;
        sex = m.sex;
        birthday = m.birthday ?? "";
        lunar = !!m.lunarBirthday;
        notes = m.notes ?? "";
        expandedId = null;
        requestAnimationFrame(() => {
            editorComp?.focusName?.();
        });
    }

    function startNewMember() {
        cancelEdit();
        editorOpen = true;
        requestAnimationFrame(() => {
            editorComp?.focusName?.();
        });
    }

    // EC14：成员 ↔ 人脉联系人绑定（仅存快照 `名称 [docId]`，不改写人脉数据）
    async function saveContactSnapshot(m: FamilyMember, snapshot: string | undefined) {
        if (contactBusy[m.id]) return;
        const target = (plugin.settings.members ?? []).find((x) => x.id === m.id);
        if (!target) return;
        const previous = target.contactSnapshot;
        contactBusy = { ...contactBusy, [m.id]: true };
        target.contactSnapshot = snapshot;
        try {
            const { saveSettings } = await import("@/core/settings");
            await saveSettings(plugin as any, plugin.settings);
            contactOverrides = { ...contactOverrides, [m.id]: snapshot ?? null };
            showMessage(t(snapshot ? "members.contactLinked" : "members.contactUnlinked"), 2500, "info");
        } catch (e) {
            target.contactSnapshot = previous;
            showMessage(t("members.contactSaveFailed").replace("${msg}", errText(e)), 5000, "error");
        } finally {
            const next = { ...contactBusy };
            delete next[m.id];
            contactBusy = next;
        }
    }
    function linkContact(m: FamilyMember) {
        if (!getContactsBridge()) {
            showMessage(t("ledger.contactsMissing"), 5000, "info");
            return;
        }
        openContactPicker({ t: (k) => t(k), showMessage: (msg, timeout, type) => showMessage(msg, timeout, type) },
            (snapshot) => { void saveContactSnapshot(m, snapshot); });
    }
    async function unlinkContact(m: FamilyMember) {
        if (!contactOf(m)) return;
        await saveContactSnapshot(m, undefined);
    }
    function cancelEdit() {
        editId = null; name = ""; role = "self"; sex = undefined; birthday = ""; lunar = false; notes = "";
        editorOpen = false;
    }

    const hasContactsBridge = $derived(Boolean(getContactsBridge()));

    function handleImportFromContacts() {
        if (!getContactsBridge()) return;
        openContactPicker({ t: (k) => t(k), showMessage: (msg, timeout, type) => showMessage(msg, timeout, type) },
            (snapshot) => {
                const match = snapshot.match(/^(.*?)\s*\[(.*?)\]$/);
                const pName = match ? match[1] : snapshot;
                const existing = (plugin.settings.members ?? []).find((m: any) => m.name.trim() === pName.trim());
                if (existing) {
                    void saveContactSnapshot(existing, snapshot);
                    showMessage(t("members.contactLinked"), 2500, "info");
                    return;
                }
                name = pName.trim();
                role = "other";
                editorOpen = true;
                requestAnimationFrame(() => {
                    editorComp?.focusName?.();
                });
            });
    }

    async function handleMemberSaved() {
        const bridge = getContactsBridge();
        if (bridge?.ensurePerson && name.trim()) {
            try {
                const person = await bridge.ensurePerson(name.trim());
                if (person?.docId) {
                    const target = (plugin.settings.members ?? []).find((m: any) => m.name.trim() === name.trim());
                    if (target && !target.contactSnapshot) {
                        target.contactSnapshot = `${person.name} [${person.docId}]`;
                        const { saveSettings } = await import("@/core/settings");
                        await saveSettings(plugin as any, plugin.settings);
                    }
                }
            } catch { /* soft fallback: non-blocking if contacts unavailable */ }
        }
        await plugin.refreshHub?.(undefined, true);
    }

    // 296波：重要证件与合同的个人资产全景时间轴
    async function openMemberAssetTimeline(m: FamilyMember) {
        try {
            const { openMemberTimelineFlow } = await import("@/core/member-timeline");
            await openMemberTimelineFlow(m, plugin, t, Dialog, showMessage);
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + errText(e) + ")", 5000, "error");
        }
    }

    let exportingVcf = $state(false);
    function exportVcf() {
        if (exportingVcf) return;
        exportingVcf = true;
        try {
            exportMemberVcf({
                members,
                t,
                showMessageFn: showMessage,
                confirmFn: confirm,
            });
        } finally {
            exportingVcf = false;
        }
    }

    let reassignBusy = $state(false);
    function openReassignDialog(fromMember?: FamilyMember) {
        openMemberReassignDialog({
            members,
            fromMember,
            plugin,
            t,
            DialogCls: Dialog,
            showMessageFn: showMessage,
            onReassigned: async () => {
                await plugin.refreshHub?.(undefined, true);
            },
        });
    }
</script>

<div class="lv-members-screen">
<MembersHeader
    {t}
    membersCount={members.length}
    {memberAlertCount}
    {reassignBusy}
    {exportingVcf}
    {editorOpen}
    {hasContactsBridge}
    membersDocId={plugin.settings?.dbRefs?.members?.docId}
    onReassign={() => openReassignDialog()}
    onExportVcf={exportVcf}
    onOpenMembersDoc={() => {
        const docId = plugin.settings?.dbRefs?.members?.docId;
        if (docId) plugin.showTabDocs?.(docId);
    }}
    onImportFromContacts={handleImportFromContacts}
    onToggleEditor={editorOpen ? cancelEdit : startNewMember}
/>

<MemberFormEditor
    bind:this={editorComp}
    bind:editorOpen
    bind:editId
    bind:name
    bind:role
    bind:sex
    bind:birthday
    bind:lunar
    bind:notes
    {plugin}
    {t}
    onSaved={handleMemberSaved}
    onCancel={cancelEdit}
    onPickAvatar={editId ? () => {
        const target = members.find((m) => m.id === editId);
        if (target) pickAvatar(target);
    } : undefined}
/>

{#if members.length === 0 && !editorOpen}
    <div class="lv-card"><div class="lv-empty" role="status">
        <div class="eic" aria-hidden="true"><UiIcon name="users" size={24} /></div>
        <b>{t("members.empty")}</b>
        <span>{t("members.emptyHint")}</span>
        <button type="button" class="lv-btn primary" onclick={startNewMember}>
            <UiIcon name="add" size={15} /> {t("add")}
        </button>
    </div></div>
{:else}
    <div class="lv-people">
        {#each members as m, index (m.id)}
            <MemberCard
                member={m}
                {plugin}
                {t}
                {version}
                avatarPath={avatars[m.id]}
                isAvatarBusy={avatarBusy.has(m.id)}
                alerts={alertsFor(m.id)}
                stats={statsOf(m.id)}
                contact={contactOf(m)}
                isContactBusy={!!contactBusy[m.id]}
                {reorderBusy}
                reassignDisabled={reassignBusy || members.length <= 1}
                isFirst={index === 0}
                isLast={index === members.length - 1}
                expanded={expandedId === m.id}
                isDragOver={dragOverId === m.id && dragId !== m.id}
                actionBusy={memberActionBusy.has(m.id)}
                onToggleExpand={() => toggleExpand(m.id)}
                onStartEdit={() => startEdit(m)}
                onPickAvatar={() => pickAvatar(m)}
                onPickAssetAvatar={() => void pickAssetAvatar(m)}
                onOpenAssetTimeline={() => void openMemberAssetTimeline(m)}
                onLinkContact={() => linkContact(m)}
                onUnlinkContact={() => void unlinkContact(m)}
                onMove={(delta) => void move(m, delta)}
                onDelete={() => confirmRemove(m)}
                onReassign={() => openReassignDialog(m)}
                onCompleteAlert={(r) => void runMemberAction(r.id, () => plugin.complete(r))}
                onDragStart={(e) => onDragStart(m, e)}
                onDragOver={(e) => { e.preventDefault(); dragOverId = m.id; }}
                onDragLeave={() => { if (dragOverId === m.id) dragOverId = null; }}
                onDrop={(e) => void onDrop(m, e)}
                onDragEnd={() => { dragId = null; dragOverId = null; }}
            />
        {/each}
    </div>
{/if}
<input type="file" accept="image/*" class="fn__none" aria-label={t("avatar.photo")} bind:this={avatarInput} onchange={(e) => void onAvatarPicked(e)} />
</div>
