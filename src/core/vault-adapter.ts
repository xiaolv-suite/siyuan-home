/**
 * 小驴管家 · 跨机容灾快照底座适配器 (lvSnapshotVault)
 *
 * 职责：
 * 1. 导出覆盖 settings + runtime + rowlogs.json 的完整快照；
 * 2. 强制脱敏剥离 Bark webhookUrl、API Key、Token、Secret 与大图 base64，仅保留 hasWebhookConfigured 布尔占位；
 * 3. 精确统计核心配置、台账绑定/规则、计划待办与 rowlogs 记录数（空库严格返回 0）；
 * 4. 提供可读差异摘要 (previewDiff) 与幂等合并恢复 (importMerge)；
 * 5. 在核心持久化写盘后触发 60s 节流自动备份，并在 onunload 时彻底注销。
 */
import { lvSnapshotVault, type LvVaultPluginAdapter } from "@/libs/lv-notice-kit";
import type { FamilyMember, HomeSettings } from "@/types";
import { BUILT_IN_MODULES } from "./modules";
import { countTotalLogEntries, loadRowLogs, saveRowLogs, type LogKind, type RowLog, type RowLogs } from "./rowlog";
import { defaultSettings, isPlainObject, normalizeCheckinBindings, saveSettings } from "./settings";
import { defaultRuntime, loadRuntime, saveRuntime } from "./hub/runtime-store";
import type { HubRuntime } from "./hub/runtime-types";
import {
    isHomeVaultRegistered,
    scheduleHomeVaultBackup,
    setHomeVaultRegistered,
    setHomeVaultRestoring,
} from "./vault-trigger";

export { isHomeVaultRegistered, scheduleHomeVaultBackup };

const PLUGIN_VERSION = typeof __PLUGIN_VERSION__ !== "undefined" ? __PLUGIN_VERSION__ : "0.5.202";

const SECRET_FIELD_EXACT_RX =
    /^(?:api[-_]?key|fallback[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|gist[-_]?token|bot[-_]?token|client[-_]?secret|app[-_]?secret|secret[-_]?key|private[-_]?key|password|passwd|credential|aiKey|backupKey|wereadApiKey|wereadIntegration|webhookUrl|barkUrl|token|secret)$/i;
const SECRET_FIELD_SUFFIX_RX =
    /(?:api[-_]?key|fallback[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|gist[-_]?token|bot[-_]?token|client[-_]?secret|app[-_]?secret|secret[-_]?key|private[-_]?key|password|passwd|credential|webhookUrl|barkUrl)$/i;
const VALUE_SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{8,}/g,
    /Bearer\s+[A-Za-z0-9._-]{6,}/gi,
    /ghp_[A-Za-z0-9]{10,}/g,
    /xox[baprs]-[A-Za-z0-9-]{8,}/g,
    /https?:\/\/api\.day\.app\/[^\s"']+/gi,
];

const SAFE_META_KEY_RX = /^(?:hasWebhookConfigured|hasSecret|secretSlot|secretSlots|configuredSecretSlots)$/i;

export function sanitizeHomeValueForBackup(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
        let out = value;
        for (const rx of VALUE_SECRET_PATTERNS) {
            out = out.replace(rx, "[REDACTED_SECRET]");
        }
        return out;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeHomeValueForBackup(item));
    }
    if (typeof value === "object") {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (!SAFE_META_KEY_RX.test(k) && (SECRET_FIELD_EXACT_RX.test(k) || SECRET_FIELD_SUFFIX_RX.test(k))) {
                continue;
            }
            if (k === "avatarImage" && typeof v === "string" && v.startsWith("data:")) {
                continue;
            }
            clean[k] = sanitizeHomeValueForBackup(v);
        }
        return clean;
    }
    return value;
}

export function sanitizeHomeSettingsForBackup(
    settings: Partial<HomeSettings> | Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!settings || typeof settings !== "object") return {};
    const raw = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
    const rawWebhook = typeof raw.webhookUrl === "string" ? raw.webhookUrl.trim() : "";
    const hasWebhookConfigured = Boolean(rawWebhook || raw.hasWebhookConfigured === true);
    delete raw.webhookUrl;
    delete raw.barkUrl;
    delete raw.corruptedSettings;
    if (typeof raw.avatarImage === "string" && raw.avatarImage.startsWith("data:")) {
        delete raw.avatarImage;
    }
    const sanitized = sanitizeHomeValueForBackup(raw) as Record<string, unknown>;
    sanitized.hasWebhookConfigured = hasWebhookConfigured;
    return sanitized;
}

