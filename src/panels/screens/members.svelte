<script lang="ts">
    import type { Reminder, FamilyMember } from "@/types";
    import { Menu, showMessage, Dialog } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import { removeMember } from "@/core/members";
    import { renderLedgerAll, setCell, uploadAsset } from "@/core/siyuan";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { memberHue } from "@/core/format";
    import { openContactPicker, getContactsBridge } from "@/libs/contact-picker";
    import { calculateRetirement } from "@/core/retirement";
    import MemberFormEditor from "./member-form-editor.svelte";
    import { openMemberReassignDialog, exportMemberVcf } from "@/core/member-dialogs";
    import UiIcon from "@/ui/icon.svelte";
    import ActivityFeed from "../activity-feed.svelte";

    let { plugin, t, version }: { plugin: HomePluginLike; t: (k: string) => string; version?: number } = $props();

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
            showMessage(t("members.avatarFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
        catch (e) { showMessage(t("hub.actionFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error"); }
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
    // 菜单从卡片内的明确按钮打开，键盘和触屏都能发现排序、删除等操作。
    function cardMenu(m: FamilyMember, x: number, y: number) {
        // 思源 3.8.x 的 document click 清理会在当前点击传播期间清空共享 Menu 容器，
        // 延迟到宏任务后再创建，避免“更多操作”打开空菜单。
        setTimeout(() => {
            const menu = new Menu("lv-member-card");
            menu.addItem({ label: t("members.edit"), click: () => startEdit(m) });
            const docId = plugin.settings.dbRefs?.members?.docId;
            if (docId) menu.addItem({ label: t("members.openLedger"), click: () => plugin.showTabDocs(docId) });
            // 296 波：个人资产与合约全景时间轴
            menu.addItem({ label: t("members.assetTimeline"), click: () => void openMemberAssetTimeline(m) });
            // 225 波：头像上传/联系人绑定收入菜单（头行只留编辑，修复 230px 窄卡按钮挤爆姓名排版）
            menu.addItem({ label: t("members.uploadAvatar"), click: () => pickAvatar(m) });
            if (contactOf(m)) {
                menu.addItem({
                    label: t("members.contactUnlink"),
                    click: () => void unlinkContact(m),
                });
            } else if (getContactsBridge()) {
                menu.addItem({
                    label: t("members.contactLink"),
                    click: () => linkContact(m),
                });
            }
            // 17 组/197 波：上移/下移（拖拽排序的键盘可达替代）
            const idx = members.findIndex((x) => x.id === m.id);
            menu.addItem({ label: t("members.moveUp"), disabled: reorderBusy || idx <= 0, click: () => move(m, -1) });
            menu.addItem({ label: t("members.moveDown"), disabled: reorderBusy || idx === members.length - 1, click: () => move(m, 1) });
            menu.addItem({ label: t("members.reassignThis"), disabled: reassignBusy || members.length <= 1, click: () => openReassignDialog(m) });
            menu.addItem({ label: t("delete"), click: () => confirmRemove(m) });
            menu.open({ x, y });
        }, 0);
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
            showMessage(t("members.reorderFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
    function openCardMenu(m: FamilyMember, e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        cardMenu(m, rect.right, rect.bottom);
    }
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
                showMessage(t("ledger.saveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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
            if (removed && followupError) showMessage(t("members.deleteFollowupFailed").replace("${msg}", followupError instanceof Error ? followupError.message : String(followupError)), 6000, "error");
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
            showMessage(t("members.contactSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
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

    // 296波：重要证件与合同的个人资产全景时间轴
    async function openMemberAssetTimeline(m: FamilyMember) {
        try {
            const { openMemberTimelineFlow } = await import("@/core/member-timeline");
            await openMemberTimelineFlow(m, plugin, t, Dialog, showMessage);
        } catch (e) {
            showMessage(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
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
<div class="lv-hero lv-members-hero">
    <div class="lv-hero-copy">
        <h1>{t("members.title")}</h1>
        <p class="lv-hero-lead">{t("settings.membersHint")}</p>
    </div>
    <div class="lv-hero-tools" style="display:flex;align-items:center;gap:16px">
        <div class="lv-members-hero-count">
            <b class="lv-num">{members.length}</b><span>{t("members.title")}</span>
        </div>
        {#if memberAlertCount > 0}
            <div class="lv-members-hero-count" style="border-left:1px solid var(--lv-line);padding-left:16px">
                <b class="lv-num" style="color:var(--lv-warn)">{memberAlertCount}</b><span>{t("dash.needAttention")}</span>
            </div>
        {/if}
    </div>
</div>

<div class="lv-member-tools" style="display:flex;align-items:center;gap:10px;margin:12px 0">
    <button class={editorOpen ? "b3-button b3-button--outline" : "lv-btn primary"}
        aria-expanded={editorOpen} aria-controls="lv-member-editor"
        onclick={editorOpen ? cancelEdit : startNewMember}>
        {#if !editorOpen}<UiIcon name="add" size={15} />{/if}{editorOpen ? t("cancel") : t("add")}
    </button>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline" onclick={() => openReassignDialog()} disabled={members.length === 0 || reassignBusy} aria-busy={reassignBusy}>
        {reassignBusy ? t("ledger.saving") : t("members.reassign")}
    </button>
    <button class="b3-button b3-button--outline" onclick={exportVcf} disabled={members.length === 0 || exportingVcf} aria-busy={exportingVcf}>
        {exportingVcf ? t("ledger.saving") : t("members.exportVcf")}
    </button>
</div>

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
    onSaved={async () => {
        await plugin.refreshHub?.(undefined, true);
    }}
    onCancel={cancelEdit}
/>

{#if members.length === 0 && !editorOpen}
    <div class="lv-card"><div class="lv-empty" role="status">
        <div class="eic" aria-hidden="true"><UiIcon name="users" size={24} /></div>
        <b>{t("members.empty")}</b>
        <span>{t("members.emptyHint")}</span>
        <button class="lv-btn primary" style="margin-top:8px" onclick={startNewMember}>
            <UiIcon name="add" size={15} /> ＋ {t("add")}
        </button>
    </div></div>
{:else}
    <div class="lv-people">
        {#each members as m (m.id)}
            <div class="lv-card lv-person" role="group" aria-label={m.name}
            draggable={!reorderBusy}
            ondragstart={(e: DragEvent) => onDragStart(m, e)}
            ondragover={(e: DragEvent) => { e.preventDefault(); dragOverId = m.id; }}
            ondragleave={() => { if (dragOverId === m.id) dragOverId = null; }}
            ondrop={(e: DragEvent) => void onDrop(m, e)}
            ondragend={() => { dragId = null; dragOverId = null; }}
            class:lv-drag-over={dragOverId === m.id && dragId !== m.id}>
        <div class="lv-person-head">
            <button class="lv-person-toggle" type="button" aria-expanded={expandedId === m.id}
                aria-controls={expandedId === m.id ? `member-details-${m.id}` : undefined} aria-label={t("members.toggleDetails").replace("${name}", m.name)}
                onclick={() => toggleExpand(m.id)}
                >
            {#if avatars[m.id]}
                <!-- 17 组/192 波：头像图（资产相对路径 → 内核 origin） -->
                <img class="lv-avatar lg lv-person-avatar-image" src={new URL(avatars[m.id], location.origin).href}
                    alt={m.name} width="44" height="44" decoding="async" loading="lazy" />
            {:else}
                <!-- 225 波：个性化色相（id 哈希 → 稳定渐变），与总览 chips 同源 -->
                <span class="lv-avatar lg lv-person-avatar-fallback" style="background:linear-gradient(135deg, hsl({memberHue(m.id)} 62% 52%), hsl({(memberHue(m.id) + 42) % 360} 62% 40%))">{m.name.slice(0, 1)}</span>
            {/if}
            <div class="lv-person-name">
                <b>{m.name}</b>
                <div class="lv-caption">{t(`role.${m.role}`)}{m.sex ? ` · ${t(`members.sex.${m.sex}`)}` : ""}{m.lunarBirthday ? ` · ${t("members.lunar")}` : ""} {m.birthday ?? ""}</div>
            </div>
            </button>
            <!-- 操作保持常显，鼠标、键盘和触屏均能直接发现。 -->
            <button class="lv-iconbtn" title={t("members.uploadAvatar")} aria-label={t("members.uploadAvatar")}
                disabled={avatarBusy.has(m.id)} aria-busy={avatarBusy.has(m.id)}
                onclick={() => pickAvatar(m)}>{avatarBusy.has(m.id) ? "…" : "头像"}</button>
            <button class="b3-button b3-button--text lv-member-edit" onclick={() => startEdit(m)}>{t("members.edit")}</button>
            <button class="b3-button b3-button--text" title={t("members.moreActions")} aria-label={t("members.moreActions")}
                onclick={(e) => openCardMenu(m, e)}>⋯</button>
        </div>
        {#if m.syncError}
            <div class="lv-caption lv-member-sync-error" role="alert">{t("members.syncError")}: {m.syncError}</div>
        {/if}
        {#if statsOf(m.id).chips.length > 0 || statsOf(m.id).birthday}
            {@const s = statsOf(m.id)}
            <div class="lv-person-info">
                {#each s.chips as c (c.label)}
                    <!-- 259 波：统计 chips 归入 lv 徽章体系（b3-chip 的黄绿底与三级文字层次冲突） -->
                    <span class="lv-badge gray">{c.label} <b class="lv-num">{c.n}</b></span>
                {/each}
                {#if s.birthday}
                    <!-- 17 组/219 波：生日倒计时 chip（单遍预计算，数据来自提醒中枢既有派生） -->
                    <span class="lv-badge lv-member-birthday">生日 · {s.birthday}</span>
                {/if}
            </div>
        {/if}
        {#if alertsFor(m.id).length > 0}
            <button type="button" class="lv-person-alert"
                style="background:none;border:none;padding:0;cursor:pointer;font:inherit;text-align:left;display:inline-flex;align-items:center;gap:6px"
                title="点击展开该成员详情与到期提醒"
                onclick={() => { if (expandedId !== m.id) toggleExpand(m.id); }}>
                <span>⚠️ 需关注 · <b>{alertsFor(m.id).length}</b> {alertsFor(m.id).length === 1 ? t("dash.needAttentionOne") : t("dash.needAttention")}</span>
                <span class="lv-caption" style="color:var(--lv-warn);font-size:11px">→</span>
            </button>
        {/if}
        {#if expandedId === m.id}
            <!-- 260 波：展开区入场动画（对齐抽屉编排语言；lv-rise 180ms） -->
            <div id={`member-details-${m.id}`} class="lv-person-expanded" style="border-top:1px solid var(--lv-line);padding-top:10px;display:flex;flex-direction:column;gap:6px">
                {#if m.notes}<p class="lv-member-notes">{m.notes}</p>{/if}
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                    <button class="b3-button b3-button--text" disabled={reorderBusy || members.findIndex((x) => x.id === m.id) <= 0} aria-busy={reorderBusy} onclick={() => void move(m, -1)}>{reorderBusy ? t("ledger.saving") : t("members.moveUp")}</button>
                    <button class="b3-button b3-button--text" disabled={reorderBusy || members.findIndex((x) => x.id === m.id) >= members.length - 1} aria-busy={reorderBusy} onclick={() => void move(m, 1)}>{reorderBusy ? t("ledger.saving") : t("members.moveDown")}</button>
                    {#if plugin.settings.dbRefs?.members?.docId}
                        <button class="b3-button b3-button--text" onclick={() => plugin.showTabDocs(plugin.settings.dbRefs.members.docId)}>{t("members.openLedger")}</button>
                    {/if}
                    <button class="b3-button b3-button--text" onclick={() => confirmRemove(m)}>{t("delete")}</button>
                </div>
                {#if contactOf(m)}
                    <div style="display:flex;gap:8px;align-items:center">
                        <span class="lv-caption lv-member-contact" title={contactOf(m) ?? ""}>{t("field.contact")}: {contactOf(m)?.split(" [")[0]}</span>
                        <span style="flex:1"></span>
                        <button class="b3-button b3-button--text" disabled={!!contactBusy[m.id]} onclick={() => void unlinkContact(m)}>{t("members.contactUnlink")}</button>
                    </div>
                {:else if getContactsBridge()}
                    <div style="display:flex;gap:8px;align-items:center">
                        <span class="lv-caption">{t("members.contactLink")}</span>
                        <span style="flex:1"></span>
                        <button class="b3-button b3-button--text" disabled={!!contactBusy[m.id]} onclick={() => linkContact(m)}>{t("members.contactLink")}</button>
                    </div>
                {/if}
                {#if alertsFor(m.id).length === 0}
                    <span class="lv-caption">{t("dash.allClear")}</span>
                {:else}
                    {#each alertsFor(m.id) as r (r.id)}
                        <div style="display:flex;gap:8px;align-items:center;font-size:12.5px">
                            <span class="lv-badge {r.level === 'overdue' ? 'red' : r.level === 'soon' ? 'orange' : 'yellow'}">{r.dueDate}</span>
                            <span>{r.title}</span>
                            <span style="flex:1"></span>
                            <button class="b3-button b3-button--text" disabled={memberActionBusy.has(r.id)} aria-busy={memberActionBusy.has(r.id)} onclick={() => void runMemberAction(r.id, () => plugin.complete(r))}>{memberActionBusy.has(r.id) ? t("ledger.saving") : t("act.done")}</button>
                        </div>
                    {/each}
                {/if}
                {#if m.birthday}
                    {@const ret = calculateRetirement({ birthday: m.birthday, sex: m.sex })}
                    {#if ret}
                        <div class="lv-member-retire-card" style="padding:10px 14px;background:var(--lv-surface-2);border-radius:8px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:7px;font-size:12px;margin:6px 0">
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <span style="font-weight:600;color:var(--lv-tx)">{t("members.retirementTitle")}</span>
                                {#if ret.isRetired}
                                    <span class="lv-badge green">{t("members.retirementRetired")}</span>
                                {:else}
                                    <span class="lv-badge orange">{t("members.retirementDaysLeft").replace("${n}", String(ret.daysLeft))}</span>
                                {/if}
                            </div>
                            <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                                <span>{t("members.retirementTarget")}: <b>{ret.targetRetireDate}</b> ({t("members.retirementAge").replace("${age}", String(ret.targetRetireAge))}{ret.delayedMonths > 0 ? ` · ${t("members.retirementDelay").replace("${n}", String(ret.delayedMonths))}` : ""})</span>
                                <span>{t("members.retirementCareerProgress")}: {ret.careerProgressPercent}%</span>
                            </div>
                            <div style="height:6px;border-radius:3px;background:var(--lv-line);overflow:hidden;width:100%">
                                <div style="height:100%;background:linear-gradient(90deg, var(--lv-accent), #f59e0b);width:{ret.careerProgressPercent}%;border-radius:3px;transition:width .3s ease"></div>
                            </div>
                        </div>
                    {/if}
                {/if}
                <div class="lv-member-timeline-card" style="margin:4px 0">
                    <button class="b3-button b3-button--outline" style="width:100%;font-size:12px;padding:6px 12px;display:flex;align-items:center;justify-content:space-between;border-radius:6px"
                        onclick={() => void openMemberAssetTimeline(m)}>
                        <span style="display:flex;align-items:center;gap:6px">
                            <span style="font-size:13px">📑</span>
                            <b style="color:var(--lv-tx)">{t("members.assetTimeline")}</b>
                        </span>
                        <span class="lv-caption" style="display:flex;align-items:center;gap:4px">
                            <span>{t("members.timelineCertsCount")} / {t("members.timelineContractsCount")}</span>
                            <span>→</span>
                        </span>
                    </button>
                </div>
                <ActivityFeed {plugin} {t} {version} memberId={m.id} compact />
            </div>
        {/if}
            </div>
        {/each}
    </div>
{/if}
<input type="file" accept="image/*" style="display:none" bind:this={avatarInput} onchange={(e) => void onAvatarPicked(e)} />
</div>

<style>
    .lv-members-screen {
        --member-gap: 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .lv-members-hero {
        margin-top: 10px;
        margin-bottom: 0;
        align-items: center;
    }

    .lv-members-hero-count {
        display: flex;
        align-items: baseline;
        gap: 7px;
        margin-left: auto;
        color: var(--lv-tx-3);
    }

    .lv-members-hero-count b { color: var(--lv-tx); font-size: 30px; font-weight: 600; }
    .lv-members-hero-count span { font-size: 12px; }

    .lv-member-tools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin: 0 2px 14px; }
    .lv-member-tools > button { min-height: 40px; }
    .lv-member-notes { margin: 0; color: var(--lv-tx-2); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }

    .lv-members-screen .lv-people { gap: var(--member-gap); }
    .lv-members-screen .lv-person { min-width: 0; }
    .lv-members-screen .lv-person-head { cursor: default; }
    .lv-members-screen .lv-person-toggle { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; background: transparent; border: 0; padding: 0; color: inherit; text-align: left; font: inherit; cursor: pointer; }
    .lv-members-screen .lv-person-avatar-image { width: 44px; height: 44px; object-fit: cover; flex-shrink: 0; }
    .lv-members-screen .lv-person-avatar-fallback { flex-shrink: 0; }
    .lv-members-screen .lv-person-head .lv-iconbtn,
    .lv-members-screen .lv-person-head .lv-member-edit,
    .lv-members-screen .lv-person-head > .b3-button { display: inline-flex !important; }
    .lv-members-screen .lv-person-head .lv-iconbtn { width: auto; min-width: 42px; padding-inline: 7px; font-size: 11px; border-color: var(--lv-line); }
    .lv-members-screen .lv-person-head .lv-member-edit { min-height: 30px; padding-inline: 7px; }
    .lv-members-screen .lv-person-head > .b3-button[title] { width: 30px; min-width: 30px; padding-inline: 0; }
    .lv-members-screen .lv-person-head > .b3-button[title] { font-size: 17px; line-height: 1; }
    .lv-members-screen .lv-person-head > .b3-button[title] { color: var(--lv-tx-2); }
    .lv-members-screen .lv-person-head > .b3-button[title]:hover { color: var(--lv-tx); background: var(--lv-surface-2); }
    .lv-members-screen .lv-member-contact { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-members-screen .lv-member-sync-error { color: var(--lv-danger); }
    .lv-members-screen .lv-member-birthday { color: var(--lv-accent); background: var(--lv-accent-soft); }
    .lv-members-screen .lv-drag-over { outline: 2px dashed var(--lv-accent); outline-offset: -2px; }

    @container lv-home (max-width: 420px) {
        .lv-members-hero-count { display: none; }
        .lv-member-tools > button { min-height: 44px; }
        .lv-members-screen .lv-person-head { align-items: flex-start; flex-wrap: wrap; }
        .lv-members-screen .lv-person-toggle { min-width: calc(100% - 12px); }
        .lv-members-screen .lv-person-head .lv-iconbtn,
        .lv-members-screen .lv-person-head .lv-member-edit,
        .lv-members-screen .lv-person-head > .b3-button[title] { margin-top: 2px; }
    }

    @media (prefers-reduced-motion: reduce) {
        .lv-members-screen .lv-person-expanded { animation: none; }
    }
</style>
