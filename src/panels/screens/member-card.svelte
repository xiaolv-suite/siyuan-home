<script lang="ts">
    import type { FamilyMember, Reminder } from "@/types";
    import type { HomePluginLike } from "@/types/plugin";
    import { Menu } from "siyuan";
    import { memberHue } from "@/core/format";
    import { calculateRetirement } from "@/core/retirement";
    import { getContactsBridge } from "@/libs/contact-picker";
    import ActivityFeed from "../activity-feed.svelte";

    export interface MemberStat {
        chips: { label: string; n: number }[];
        birthday: string | null;
    }

    let {
        member: m,
        plugin,
        t,
        version,
        avatarPath,
        isAvatarBusy = false,
        alerts = [],
        stats = { chips: [], birthday: null },
        contact = null,
        isContactBusy = false,
        reorderBusy = false,
        reassignDisabled = false,
        isFirst = false,
        isLast = false,
        expanded = false,
        isDragOver = false,
        actionBusy = false,
        onToggleExpand,
        onStartEdit,
        onPickAvatar,
        onOpenAssetTimeline,
        onLinkContact,
        onUnlinkContact,
        onMove,
        onDelete,
        onReassign,
        onCompleteAlert,
        onDragStart,
        onDragOver,
        onDragLeave,
        onDrop,
        onDragEnd,
    }: {
        member: FamilyMember;
        plugin: HomePluginLike;
        t: (k: string) => string;
        version?: number;
        avatarPath?: string;
        isAvatarBusy?: boolean;
        alerts?: Reminder[];
        stats?: MemberStat;
        contact?: string | null;
        isContactBusy?: boolean;
        reorderBusy?: boolean;
        reassignDisabled?: boolean;
        isFirst?: boolean;
        isLast?: boolean;
        expanded?: boolean;
        isDragOver?: boolean;
        actionBusy?: boolean;
        onToggleExpand: () => void;
        onStartEdit: () => void;
        onPickAvatar: () => void;
        onOpenAssetTimeline: () => void;
        onLinkContact: () => void;
        onUnlinkContact: () => void;
        onMove: (delta: number) => void;
        onDelete: () => void;
        onReassign: () => void;
        onCompleteAlert: (reminder: Reminder) => void;
        onDragStart?: (e: DragEvent) => void;
        onDragOver?: (e: DragEvent) => void;
        onDragLeave?: () => void;
        onDrop?: (e: DragEvent) => void;
        onDragEnd?: () => void;
    } = $props();

    function openCardMenu(e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = rect.right;
        const y = rect.bottom;
        setTimeout(() => {
            const menu = new Menu("lv-member-card");
            menu.addItem({ label: t("members.edit"), click: () => onStartEdit() });
            const docId = plugin.settings?.dbRefs?.members?.docId;
            if (docId) menu.addItem({ label: t("members.openLedger"), click: () => plugin.showTabDocs?.(docId) });
            menu.addItem({ label: t("members.assetTimeline"), click: () => onOpenAssetTimeline() });
            menu.addItem({ label: t("members.uploadAvatar"), click: () => onPickAvatar() });
            if (contact) {
                menu.addItem({
                    label: t("members.contactUnlink"),
                    click: () => onUnlinkContact(),
                });
            } else if (getContactsBridge()) {
                menu.addItem({
                    label: t("members.contactLink"),
                    click: () => onLinkContact(),
                });
            }
            menu.addItem({ label: t("members.moveUp"), disabled: reorderBusy || isFirst, click: () => onMove(-1) });
            menu.addItem({ label: t("members.moveDown"), disabled: reorderBusy || isLast, click: () => onMove(1) });
            menu.addItem({ label: t("members.reassignThis"), disabled: reassignDisabled, click: () => onReassign() });
            menu.addItem({ label: t("delete"), click: () => onDelete() });
            menu.open({ x, y });
        }, 0);
    }
</script>