function extractCoreRuntimeForBackup(runtime: Partial<HubRuntime> | Record<string, unknown> | undefined): Record<string, unknown> {
    if (!runtime || typeof runtime !== "object") {
        return {
            memos: [],
            handled: {},
            handledYear: {},
            handledUntil: {},
            monthlyCompletions: {},
        };
    }
    const rt = runtime as Record<string, unknown>;
    const pickObj = (k: string) =>
        rt[k] && typeof rt[k] === "object" && !Array.isArray(rt[k]) ? sanitizeHomeValueForBackup(JSON.parse(JSON.stringify(rt[k]))) : {};
    const pickArr = (k: string) =>
        Array.isArray(rt[k]) ? sanitizeHomeValueForBackup(JSON.parse(JSON.stringify(rt[k]))) : [];

    const out: Record<string, unknown> = {
        memos: pickArr("memos"),
        handled: pickObj("handled"),
        handledYear: pickObj("handledYear"),
        handledUntil: pickObj("handledUntil"),
        monthlyCompletions: pickObj("monthlyCompletions"),
        snoozed: pickObj("snoozed"),
        snoozeCounts: pickObj("snoozeCounts"),
        decomposedReminders: pickObj("decomposedReminders"),
        planDates: pickObj("planDates"),
        muted: pickObj("muted"),
        renewHistory: pickObj("renewHistory"),
        namedViews: pickArr("namedViews"),
        pinnedMemoIds: pickArr("pinnedMemoIds"),
        pinnedReminderIds: pickArr("pinnedReminderIds"),
        favorSyncs: pickObj("favorSyncs"),
        monthlyDueTotals: pickObj("monthlyDueTotals"),
        moduleHistory: pickObj("moduleHistory"),
        trash: pickArr("trash"),
    };
    if (typeof rt.activeNamedViewId === "string" && rt.activeNamedViewId) out.activeNamedViewId = rt.activeNamedViewId;
    if (typeof rt.hubViewMode === "string") out.hubViewMode = rt.hubViewMode;
    if (typeof rt.hubCalMode === "string") out.hubCalMode = rt.hubCalMode;
    if (typeof rt.hubQuickModule === "string") out.hubQuickModule = rt.hubQuickModule;
    if (typeof rt.todaySilent === "string") out.todaySilent = rt.todaySilent;
    if (typeof rt.lastNotifiedDate === "string") out.lastNotifiedDate = rt.lastNotifiedDate;
    if (typeof rt.lastOverdueAlertDate === "string") out.lastOverdueAlertDate = rt.lastOverdueAlertDate;
    if (typeof rt.lastWeeklyDigest === "string") out.lastWeeklyDigest = rt.lastWeeklyDigest;
    return out;
}

export async function exportHomeSnapshot(plugin: any): Promise<Record<string, unknown>> {
    const sanitizedSettings = sanitizeHomeSettingsForBackup(plugin?.settings);
    const coreRuntime = extractCoreRuntimeForBackup(plugin?.runtime);
    let rowlogs: RowLogs = {};
    if (plugin && typeof plugin.loadData === "function") {
        try {
            rowlogs = await loadRowLogs(plugin);
        } catch {
            rowlogs = {};
        }
    }
    const sanitizedRowlogs = (sanitizeHomeValueForBackup(JSON.parse(JSON.stringify(rowlogs))) ?? {}) as RowLogs;

    return {
        version: PLUGIN_VERSION,
        exportedAt: new Date().toISOString(),
        settings: sanitizedSettings,
        runtime: coreRuntime,
        rowlogs: sanitizedRowlogs,
        coreLedgers: {
            members: Array.isArray(sanitizedSettings.members) ? sanitizedSettings.members : [],
            enabledModules: Array.isArray(sanitizedSettings.enabledModules) ? sanitizedSettings.enabledModules : [],
            dbRefs: isPlainObject(sanitizedSettings.dbRefs) ? sanitizedSettings.dbRefs : {},
        },
    };
}

export interface HomeSnapshotCountSummary {
    total: number;
    members: number;
    ledgers: number;
    rules: number;
    plans: number;
    memos: number;
    rowlogs: number;
}

