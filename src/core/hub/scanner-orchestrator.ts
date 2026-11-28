/**
 * 全量与增量扫描编排器 (ScannerOrchestrator)
 * 从 index.ts 上帝类中剥离的 31 模块台账扫描、每日摘要、临期高优卡片派发与去抖调度。
 */

import { buildScanProviders } from "./registry";
import { runScan, deriveVisible, type ScanResult } from "./scanner";
import { createRuntimeCacheSnapshot } from "./runtime-snapshot";
import { deliverPriorityReminderCard } from "./priority-reminder-delivery";
import { dailyDigest, markNotified, inSilentHours, weeklyPreview, markWeeklyNotified } from "./notify";
import { homeNotify } from "@/libs/notice";
import { purgeHandled } from "./runtime";
import { withRuntime } from "./actions";
import { loadRowLogs } from "@/core/rowlog";
import { lvAutomation } from "@/libs/lv-notice-kit";
import { provisionModule } from "@/core/provisioner";
import { saveSettings } from "@/core/settings";
import { localDateKey } from "./rule";

export class ScannerOrchestrator {
    private readonly plugin: any;
    private static readonly FULL_SCAN_MIN_MS = 30 * 1000;
    private lastScanAt = 0;
    private lastHubScanDigest = "";
    private fullScanSeq = 0;
    private incScanSeq = 0;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async repairModule(moduleId: string): Promise<any> {
        const schema = this.plugin.schemaCatalog[moduleId];
        if (!schema) return;
        const resolveName = (key: string) => String(this.plugin.i18n[`field.${key}`] ?? key);
        const res = await provisionModule(
            this.plugin.settings,
            moduleId,
            schema,
            this.plugin.i18nText("module." + moduleId),
            {
                resolveName,
                reconcileGhostColumns: true,
            },
        );
        try {
            await saveSettings(this.plugin, this.plugin.settings);
        } catch (e) {
            console.warn("[LvHome] saveSettings in repairModule failed:", e);
        }
        await this.plugin.refreshHub(moduleId, true);
        return res;
    }

    async provisionLedgers(): Promise<void> {
        const resolveName = (key: string) => String(this.plugin.i18n[`field.${key}`] ?? key);
        const enabled = new Set(this.plugin.settings.enabledModules);
        for (const [id, schema] of Object.entries(this.plugin.schemaCatalog)) {
            if (!enabled.has(id)) continue;
            await provisionModule(
                this.plugin.settings,
                id,
                schema as any,
                this.plugin.i18nText("module." + id),
                { resolveName },
            );
        }
        try {
            await saveSettings(this.plugin, this.plugin.settings);
        } catch (e) {
            console.warn("[LvHome] saveSettings in provision failed:", e);
        }
    }

    async refreshHub(
        only?: string | string[],
        force = false,
        options?: { internalWarmup?: boolean },
    ): Promise<ScanResult> {
        // 若后台延迟预热正在进行中且本次为外部非强制全量扫描，直接复用其 in-flight 结果
        if (!only && !options?.internalWarmup && this.plugin.deferredWarmupPromise) {
            await this.plugin.deferredWarmupPromise;
            if (this.plugin.scan) return this.plugin.scan;
        }

        const onlySet = only ? new Set(Array.isArray(only) ? only : [only]) : undefined;
        if (!onlySet && !force && this.lastScanAt && Date.now() - this.lastScanAt < ScannerOrchestrator.FULL_SCAN_MIN_MS) {
            const cached = this.plugin.scan;
            if (cached) {
                this.plugin.emitHubChanged();
                return cached;
            }
        }

        const startFullSeq = onlySet ? this.fullScanSeq : ++this.fullScanSeq;
        const myIncSeq = onlySet ? ++this.incScanSeq : 0;
        const seq = onlySet ? myIncSeq : ++this.plugin.scanSeq;
        const perfMark = `lvhome-${onlySet ? "inc" : "scan"}-${seq}`;
        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark(`${perfMark}-start`);
        }

