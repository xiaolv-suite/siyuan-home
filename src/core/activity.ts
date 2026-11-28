/**
 * 只读活动投影：将语义明确的台账日期和 rowlogs 子记录映射为界面时间线。
 * 摘要仅保存在当前进程内存，不写入同步运行态或设置文件。
 */
import type { Plugin } from "siyuan";
import type { HomePluginLike } from "@/types/plugin";
import { renderLedgerAll, type AvRow, type RequestOptions } from "./siyuan";
import { loadRowLogs, type LogKind, type RowLogs } from "./rowlog";
import { queryDiaryEventsFromSql, type QueriedDiaryEvent } from "./diary-envelope";
import type { ModuleSchema } from "./schema";

export interface ActivityDetail {
    key: string;
    value: string;
    /** select 值的可选 i18n 键。 */
    valueKey?: string;
}

export interface ActivityRecord {
    id: string;
    moduleId: string;
    avId: string;
    rowId: string;
    title: string;
    memberId?: string;
    /** 事项日期；rowlog 与 schema 中声明的业务日期来自这里。 */
    eventDate?: string;
    /** 仅在源数据提供真实录入/创建时间时存在。 */
    recordedAt?: string;
    /** 供排序；优先真实录入时间，其次事项日期。 */
    sortAt: number;
    source: "ledger" | "rowlog" | "diary";
    logKind?: LogKind;
    /** 日记流水来源标识（支持一键跳回源日记块） */
    eventId?: string;
    diaryBlockId?: string;
    diaryDocId?: string;
    /** Gate-4：源台账资产行已删除/失效时标灰提示，但历史金额与统计 0 丢失 */
    sourceInvalidated?: boolean;
    /** 金额与符号（支持退款 sign=-1 与账户互转 flowScope='neutral' 过滤） */
    amount?: number;
    sign?: number;
    flowScope?: string;
    details: ActivityDetail[];
}

export interface ActivityReadError {
    moduleId: string;
    message: string;
}

export interface ActivitySnapshot {
    records: ActivityRecord[];
    errors: ActivityReadError[];
    coveredModules: string[];
    eligibleModules: number;
    orphanedRowLogs: number;
    loadedAt: string;
}

export interface ActivityTarget {
    requestId: string;
    moduleId: string;
    rowId: string;
    source?: "ledger" | "rowlog";
    logKind?: LogKind;
    entryAt?: string;
    eventDate?: string;
    activityId?: string;
}

const LOG_KINDS: readonly LogKind[] = ["valuations", "moves", "prices", "transfers", "meters", "checks", "loans", "deposits", "fuelings", "chargings", "maintenance", "chexecs", "vitals"];
const ROWLOG_DETAIL_KEYS: Partial<Record<LogKind, readonly string[]>> = {
    valuations: ["value"], moves: ["from", "to"], prices: ["price", "channel"],
    transfers: ["from", "to"], meters: ["reading", "usage"], checks: ["result"],
    loans: ["to", "back"], deposits: ["amount"],
    fuelings: ["fuelGrade", "quantity", "odometer", "totalCost", "station"],
    chargings: ["chargingMode", "quantity", "odometer", "totalCost", "station"],
    maintenance: ["category", "odometer", "cost", "shop"],
    chexecs: ["points", "note"],
    vitals: ["val1", "val2", "pulse", "note"],
};

interface CacheEntry {
    snapshots: Map<number, ActivitySnapshot>;
    inFlight: Map<number, Promise<ActivitySnapshot>>;
}

const activityCache = new WeakMap<object, CacheEntry>();

function validDate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : undefined;
}