export function summarizeHomeSnapshotCounts(snapshot: unknown): HomeSnapshotCountSummary {
    if (!isPlainObject(snapshot)) {
        return { total: 0, members: 0, ledgers: 0, rules: 0, plans: 0, memos: 0, rowlogs: 0 };
    }
    const s = isPlainObject(snapshot.settings) ? snapshot.settings : {};
    const rt = isPlainObject(snapshot.runtime) ? snapshot.runtime : {};
    const rowlogsObj = isPlainObject(snapshot.rowlogs) ? (snapshot.rowlogs as RowLogs) : {};

    const members = Array.isArray(s.members) ? s.members.length : 0;

    let ledgers = 0;
    if (isPlainObject(s.dbRefs)) {
        for (const ref of Object.values(s.dbRefs)) {
            if (isPlainObject(ref) && (typeof ref.avId === "string" && ref.avId.trim() || typeof ref.docId === "string" && ref.docId.trim())) {
                ledgers++;
            }
        }
    }

    let rules = 0;
    if (isPlainObject(s.leadOverrides)) rules += Object.keys(s.leadOverrides).length;
    if (isPlainObject(s.budgetLimits)) rules += Object.keys(s.budgetLimits).length;
    if (Array.isArray(s.checkinBindings)) rules += s.checkinBindings.length;
    if (Array.isArray(s.pinnedLedgers)) rules += s.pinnedLedgers.length;
    if (isPlainObject(s.columnVisibility)) rules += Object.keys(s.columnVisibility).length;
    if (isPlainObject(s.ledgerSort)) rules += Object.keys(s.ledgerSort).length;
    if (s.onboarded === true) rules += 1;
    if (typeof s.targetNotebookId === "string" && s.targetNotebookId.trim()) rules += 1;
    if (s.webhookEnabled === true) rules += 1;

    const memos = Array.isArray(rt.memos) ? rt.memos.length : 0;

    let plans = 0;
    if (isPlainObject(rt.planDates)) plans += Object.keys(rt.planDates).length;
    if (isPlainObject(rt.snoozed)) plans += Object.keys(rt.snoozed).length;
    if (isPlainObject(rt.muted)) plans += Object.keys(rt.muted).length;
    if (Array.isArray(rt.namedViews)) plans += rt.namedViews.length;
    if (isPlainObject(rt.handled)) plans += Object.keys(rt.handled).length;
    if (isPlainObject(rt.handledYear)) plans += Object.keys(rt.handledYear).length;
    if (isPlainObject(rt.handledUntil)) plans += Object.keys(rt.handledUntil).length;
    if (isPlainObject(rt.renewHistory)) {
        for (const arr of Object.values(rt.renewHistory)) {
            if (Array.isArray(arr)) plans += arr.length;
        }
    }
    if (Array.isArray(rt.trash)) plans += rt.trash.length;

    const rowlogs = countTotalLogEntries(rowlogsObj);
    const total = members + ledgers + rules + plans + memos + rowlogs;
    return { total, members, ledgers, rules, plans, memos, rowlogs };
}

export function countHomeSnapshotRecords(snapshot: Record<string, unknown>): number {
    return summarizeHomeSnapshotCounts(snapshot).total;
}

export async function previewHomeSnapshotDiff(
    plugin: any,
    incoming: Record<string, unknown>,
): Promise<{ currentCount: number; incomingCount: number; summary: string }> {
    const currentSnap = await exportHomeSnapshot(plugin);
    const cur = summarizeHomeSnapshotCounts(currentSnap);
    const inc = summarizeHomeSnapshotCounts(incoming);
    const summary =
        `成员 ${cur.members}→${inc.members} · 台账绑定 ${cur.ledgers}→${inc.ledgers} · 配置规则 ${cur.rules}→${inc.rules} · 计划/待办 ${cur.plans + cur.memos}→${inc.plans + inc.memos} · 操作行日志 ${cur.rowlogs}→${inc.rowlogs}`;
    return {
        currentCount: cur.total,
        incomingCount: inc.total,
        summary,
    };
}

const LOG_KINDS: LogKind[] = [
    "valuations",
    "moves",
    "prices",
    "transfers",
    "meters",
    "checks",
    "loans",
    "deposits",
    "fuelings",
    "chargings",
    "maintenance",
    "chexecs",
    "vitals",
    "quickflows",
];