        const moduleStats = new Map<string, { rowCount: number; memberCounts: Record<string, number> }>();
        const deps = {
            settings: this.plugin.settings,
            getDbRef: (id: string) => this.plugin.settings.dbRefs[id],
            loadRowLogs: () => loadRowLogs(this.plugin),
            t: (key: string) => this.plugin.i18nText(key),
            onStats: (id: string, stats: { rowCount: number; memberCounts: Record<string, number> }) =>
                moduleStats.set(id, stats),
        };

        const providers = buildScanProviders(this.plugin.schemaCatalog, deps);
        const now = new Date();
        const scan = await runScan(providers, this.plugin.settings, this.plugin.runtime, now, onlySet, moduleStats);

        if (!onlySet) {
            if (startFullSeq !== this.fullScanSeq) return scan;
        } else {
            if (myIncSeq !== this.incScanSeq || startFullSeq !== this.fullScanSeq) return scan;
        }

        let finalScan: ScanResult = scan;
        let shouldSendWebhook = false;
        const enabledSet = new Set<string>(this.plugin.settings?.enabledModules ?? []);

        await withRuntime(this.plugin, async (rt) => {
            if (!onlySet && startFullSeq !== this.fullScanSeq) return;
            if (onlySet && (myIncSeq !== this.incScanSeq || startFullSeq !== this.fullScanSeq)) return;

            const mergedByModule: ScanResult["byModule"] = {};
            if (onlySet) {
                const prevByModule = rt.cache?.byModule ?? {};
                for (const [mid, slice] of Object.entries(prevByModule)) {
                    if (!onlySet.has(mid) && (enabledSet.has(mid) || mid === "adhoc")) {
                        mergedByModule[mid] = slice;
                    }
                }
                for (const mid of onlySet) {
                    if (scan.byModule[mid]) mergedByModule[mid] = scan.byModule[mid];
                }
            } else {
                Object.assign(mergedByModule, scan.byModule);
            }

            const sortedModules = Object.keys(mergedByModule).sort();
            const derived = sortedModules.length > 0
                ? sortedModules.flatMap((id) =>
                    [...(mergedByModule[id]?.reminders ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
                )
                : (!onlySet ? (scan.derived?.length ? scan.derived : scan.reminders) : []);

            const mergedErrors = onlySet
                ? [
                    ...(rt.cache?.errors ?? []).filter((e) => !onlySet.has(e.moduleId) && (enabledSet.has(e.moduleId) || e.moduleId === "adhoc")),
                    ...scan.errors,
                ]
                : scan.errors;

            const visible = deriveVisible(derived, this.plugin.settings, rt, now);
            finalScan = {
                reminders: visible.reminders,
                counts: visible.counts,
                scannedAt: scan.scannedAt,
                errors: mergedErrors,
                stale: mergedErrors.length > 0,
                derived,
                byModule: mergedByModule,
            };

            this.plugin.scan = finalScan;
            rt.cache = createRuntimeCacheSnapshot(finalScan);
            rt.scannedAt = finalScan.scannedAt;

            if (!onlySet) {
                let priorityCardDelivered = false;
                try {
                    const priorityRes = deliverPriorityReminderCard({
                        reminders: finalScan.reminders,
                        settings: this.plugin.settings,
                        runtime: rt,
                        t: (k) => this.plugin.i18nText(k),
                        onOpenReminders: () => this.plugin.openRemindersScreen(),
                        onOpenModule: (m) => this.plugin.openModuleTab(m),
                    });
                    priorityCardDelivered = priorityRes.delivered;
                } catch {
                    /* 优雅降级 */
                }

                const digest = dailyDigest(finalScan, this.plugin.settings, rt);
                if (digest.shouldNotify) {
                    markNotified(rt);
                    if (!priorityCardDelivered && (digest.overdue > 0 || digest.soon > 0)) {
                        const text = this.plugin
                            .i18nText("notify.digest")
                            .replace("${overdue}", String(digest.overdue))
                            .replace("${soon}", String(digest.soon));
                        homeNotify(text, 6000, "info");
                    }
                }

                const today = localDateKey(now);
                let pushedOverdueAlert = false;
                if (
                    finalScan.counts.overdue > 0 &&
                    !inSilentHours(this.plugin.settings, rt) &&
                    rt.lastOverdueAlertDate !== today
                ) {
                    rt.lastOverdueAlertDate = today;
                    if (!priorityCardDelivered) {
                        homeNotify(
                            this.plugin.i18nText("notify.overdue").replace("${n}", String(finalScan.counts.overdue)),
                            6000,
                            "error",
                        );
                    }
                    pushedOverdueAlert = true;
                }

                shouldSendWebhook = Boolean(digest.shouldNotify || pushedOverdueAlert);

                const weekly = weeklyPreview(finalScan, this.plugin.settings, rt);
                if (weekly.shouldNotify) {
                    markWeeklyNotified(rt);
                    homeNotify(this.plugin.i18nText("notify.weekly").replace("${n}", String(weekly.upcoming)), 6000, "info");
                }
            }

            purgeHandled(rt, now);

            if (!onlySet) {
                const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                const dueNowCount = finalScan.reminders.filter((r) => r.daysLeft <= 0).length;
                const completedCount = rt.monthlyCompletions?.[monthKey] ?? 0;
                const safeDueTotal = Math.max(dueNowCount + completedCount, rt.monthlyDueTotals?.[monthKey] ?? 0);
                rt.monthlyDueTotals = {
                    ...(rt.monthlyDueTotals ?? {}),
                    [monthKey]: safeDueTotal,
                };
                const { recordModuleHistory } = await import("@/core/hub/runtime");
                recordModuleHistory(rt, finalScan.reminders, now);
            }
        }, { allowInGuestMode: true });

        if (!onlySet && startFullSeq === this.fullScanSeq) {
            this.lastScanAt = Date.now();
        }
        if (shouldSendWebhook) {
            try {
                const { sendWebhook, buildDigestBody } = await import("@/core/webhook");
                const topTitles = finalScan.reminders
                    .filter((r) => r.level === "overdue" || (r.level === "soon" && r.daysLeft <= 7))
                    .sort((a, b) => a.daysLeft - b.daysLeft)
                    .slice(0, 3)
                    .map((r) => r.title);
                await sendWebhook(this.plugin.settings, buildDigestBody(finalScan.counts, topTitles));
            } catch { /* soft */ }
        }

        const scanDigest = `${finalScan.counts.overdue}|${finalScan.counts.soon}|${finalScan.reminders.length}`;
        if (scanDigest !== this.lastHubScanDigest) {
            this.lastHubScanDigest = scanDigest;
            console.debug(
                `[LvHome] 管家扫描完成：${finalScan.counts.overdue} 项逾期，${finalScan.counts.soon} 项临期（共 ${finalScan.reminders.length} 项）`,
            );
        }

        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark(`${perfMark}-end`);
            try {
                performance.measure(perfMark, `${perfMark}-start`, `${perfMark}-end`);
            } catch {
                /* 性能测量 */
            }
        }

        const todayDue = finalScan.reminders.filter((r) => r.daysLeft <= 0).length;
        this.plugin.updateStatusbar(todayDue);

        const expiringItems = (finalScan.reminders ?? []).filter((r) => typeof r.daysLeft === "number" && r.daysLeft <= 3);
        if (expiringItems.length > 0) {
            for (const item of expiringItems) {
                try {
                    await lvAutomation.trigger("siyuan-home", "expiring-item", {
                        id: item.id,
                        title: item.title,
                        dueDate: item.dueDate,
                    });
                } catch {
                    /* 容错降级 */
                }
            }
        }

        this.plugin.emitHubChanged();
        return finalScan;
    }
}
