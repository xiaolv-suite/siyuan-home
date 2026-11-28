<script lang="ts">
    import { onDestroy } from "svelte";
    import type { Reminder } from "@/types";
    import Onboarding from "../onboarding.svelte";
    import type { HomePluginLike } from "@/types/plugin";
    import { saveRuntime } from "@/core/hub/runtime";
    import { applyExpiringRemindersFilter, applyRemindersDrillFilter } from "@/core/reminders-view-model";
    import { localDateKey } from "@/core/hub/rule";
    import { BUILT_IN_MODULES } from "@/core/modules";
    import { resolvePinnedLedgers } from "@/core/navigation-prefs";
    import {
        bucketUpcomingReminders,
        buildOverviewQuickRepairPlan,
        computeOverviewFinancialSummary,
        emptyOverviewFinancialSummary,
        formatCnyCompact,
    } from "@/core/overview-view-model";
    import { parseQuickAdd } from "@/core/quick-add";
    import { currentLocalHHMM } from "@/core/quick-actions";
    import { ensureModuleTargetRef, saveQuickFuelingRecord } from "@/core/quick-event-saver";
    import { writeLedgerRow } from "@/core/ledger-writer";
    import { renderLedgerAll } from "@/core/siyuan";
    import { formatLocalTime } from "@/core/date-display";
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage, homeInline } from "@/libs/notice";
    import { lvLaunchpad } from "@/libs/lv-notice-kit";
    import UiIcon from "@/ui/icon.svelte";
    import { moduleUiIcon } from "@/ui/icons";
    import { createDefaultGuestConfig, filterGuestReminders, filterGuestVisibleModules } from "@/core/guest-mode";
    import OverviewStartGuide from "./overview-start-guide.svelte";
    import {
        openLifeIndexModal as showLifeIndex,
        openEmergencyCardModal as showEmergencyCard,
        openLocationSearchModal as showLocationSearch,
        openYearlyShareCardModal as showShareCard,
    } from "@/core/overview-modals";
    import { getLunarDisplay } from "@/core/hub/lunar-lazy";

    let { plugin, t, onGoto, onCapture, version, initialScanError = "", onRetryScan }: {
        plugin: HomePluginLike;
        t: (k: string) => string;
        onGoto: (s: any) => void;
        onCapture?: (moduleId?: string) => void;
        version?: number;
        initialScanError?: string;
        onRetryScan?: () => Promise<void>;
    } = $props();

    type QuickMode = "fuel" | "asset" | "repair" | "memo";
    let quickMode = $state<QuickMode>("fuel");
    let quickTitle = $state("");
    let quickAmount = $state("");
    let quickSub = $state("");
    let quickSaving = $state(false);
    let quickToast = $state("");
    let quickError = $state("");
    let quickToastTimer: ReturnType<typeof setTimeout> | undefined;
    let quickTitleInput = $state<HTMLInputElement | undefined>(undefined);
    let financialRefreshSeq = $state(0);
    let showToolsMenu = $state(false);
    let toolsPopoverEl = $state<HTMLDivElement | undefined>(undefined);
    let toolsToggleEl = $state<HTMLButtonElement | undefined>(undefined);

    const onboarded = $derived.by(() => {
        void version;
        return !!plugin.settings.onboarded;
    });

    const isGuest = $derived.by(() => {
        void version;
        return Boolean(plugin.runtime?.guestModeActive);
    });

    const allReminders = $derived.by(() => {
        void version;
        const list = plugin.scan?.reminders ?? [];
        return isGuest ? filterGuestReminders(list, createDefaultGuestConfig(true)) : list;
    });

    const members = $derived.by(() => {
        void version;
        return plugin.settings.members ?? [];
    });

    // svelte-ignore state_referenced_locally
    let memberFilter = $state<string | undefined>(plugin.runtime.filterMemberId);

    const reminders = $derived(
        memberFilter
            ? allReminders.filter((r: Reminder) => !r.memberId || r.memberId === memberFilter)
            : allReminders,
    );

    const buckets = $derived(bucketUpcomingReminders(reminders));

    const firstScanPending = $derived.by(() => {
        void version;
        return !initialScanError && !plugin.runtime?.scannedAt && !(plugin.scan?.errors?.length) && allReminders.length === 0;
    });

    const enabledModules = $derived.by(() => {
        void version;
        const raw = plugin.settings.enabledModules ?? [];
        return isGuest ? filterGuestVisibleModules(raw, createDefaultGuestConfig(true)) : raw;
    });

    const pinnedModules = $derived.by(() => {
        void version;
        return resolvePinnedLedgers(plugin.settings, enabledModules);
    });

    const enabledNonMemberCount = $derived(enabledModules.filter((id) => id !== "members" && id !== "adhoc").length);
    const availableLibraryCount = $derived.by(() => {
        const enabledSet = new Set(enabledModules);
        return BUILT_IN_MODULES.filter((m) => !enabledSet.has(m.id)).length;
    });

    const statsByModule = $derived.by(() => {
        void version;
        return plugin.runtime?.cache?.byModule ?? {};
    });
    const rowCountOf = (mid: string): number | undefined => statsByModule[mid]?.rowCount;
    const hasLedgerRows = $derived.by(() => Object.values(statsByModule).some((stats: any) => typeof stats?.rowCount === "number" && stats.rowCount > 0));
    const showStartGuide = $derived(onboarded && (members.length === 0 || !hasLedgerRows));

    const pendingByModule = $derived.by(() => {
        const map = new Map<string, number>();
        for (const r of reminders) map.set(r.moduleId, (map.get(r.moduleId) ?? 0) + 1);
        return map;
    });

    const scanErrors = $derived.by(() => { void version; return plugin.scan?.errors ?? []; });
    const permissionDenied = $derived(scanErrors.some((error) => error.moduleId === "permission"));
    const snapshotLabel = $derived.by(() => {
        const at = plugin.runtime?.scannedAt;
        return formatLocalTime(at, { hour: "2-digit", minute: "2-digit" }) ?? "—";
    });
    const memberOf = (id: string | undefined) => (id ? members.find((m) => m.id === id) : undefined);

    const dateLine = $derived.by(() => {
        const base = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
        const lunar = getLunarDisplay();
        return lunar ? `${base} · ${lunar}` : base;
    });

    const starterModule = $derived(
        enabledModules.find((id) => id !== "members" && id !== "adhoc") ?? undefined,
    );

    let financialSummary = $state(emptyOverviewFinancialSummary());
    $effect(() => {
        void version;
        void financialRefreshSeq;
        if (!onboarded) return;
        let cancelled = false;
        void computeOverviewFinancialSummary(plugin).then((res) => {
            if (!cancelled) financialSummary = res;
        }).catch(() => undefined);
        return () => { cancelled = true; };
    });

    const assetDisplayCount = $derived(
        financialSummary.loaded && financialSummary.assetCount > 0
            ? financialSummary.assetCount
            : (rowCountOf("assets-real") ?? 0),
    );
    const insuranceDisplayCount = $derived(
        financialSummary.loaded && financialSummary.insuranceCount > 0
            ? financialSummary.insuranceCount
            : (rowCountOf("insurance") ?? 0),
    );
    const failedFinancialSet = $derived(new Set(financialSummary.failedModules ?? []));
    const assetMetricMain = $derived(
        failedFinancialSet.has("assets-real")
            ? "—"
            : (financialSummary.assetTotalAmount > 0
                ? formatCnyCompact(financialSummary.assetTotalAmount)
                : `${assetDisplayCount} 件`),
    );

    const spendBars = $derived.by(() => {
        const items = [
            { id: "vehicles", label: t("home.spendVehicle"), amount: financialSummary.vehicleMonthCost, muted: false },
            { id: "house", label: t("home.spendHouse"), amount: financialSummary.houseMonthCost, muted: false },
            { id: "memberships", label: t("home.spendSub"), amount: financialSummary.subscriptionMonthCost, muted: false },
            { id: "insurance", label: t("home.spendInsurance"), amount: financialSummary.insuranceMonthCost, muted: true },
        ];
        const maxAmt = Math.max(...items.map((x) => x.amount), 1);
        return items.map((x) => {
            const failed = failedFinancialSet.has(x.id) || (x.id === "vehicles" && failedFinancialSet.has("rowlogs"));
            return {
                ...x,
                pct: failed ? 0 : (x.amount > 0 ? Math.max(8, Math.round((x.amount / maxAmt) * 100)) : 0),
                formatted: failed ? "—" : formatCnyCompact(x.amount),
            };
        });
    });

    const currentMonthNum = new Date().getMonth() + 1;

    function openLedgerFor(moduleId: string) {
        plugin.setActiveLedger(moduleId);
        onGoto("ledger");
    }

    function drillReminders(mid: string) {
        applyRemindersDrillFilter(plugin.runtime, mid);
        onGoto("reminders");
        void saveRuntime(plugin, plugin.runtime).catch(() => undefined);
    }

    function openExpiringReminders() {
        applyExpiringRemindersFilter(plugin.runtime);
        onGoto("reminders");
        void saveRuntime(plugin, plugin.runtime).catch(() => undefined);
    }

    function openStarterRecord() {
        if (starterModule) openLedgerFor(starterModule);
        else onGoto("library");
    }

    function openQuickEvent(sub?: "fuel" | "vital" | "chore" | "shopping" | "snippet") {
        if (onCapture) onCapture(sub ? `event:${sub}` : "event");
    }

    async function setMemberFilter(id: string | undefined) {
        memberFilter = id;
        plugin.runtime.filterMemberId = id;
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch (e) {
            showMessage(t("dash.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    }

    async function viewAllReminders() {
        plugin.runtime.hubFilter = "all";
        plugin.runtime.hubMemberId = undefined;
        plugin.runtime.hubModuleId = undefined;
        plugin.runtime.hubDueWithin = "all";
        plugin.runtime.activeNamedViewId = undefined;
        onGoto("reminders");
        try {
            await saveRuntime(plugin, plugin.runtime);
        } catch { /* soft */ }
    }

    let retryingScan = $state(false);
    async function retryScan() {
        if (retryingScan) return;
        retryingScan = true;
        try {
            if (onRetryScan) await onRetryScan();
            else await plugin.refreshHub(undefined, true);
        } catch (e) {
            showMessage(t("hub.rescanFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            retryingScan = false;
        }
    }

    let overviewBusy = $state<Set<string>>(new Set());
    async function runOverviewAction(key: string, action: () => Promise<void>) {
        if (isGuest || plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        if (overviewBusy.has(key)) return;
        overviewBusy = new Set([...overviewBusy, key]);
        try {
            await action();
        } catch (e) {
            showMessage(t("hub.actionFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            const next = new Set(overviewBusy);
            next.delete(key);
            overviewBusy = next;
        }
    }

    let lastPostponedOverdueMap = $state<Record<string, string | undefined> | null>(null);
    async function handleBatchPostponeOverdue() {
        await runOverviewAction("batch-postpone", async () => {
            const overdueIds = allReminders.filter((r: Reminder) => r.level === "overdue").map((r: Reminder) => r.id);
            if (overdueIds.length === 0) return;
            const todayKey = localDateKey(new Date());
            const prev = await plugin.batchSnooze?.(overdueIds, todayKey);
            lastPostponedOverdueMap = prev ?? {};
            try { lvLaunchpad.haptic(10); } catch { /* soft */ }
            showMessage(t("dash.overduePostponed").replace("${n}", String(overdueIds.length)), 3500, "info");
        });
    }

    async function handleUndoPostpone() {
        await runOverviewAction("batch-postpone", async () => {
            const mapToUndo = lastPostponedOverdueMap;
            if (!mapToUndo || Object.keys(mapToUndo).length === 0) return;
            await plugin.undoBatchSnooze?.(mapToUndo);
            lastPostponedOverdueMap = null;
            showMessage(t("dash.undoSuccess"), 2500, "info");
        });
    }

    const quickModeConfig = $derived.by(() => {
        if (quickMode === "fuel") {
            return {
                targetModule: "vehicles",
                targetLabel: t("module.vehicles"),
                phTitle: t("home.quickPhFuelTitle"),
                phAmt: t("home.quickPhFuelAmt"),
                phSub: t("home.quickPhFuelSub"),
                hasExtra: true,
            };
        }
        if (quickMode === "asset") {
            return {
                targetModule: "assets-real",
                targetLabel: t("module.assets-real"),
                phTitle: t("home.quickPhAssetTitle"),
                phAmt: t("home.quickPhAssetAmt"),
                phSub: t("home.quickPhAssetSub"),
                hasExtra: true,
            };
        }
        if (quickMode === "repair") {
            const repairPlan = buildOverviewQuickRepairPlan(quickTitle, undefined, quickSub, "");
            return {
                targetModule: repairPlan.moduleId,
                targetLabel: t(`module.${repairPlan.moduleId}`),
                phTitle: t("home.quickPhRepairTitle"),
                phAmt: t("home.quickPhRepairAmt"),
                phSub: t("home.quickPhRepairSub"),
                hasExtra: true,
            };
        }
        return {
            targetModule: "adhoc",
            targetLabel: t("adhoc.name"),
            phTitle: t("home.quickPhMemoTitle"),
            phAmt: "",
            phSub: "",
            hasExtra: false,
        };
    });

    function showQuickFeedback(msg: string) {
        quickError = "";
        quickToast = msg;
        if (quickToastTimer) clearTimeout(quickToastTimer);
        quickToastTimer = setTimeout(() => { quickToast = ""; }, 3200);
    }

    onDestroy(() => {
        if (quickToastTimer) clearTimeout(quickToastTimer);
    });

    function handleToolsPointerDown(e: PointerEvent) {
        if (!showToolsMenu) return;
        const target = e.target as Node | null;
        if (target && toolsPopoverEl && !toolsPopoverEl.contains(target)) {
            showToolsMenu = false;
        }
    }

    function handleToolsKeydown(e: KeyboardEvent) {
        if (!showToolsMenu || e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        showToolsMenu = false;
        toolsToggleEl?.focus();
    }

    async function submitQuickAdd() {
        if (quickSaving) return;
        if (isGuest || plugin.runtime?.guestModeActive) {
            showMessage(t("guest.writeBlocked"), 3500, "info");
            return;
        }
        const rawTitle = quickTitle.trim();
        if (!rawTitle) {
            quickToast = "";
            quickError = t("home.quickTitleRequired");
            quickTitleInput?.focus();
            showMessage(t("home.quickTitleRequired"), 2600, "info");
            return;
        }

        quickToast = "";
        quickError = "";
        const parsedFromTitle = parseQuickAdd(rawTitle);
        const parsedAmount = Number(quickAmount.trim().replace(/[^\d.]/g, ""));
        const validAmount = quickAmount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0
            ? parsedAmount
            : parsedFromTitle.amount;
        const subText = quickSub.trim();
        const today = localDateKey(new Date());

        quickSaving = true;
        try {
            if (quickMode === "memo") {
                const title = parsedFromTitle.cleanTitle || rawTitle;
                const due = parsedFromTitle.dueDate || localDateKey(new Date(Date.now() + 3 * 86400000));
                await plugin.addMemo(title, due, {
                    priority: parsedFromTitle.priority,
                    category: parsedFromTitle.category,
                    cycle: parsedFromTitle.cycle,
                    recurrenceAnchor: parsedFromTitle.recurrenceAnchor,
                    amount: validAmount,
                });
                quickTitle = "";
                quickAmount = "";
                quickSub = "";
                financialRefreshSeq += 1;
                showQuickFeedback(t("home.quickAdded").replace("${target}", t("adhoc.name")).replace("${title}", title));
                return;
            }

            if (quickMode === "fuel") {
                const parsedMileage = Number(subText.replace(/[^\d.]/g, ""));
                const hasMileage = subText !== "" && Number.isFinite(parsedMileage) && parsedMileage > 0;
                const vRef = await ensureModuleTargetRef(plugin, "vehicles", { autoEnable: true });
                let vRows = vRef?.avId ? ((await renderLedgerAll(vRef.avId)).rows ?? []) : [];
                let targetVehicleId = vRows[0]?.itemID as string | undefined;
                if (!targetVehicleId) {
                    const created = await writeLedgerRow({
                        moduleId: "vehicles",
                        target: vRef,
                        name: t("module.vehicles"),
                        plugin,
                        members: plugin.settings.members,
                        operationKey: `home-quick:vehicles:init:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
                        fields: hasMileage ? { mileage: parsedMileage } : {},
                    });
                    if (created.failed.length > 0) {
                        showMessage(t("ledger.savePartial").replace("${fields}", created.failed.join(", ")), 5000, "error");
                    }
                    targetVehicleId = created.itemID;
                }
                const isCharging = /电|kwh|充电/i.test(rawTitle);
                const mileage = hasMileage ? parsedMileage : 0;
                const unitPrice = isCharging ? 1.2 : 8.2;
                const liters = validAmount !== undefined ? Math.max(0.1, Number((validAmount / unitPrice).toFixed(2))) : 0;
                await saveQuickFuelingRecord({
                    plugin,
                    date: today,
                    time: currentLocalHHMM(),
                    vehicleId: targetVehicleId,
                    kind: isCharging ? "charging" : "fuel",
                    amount: validAmount,
                    liters,
                    mileage,
                    unitPrice,
                    note: rawTitle,
                });
                await plugin.refreshHub?.(["vehicles"], true).catch(() => undefined);
                financialRefreshSeq += 1;
                plugin.emitHubChanged?.();
                quickTitle = "";
                quickAmount = "";
                quickSub = "";
                showQuickFeedback(
                    t("home.quickAdded")
                        .replace("${target}", t("module.vehicles"))
                        .replace("${title}", rawTitle + (validAmount !== undefined ? ` · ¥${validAmount}` : "")),
                );
                return;
            }

            const targetPlan = quickMode === "asset"
                ? {
                    moduleId: "assets-real" as const,
                    fields: {
                        date: today,
                        ...(validAmount !== undefined ? { amount: validAmount } : {}),
                        ...(subText ? { location: subText } : {}),
                    },
                }
                : buildOverviewQuickRepairPlan(rawTitle, validAmount, subText, today);
            const targetMod = targetPlan.moduleId;
            const targetRef = await ensureModuleTargetRef(plugin, targetMod, { autoEnable: true });
            const writeRes = await writeLedgerRow({
                moduleId: targetMod,
                target: targetRef,
                name: rawTitle,
                plugin,
                members: plugin.settings.members,
                operationKey: `home-quick:${targetMod}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
                fields: targetPlan.fields,
            });
            await plugin.refreshHub?.([targetMod], true).catch(() => undefined);
            financialRefreshSeq += 1;
            plugin.emitHubChanged?.();
            quickTitle = "";
            quickAmount = "";
            quickSub = "";
            if (writeRes.failed.length > 0) {
                showMessage(t("ledger.savePartial").replace("${fields}", writeRes.failed.join(", ")), 6000, "error");
            } else {
                showQuickFeedback(
                    t("home.quickAdded")
                        .replace("${target}", t(`module.${targetMod}`))
                        .replace("${title}", rawTitle + (validAmount !== undefined ? ` · ¥${validAmount}` : "")),
                );
            }
        } catch (err) {
            const msg = t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err));
            quickError = msg;
            showMessage(msg, 5000, "error");
        } finally {
            quickSaving = false;
        }
    }

    async function openJournalDoc() {
        const { openDailyJournalDoc } = await import("@/core/doc-sync");
        if (!(await openDailyJournalDoc(plugin))) {
            showMessage(t("capture.docSyncHint"), 3000, "info");
        }
    }

    async function copyDailyHomeBoard(e?: MouseEvent) {
        try {
            const { formatDailyHomeBoardMarkdown } = await import("@/core/reminder-digest");
            const boardItems = allReminders.map((r: Reminder) => ({
                id: r.id,
                moduleId: r.moduleId,
                title: r.title,
                dueDate: r.dueDate,
                daysLeft: r.daysLeft,
                level: r.level,
                location: (r as any).location,
            }));
            const md = formatDailyHomeBoardMarkdown(boardItems, {
                label: (mid) => (t(`module.${mid}`) !== `module.${mid}` ? t(`module.${mid}`) : mid),
            });
            await navigator.clipboard.writeText(md);
            if (e?.currentTarget) homeInline(e.currentTarget as HTMLElement, t("overview.copyDailyBoardDone"));
            showMessage(t("overview.copyDailyBoardDone"), 3000, "info");
        } catch {
            showMessage(t("ledger.copyAsImageFail"), 3000, "error");
        }
    }

    const openLifeIndexModal = () => showLifeIndex({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });
    const openEmergencyCardModal = () => showEmergencyCard({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });
    const openShareCardModal = () => showShareCard({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });
    const openLocationIndexModal = () => showLocationSearch({ plugin, allReminders, t, DialogCls: Dialog, showMessageFn: showMessage });

    function urgencyBadge(r: Reminder): { text: string; cls: string } {
        if (r.daysLeft < 0) return { text: t("days.overdue").replace("${n}", String(-r.daysLeft)), cls: "lv-pill-badge--danger" };
        if (r.daysLeft === 0) return { text: t("days.today"), cls: "lv-pill-badge--danger" };
        if (r.daysLeft <= 14) return { text: t("days.after").replace("${n}", String(r.daysLeft)), cls: "lv-pill-badge--warn" };
        return { text: t("days.after").replace("${n}", String(r.daysLeft)), cls: "lv-pill-badge--accent" };
    }
</script>

<svelte:window onpointerdowncapture={handleToolsPointerDown} onkeydown={handleToolsKeydown} />

{#if !onboarded}
    <Onboarding {plugin} {t} onGoto={onGoto} {onCapture} />
{:else}
    {#if permissionDenied}
        <div class="lv-card lv-alert-banner" role="alert" style="margin-bottom:12px;">
            <UiIcon name="alert" size={18} />
            <span class="lv-alert-text">{t("permission.body")}</span>
            <button type="button" class="b3-button b3-button--outline" disabled={retryingScan} aria-busy={retryingScan} onclick={retryScan}>
                {retryingScan ? t("ledger.saving") : t("hub.rescan")}
            </button>
        </div>
    {/if}

    {#if showStartGuide}
        <OverviewStartGuide
            {t}
            {starterModule}
            {onGoto}
            onOpenStarterRecord={openStarterRecord}
            onOpenSettings={() => plugin.openSetting()}
        />
    {/if}

    <div class="lv-home-top">
        <div>
            <h1>{t("home.title")}</h1>
            <p>
                {buckets.due30Count > 0
                    ? t("home.subtitleDue").replace("${date}", dateLine).replace("${n}", String(buckets.due30Count))
                    : t("home.subtitleCalm").replace("${date}", dateLine)}
            </p>
        </div>
        <div class="lv-home-top__right">
            <div class="lv-member-pills" role="group" aria-label={t("tabMembers")}>
                <button
                    type="button"
                    class="lv-m-pill"
                    class:on={!memberFilter}
                    aria-pressed={!memberFilter}
                    onclick={() => void setMemberFilter(undefined)}
                >
                    {t("home.allMembers")}
                </button>
                {#each members as m (m.id)}
                    <button
                        type="button"
                        class="lv-m-pill"
                        class:on={memberFilter === m.id}
                        aria-pressed={memberFilter === m.id}
                        onclick={() => void setMemberFilter(m.id)}
                    >
                        {m.name}
                    </button>
                {/each}
                <button
                    type="button"
                    class="lv-m-pill"
                    aria-label={t("add")}
                    title={t("tab.members")}
                    onclick={() => onGoto("members")}
                >
                    <UiIcon name="add" size={13} />
                </button>
            </div>

            <div class="lv-tools-popover" bind:this={toolsPopoverEl}>
                <button
                    bind:this={toolsToggleEl}
                    type="button"
                    class="lv-btn ghost sm lv-hero-tools-toggle"
                    aria-haspopup="menu"
                    aria-expanded={showToolsMenu}
                    onclick={() => (showToolsMenu = !showToolsMenu)}
                >
                    <UiIcon name="menu" size={13} />
                    <span>{t("home.toolsMenu")}</span>
                    <UiIcon name={showToolsMenu ? "chevronUp" : "chevronDown"} size={11} />
                </button>
                {#if showToolsMenu}
                    <div class="lv-tools-popover__menu lv-hero-tools-group" role="menu">
                        <button type="button" role="menuitem" class="lv-btn ghost sm" onclick={() => { showToolsMenu = false; void openJournalDoc(); }}>
                            <UiIcon name="note" size={13} /> {t("capture.openJournalDoc")}
                        </button>
                        <button type="button" role="menuitem" class="lv-btn ghost sm" onclick={(e) => { showToolsMenu = false; void copyDailyHomeBoard(e); }}>
                            <UiIcon name="home" size={13} /> {t("overview.dailyBoard")}
                        </button>
                        <button type="button" role="menuitem" class="lv-btn ghost sm" title={t("ledger.locSearch")} onclick={() => { showToolsMenu = false; openLocationIndexModal(); }}>
                            <UiIcon name="mapPin" size={13} /> {t("ledger.locSearch")}
                        </button>
                        <button type="button" role="menuitem" class="lv-btn ghost sm" onclick={() => { showToolsMenu = false; openLifeIndexModal(); }}>
                            <UiIcon name="shield" size={13} /> {t("overview.lifeIndex")}
                        </button>
                        <button type="button" role="menuitem" class="lv-btn ghost sm" onclick={() => { showToolsMenu = false; openEmergencyCardModal(); }}>
                            <UiIcon name="alert" size={13} /> {t("overview.emergencyCard")}
                        </button>
                        <button type="button" role="menuitem" class="lv-btn ghost sm" onclick={() => { showToolsMenu = false; openShareCardModal(); }}>
                            <UiIcon name="camera" size={13} /> {t("overview.shareCard")}
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- 顶部 1px 分割极简 4 格指标带 -->
    <div class="lv-metric-strip">
        <button type="button" class="lv-metric-cell is-clickable" onclick={openExpiringReminders}>
            <span>{t("home.metricDue")}</span>
            <b>{buckets.due30Count} 项</b>
            <small>{t("home.metricDueSub").replace("${soon}", String(buckets.due7Count))}</small>
        </button>
        <button
            type="button"
            class="lv-metric-cell is-clickable"
            onclick={() => openLedgerFor(enabledModules.includes("assets-real") ? "assets-real" : (starterModule ?? "certs"))}
        >
            <span>{t("home.metricAssets")}</span>
            <b>{assetMetricMain}</b>
            <small>
                {t("home.metricAssetsSub")
                    .replace("${count}", String(assetDisplayCount))
                    .replace("${ins}", String(insuranceDisplayCount))}
            </small>
        </button>
        <button
            type="button"
            class="lv-metric-cell is-clickable"
            onclick={() => openLedgerFor(enabledModules.includes("vehicles") ? "vehicles" : (enabledModules.includes("memberships") ? "memberships" : (starterModule ?? "certs")))}
        >
            <span>{t("home.metricSpend")}</span>
            <b>{formatCnyCompact(financialSummary.monthlyVehicleAndSubTotal)}</b>
            <small>
                {t("home.metricSpendSub")
                    .replace("${car}", formatCnyCompact(financialSummary.vehicleMonthCost))
                    .replace("${sub}", formatCnyCompact(financialSummary.subscriptionMonthCost))}
            </small>
        </button>
        <button type="button" class="lv-metric-cell is-clickable" onclick={() => onGoto("library")}>
            <span>{t("home.metricPinned")}</span>
            <b>{pinnedModules.length} 个</b>
            <small>
                {t("home.metricPinnedSub")
                    .replace("${on}", String(enabledNonMemberCount))
                    .replace("${off}", String(availableLibraryCount))}
            </small>
        </button>
    </div>

    <!-- 65% 主区 + 35% 静谧侧栏 -->
    <div class="lv-home-sheet">
        <div class="lv-home-main">
            <!-- 最近要处理的事 -->
            <div>
                <div class="lv-sec-head">
                    <div class="lv-sec-head__left">
                        <b>{t("home.todoTitle")}</b>
                        <span>
                            {reminders.length > 0
                                ? t("home.todoSub").replace("${n}", String(reminders.length))
                                : t("home.todoSubEmpty")}
                        </span>
                    </div>
                    <div class="lv-sec-head__actions">
                        {#if buckets.overdueCount > 0}
                            <button
                                type="button"
                                class="lv-btn ghost sm"
                                disabled={overviewBusy.has("batch-postpone")}
                                onclick={handleBatchPostponeOverdue}
                            >
                                {t("dash.postponeOverdueToToday").replace("${n}", String(buckets.overdueCount))}
                            </button>
                        {/if}
                        {#if lastPostponedOverdueMap && Object.keys(lastPostponedOverdueMap).length > 0}
                            <button
                                type="button"
                                class="lv-btn ghost sm lv-tx-accent"
                                disabled={overviewBusy.has("batch-postpone")}
                                onclick={handleUndoPostpone}
                            >
                                {t("dash.undoPostpone")}
                            </button>
                        {/if}
                        <button type="button" class="lv-btn ghost sm" onclick={() => void viewAllReminders()}>
                            <span>{t("home.viewAllRecords")}</span>
                            <UiIcon name="forward" size={12} />
                        </button>
                    </div>
                </div>

                {#if firstScanPending}
                    <div class="lv-todo-rows" role="status" aria-busy="true">
                        {#each [0, 1, 2] as idx (idx)}
                            <div class="lv-todo-row">
                                <div class="lv-skel lv-skel--w56"></div>
                                <div class="lv-skel lv-skel--w26"></div>
                            </div>
                        {/each}
                    </div>
                {:else if reminders.length === 0 && scanErrors.length > 0}
                    <div style="padding:14px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        <span class="lv-caption">{initialScanError || t("dash.focusDataErr").replace("${t}", snapshotLabel).replace("${n}", String(scanErrors.length))}</span>
                        <button type="button" class="lv-btn sm" disabled={retryingScan} onclick={retryScan}>{t("hub.rescan")}</button>
                    </div>
                {:else if buckets.soon.length === 0 && buckets.month.length === 0}
                    <div style="padding:16px 0;font-size:13px;color:var(--lv-tx-3);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                        <span>{t("home.todoEmpty")}</span>
                        {#if memberFilter}
                            <button type="button" class="lv-btn ghost sm" onclick={() => void setMemberFilter(undefined)}>{t("dash.clearFilter")}</button>
                        {/if}
                    </div>
                {:else}
                    {#if buckets.soon.length > 0}
                        <div class="lv-tier-label">{t("home.todoTierSoon")}</div>
                        <div class="lv-todo-rows">
                            {#each buckets.soon as r (r.id)}
                                {@const badge = urgencyBadge(r)}
                                {@const mem = memberOf(r.memberId)}
                                {@const modName = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : t("adhoc.name")}
                                <div class="lv-todo-row">
                                    <div class="lv-todo-left">
                                        <button
                                            type="button"
                                            class="lv-todo-check"
                                            aria-label={`${t("home.markDone")}：${r.title}`}
                                            disabled={overviewBusy.has(r.id)}
                                            onclick={() => void runOverviewAction(r.id, () => plugin.complete(r))}
                                        >
                                            <UiIcon name="check" size={11} />
                                        </button>
                                        <div class="lv-todo-body">
                                            <div class="lv-todo-title">{r.title}</div>
                                            <div class="lv-todo-meta">
                                                <span class="lv-pill-badge {badge.cls}">{badge.text}</span>
                                                <span>{modName} · {r.dueDate}{mem ? ` · ${mem.name}` : ""}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="lv-todo-actions">
                                        <button
                                            type="button"
                                            class="lv-btn ghost sm"
                                            onclick={() => r.moduleId !== "adhoc" ? openLedgerFor(r.moduleId) : onGoto("reminders")}
                                        >
                                            {t("home.viewItem")}
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    {#if buckets.month.length > 0}
                        <div class="lv-tier-label">{t("home.todoTierMonth")}</div>
                        <div class="lv-todo-rows">
                            {#each buckets.month as r (r.id)}
                                {@const badge = urgencyBadge(r)}
                                {@const mem = memberOf(r.memberId)}
                                {@const modName = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : t("adhoc.name")}
                                <div class="lv-todo-row">
                                    <div class="lv-todo-left">
                                        <button
                                            type="button"
                                            class="lv-todo-check"
                                            aria-label={`${t("home.markDone")}：${r.title}`}
                                            disabled={overviewBusy.has(r.id)}
                                            onclick={() => void runOverviewAction(r.id, () => plugin.complete(r))}
                                        >
                                            <UiIcon name="check" size={11} />
                                        </button>
                                        <div class="lv-todo-body">
                                            <div class="lv-todo-title">{r.title}</div>
                                            <div class="lv-todo-meta">
                                                <span class="lv-pill-badge {badge.cls}">{badge.text}</span>
                                                <span>{modName} · {r.dueDate}{mem ? ` · ${mem.name}` : ""}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="lv-todo-actions">
                                        <button
                                            type="button"
                                            class="lv-btn ghost sm"
                                            onclick={() => r.moduleId !== "adhoc" ? openLedgerFor(r.moduleId) : onGoto("reminders")}
                                        >
                                            {t("home.viewItem")}
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {/if}
            </div>

            <!-- 常用台账快速入口 -->
            <div class="lv-home-pinned-sec">
                <div class="lv-sec-head">
                    <div class="lv-sec-head__left">
                        <b>{t("home.pinnedTitle")}</b>
                        <span>{t("home.pinnedSub")}</span>
                    </div>
                    <button type="button" class="lv-btn ghost sm" onclick={() => onGoto("library")}>
                        <span>{t("home.adjustPins")}</span>
                        <UiIcon name="forward" size={12} />
                    </button>
                </div>

                <div class="lv-pinned-grid">
                    {#each pinnedModules.slice(0, 5) as mid (mid)}
                        {@const count = rowCountOf(mid)}
                        {@const pending = pendingByModule.get(mid) ?? 0}
                        <button type="button" class="lv-pinned-card" onclick={() => openLedgerFor(mid)}>
                            <div class="lv-pinned-card__top">
                                <span class="lv-pinned-ic" aria-hidden="true">
                                    <UiIcon name={moduleUiIcon(mid)} size={15} />
                                </span>
                                {#if pending > 0}
                                    <span
                                        role="button"
                                        tabindex="0"
                                        class="lv-pill-badge lv-pill-badge--warn"
                                        title={t("mod.pendingDrill")}
                                        onclick={(e: MouseEvent) => { e.stopPropagation(); drillReminders(mid); }}
                                        onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); drillReminders(mid); } }}
                                    >{pending} 待办</span>
                                {:else if typeof count === "number"}
                                    <span class="lv-caption">{count} {t("mod.records")}</span>
                                {/if}
                            </div>
                            <div>
                                <b>{t(`module.${mid}`)}</b>
                                <small>{t("home.pinnedCardSub")}</small>
                            </div>
                        </button>
                    {/each}
                    <button type="button" class="lv-pinned-card lv-pinned-card--add" onclick={() => onGoto("library")}>
                        <div class="lv-pinned-card__top">
                            <span class="lv-pinned-ic" aria-hidden="true">
                                <UiIcon name="add" size={15} />
                            </span>
                        </div>
                        <div>
                            <b>{t("home.moreLedgers")}</b>
                            <small>{t("home.moreLedgersSub").replace("${total}", String(BUILT_IN_MODULES.length))}</small>
                        </div>
                    </button>
                </div>
            </div>
        </div>

        <!-- 右侧 35% 静谧侧栏 -->
        <aside class="lv-home-rail" aria-label={t("home.quickAddTitle")}>
            <div class="lv-rail-block" id="lv-quick-add-box">
                <div class="lv-rail-title">
                    <b>{t("home.quickAddTitle")}</b>
                    <button type="button" class="lv-rail-nav__sec-link" onclick={() => openQuickEvent()}>
                        {t("home.quickFullForm")}
                    </button>
                </div>

                <div class="lv-quick-mode-tabs" role="tablist" aria-label={t("home.quickAddTitle")}>
                    <button
                        type="button"
                        class="lv-q-tab"
                        class:on={quickMode === "fuel"}
                        role="tab"
                        aria-selected={quickMode === "fuel"}
                        onclick={() => { quickMode = "fuel"; quickError = ""; }}
                    >
                        {t("home.quickModeFuel")}
                    </button>
                    <button
                        type="button"
                        class="lv-q-tab"
                        class:on={quickMode === "asset"}
                        role="tab"
                        aria-selected={quickMode === "asset"}
                        onclick={() => { quickMode = "asset"; quickError = ""; }}
                    >
                        {t("home.quickModeAsset")}
                    </button>
                    <button
                        type="button"
                        class="lv-q-tab"
                        class:on={quickMode === "repair"}
                        role="tab"
                        aria-selected={quickMode === "repair"}
                        onclick={() => { quickMode = "repair"; quickError = ""; }}
                    >
                        {t("home.quickModeRepair")}
                    </button>
                    <button
                        type="button"
                        class="lv-q-tab"
                        class:on={quickMode === "memo"}
                        role="tab"
                        aria-selected={quickMode === "memo"}
                        onclick={() => { quickMode = "memo"; quickError = ""; }}
                    >
                        {t("home.quickModeMemo")}
                    </button>
                </div>

                <div class="lv-quick-form">
                    <input
                        bind:this={quickTitleInput}
                        type="text"
                        class="lv-st-input lv-memo-input"
                        bind:value={quickTitle}
                        placeholder={isGuest ? t("guest.writeBlocked") : quickModeConfig.phTitle}
                        aria-label={quickModeConfig.phTitle}
                        disabled={quickSaving || isGuest}
                        oninput={() => { if (quickError) quickError = ""; }}
                        onkeydown={(e: KeyboardEvent) => {
                            if (e.key === "Enter" && !e.isComposing) void submitQuickAdd();
                        }}
                    />
                    {#if quickModeConfig.hasExtra}
                        <div class="lv-quick-form-row">
                            <input
                                type="text"
                                class="lv-st-input"
                                bind:value={quickAmount}
                                placeholder={quickModeConfig.phAmt}
                                aria-label={quickModeConfig.phAmt}
                                disabled={quickSaving || isGuest}
                                onkeydown={(e: KeyboardEvent) => {
                                    if (e.key === "Enter" && !e.isComposing) void submitQuickAdd();
                                }}
                            />
                            <input
                                type="text"
                                class="lv-st-input"
                                bind:value={quickSub}
                                placeholder={quickModeConfig.phSub}
                                aria-label={quickModeConfig.phSub}
                                disabled={quickSaving || isGuest}
                                onkeydown={(e: KeyboardEvent) => {
                                    if (e.key === "Enter" && !e.isComposing) void submitQuickAdd();
                                }}
                            />
                        </div>
                    {/if}
                    <button
                        type="button"
                        class="lv-btn primary"
                        disabled={quickSaving || isGuest}
                        aria-busy={quickSaving}
                        onclick={() => void submitQuickAdd()}
                    >
                        {quickSaving ? t("ledger.saving") : `${t("home.quickSubmitPrefix")}「${quickModeConfig.targetLabel}」`}
                    </button>
                    {#if quickError}
                        <div class="lv-quick-error" role="alert">{quickError}</div>
                    {/if}
                    {#if quickToast}
                        <div class="lv-quick-toast" role="status">{quickToast}</div>
                    {/if}
                </div>
            </div>

            <div class="lv-rail-block">
                <div class="lv-rail-title">
                    <b>{t("home.spendTitle")}</b>
                    <span>{t("home.spendMonthTag").replace("${m}", String(currentMonthNum))}</span>
                </div>
                <div class="lv-spend-list">
                    {#each spendBars as item (item.label)}
                        <div class="lv-spend-item">
                            <div class="lv-spend-row">
                                <span>{item.label}</span>
                                <b>{item.formatted}</b>
                            </div>
                            <div class="lv-bar-track">
                                <div
                                    class="lv-bar-fill"
                                    class:lv-bar-fill--muted={item.muted}
                                    style="width:{item.pct}%;"
                                ></div>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </aside>
    </div>
{/if}