export function mergeRowLogsForRestore(current: RowLogs, incomingRaw: unknown): RowLogs {
    if (!isPlainObject(incomingRaw)) return current;
    const out: RowLogs = JSON.parse(JSON.stringify(current ?? {})) as RowLogs;

    for (const [key, rawGroup] of Object.entries(incomingRaw)) {
        if (!isPlainObject(rawGroup)) continue;
        const targetGroup: RowLog = (out[key] = out[key] ? { ...out[key] } : {});

        for (const kind of LOG_KINDS) {
            const incomingList = (rawGroup as Record<string, unknown>)[kind];
            if (!Array.isArray(incomingList) || incomingList.length === 0) continue;
            const existingList = Array.isArray(targetGroup[kind])
                ? ([...(targetGroup[kind] as Record<string, unknown>[])] as Record<string, unknown>[])
                : [];

            if (kind === "valuations" || kind === "meters") {
                const seenDates = new Set(existingList.map((e) => String(e?.date || "")).filter(Boolean));
                for (const item of incomingList) {
                    if (!isPlainObject(item)) continue;
                    const date = String(item.date || "");
                    if (!date || seenDates.has(date)) continue;
                    seenDates.add(date);
                    existingList.push(item);
                }
            } else {
                const sig = (e: Record<string, unknown>) => JSON.stringify({ ...e, at: "" });
                const seenSigs = new Set(existingList.map((e) => sig(e)));
                for (const item of incomingList) {
                    if (!isPlainObject(item)) continue;
                    const s = sig(item);
                    if (seenSigs.has(s)) continue;
                    seenSigs.add(s);
                    existingList.push(item);
                }
            }
            targetGroup[kind] = existingList as any;
        }
    }
    return out;
}

function mergeMembers(current: FamilyMember[] = [], incoming: unknown): FamilyMember[] {
    if (!Array.isArray(incoming)) return current;
    const byId = new Map<string, FamilyMember>();
    for (const m of current) {
        if (m && typeof m.id === "string") byId.set(m.id, m);
    }
    for (const raw of incoming) {
        if (!isPlainObject(raw) || typeof raw.id !== "string" || !raw.id) continue;
        const existing = byId.get(raw.id);
        if (!existing) {
            byId.set(raw.id, raw as unknown as FamilyMember);
        } else {
            byId.set(raw.id, { ...raw, ...existing } as FamilyMember);
        }
    }
    return Array.from(byId.values());
}

