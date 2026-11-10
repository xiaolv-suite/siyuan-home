<script lang="ts">
    import { onMount } from "svelte";
    import UiIcon from "@/ui/icon.svelte";
    import type { UiIconName } from "@/ui/icons";
    import { lvActivity, lvEcosystem, lvLaunchpad, type LvActivityRecord, type LvLaunchpadItem, withDocLock } from "@/libs/notice";
    import { homeNotify, homeInline } from "@/libs/notice";
    import type { HomePluginLike } from "@/types/plugin";

    let {
        plugin,
        t,
        version,
    }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        version?: number;
    } = $props();

    let activities = $state<LvActivityRecord[]>([]);
    let launchpadItems = $state<LvLaunchpadItem[]>([]);
    let collapsed = $state(false);
    let copyBtnEl = $state<HTMLButtonElement | undefined>();
    let appendBtnEl = $state<HTMLButtonElement | undefined>();

    const ecosystemStatus = $derived.by(() => {
        void version;
        void activities.length;
        return lvEcosystem.getStatusBadgeText();
    });

    const CATEGORY_MAP: Record<string, { icon: UiIconName; label: string }> = {
        habit: { icon: "checkCircle", label: "打卡" },
        clip: { icon: "bookmark", label: "剪藏" },
        exam: { icon: "backpack", label: "考试" },
        card: { icon: "sparkle", label: "闪卡" },
        task: { icon: "check", label: "待办" },
        contact: { icon: "users", label: "人脉" },
        note: { icon: "note", label: "速记" },
    };

    const ECOSYSTEM_SIBLINGS: Array<{
        id: string;
        name: string;
        fullName: string;
        color: string;
        desc: string;
        bridgeName: string;
        svgIcon: string;
    }> = [
        { id: "siyuan-checkin", name: "打卡", fullName: "小驴打卡", color: "#8b5cf6", desc: "习惯追踪与时间沉淀", bridgeName: "siyuanCheckin", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><path d="M8 2v4" fill="none"/><path d="M16 2v4" fill="none"/><rect width="18" height="18" x="3" y="4" rx="2" fill="none"/><path d="M3 10h18" fill="none"/><path d="m9 16 2 2 4-4" fill="none"/></svg>' },
        { id: "siyuan-contacts", name: "人脉", fullName: "小驴人脉", color: "#3b82f6", desc: "社交网络与交往纪实", bridgeName: "LvContacts", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" fill="none"/><circle cx="9" cy="7" r="4" fill="none"/><path d="M22 21v-2a4 4 0 0 0-3-3.87" fill="none"/><path d="M16 3.13a4 4 0 0 1 0 7.75" fill="none"/></svg>' },
        { id: "siyuan-speed-switch", name: "雷切", fullName: "小驴雷切", color: "#06b6d4", desc: "切屏画板与命令中心", bridgeName: "siyuanSpeedSwitch", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><path d="M9 3v18" fill="none"/><path d="m15.5 8-3 4.5h3l-2.5 4.5" fill="none"/></svg>' },
        { id: "siyuan-lv-cards", name: "闪卡", fullName: "小驴闪卡", color: "#f59e0b", desc: "FSRS 记忆与间隔复习", bridgeName: "siyuanCards", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><rect x="6" y="6" width="14" height="16" rx="2.5" fill="none"/><path d="M4 18V5a2.5 2.5 0 0 1 2.5-2.5H17" fill="none"/><path d="m10 14 2.2 2.2 4.3-4.4" fill="none"/></svg>' },
        { id: "siyuan-exam", name: "考试", fullName: "小驴考试", color: "#10b981", desc: "题库测验与错题复盘", bridgeName: "siyuanExam", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" fill="none"/><path d="m9 12 2 2 4-4" fill="none"/></svg>' },
        { id: "siyuan-glean", name: "拾遗", fullName: "小驴拾遗", color: "#ec4899", desc: "稍后阅读与灵感归流", bridgeName: "siyuanGlean", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><path d="M12 7v14" fill="none"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" fill="none"/></svg>' },
        { id: "xiaolv-common", name: "常用", fullName: "小驴常用", color: "#f97316", desc: "常用动作与模板热插", bridgeName: "xiaolvCommon", svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important;stroke:currentColor!important;"><rect x="4" y="3" width="16" height="18" rx="2" fill="none"/><path d="m10 10-2 2 2 2" fill="none"/><path d="m14 10 2 2-2 2" fill="none"/><path d="M9 17h6" fill="none"/></svg>' },
    ];

    function loadRecords() {
        try {
            activities = lvActivity.getTodayRecords();
        } catch {
            activities = [];
        }
        try {
            const registered = lvLaunchpad.getItems().filter((it) => it.state !== "hidden" && it.id !== "siyuan-home");
            const regMap = new Map(registered.map((r) => [r.id, r]));
            const merged: LvLaunchpadItem[] = [];

            for (const sib of ECOSYSTEM_SIBLINGS) {
                const existing = regMap.get(sib.id);
                if (existing) {
                    merged.push(existing);
                } else {
                    const host = typeof window !== "undefined" ? (window as any)[sib.bridgeName] : null;
                    const isOnline = Boolean(host);
                    merged.push({
                        id: sib.id,
                        name: sib.name,
                        fullName: sib.fullName,
                        color: sib.color,
                        desc: sib.desc,
                        svgIcon: sib.svgIcon,
                        badge: isOnline ? "就绪" : undefined,
                        badgeType: isOnline ? "success" : undefined,
                        onClick: () => {
                            if (host && typeof host.open === "function") {
                                host.open();
                            } else if (host && typeof host.openDefaultEntry === "function") {
                                host.openDefaultEntry();
                            } else if (host && typeof host.openSwitcher === "function") {
                                host.openSwitcher();
                            } else if (host && typeof host.openWorkbench === "function") {
                                host.openWorkbench();
                            } else if (host && typeof host.practice === "function") {
                                host.practice();
                            } else if (host && typeof host.openHub === "function") {
                                host.openHub();
                            } else {
                                homeNotify(isOnline ? `${sib.fullName} 已就绪` : `未检测到 ${sib.fullName} 运行实例`, 2000, isOnline ? "info" : "error");
                            }
                        },
                    });
                }
            }
            launchpadItems = merged;
        } catch {
            launchpadItems = [];
        }
    }

    onMount(() => {
        loadRecords();
        let unsub: (() => void) | undefined;
        try {
            unsub = lvActivity.onActivity(() => {
                loadRecords();
            });
        } catch {
            /* 兼容性降级 */
        }
        return () => {
            unsub?.();
        };
    });

    $effect(() => {
        void version;
        loadRecords();
    });

    async function handleCopyDigest() {
        try {
            const md = lvActivity.formatAsMarkdown();
            await navigator.clipboard.writeText(md);
            if (copyBtnEl) homeInline(copyBtnEl, t("overview.copyEcosystemDigestOk"));
            homeNotify(t("overview.copyEcosystemDigestOk"), 2500, "info");
        } catch {
            homeNotify(t("overview.copyEcosystemDigest") + "失败", 3000, "error");
        }
    }

    async function handleAppendToJournal() {
        try {
            const md = lvActivity.formatAsMarkdown();
            let docId = plugin.settings?.dbRefs?.adhoc?.docId;
            if (!docId) {
                const { ensureDailyJournalDoc } = await import("@/core/doc-sync");
                docId = await ensureDailyJournalDoc(plugin);
            }
            if (docId) {
                const { upsertDocSection } = await import("@/core/doc-sync");
                await withDocLock(docId, async () => {
                    await upsertDocSection(docId!, "ecosystem-activity", md);
                });
                if (appendBtnEl) homeInline(appendBtnEl, t("overview.appendEcosystemDailyNoteOk"));
                homeNotify(t("overview.appendEcosystemDailyNoteOk"), 2500, "info");
            } else {
                homeNotify(t("overview.copyEcosystemDigestOk"), 2500, "info");
            }
        } catch (e) {
            homeNotify(String(e instanceof Error ? e.message : e), 3000, "error");
        }
    }

    function openBlock(blockId?: string) {
        if (!blockId) return;
        if (typeof plugin.showTabDocs === "function") {
            plugin.showTabDocs(blockId);
        }
    }
</script>

<section class="lv-activity lv-ecosystem-activity" aria-labelledby="lv-ecosystem-title">
    <div class="lv-activity-head">
        <div class="lv-activity-heading">
            <h2 id="lv-ecosystem-title" class="lv-title-sec">🐴 {t("overview.ecosystemTitle")}</h2>
            <span class="lv-badge gray lv-ecosystem-badge" style="font-size:11px; padding:2px 8px; border-radius:10px; font-weight:normal; max-width:100%; text-overflow:ellipsis; overflow:hidden;">
                {ecosystemStatus}
            </span>
            <span class="lv-sub">{t("overview.ecosystemHint")}</span>
        </div>
        <div class="lv-activity-actions">
            {#if !collapsed && activities.length > 0}
                <button
                    bind:this={copyBtnEl}
                    type="button"
                    class="b3-button b3-button--text"
                    onclick={handleCopyDigest}
                    title={t("overview.copyEcosystemDigest")}
                >
                    <UiIcon name="copy" size={13} /> {t("overview.copyEcosystemDigest")}
                </button>
                <button
                    bind:this={appendBtnEl}
                    type="button"
                    class="b3-button b3-button--text"
                    onclick={handleAppendToJournal}
                    title={t("overview.appendEcosystemDailyNote")}
                >
                    <UiIcon name="note" size={13} /> {t("overview.appendEcosystemDailyNote")}
                </button>
            {/if}
            <button
                type="button"
                class="b3-button b3-button--text"
                onclick={() => void plugin.runLifeHealthAudit?.()}
                title={t("overview.aiAudit")}
            >
                <UiIcon name="sparkle" size={13} /> {t("overview.aiAudit")}
            </button>
            <button
                type="button"
                class="b3-button b3-button--text"
                onclick={loadRecords}
                title={t("activity.refresh")}
            >
                <UiIcon name="history" size={14} /> {t("activity.refresh")}
            </button>
            <button
                type="button"
                class="b3-button b3-button--text"
                onclick={() => (collapsed = !collapsed)}
                aria-expanded={!collapsed}
            >
                <UiIcon name={collapsed ? "chevronDown" : "chevronUp"} size={13} />
                {collapsed ? t("activity.expand") : t("activity.collapse")}
            </button>
        </div>
    </div>

    {#if !collapsed}
        <div class="lv-activity-body">
            {#if launchpadItems.length > 0}
                <div class="lv-launchpad-strip" role="group" aria-label="小驴生态矩阵">
                    {#each launchpadItems as item (item.id)}
                        <button
                            type="button"
                            class="lv-launchpad-chip"
                            title={`${item.fullName} · ${item.desc || ""}`}
                            onclick={() => {
                                if (typeof item.onClick === "function") {
                                    void item.onClick();
                                }
                            }}
                        >
                            <span class="lv-launchpad-chip-dot" style="background-color: {item.color || 'var(--b3-theme-primary)'};"></span>
                            <span class="lv-launchpad-chip-name">{item.name}</span>
                            {#if item.badge}
                                <span class="lv-launchpad-chip-badge" class:is-warn={item.badgeType === "warn"} class:is-error={item.badgeType === "error"} class:is-success={item.badgeType === "success"}>
                                    {item.badge}
                                </span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {/if}
            {#if activities.length === 0}
                <div class="lv-card lv-activity-list">
                    <div class="lv-activity-state" style="padding:16px; justify-content:center; text-align:center; flex-direction:column; min-height:72px;">
                        <div style="display:flex; align-items:center; gap:8px; color:var(--lv-tx-2); font-weight:500;">
                            <UiIcon name="sparkle" size={16} />
                            <span>{t("overview.ecosystemEmpty")}</span>
                        </div>
                        <div style="font-size:12px; color:var(--lv-tx-3); margin-top:4px;">
                            {t("overview.ecosystemEmptyHint")}
                        </div>
                    </div>
                </div>
            {:else}
                <div class="lv-card lv-activity-list">
                    {#each activities as item (item.id)}
                        {@const meta = CATEGORY_MAP[item.category] || { icon: "sparkle" as UiIconName, label: "动态" }}
                        <article class="lv-activity-row">
                            <span class="lv-activity-mark" aria-hidden="true" title={meta.label}>
                                <UiIcon name={meta.icon} size={15} />
                            </span>
                            <div class="lv-activity-main">
                                <div class="lv-activity-title-row">
                                    <span class="lv-badge gray" style="font-size:10.5px; padding:1px 6px;">{item.source}</span>
                                    <b>{item.title}</b>
                                    {#if item.linkBlockId}
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text lv-activity-doc-btn"
                                            title="跳转思源块"
                                            aria-label="跳转思源块"
                                            onclick={() => openBlock(item.linkBlockId)}
                                        >
                                            <UiIcon name="folder" size={13} />
                                        </button>
                                    {/if}
                                </div>
                                {#if item.detail}
                                    <div class="lv-activity-details">
                                        <span style="color:var(--lv-tx-2); font-size:11.5px;">{item.detail}</span>
                                    </div>
                                {/if}
                            </div>
                            <div class="lv-activity-time">
                                <b class="lv-num">{item.timeStr}</b>
                                <span style="font-size:10px; color:var(--lv-tx-3);">今日</span>
                            </div>
                        </article>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</section>

<style>
    .lv-launchpad-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 4px 0 10px;
    }
    .lv-launchpad-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--lv-surface, var(--b3-theme-surface));
        border: 1px solid var(--lv-line, var(--b3-border-color));
        color: var(--lv-tx-1, var(--b3-theme-on-surface));
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
        line-height: 1;
        white-space: nowrap;
    }
    .lv-launchpad-chip:hover {
        background: var(--lv-surface-hover, var(--b3-theme-background-hover));
        border-color: var(--lv-accent, var(--b3-theme-primary));
        transform: translateY(-1px);
    }
    .lv-launchpad-chip-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .lv-launchpad-chip-name {
        font-size: 11.5px;
    }
    .lv-launchpad-chip-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--b3-theme-surface-lighter, rgba(125, 125, 125, 0.15));
        color: var(--lv-tx-2, var(--b3-theme-on-surface-light));
        font-weight: normal;
    }
    .lv-launchpad-chip-badge.is-warn {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
    }
    .lv-launchpad-chip-badge.is-error {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
    }
    .lv-launchpad-chip-badge.is-success {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }
</style>