function dateFromCell(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const date = (value as { date?: { content?: unknown; isNotEmpty?: unknown } }).date;
    if (!date || date.isNotEmpty !== true) return undefined;
    const raw = date.content;
    const milliseconds = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(milliseconds)) return undefined;
    const parsed = new Date(milliseconds);
    if (!Number.isFinite(parsed.getTime())) return undefined;
    const y = parsed.getFullYear();
    if (y < 1900 || y > 2200) return undefined;
    return `${y}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function normalizedTimestamp(raw: unknown): string | undefined {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    const d = Number.isFinite(n) ? new Date(n > 1_000_000_000 && n < 100_000_000_000 ? n * 1000 : n)
        : typeof raw === "string" ? new Date(raw) : new Date(NaN);
    if (!Number.isFinite(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200) return undefined;
    return d.toISOString();
}

/** Pull only explicit system creation metadata. Never treat an event/deadline date as insertion time. */
function recordedAtFromRow(row: AvRow): string | undefined {
    for (const cell of Object.values(row.cells)) {
        if (!cell || typeof cell !== "object") continue;
        const value = cell as { createdAt?: unknown; created?: { content?: unknown } };
        const created = normalizedTimestamp(value.createdAt)
            ?? normalizedTimestamp(value.created?.content);
        if (created) return created;
    }
    return undefined;
}

function scalarFromCell(value: unknown): { text: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, any>;
    const candidates = [
        typeof v.text?.content === "string" ? v.text.content : undefined,
        typeof v.block?.content === "string" ? v.block.content : undefined,
        typeof v.select?.content === "string" ? v.select.content : undefined,
        typeof v.mSelect?.[0]?.content === "string" ? v.mSelect[0].content : undefined,
        typeof v.number?.content === "number" && Number.isFinite(v.number.content) ? String(v.number.content) : undefined,
        typeof v.checkbox?.checked === "boolean" ? (v.checkbox.checked ? "true" : "false") : undefined,
    ];
    const text = candidates.find((candidate) => candidate?.trim());
    if (!text) return undefined;
    const safe = text.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
    return { text: safe };
}

function cellDetails(row: AvRow, columns: Record<string, string> | undefined, fields: string[]): ActivityDetail[] {
    if (!columns) return [];
    const output: ActivityDetail[] = [];
    for (const key of fields) {
        const cell = scalarFromCell(row.cells[columns[key]]);
        if (!cell) continue;
        const raw = row.cells[columns[key]] as Record<string, any> | undefined;
        const selected = raw?.select?.content ?? raw?.mSelect?.[0]?.content;
        output.push({ key, value: cell.text, valueKey: typeof selected === "string" ? `field.${key}.opt.${selected}` : undefined });
        if (output.length >= 4) break;
    }
    return output;
}

function rowName(row: AvRow, columns: Record<string, string> | undefined): string {
    if (!columns?.name) return "";
    return scalarFromCell(row.cells[columns.name])?.text ?? "";
}

function relationMember(row: AvRow, columns: Record<string, string> | undefined, memberByAvItem: Map<string, string>): string | undefined {
    const relationKey = columns?.member;
    if (!relationKey) return undefined;
    const blockIDs = row.cells[relationKey]?.relation?.blockIDs;
    return Array.isArray(blockIDs) && typeof blockIDs[0] === "string" ? memberByAvItem.get(blockIDs[0]) : undefined;
}

function eventTimestamp(day: string | undefined): number | undefined {
    if (!day) return undefined;
    const value = new Date(`${day}T12:00:00`).getTime();
    return Number.isFinite(value) ? value : undefined;
}

function shortId(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
}

/** Stable identity used by both the activity projection and the source detail view. */
export function rowLogActivityId(moduleId: string, rowId: string, kind: LogKind, entry: Record<string, unknown>): string {
    return `${moduleId}|${rowId}|${kind}|${shortId(JSON.stringify(entry))}`;
}

function entryDetails(kind: LogKind, entry: Record<string, unknown>): ActivityDetail[] {
    const details: ActivityDetail[] = [];
    for (const key of ROWLOG_DETAIL_KEYS[kind] ?? []) {
        const value = entry[key];
        if (typeof value === "string" && value.trim()) {
            const valueKey = key === "fuelGrade" || key === "chargingMode" || (key === "category" && kind === "maintenance")
                ? `activity.value.${key}.${value.trim()}` : undefined;
            details.push({ key, value: value.trim().replace(/[\r\n\t]+/g, " ").slice(0, 100), valueKey });
        }
        else if (typeof value === "number" && Number.isFinite(value)) details.push({ key, value: String(value) });
        if (details.length >= 4) break;
    }
    return details;
}

export function projectRowLogActivities(input: {
    moduleId: string;
    avId: string;
    rows: AvRow[];
    logs: RowLogs;
    columns?: Record<string, string>;
    memberByAvItem?: Map<string, string>;
}): { records: ActivityRecord[]; orphaned: number } {
    const { moduleId, avId, rows, logs, columns, memberByAvItem = new Map() } = input;
    const rowById = new Map(rows.map((row) => [row.itemID, row]));
    const prefix = `${avId}|`;
    const records: ActivityRecord[] = [];
    let orphaned = 0;
    for (const [key, grouped] of Object.entries(logs)) {
        if (!key.startsWith(prefix) || !grouped || typeof grouped !== "object") continue;
        const rowId = key.slice(prefix.length);
        const row = rowById.get(rowId);
        if (!row) {
            if (LOG_KINDS.some((kind) => Array.isArray(grouped[kind]) && grouped[kind]!.length > 0)) orphaned++;
            continue;
        }
        const title = rowName(row, columns) || "未命名记录";
        for (const kind of LOG_KINDS) {
            const entries = grouped[kind];
            if (!Array.isArray(entries)) continue;
            for (const raw of entries) {
                if (!raw || typeof raw !== "object") continue;
                const entry = raw as Record<string, unknown>;
                const eventDate = validDate(entry.date);
                if (!eventDate) continue;
                const recordedAt = normalizedTimestamp(entry.at);
                const baseTime = recordedAt ? new Date(recordedAt).getTime() : eventTimestamp(eventDate);
                if (baseTime === undefined) continue;
                const entryMemberId = typeof entry.memberId === "string" && entry.memberId.trim()
                    ? (memberByAvItem.get(entry.memberId.trim()) ?? entry.memberId.trim())
                    : relationMember(row, columns, memberByAvItem);
                records.push({
                    id: rowLogActivityId(moduleId, rowId, kind, entry),
                    moduleId, avId, rowId, title, memberId: entryMemberId,
                    eventDate, recordedAt, sortAt: baseTime, source: "rowlog", logKind: kind,
                    details: entryDetails(kind, entry),
                });
            }
        }
    }
    return { records, orphaned };
}

/** Project a single AV row for tests and shared consumers. */
export function projectLedgerActivity(input: {
    moduleId: string;
    avId: string;
    row: AvRow;
    schema: ModuleSchema;
    columns?: Record<string, string>;
    memberByAvItem?: Map<string, string>;
}): ActivityRecord | undefined {
    const { moduleId, avId, row, schema, columns } = input;
    const recordedAt = recordedAtFromRow(row);
    const dateKey = schema.activity?.dateField;
    const eventDate = dateKey && columns?.[dateKey] ? dateFromCell(row.cells[columns[dateKey]]) : undefined;
    const effectiveTime = recordedAt ? new Date(recordedAt).getTime() : eventTimestamp(eventDate);
    if (effectiveTime === undefined) return undefined;
    const title = rowName(row, columns);
    const details = cellDetails(row, columns, schema.activity?.detailFields ?? []);
    if (eventDate && recordedAt && eventDate !== recordedAt.slice(0, 10)) details.unshift({ key: dateKey ?? "date", value: eventDate });
    return {
        id: `${moduleId}|${row.itemID}|ledger`, moduleId, avId, rowId: row.itemID,
        title, memberId: relationMember(row, columns, input.memberByAvItem ?? new Map()),
        eventDate, recordedAt, sortAt: effectiveTime, source: "ledger", details: details.slice(0, 4),
    };
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const output = new Array<R>(items.length);
    let cursor = 0;
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            output[index] = await run(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return output;
}

/** 将日记流水投影为跨层聚合记录（含 Gate-4 来源失效标灰与 0 金额丢失） */
export function projectDiaryActivities(input: {
    events: QueriedDiaryEvent[];
    liveRowIdsByModule: Map<string, Set<string>>;
    rowTitleById?: Map<string, string>;
    memberByRowId?: Map<string, string>;
}): ActivityRecord[] {
    const out: ActivityRecord[] = [];
    for (const ev of input.events) {
        const mod = ev.module || "general";
        const liveSet = input.liveRowIdsByModule.get(mod);
        const sourceInvalidated = Boolean(ev.target && liveSet && !liveSet.has(ev.target));
        const eventDate = validDate(ev.bizDate) || validDate(ev.recordedAt);
        const recordedAt = normalizedTimestamp(ev.recordedAt);
        const sortAt = recordedAt ? new Date(recordedAt).getTime() : (eventTimestamp(eventDate) ?? Date.now());
        const resolvedTitle =
            (ev.target ? input.rowTitleById?.get(ev.target) : undefined) ||
            ev.content.replace(/^\[补记\s+\d{4}-\d{2}-\d{2}\]\s*/, "").slice(0, 60) ||
            "日记流水";
        const details: ActivityDetail[] = [];
        if (ev.amount !== undefined) {
            const signed = ev.sign === -1 ? -ev.amount : ev.amount;
            details.push({ key: "amount", value: `¥${signed.toFixed(2)}` });
        }
        if (ev.attrs["custom-lv-quantity"]) {
            details.push({ key: "quantity", value: ev.attrs["custom-lv-quantity"] });
        }
        if (ev.attrs["custom-lv-odometer"]) {
            details.push({ key: "odometer", value: ev.attrs["custom-lv-odometer"] });
        }
        if (ev.action) {
            details.push({ key: "action", value: ev.action });
        }

        const logKind: LogKind | undefined =
            ev.action === "fuel" || ev.action === "fuelings"
                ? "fuelings"
                : ev.action === "charging" || ev.action === "chargings"
                    ? "chargings"
                    : ev.action === "maintenance"
                        ? "maintenance"
                        : ev.action.startsWith("vital") || ev.action === "vitals"
                            ? "vitals"
                            : ev.action === "chore-done" || ev.action === "chexecs"
                                ? "chexecs"
                                : undefined;

        out.push({
            id: `diary|${ev.eventId}`,
            moduleId: mod,
            avId: ev.avId || "",
            rowId: ev.target || ev.blockId,
            title: resolvedTitle,
            memberId: ev.target ? input.memberByRowId?.get(ev.target) : undefined,
            eventDate,
            recordedAt,
            sortAt,
            source: "diary",
            logKind,
            eventId: ev.eventId,
            diaryBlockId: ev.blockId,
            diaryDocId: ev.docId,
            sourceInvalidated,
            amount: ev.amount,
            sign: ev.sign,
            flowScope: ev.flowScope,
            details: details.slice(0, 4),
        });
    }
    return out;
}

/** 聚合净支出统计：严格过滤 flowScope === 'neutral' 的账户互转，并计入退款 sign=-1 */
export function computeNetExpenseTotal(records: readonly ActivityRecord[]): number {
    let sum = 0;
    for (const r of records) {
        if (r.flowScope === "neutral") continue;
        if (typeof r.amount === "number" && Number.isFinite(r.amount)) {
            sum += (r.sign === -1 ? -1 : 1) * r.amount;
        }
    }
    return Number(sum.toFixed(2));
}

export async function loadActivitySnapshot(plugin: HomePluginLike, options: { force?: boolean; revision?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<ActivitySnapshot> {
    const revision = options.revision ?? 0;
    const cache = activityCache.get(plugin) ?? { snapshots: new Map<number, ActivitySnapshot>(), inFlight: new Map<number, Promise<ActivitySnapshot>>() };
    activityCache.set(plugin, cache);
    if (!options.force && cache.snapshots.has(revision)) return cache.snapshots.get(revision)!;
    const existing = cache.inFlight.get(revision);
    if (existing) return existing;

    const promise = (async (): Promise<ActivitySnapshot> => {
        const enabled = plugin.settings.enabledModules.filter((id) => id !== "members");
        const modules = enabled.flatMap((moduleId) => {
            const ref = plugin.settings.dbRefs?.[moduleId];
            const schema = plugin.schemaCatalog?.[moduleId];
            if (!ref?.avId || !schema) return [];
            return [{ moduleId, avId: ref.avId, avBlockId: (ref as any).avBlockId as string | undefined, columns: ref.columns, schema }];
        });
        const memberByAvItem = new Map((plugin.settings.members ?? []).flatMap((member) => member.avItemId ? [[member.avItemId, member.id] as const] : []));
        const errors: ActivityReadError[] = [];
        const records: ActivityRecord[] = [];
        const coveredModules: string[] = [];
        let orphanedRowLogs = 0;
        let logs: RowLogs = {};
        try {
            logs = await loadRowLogs(plugin as unknown as Plugin);
        } catch (error) {
            errors.push({ moduleId: "rowlogs", message: error instanceof Error ? error.message : String(error) });
        }

        // 查询日记信封流水（双读去重安全窗）
        let diaryEvents: QueriedDiaryEvent[] = [];
        try {
            diaryEvents = await queryDiaryEventsFromSql(undefined, { verifyLiveDom: true });
        } catch {
            diaryEvents = [];
        }
        const diaryModules = new Set(diaryEvents.map((e) => e.module).filter(Boolean));
        const diaryEventIdSet = new Set(diaryEvents.map((e) => e.eventId));

        const eligible = modules.filter(({ moduleId, avId, schema }) =>
            schema.activity ||
            diaryModules.has(moduleId) ||
            Object.keys(logs).some((key) => key.startsWith(`${avId}|`)),
        );
        let done = 0;
        options.onProgress?.(0, eligible.length);
        const liveRowIdsByModule = new Map<string, Set<string>>();
        const rowTitleById = new Map<string, string>();
        const memberByRowId = new Map<string, string>();

        const moduleResults = await mapLimit(eligible, 2, async (module) => {
            try {
                const requestOptions: RequestOptions & { blockID?: string } = {
                    signal: options.signal,
                    latestKey: `activity:${module.moduleId}`,
                    ...(module.avBlockId ? { blockID: module.avBlockId } : {}),
                };
                const read = await renderLedgerAll(module.avId, 200, requestOptions);
                if (!read.complete) throw new Error(`读取不完整：${read.rows.length}/${read.rowCount}`);
                const liveSet = new Set<string>();
                for (const row of read.rows) {
                    liveSet.add(row.itemID);
                    const t = rowName(row, module.columns);
                    if (t) rowTitleById.set(row.itemID, t);
                    const m = relationMember(row, module.columns, memberByAvItem);
                    if (m) memberByRowId.set(row.itemID, m);
                }
                liveRowIdsByModule.set(module.moduleId, liveSet);

                const projected = read.rows.flatMap((row) => {
                    const activity = projectLedgerActivity({ ...module, row, memberByAvItem });
                    return activity ? [activity] : [];
                });
                // 双读期按 eventId 去重：已被日记覆盖的 rowlog 不重复出现
                const dedupedLogs: RowLogs = {};
                for (const [k, g] of Object.entries(logs)) {
                    if (!k.startsWith(`${module.avId}|`) || !g) continue;
                    const cloned: Record<string, unknown[]> = {};
                    for (const [kind, arr] of Object.entries(g)) {
                        if (!Array.isArray(arr)) continue;
                        cloned[kind] = arr.filter((item: any) => !item?.diaryEventId || !diaryEventIdSet.has(String(item.diaryEventId)));
                    }
                    dedupedLogs[k] = cloned as any;
                }
                const logProjection = projectRowLogActivities({ moduleId: module.moduleId, avId: module.avId, rows: read.rows, logs: dedupedLogs, columns: module.columns, memberByAvItem });
                done++;
                options.onProgress?.(done, eligible.length);
                return { moduleId: module.moduleId, records: projected.concat(logProjection.records), orphaned: logProjection.orphaned };
            } catch (error) {
                done++;
                options.onProgress?.(done, eligible.length);
                errors.push({ moduleId: module.moduleId, message: error instanceof Error ? error.message : String(error) });
                return undefined;
            }
        });
        for (const result of moduleResults) {
            if (!result) continue;
            coveredModules.push(result.moduleId);
            orphanedRowLogs += result.orphaned;
            records.push(...result.records);
        }
        if (diaryEvents.length > 0) {
            const diaryRecords = projectDiaryActivities({
                events: diaryEvents,
                liveRowIdsByModule,
                rowTitleById,
                memberByRowId,
            });
            records.push(...diaryRecords);
        }
        const dayKey = (ts: number) => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };
        const sourceWeight = (s: ActivityRecord["source"]) => (s === "diary" || s === "rowlog" ? 1 : 0);
        records.sort((a, b) => {
            const dayCmp = dayKey(b.sortAt).localeCompare(dayKey(a.sortAt));
            if (dayCmp !== 0) return dayCmp;
            const srcCmp = sourceWeight(b.source) - sourceWeight(a.source);
            if (srcCmp !== 0) return srcCmp;
            return b.sortAt - a.sortAt || b.id.localeCompare(a.id);
        });
        return { records, errors, coveredModules, eligibleModules: eligible.length, orphanedRowLogs, loadedAt: new Date().toISOString() };
    })();
    cache.inFlight.set(revision, promise);
    try {
        const snapshot = await promise;
        cache.snapshots.set(revision, snapshot);
        // Keep at most the two most recent snapshots for this plugin instance.
        const revisions = [...cache.snapshots.keys()].sort((a, b) => b - a);
        for (const stale of revisions.slice(2)) cache.snapshots.delete(stale);
        return snapshot;
    } finally {
        cache.inFlight.delete(revision);
    }
}

/** Tests and explicit data mutations can invalidate the in-memory projection without touching persisted data. */
export function invalidateActivitySnapshot(plugin: object): void {
    activityCache.delete(plugin);
}

/** 聚焦并高亮定位指定活动行（抽屉时间线定位） */
export function markActivityLine(line: HTMLElement, targetActivityId?: string): void {
    if (typeof document === "undefined" || !line) return;
    if (targetActivityId && line.dataset?.lvActivityId !== targetActivityId) return;
    line.classList.add("lv-activity-target");
    line.setAttribute("aria-current", "location");
    line.tabIndex = -1;
    if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
            if (!line.isConnected) return;
            const prefersReduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
            line.scrollIntoView?.({ block: "center", behavior: prefersReduced ? "auto" : "smooth" });
            line.focus?.({ preventScroll: true });
        });
    }
}