export async function restoreHomeSnapshotMerge(plugin: any, incoming: Record<string, unknown>): Promise<boolean> {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return false;

    const hasSettings = isPlainObject(incoming.settings);
    const hasRuntime = isPlainObject(incoming.runtime);
    const hasRowlogs = isPlainObject(incoming.rowlogs);
    if (!hasSettings && !hasRuntime && !hasRowlogs) return false;

    const settingsObj = hasSettings ? (incoming.settings as Record<string, unknown>) : undefined;
    const runtimeObj = hasRuntime ? (incoming.runtime as Record<string, unknown>) : undefined;
    const rowlogsObj = hasRowlogs ? (incoming.rowlogs as Record<string, unknown>) : undefined;

    const hasKnownSettingsField = Boolean(
        settingsObj &&
            (Array.isArray(settingsObj.enabledModules) ||
                Array.isArray(settingsObj.members) ||
                isPlainObject(settingsObj.dbRefs) ||
                typeof settingsObj.onboarded === "boolean"),
    );
    const hasKnownRuntimeField = Boolean(
        runtimeObj &&
            (Array.isArray(runtimeObj.memos) ||
                isPlainObject(runtimeObj.handled) ||
                isPlainObject(runtimeObj.handledYear) ||
                isPlainObject(runtimeObj.handledUntil) ||
                isPlainObject(runtimeObj.monthlyCompletions) ||
                isPlainObject(runtimeObj.planDates) ||
                isPlainObject(runtimeObj.snoozed) ||
                isPlainObject(runtimeObj.renewHistory)),
    );
    const hasKnownRowlogsField = Boolean(rowlogsObj && Object.keys(rowlogsObj).length > 0);
    if (!hasKnownSettingsField && !hasKnownRuntimeField && !hasKnownRowlogsField) return false;

    setHomeVaultRestoring(plugin, true);
    try {
        if (hasSettings && settingsObj) {
            const curSettings: HomeSettings = plugin.settings ?? defaultSettings();
            const knownIds = new Set(BUILT_IN_MODULES.map((m) => m.id));
            const incEnabled = Array.isArray(settingsObj.enabledModules)
                ? settingsObj.enabledModules.filter((id): id is string => typeof id === "string" && knownIds.has(id))
                : [];
            const mergedEnabled =
                curSettings.onboarded || (curSettings.dbRefs && Object.keys(curSettings.dbRefs).length > 0)
                    ? Array.from(new Set([...(curSettings.enabledModules ?? []), ...incEnabled]))
                    : incEnabled.length > 0
                      ? incEnabled
                      : curSettings.enabledModules;

            const mergedDbRefs: HomeSettings["dbRefs"] = { ...(curSettings.dbRefs ?? {}) };
            if (isPlainObject(settingsObj.dbRefs)) {
                for (const [modId, rawRef] of Object.entries(settingsObj.dbRefs)) {
                    if (!isPlainObject(rawRef)) continue;
                    const existingRef = mergedDbRefs[modId];
                    if (!existingRef || (!existingRef.avId && !existingRef.docId)) {
                        mergedDbRefs[modId] = rawRef as HomeSettings["dbRefs"][string];
                    } else {
                        mergedDbRefs[modId] = {
                            ...rawRef,
                            ...existingRef,
                            columns: {
                                ...(isPlainObject(rawRef.columns) ? rawRef.columns : {}),
                                ...(isPlainObject(existingRef.columns) ? existingRef.columns : {}),
                            },
                        } as HomeSettings["dbRefs"][string];
                    }
                }
            }

            const incomingWebhook = typeof settingsObj.webhookUrl === "string" ? settingsObj.webhookUrl.trim() : "";
            const nextWebhookUrl = curSettings.webhookUrl?.trim() ? curSettings.webhookUrl : incomingWebhook;
            const incomingClean = { ...settingsObj };
            delete incomingClean.webhookUrl;
            delete incomingClean.barkUrl;
            delete incomingClean.hasWebhookConfigured;

            const mergedBindings = normalizeCheckinBindings([
                ...(curSettings.checkinBindings ?? []),
                ...(Array.isArray(settingsObj.checkinBindings) ? settingsObj.checkinBindings : []),
            ]);

            plugin.settings = {
                ...curSettings,
                ...incomingClean,
                enabledModules: mergedEnabled,
                members: mergeMembers(curSettings.members, settingsObj.members),
                dbRefs: mergedDbRefs,
                leadOverrides: {
                    ...(curSettings.leadOverrides ?? {}),
                    ...(isPlainObject(settingsObj.leadOverrides) ? (settingsObj.leadOverrides as Record<string, number>) : {}),
                },
                budgetLimits: {
                    ...(curSettings.budgetLimits ?? {}),
                    ...(isPlainObject(settingsObj.budgetLimits) ? (settingsObj.budgetLimits as Record<string, number>) : {}),
                },
                columnVisibility: {
                    ...(curSettings.columnVisibility ?? {}),
                    ...(isPlainObject(settingsObj.columnVisibility) ? (settingsObj.columnVisibility as Record<string, string[]>) : {}),
                },
                ledgerSort: {
                    ...(curSettings.ledgerSort ?? {}),
                    ...(isPlainObject(settingsObj.ledgerSort)
                        ? (settingsObj.ledgerSort as Record<string, { key: string; asc: boolean }>)
                        : {}),
                },
                checkinBindings: mergedBindings,
                onboarded: Boolean(curSettings.onboarded || settingsObj.onboarded),
                webhookUrl: nextWebhookUrl,
                webhookEnabled: nextWebhookUrl ? Boolean(curSettings.webhookEnabled ?? settingsObj.webhookEnabled) : false,
                avatarImage: curSettings.avatarImage || (typeof settingsObj.avatarImage === "string" ? settingsObj.avatarImage : undefined),
            };
            await saveSettings(plugin, plugin.settings);
        }

        if (hasRuntime && runtimeObj) {
            if (!plugin.runtime) {
                plugin.runtime = typeof plugin.loadData === "function" ? await loadRuntime(plugin) : defaultRuntime();
            }
            const rt = plugin.runtime as HubRuntime;

            if (Array.isArray(runtimeObj.memos)) {
                const byId = new Map<string, any>();
                for (const m of rt.memos ?? []) {
                    if (m?.id) byId.set(m.id, m);
                }
                for (const m of runtimeObj.memos as any[]) {
                    if (m?.id && !byId.has(m.id)) byId.set(m.id, m);
                }
                rt.memos = Array.from(byId.values());
            }

            const mergeStringOrObjMap = (key: keyof HubRuntime) => {
                const inc = runtimeObj[key as string];
                if (isPlainObject(inc)) {
                    (rt as any)[key] = { ...((rt as any)[key] ?? {}), ...inc };
                }
            };
            mergeStringOrObjMap("handled");
            mergeStringOrObjMap("handledYear");
            mergeStringOrObjMap("handledUntil");
            mergeStringOrObjMap("monthlyCompletions");
            mergeStringOrObjMap("monthlyDueTotals");
            mergeStringOrObjMap("snoozed");
            mergeStringOrObjMap("snoozeCounts");
            mergeStringOrObjMap("decomposedReminders");
            mergeStringOrObjMap("planDates");
            mergeStringOrObjMap("muted");
            mergeStringOrObjMap("favorSyncs");
            mergeStringOrObjMap("moduleHistory");

            if (isPlainObject(runtimeObj.renewHistory)) {
                const nextRenew = { ...(rt.renewHistory ?? {}) };
                for (const [rowId, arr] of Object.entries(runtimeObj.renewHistory)) {
                    if (!Array.isArray(arr)) continue;
                    const existing = Array.isArray(nextRenew[rowId]) ? [...nextRenew[rowId]] : [];
                    const seen = new Set(existing.map((e) => `${e.from}|${e.to}|${e.at}`));
                    for (const item of arr) {
                        if (!isPlainObject(item)) continue;
                        const sig = `${item.from}|${item.to}|${item.at}`;
                        if (!seen.has(sig)) {
                            seen.add(sig);
                            existing.push(item as { from: string; to: string; at: string });
                        }
                    }
                    nextRenew[rowId] = existing;
                }
                rt.renewHistory = nextRenew;
            }

            if (Array.isArray(runtimeObj.namedViews)) {
                const byId = new Map<string, any>();
                for (const v of rt.namedViews ?? []) {
                    if (v?.id) byId.set(v.id, v);
                }
                for (const v of runtimeObj.namedViews as any[]) {
                    if (v?.id && !byId.has(v.id)) byId.set(v.id, v);
                }
                rt.namedViews = Array.from(byId.values());
            }

            for (const arrKey of ["pinnedMemoIds", "pinnedReminderIds"] as const) {
                if (Array.isArray(runtimeObj[arrKey])) {
                    rt[arrKey] = Array.from(new Set([...(rt[arrKey] ?? []), ...(runtimeObj[arrKey] as string[])]));
                }
            }

            if (Array.isArray(runtimeObj.trash)) {
                const existing = [...(rt.trash ?? [])];
                const seen = new Set(existing.map((t) => `${t.id}|${t.deletedAt}`));
                for (const item of runtimeObj.trash as any[]) {
                    if (!isPlainObject(item) || typeof item.id !== "string" || typeof item.deletedAt !== "string") continue;
                    const sig = `${item.id}|${item.deletedAt}`;
                    if (!seen.has(sig)) {
                        seen.add(sig);
                        existing.push(item as any);
                    }
                }
                rt.trash = existing;
            }

            await saveRuntime(plugin, rt);
        }

        if (hasRowlogs && rowlogsObj && typeof plugin.saveData === "function") {
            const currentRowLogs = typeof plugin.loadData === "function" ? await loadRowLogs(plugin) : {};
            const mergedLogs = mergeRowLogsForRestore(currentRowLogs, rowlogsObj);
            await saveRowLogs(plugin, mergedLogs);
        }

        plugin.emitHubChanged?.();
        plugin.refreshHub?.(undefined, true)?.catch?.(() => undefined);
        return true;
    } catch (err) {
        console.error("[LvHome] restoreHomeSnapshotMerge failed:", err);
        return false;
    } finally {
        setHomeVaultRestoring(plugin, false);
    }
}

export function createHomeVaultAdapter(plugin: any): LvVaultPluginAdapter {
    return {
        pluginId: "siyuan-home",
        label: "小驴管家",
        schemaVersion: 1,
        countRecords: (snapshot) => countHomeSnapshotRecords(snapshot),
        exportSnapshot: () => exportHomeSnapshot(plugin),
        previewDiff: (incoming) => previewHomeSnapshotDiff(plugin, incoming),
        importMerge: (incoming) => restoreHomeSnapshotMerge(plugin, incoming),
    };
}

export function registerHomeSnapshotVault(plugin: any): () => void {
    if (!plugin) return () => {};
    setHomeVaultRegistered(plugin, true);
    const adapter = createHomeVaultAdapter(plugin);
    const unregisterAdapter = lvSnapshotVault.register(adapter);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        setHomeVaultRegistered(plugin, false);
        try {
            unregisterAdapter();
        } catch {
            /* soft */
        }
        try {
            lvSnapshotVault.unregister("siyuan-home");
        } catch {
            /* soft */
        }
    };
}