<div class="lv-card lv-person" role="group" aria-label={m.name}
    draggable={!reorderBusy}
    ondragstart={(e) => onDragStart?.(e)}
    ondragover={(e) => { e.preventDefault(); onDragOver?.(e); }}
    ondragleave={() => onDragLeave?.()}
    ondrop={(e) => onDrop?.(e)}
    ondragend={() => onDragEnd?.()}
    class:lv-drag-over={isDragOver}>
    <div class="lv-person-head">
        <button class="lv-person-toggle" type="button" aria-expanded={expanded}
            aria-controls={expanded ? `member-details-${m.id}` : undefined}
            aria-label={t("members.toggleDetails").replace("${name}", m.name)}
            onclick={() => onToggleExpand()}>
            {#if avatarPath}
                <img class="lv-avatar lg lv-person-avatar-image" src={new URL(avatarPath, location.origin).href}
                    alt={m.name} width="44" height="44" decoding="async" loading="lazy" />
            {:else}
                <span class="lv-avatar lg lv-person-avatar-fallback" style="background:linear-gradient(135deg, hsl({memberHue(m.id)} 62% 52%), hsl({(memberHue(m.id) + 42) % 360} 62% 40%))">{m.name.slice(0, 1)}</span>
            {/if}
            <div class="lv-person-name">
                <b>{m.name}</b>
                <div class="lv-caption">{t(`role.${m.role}`)}{m.sex ? ` · ${t(`members.sex.${m.sex}`)}` : ""}{m.lunarBirthday ? ` · ${t("members.lunar")}` : ""} {m.birthday ?? ""}</div>
            </div>
        </button>
        <button class="lv-iconbtn" title={t("members.uploadAvatar")} aria-label={t("members.uploadAvatar")}
            disabled={isAvatarBusy} aria-busy={isAvatarBusy}
            onclick={() => onPickAvatar()}>{isAvatarBusy ? "…" : "头像"}</button>
        <button class="b3-button b3-button--text lv-member-edit" onclick={() => onStartEdit()}>{t("members.edit")}</button>
        <button class="b3-button b3-button--text" title={t("members.moreActions")} aria-label={t("members.moreActions")}
            onclick={(e) => openCardMenu(e)}>⋯</button>
    </div>
    {#if m.syncError}
        <div class="lv-caption lv-member-sync-error" role="alert">{t("members.syncError")}: {m.syncError}</div>
    {/if}
    {#if stats.chips.length > 0 || stats.birthday}
        <div class="lv-person-info">
            {#each stats.chips as c (c.label)}
                <span class="lv-badge gray">{c.label} <b class="lv-num">{c.n}</b></span>
            {/each}
            {#if stats.birthday}
                <span class="lv-badge lv-member-birthday">生日 · {stats.birthday}</span>
            {/if}
        </div>
    {/if}
    {#if alerts.length > 0}
        <button type="button" class="lv-person-alert"
            style="background:none;border:none;padding:0;cursor:pointer;font:inherit;text-align:left;display:inline-flex;align-items:center;gap:6px"
            title="点击展开该成员详情与到期提醒"
            onclick={() => { if (!expanded) onToggleExpand(); }}>
            <span>⚠️ 需关注 · <b>{alerts.length}</b> {alerts.length === 1 ? t("dash.needAttentionOne") : t("dash.needAttention")}</span>
            <span class="lv-caption" style="color:var(--lv-warn);font-size:11px">→</span>
        </button>
    {/if}
    {#if expanded}
        <div id={`member-details-${m.id}`} class="lv-person-expanded" style="border-top:1px solid var(--lv-line);padding-top:10px;display:flex;flex-direction:column;gap:6px">
            {#if m.notes}<p class="lv-member-notes">{m.notes}</p>{/if}
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <button class="b3-button b3-button--text" disabled={reorderBusy || isFirst} aria-busy={reorderBusy} onclick={() => onMove(-1)}>{reorderBusy ? t("ledger.saving") : t("members.moveUp")}</button>
                <button class="b3-button b3-button--text" disabled={reorderBusy || isLast} aria-busy={reorderBusy} onclick={() => onMove(1)}>{reorderBusy ? t("ledger.saving") : t("members.moveDown")}</button>
                {#if plugin.settings?.dbRefs?.members?.docId}
                    <button class="b3-button b3-button--text" onclick={() => plugin.showTabDocs?.(plugin.settings.dbRefs.members.docId)}>{t("members.openLedger")}</button>
                {/if}
                <button class="b3-button b3-button--text" onclick={() => onDelete()}>{t("delete")}</button>
            </div>
            {#if contact}
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="lv-caption lv-member-contact" title={contact ?? ""}>{t("field.contact")}: {contact.split(" [")[0]}</span>
                    <span style="flex:1"></span>
                    <button class="b3-button b3-button--text" disabled={isContactBusy} onclick={() => onUnlinkContact()}>{t("members.contactUnlink")}</button>
                </div>
            {:else if getContactsBridge()}
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="lv-caption">{t("members.contactLink")}</span>
                    <span style="flex:1"></span>
                    <button class="b3-button b3-button--text" disabled={isContactBusy} onclick={() => onLinkContact()}>{t("members.contactLink")}</button>
                </div>
            {/if}
            {#if alerts.length === 0}
                <span class="lv-caption">{t("dash.allClear")}</span>
            {:else}
                {#each alerts as r (r.id)}
                    <div style="display:flex;gap:8px;align-items:center;font-size:12.5px">
                        <span class="lv-badge {r.level === 'overdue' ? 'red' : r.level === 'soon' ? 'orange' : 'yellow'}">{r.dueDate}</span>
                        <span>{r.title}</span>
                        <span style="flex:1"></span>
                        <button class="b3-button b3-button--text" disabled={actionBusy} aria-busy={actionBusy} onclick={() => onCompleteAlert(r)}>{actionBusy ? t("ledger.saving") : t("act.done")}</button>
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
                    onclick={() => onOpenAssetTimeline()}>
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

<style>
    .lv-person { min-width: 0; }
    .lv-person-head { cursor: default; }
    .lv-person-toggle { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; background: transparent; border: 0; padding: 0; color: inherit; text-align: left; font: inherit; cursor: pointer; }
    .lv-person-avatar-image { width: 44px; height: 44px; object-fit: cover; flex-shrink: 0; }
    .lv-person-avatar-fallback { flex-shrink: 0; }
    .lv-person-head .lv-iconbtn,
    .lv-person-head .lv-member-edit,
    .lv-person-head > .b3-button { display: inline-flex !important; }
    .lv-person-head .lv-iconbtn { width: auto; min-width: 42px; padding-inline: 7px; font-size: 11px; border-color: var(--lv-line); }
    .lv-person-head .lv-member-edit { min-height: 30px; padding-inline: 7px; }
    .lv-person-head > .b3-button[title] { width: 30px; min-width: 30px; padding-inline: 0; }
    .lv-person-head > .b3-button[title] { font-size: 17px; line-height: 1; }
    .lv-person-head > .b3-button[title] { color: var(--lv-tx-2); }
    .lv-person-head > .b3-button[title]:hover { color: var(--lv-tx); background: var(--lv-surface-2); }
    .lv-member-notes { margin: 0; color: var(--lv-tx-2); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .lv-member-contact { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-member-sync-error { color: var(--lv-danger); }
    .lv-member-birthday { color: var(--lv-accent); background: var(--lv-accent-soft); }
    .lv-drag-over { outline: 2px dashed var(--lv-accent); outline-offset: -2px; }

    @container lv-home (max-width: 420px) {
        .lv-person-head { align-items: flex-start; flex-wrap: wrap; }
        .lv-person-toggle { min-width: calc(100% - 12px); }
        .lv-person-head .lv-iconbtn,
        .lv-person-head .lv-member-edit,
        .lv-person-head > .b3-button[title] { margin-top: 2px; }
    }

    @media (prefers-reduced-motion: reduce) {
        .lv-person-expanded { animation: none; }
    }
</style>
