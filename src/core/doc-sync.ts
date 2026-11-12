/**
 * 思源笔记文档双向落地与 LifeLog 标准时间线同步引擎（doc-sync.ts）
 *
 * 核心契约：
 * 1. 所有带时间的记录统一输出为思源生态标准 LifeLog 段落语法（`HH:mm 类型：内容 #标签`）：
 *    - 必须为独立原生段落块（NodeParagraph，块间空行分隔，无 `- ` 列表前缀，行首时间不加粗 `**`）；
 *    - 类型名称绝不含冒号（防解析器截断），正文单行化（换行符转空格），附带稳定块 ID（防外部插件重复记账），
 *      可直接被叶归 LifeLog、小驴打卡 LifeLog 适配器等识别 LifeLog 的插件无缝解析。
 * 2. `/📒 日常流水与备忘` 采用原生顶级标题构建 **【年（H2）➔ 月（H3）➔ 日（H4）】** 三级可折叠大纲，
 *    年、月、日及当日时刻全部严格按**倒序**排列；同步更新时自动检测并保留用户已折叠的年/月/日标题折叠态。
 */

import {
    appendBlock,
    createDocWithMd,
    foldBlock,
    getBlockKramdown,
    getHPathByID,
    renderLedgerAll,
    updateBlock,
    type AvRow,
} from "./siyuan";
import { ensureNotebook, findLedgerDoc, isDocMissingError, stableAvSeed } from "./provisioner";
import { normalizeLifelogTime } from "./quick-actions";
import { loadRowLogs, type LogKind, type RowLog, type RowLogs } from "./rowlog";
import { withDocLock } from "@/libs/notice";
import { saveSettings } from "./settings";
import type { FamilyMember } from "@/types";

export const DAILY_JOURNAL_TITLE = "日常流水与备忘";
export const DAILY_JOURNAL_HPATH = "/📒 日常流水与备忘";

/** 思源生态通用 LifeLog 段落识别正则（行首无样式 HH:mm + 空格 + 类型 + 冒号 + 内容） */
export const LIFELOG_MARKER_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([^：:\r\n]+)[：:](.+)$/;

const ALL_LOG_KINDS: readonly LogKind[] = [
    "fuelings",
    "chargings",
    "maintenance",
    "vitals",
    "chexecs",
    "quickflows",
    "valuations",
    "moves",
    "prices",
    "transfers",
    "meters",
    "checks",
    "loans",
    "deposits",
];

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

const knownSectionIds = new Set<string>();
const sectionWriteChains = new Map<string, Promise<unknown>>();

export function sectionBlockId(docId: string, sectionKey: string): string {
    return stableAvSeed(`sec:${sectionKey}`, docId);
}

function enqueueSectionWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = sectionWriteChains.get(key) ?? Promise.resolve();
    const next = prev.then(task);
    const cleanup = next.catch(() => undefined).finally(() => {
        if (sectionWriteChains.get(key) === cleanup) {
            sectionWriteChains.delete(key);
        }
    });
    sectionWriteChains.set(key, cleanup);
    return next;
}

export const cleanLifelogType = (raw: string): string =>
    String(raw || "日常记录").replace(/[\r\n\s]+/g, " ").replace(/[：:]/g, "-").trim() || "日常记录";

export const cleanLifelogBody = (raw: string): string =>
    String(raw || "").replace(/[\r\n\s]+/g, " ").trim() || "已记录";

/**
 * 构建单行标准 LifeLog 段落文本：`HH:mm 类型：内容`
 * 严格满足：无列表符号 `- `、行首时间纯文本无粗体、类型不含冒号、正文无换行
 */
export function buildLifelogLine(time: string, type: string, body: string): string {
    const hhmm = normalizeLifelogTime(time);
    return `${hhmm} ${cleanLifelogType(type)}：${cleanLifelogBody(body)}`;
}

export function weekdayOfDate(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? "" : WEEKDAY_CN[d.getDay()];
}

function normalizeValidDate(raw: unknown, fallbackAt?: unknown): string {
    for (const candidate of [raw, fallbackAt]) {
        if (typeof candidate === "string") {
            const slice = candidate.trim().slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(slice)) return slice;
        }
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 在指定台账文档底部幂等插入或原地更新附属记录超级块（保护上方 AttributeView 数据库块不受影响）
 */
export async function upsertDocSection(
    docId: string,
    sectionKey: string,
    markdownBody: string,
): Promise<string> {
    const secId = sectionBlockId(docId, sectionKey);
    const wrapped = `{{{row\n${markdownBody.trim()}\n}}}\n{: id="${secId}" custom-lvhome-sec="${sectionKey}"}`;

    return withDocLock(docId, () =>
        enqueueSectionWrite(secId, async () => {
            let exists = knownSectionIds.has(secId);
            if (!exists) {
                try {
                    const res = await getBlockKramdown(secId, { retries: 0 });
                    exists = !!res?.id;
                } catch {
                    exists = false;
                }
            }
            if (exists) {
                try {
                    await updateBlock(secId, wrapped, { retries: 0 });
                    knownSectionIds.add(secId);
                    return secId;
                } catch {
                    knownSectionIds.delete(secId);
                }
            }
            await appendBlock(docId, wrapped, { retries: 0 });
            knownSectionIds.add(secId);
            return secId;
        }),
    );
}

/**
 * 从文档既有 Kramdown 中提取用户手动折叠的块 ID（含 `fold="1"` 的标题）
 */
export function extractFoldedBlockIds(kramdown: string): Set<string> {
    const folded = new Set<string>();
    if (!kramdown) return folded;
    const ialRe = /\{:\s*([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ialRe.exec(kramdown)) !== null) {
        const attrs = match[1];
        if (!/\bfold="1"/.test(attrs)) continue;
        const idMatch = /\bid="([0-9a-zA-Z-]+)"/.exec(attrs);
        if (idMatch) folded.add(idMatch[1]);
    }
    return folded;
}

export function formatBlockRef(targetId: string | undefined, anchorText: string): string {
    const cleanText = String(anchorText ?? "").trim();
    if (!cleanText) return "";
    if (!targetId || cleanText.includes("((")) return cleanText;
    return `((${targetId} "${cleanText.replace(/"/g, "'")}"))`;
}

/**
 * 从文档既有 Kramdown 中提取非本插件托管（无 `custom-lvhome="1"`）的用户手写段落或双链块，重同步时原样保留
 */
export function extractUserCustomBlocks(kramdown: string, docId: string): string[] {
    if (!kramdown) return [];
    const preserved: string[] = [];
    // 按顶层块切分（以块末尾 `{: ...}` 为界）
    const chunks = kramdown.split(/\n\n+/);
    for (const raw of chunks) {
        const chunk = raw.trim();
        if (!chunk) continue;
        // 忽略文档根属性行 `{: id="${docId}" ... type="doc" ...}`
        if (chunk.startsWith("{:") && (chunk.includes('type="doc"') || chunk.includes(`id="${docId}"`))) continue;
        // 忽略本插件托管生成的块及旧版初始化头部/超级块
        if (chunk.includes('custom-lvhome="1"') || chunk.includes("custom-lvhome-sec=")) continue;
        if (chunk.includes("小驴管家 · 日常流水") || chunk.startsWith("# 📒")) continue;
        preserved.push(chunk);
    }
    return preserved;
}

/**
 * 原地更新专用汇总文档 `/📒 日常流水与备忘` 的顶级大纲与段落，保留用户手写双链块并恢复已折叠的年/月/日标题
 */
export async function replaceJournalDocPreservingFolds(
    docId: string,
    markdown: string,
): Promise<void> {
    return withDocLock(docId, async () => {
        await enqueueSectionWrite(`doc:${docId}`, async () => {
            let foldedIds = new Set<string>();
            let userBlocks: string[] = [];
            try {
                const prev = await getBlockKramdown(docId, { retries: 0 });
                const prevKd = prev?.kramdown ?? "";
                foldedIds = extractFoldedBlockIds(prevKd);
                userBlocks = extractUserCustomBlocks(prevKd, docId);
            } catch {
                /* 文档初次写入或读取不可用时无需恢复折叠 */
            }

            const finalMd = userBlocks.length > 0
                ? `${markdown.trim()}\n\n${userBlocks.join("\n\n")}`
                : markdown.trim();

            await updateBlock(docId, finalMd, { retries: 0 });

            if (foldedIds.size > 0) {
                for (const blockId of foldedIds) {
                    if (!finalMd.includes(`id="${blockId}"`)) continue;
                    try {
                        await foldBlock(blockId, { retries: 0 });
                    } catch {
                        /* ignore single fold failure */
                    }
                }
            }
        });
    });
}

function memberNameById(members: FamilyMember[] | undefined, idOrAvId: unknown): string {
    if (!idOrAvId) return "";
    const ids = Array.isArray(idOrAvId)
        ? idOrAvId.map(String)
        : typeof idOrAvId === "string"
            ? (idOrAvId.includes(",") ? idOrAvId.split(",").map((s) => s.trim()) : [idOrAvId.trim()])
            : [];
    const names = ids
        .map((id) => (members ?? []).find((m) => m.id === id || m.avItemId === id)?.name)
        .filter(Boolean);
    return names.join("、");
}

function rowTitleFromCells(row: AvRow | undefined, columns: Record<string, string> | undefined): string {
    if (!row || !columns?.name) return "";
    const cell = row.cells?.[columns.name];
    return String(cell?.text?.content ?? cell?.block?.content ?? "").trim();
}

export interface ParsedLifelogSpec {
    date: string;
    time: string;
    sortKey: string;
    lifelogType: string;
    detailText: string;
    tags: string[];
}

export interface LifelogLinkOptions {
    /** 关联主体所属的台账文档 ID（如车辆/健康/家务文档 ID），传入后主体名称自动转为思源双链 `((docId "主体名"))` */
    subjectDocId?: string;
    /** 家庭成员台账文档 ID，传入后成员姓名自动转为思源双链 `((membersDocId "成员名"))` */
    membersDocId?: string;
    /** 该台账行绑定的所属成员名（可选，当流水自身无 memberId 时补充关联成员双链） */
    rowMemberName?: string;
}

/**
 * 将单条 rowlog 子记录解析为结构化 LifeLog 要素（支持自动生成与保留思源 `((id "锚文本"))` 双链）
 */
export function describeRowLogAsLifelog(
    kind: LogKind,
    entry: Record<string, unknown>,
    members?: FamilyMember[],
    subjectTitle?: string,
    linkOpts?: LifelogLinkOptions,
): ParsedLifelogSpec {
    const date = normalizeValidDate(entry.date, entry.at);
    const time = normalizeLifelogTime(entry.time, entry.at);
    const sortKey = `${date}T${time}:${String(entry.at ?? "")}`;
    const note = typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : "";
    const rawSubject = subjectTitle?.trim() || "";
    const subject = rawSubject ? formatBlockRef(linkOpts?.subjectDocId, rawSubject) : "";
    const rowOwnerLink = linkOpts?.rowMemberName ? formatBlockRef(linkOpts?.membersDocId, linkOpts.rowMemberName) : undefined;
    const parts = (...items: unknown[]) => items.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" · ");

    let lifelogType = "日常记录";
    let detailText = parts(subject, note || "记录更新");
    let tags = ["#日常"];

    if (kind === "fuelings" || kind === "chargings") {
        const isC = kind === "chargings";
        const qty = entry.quantity ?? entry.liters;
        const cost = entry.totalCost ?? entry.cost;
        const odo = entry.odometer ?? entry.mileage;
        const unitP = entry.unitPrice !== undefined ? `¥${entry.unitPrice}/${isC ? "kWh" : "L"}` : undefined;
        const CHARGE_LABELS: Record<string, string> = { ac: "慢充", home: "家充", dc: "快充" };
        const gradeOrMode = isC
            ? (CHARGE_LABELS[String(entry.chargingMode)] ?? (entry.chargingMode ? String(entry.chargingMode) : undefined))
            : (entry.fuelGrade ? `${entry.fuelGrade}#` : undefined);
        const fullStatus = entry.full !== undefined ? (entry.full ? (isC ? "已充满" : "已加满") : (isC ? "未充满" : "未加满")) : undefined;

        lifelogType = isC ? "车辆充电" : "车辆加油";
        detailText = parts(
            subject,
            rowOwnerLink,
            gradeOrMode,
            qty !== undefined && `${qty} ${isC ? "kWh" : "L"}`,
            cost !== undefined && `¥${cost}`,
            unitP && `(${unitP})`,
            fullStatus,
            odo !== undefined && `里程 ${odo} km`,
            typeof entry.station === "string" ? entry.station.trim() : "",
            note,
        );
        tags = ["#车辆", isC ? "#充电" : "#加油"];
        if (entry.full === true) tags.push(isC ? "#充满" : "#加满");
    } else if (kind === "maintenance") {
        const cat = typeof entry.category === "string" && entry.category.trim() ? entry.category.trim() : "常规维保";
        const cost = entry.cost ?? entry.totalCost;
        const odo = entry.odometer ?? entry.mileage;
        lifelogType = "车辆维保";
        detailText = parts(subject, rowOwnerLink, cat, cost !== undefined && `¥${cost}`, odo !== undefined && `里程 ${odo} km`, typeof entry.shop === "string" ? entry.shop.trim() : "", note);
        tags = ["#车辆", "#维保"];
    } else if (kind === "vitals") {
        const vtype = String(entry.type ?? "bp");
        const owner = rowOwnerLink && !rawSubject.includes(linkOpts?.rowMemberName || "\u0000") ? rowOwnerLink : undefined;
        let vText = "";
        if (vtype === "bg") {
            const timing = entry.val2 === 1 || entry.glucoseTiming === "postprandial" ? "餐后" : "空腹";
            lifelogType = "血糖监测";
            vText = `${timing} ${entry.val1 ?? entry.glucose ?? "—"} mmol/L`;
            tags = ["#健康", "#血糖"];
        } else if (vtype === "hr") {
            lifelogType = "心率监测";
            vText = `${entry.val1 ?? entry.pulse ?? "—"} bpm`;
            tags = ["#健康", "#心率"];
        } else if (vtype === "weight") {
            lifelogType = "体重记录";
            vText = `${entry.val1 ?? entry.weight ?? "—"} kg`;
            tags = ["#健康", "#体重"];
        } else if (vtype === "temp") {
            lifelogType = "体温记录";
            vText = `${entry.val1 ?? entry.temperature ?? "—"} ℃`;
            tags = ["#健康", "#体温"];
        } else {
            const pulse = entry.pulse !== undefined ? `心率 ${entry.pulse} bpm` : "";
            lifelogType = "血压监测";
            vText = parts(`${entry.val1 ?? entry.systolic ?? "—"}/${entry.val2 ?? entry.diastolic ?? "—"} mmHg`, pulse);
            tags = ["#健康", "#血压"];
        }
        detailText = parts(subject, owner, vText, note);
    } else if (kind === "chexecs") {
        const whoRaw = memberNameById(members, entry.memberId);
        const who = whoRaw ? formatBlockRef(linkOpts?.membersDocId, whoRaw) : rowOwnerLink;
        const pts = typeof entry.points === "number" && entry.points > 0 ? `+${entry.points} 积分` : undefined;
        lifelogType = "家务打卡";
        detailText = parts(subject, who ? `执行人 ${who}` : undefined, pts, note);
        tags = ["#家务"];
    } else if (kind === "quickflows") {
        const rawQ = String(entry.title ?? rawSubject ?? "").trim();
        const qtitle = rawQ ? formatBlockRef(linkOpts?.subjectDocId, rawQ) : "";
        if (String(entry.kind ?? "snippet") === "shopping") {
            const cost = entry.price ?? entry.cost;
            const priceText = cost !== undefined ? `¥${cost}` : undefined;
            const qty = typeof entry.qty === "number" && entry.qty > 0 && entry.qty !== 1 ? `数量 ${entry.qty}` : undefined;
            lifelogType = "待买清单";
            detailText = parts(qtitle, priceText, qty, note);
            tags = ["#待买"];
        } else {
            const detail = typeof entry.detail === "string" && entry.detail.trim() && entry.detail.trim() !== rawQ ? entry.detail.trim().slice(0, 100) : undefined;
            lifelogType = "随手便签";
            detailText = parts(qtitle, detail, note);
            tags = ["#便签"];
        }
    } else if (SIMPLE_LOG_MAP[kind]) {
        const simple = SIMPLE_LOG_MAP[kind]!;
        lifelogType = simple.type;
        detailText = parts(subject, simple.format(entry), note);
        tags = simple.tags;
    }

    return { date, time, sortKey, lifelogType, detailText, tags };
}

const SIMPLE_LOG_MAP: Partial<Record<LogKind, { type: string; tags: string[]; format: (e: Record<string, unknown>) => string }>> = {
    valuations: { type: "资产估值", tags: ["#资产"], format: (e) => `¥${e.value ?? "—"}` },
    moves: { type: "位置变更", tags: ["#变更"], format: (e) => `${e.from || "—"} ➔ ${e.to || "—"}` },
    transfers: { type: "位置变更", tags: ["#变更"], format: (e) => `${e.from || "—"} ➔ ${e.to || "—"}` },
    prices: { type: "价格记录", tags: ["#价格"], format: (e) => `¥${e.price ?? "—"}${e.channel ? ` · ${e.channel}` : ""}` },
    meters: { type: "水电抄表", tags: ["#抄表"], format: (e) => `读数 ${e.reading ?? "—"}${e.usage !== undefined ? ` · 本期用量 ${e.usage}` : ""}` },
    checks: { type: "盘点核验", tags: ["#盘点"], format: (e) => String(e.result ?? "已核对") },
    loans: { type: "借还记录", tags: ["#借还"], format: (e) => `${e.to ?? "—"}${e.back ? ` · 已还 ${e.back}` : ""}` },
    deposits: { type: "心愿存入", tags: ["#心愿"], format: (e) => `¥${e.amount ?? "—"}` },
};

/**
 * 将单条 rowlog 子记录格式化为标准 LifeLog 单行段落文本：`HH:mm 类型：内容 #标签`
 */
export function formatRowLogEntryLine(
    kind: LogKind,
    entry: Record<string, unknown>,
    members?: FamilyMember[],
    subjectTitle?: string,
): string {
    const spec = describeRowLogAsLifelog(kind, entry, members, subjectTitle);
    const tagSuffix = spec.tags.length > 0 ? ` ${spec.tags.join(" ")}` : "";
    return buildLifelogLine(spec.time, spec.lifelogType, `${spec.detailText}${tagSuffix}`);
}

/**
 * 过滤与合并同一时刻由血压附带生成的冗余心率条目（把 pulse 合并进血压读数，保持 LifeLog 时间线清爽）
 */
function normalizeVitalsForLifelog(list: ReadonlyArray<Record<string, unknown>>): Array<Record<string, unknown>> {
    const bpByStamp = new Map<string, Record<string, unknown>>();
    const out: Array<Record<string, unknown>> = [];

    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (String(item.type ?? "bp") === "bp") {
            const copy = { ...item };
            const stamp = `${String(item.date ?? "")}|${String(item.at ?? item.time ?? "")}`;
            bpByStamp.set(stamp, copy);
            out.push(copy);
        }
    }
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (String(item.type ?? "bp") === "bp") continue;
        if (String(item.type) === "hr") {
            const stamp = `${String(item.date ?? "")}|${String(item.at ?? item.time ?? "")}`;
            const pairedBp = bpByStamp.get(stamp);
            if (pairedBp) {
                if (pairedBp.pulse === undefined && item.val1 !== undefined) {
                    pairedBp.pulse = item.val1;
                }
                continue;
            }
        }
        out.push(item);
    }
    return out;
}

export interface FormatModuleRowLogsInput {
    moduleTitle: string;
    avId: string;
    rows: AvRow[];
    columns?: Record<string, string>;
    logs: RowLogs;
    renewHistory?: Record<string, Array<{ from: string; to: string; at: string }>>;
    members?: FamilyMember[];
    /** 关联的 `/📒 日常流水与备忘` 文档 ID（传入后自动生成指向流水总账的反向双链） */
    journalDocId?: string;
    /** 家庭成员台账文档 ID（传入后自动将成员名渲染为双链） */
    membersDocId?: string;
}

export function buildFlowEntryIdKey(
    rowLogKey: string,
    kind: string,
    entry: Record<string, unknown>,
    spec: Pick<ParsedLifelogSpec, "date" | "time" | "detailText">,
): string {
    const fingerprint = String(entry.at ?? `${spec.date}T${spec.time}:${spec.detailText}`);
    return `${rowLogKey}|${kind}|${fingerprint}`;
}

/**
 * 生成单个台账模块文档底部的 `## 📋 日常流水与附属记录（LifeLog）` Markdown 内容（按日期倒序排列，带双向双链）
 */
export function formatModuleRowLogsMarkdown(input: FormatModuleRowLogsInput): string {
    const { avId, rows, columns, logs, renewHistory = {}, members, journalDocId, membersDocId } = input;
    const rowById = new Map(rows.map((r) => [r.itemID, r]));
    const prefix = `${avId}|`;

    const rowIds = new Set<string>();
    for (const r of rows) rowIds.add(r.itemID);
    for (const key of Object.keys(logs)) {
        if (key.startsWith(prefix)) rowIds.add(key.slice(prefix.length));
    }

    const byDate = new Map<string, Array<{ sortKey: string; text: string }>>();
    const pushDateLine = (date: string, sortKey: string, text: string) => {
        const list = byDate.get(date) ?? [];
        list.push({ sortKey, text });
        byDate.set(date, list);
    };

    for (const rowId of rowIds) {
        const rowLogKey = `${avId}|${rowId}`;
        const grouped: RowLog | undefined = logs[rowLogKey];
        const renews = renewHistory[rowId] ?? [];
        const row = rowById.get(rowId);
        const rowTitle = rowTitleFromCells(row, columns) || "关联条目";
        const memberRelationIds = columns?.member ? row?.cells?.[columns.member]?.relation?.blockIDs : undefined;
        const rowMemberName = Array.isArray(memberRelationIds) && memberRelationIds[0]
            ? memberNameById(members, memberRelationIds[0])
            : "";

        if (grouped && typeof grouped === "object") {
            for (const kind of ALL_LOG_KINDS) {
                const rawList = grouped[kind] as unknown as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(rawList) || rawList.length === 0) continue;
                const list = kind === "vitals" ? normalizeVitalsForLifelog(rawList) : rawList;
                for (const entry of list) {
                    if (!entry || typeof entry !== "object") continue;
                    const spec = describeRowLogAsLifelog(kind, entry, members, rowTitle, {
                        membersDocId,
                        rowMemberName,
                    });
                    const idKey = buildFlowEntryIdKey(rowLogKey, kind, entry, spec);
                    const journalTargetId = journalDocId ? stableAvSeed(`ll:${idKey}`, journalDocId) : undefined;
                    const backRef = journalTargetId ? ` ((${journalTargetId} "📒 流水总账"))` : "";
                    const tagSuffix = spec.tags.length > 0 ? ` ${spec.tags.join(" ")}` : "";
                    const line = buildLifelogLine(spec.time, spec.lifelogType, `${spec.detailText}${tagSuffix}${backRef}`);
                    pushDateLine(spec.date, spec.sortKey, line);
                }
            }
        }

        for (const r of renews) {
            const date = normalizeValidDate(undefined, r.at);
            const time = normalizeLifelogTime(undefined, r.at);
            const line = buildLifelogLine(time, "效期续期", `${rowTitle} · ${r.from} ➔ ${r.to} #续期`);
            pushDateLine(date, `${date}T${time}:${String(r.at ?? "")}`, line);
        }
    }

    if (byDate.size === 0) return "";

    const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
    const dayBlocks: string[] = [];
    for (const date of sortedDates) {
        const entries = (byDate.get(date) ?? []).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
        const wk = weekdayOfDate(date);
        dayBlocks.push(`### ${date}${wk ? ` ${wk}` : ""}\n\n${entries.map((e) => e.text).join("\n\n")}`);
    }

    const journalDocRef = journalDocId
        ? `，已与 ((${journalDocId} "📒 ${DAILY_JOURNAL_TITLE}")) 建立双向链接`
        : "";
    return `## 📋 日常流水与附属记录（LifeLog）\n\n> 💡 以下记录采用标准 \`HH:mm 类型：内容\` LifeLog 段落格式，按日期倒序同步，可被 LifeLog 插件直接识别${journalDocRef}。\n\n${dayBlocks.join("\n\n")}`;
}

export interface DailyJournalFlowItem {
    idKey: string;
    date: string;
    time: string;
    sortKey: string;
    lifelogType: string;
    detailText: string;
    tags?: string[];
    docId?: string;
    moduleTitle?: string;
}

export interface FormatDailyJournalInput {
    docId?: string;
    memos: Array<{
        id: string;
        title: string;
        dueDate: string;
        createdAt?: string;
        doneAt?: string;
        priority?: "high" | "medium" | "low";
        category?: string;
        cycle?: string;
        recurrenceAnchor?: "due" | "completion";
    }>;
    flowItems: DailyJournalFlowItem[];
}

/**
 * 生成 `/📒 日常流水与备忘` 完整原生文档 Markdown：
 * - 顶部待办备忘区（H2，可折叠）
 * - 【年（H2）】➔【月（H3）】➔【日期（H4）】三级标题严格倒序排列，便于按年、按月一键折叠
 * - 每条流水均为独立标准 LifeLog 段落：`HH:mm 类型：内容 #标签 ((docId "台账 · 模块"))` + 稳定块 ID
 */
export function formatDailyJournalMarkdown(input: FormatDailyJournalInput): string {
    const { docId = "20260101000000-journal", memos = [], flowItems = [] } = input;
    const blockIdFor = (seedKey: string) => stableAvSeed(seedKey, docId);

    const introId = blockIdFor("bq:intro");
    const intro = [
        `> 🏠 **小驴管家 · ${DAILY_JOURNAL_TITLE}（LifeLog 标准时间线）**`,
        `> 💡 时间记录采用 \`HH:mm 类型：内容\` LifeLog 标准格式，与台账及成员双向链接；按年/月/日倒序组织，支持标题折叠。`,
        `{: id="${introId}" custom-lvhome="1"}`,
    ].join("\n");

    // 1. 待办备忘区（H2）
    const activeMemos = memos.filter((m) => !m.doneAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const memosH2Id = blockIdFor("h2:pending-memos");
    const memosBodyId = blockIdFor("body:pending-memos");
    const memoLines: string[] = [];
    for (const m of activeMemos) {
        const pri = m.priority === "high" ? " · 🔥 高优" : m.priority === "medium" ? " · ⚡ 中优" : m.priority === "low" ? " · 🌱 低优" : "";
        const cat = m.category ? ` · #${m.category}` : "";
        const cyc = m.cycle ? ` · 🔁 ${m.cycle}${m.recurrenceAnchor === "completion" ? "(按完成顺延)" : ""}` : "";
        const amt = typeof (m as any).amount === "number" && (m as any).amount > 0 ? ` · 💰 ¥${(m as any).amount}` : "";
        memoLines.push(`- [ ] **${m.title}** · 到期 \`${m.dueDate}\`${amt}${pri}${cat}${cyc}`);
    }
    const memosSection = memoLines.length > 0
        ? `## 📌 待办备忘与周期事项（${activeMemos.length} 项）\n{: id="${memosH2Id}" custom-lvhome="1"}\n\n${memoLines.join("\n")}\n{: id="${memosBodyId}" custom-lvhome="1"}`
        : `## 📌 待办备忘与周期事项\n{: id="${memosH2Id}" custom-lvhome="1"}\n\n暂无待办备忘。\n{: id="${memosBodyId}" custom-lvhome="1"}`;

    // 2. 收集全部带时间的 LifeLog 条目（含已办结备忘的完成时刻）
    const allFlows: DailyJournalFlowItem[] = [...flowItems];
    for (const m of memos) {
        if (!m.doneAt) continue;
        const doneDate = normalizeValidDate(undefined, m.doneAt);
        const doneTime = normalizeLifelogTime(undefined, m.doneAt);
        const tags = ["#备忘"];
        if (m.category) tags.push(`#${m.category.replace(/\s+/g, "_")}`);
        allFlows.push({
            idKey: `memo-done:${m.id}:${m.doneAt}`,
            date: doneDate,
            time: doneTime,
            sortKey: `${doneDate}T${doneTime}:${m.doneAt}`,
            lifelogType: "备忘办结",
            detailText: m.title,
            tags,
        });
    }

    if (allFlows.length === 0) {
        const emptyH2Id = blockIdFor("h2:empty-flows");
        const emptyPId = blockIdFor("p:empty-flows");
        return `${intro}\n\n${memosSection}\n\n## ⚡ 日常流水时间线\n{: id="${emptyH2Id}" custom-lvhome="1"}\n\n暂无日常流水记录。\n{: id="${emptyPId}" custom-lvhome="1"}`;
    }

    // 3. 按【年】->【月】->【日期】三级分组并全层级严格倒序排列
    const tree = new Map<string, Map<string, Map<string, DailyJournalFlowItem[]>>>();
    for (const item of allFlows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
        const [y, m] = [item.date.slice(0, 4), item.date.slice(5, 7)];
        const ym = tree.get(y) ?? new Map();
        if (!tree.has(y)) tree.set(y, ym);
        const dm = ym.get(m) ?? new Map();
        if (!ym.has(m)) ym.set(m, dm);
        const dl = dm.get(item.date) ?? [];
        if (!dm.has(item.date)) dm.set(item.date, dl);
        dl.push(item);
    }

    const yearBlocks: string[] = [];
    for (const y of [...tree.keys()].sort((a, b) => b.localeCompare(a))) {
        const ym = tree.get(y)!;
        const monthBlocks: string[] = [];
        for (const m of [...ym.keys()].sort((a, b) => b.localeCompare(a))) {
            const dm = ym.get(m)!;
            const dateBlocks: string[] = [];
            for (const d of [...dm.keys()].sort((a, b) => b.localeCompare(a))) {
                const itemsDesc = [...(dm.get(d) ?? [])].sort((a, b) =>
                    b.sortKey.localeCompare(a.sortKey) || b.idKey.localeCompare(a.idKey),
                );
                const seenP = new Set<string>();
                const pars = itemsDesc.map((it, idx) => {
                    const tag = it.tags?.length ? ` ${it.tags.join(" ")}` : "";
                    const ref = it.docId ? ` ((${it.docId} "${(it.moduleTitle || "查看台账").replace(/"/g, "'")}"))` : "";
                    const line = buildLifelogLine(it.time, it.lifelogType, `${it.detailText}${tag}${ref}`);
                    let pId = blockIdFor(`ll:${it.idKey}`);
                    if (seenP.has(pId)) pId = blockIdFor(`ll:${it.idKey}:${idx}`);
                    seenP.add(pId);
                    return `${line}\n{: id="${pId}" custom-lvhome="1"}`;
                });
                const wk = weekdayOfDate(d);
                dateBlocks.push(`#### ${d}${wk ? ` ${wk}` : ""}\n{: id="${blockIdFor(`yd:${d}`)}" custom-lvhome="1"}\n\n${pars.join("\n\n")}`);
            }
            monthBlocks.push(`### ${m} 月\n{: id="${blockIdFor(`ym:${y}-${m}`)}" custom-lvhome="1"}\n\n${dateBlocks.join("\n\n")}`);
        }
        yearBlocks.push(`## ${y} 年\n{: id="${blockIdFor(`yr:${y}`)}" custom-lvhome="1"}\n\n${monthBlocks.join("\n\n")}`);
    }

    return `${intro}\n\n${memosSection}\n\n${yearBlocks.join("\n\n")}`;
}

/**
 * 确保 `/📒 日常流水与备忘` 文档在目标笔记本中创建并登记到 `settings.dbRefs.adhoc`
 */
export async function ensureDailyJournalDoc(plugin: any): Promise<string | undefined> {
    if (!plugin?.settings?.dbRefs) return undefined;
    const existing = plugin.settings.dbRefs.adhoc;
    if (existing?.docId) {
        try {
            await getHPathByID(existing.docId);
            return existing.docId;
        } catch (e) {
            if (!isDocMissingError(e)) return existing.docId;
        }
    }

    try {
        const preferredNb = existing?.notebook
            || plugin.settings.dbRefs?.members?.notebook
            || plugin.settings.dbRefs?.certs?.notebook;
        const notebookId = await ensureNotebook(preferredNb, plugin.settings.targetNotebookId);
        const rawRoot = typeof plugin.settings?.rootPath === "string" ? plugin.settings.rootPath.trim().replace(/\/+$/, "") : "";
        const targetJournalHPath = rawRoot
            ? `${rawRoot.startsWith("/") ? rawRoot : `/${rawRoot}`}${DAILY_JOURNAL_HPATH}`
            : DAILY_JOURNAL_HPATH;
        const found = await findLedgerDoc(notebookId, targetJournalHPath, "adhoc");
        if (found?.id) {
            plugin.settings.dbRefs.adhoc = {
                ...existing,
                docId: found.id,
                notebook: found.box || notebookId,
            };
            try { await saveSettings(plugin, plugin.settings); } catch { /* soft */ }
            return found.id;
        }

        const initMd = `> 🏠 **小驴管家 · ${DAILY_JOURNAL_TITLE}（LifeLog 标准时间线）**\n`;
        const docId = await createDocWithMd(notebookId, targetJournalHPath, initMd, {
            idempotencyKey: `provision:doc:adhoc:${notebookId}:${targetJournalHPath}`,
            retries: 0,
        });
        plugin.settings.dbRefs.adhoc = {
            docId,
            notebook: notebookId,
        };
        try { await saveSettings(plugin, plugin.settings); } catch { /* soft */ }
        return docId;
    } catch {
        return undefined;
    }
}

/**
 * 将指定模块的 rowlogs 与续期历史按标准 LifeLog 格式同步写入对应 `/台账 · XXX` 思源文档底部
 */
export async function syncModuleDocSection(
    plugin: any,
    moduleId: string,
    providedLogs?: RowLogs,
): Promise<void> {
    if (!plugin?.settings?.dbRefs || moduleId === "adhoc" || moduleId === "members") return;
    const ref = plugin.settings.dbRefs[moduleId];
    if (!ref?.docId || !ref?.avId) return;

    try {
        const logs = providedLogs ?? (await loadRowLogs(plugin));
        const renewHistory = plugin.runtime?.renewHistory ?? {};
        const prefix = `${ref.avId}|`;
        const hasModuleLogs = Object.keys(logs).some((k) => k.startsWith(prefix));
        const hasRenews = Object.keys(renewHistory).length > 0;
        const secId = sectionBlockId(ref.docId, "rowlogs");
        if (!hasModuleLogs && !hasRenews && !knownSectionIds.has(secId)) return;

        const journalDocId = plugin.settings.dbRefs?.adhoc?.docId || (await ensureDailyJournalDoc(plugin));
        const membersDocId = plugin.settings.dbRefs?.members?.docId;
        const read = await renderLedgerAll(ref.avId);
        const modTitle = typeof plugin.i18nText === "function"
            ? plugin.i18nText(`module.${moduleId}`)
            : String(plugin.i18n?.[`module.${moduleId}`] ?? moduleId);
        const md = formatModuleRowLogsMarkdown({
            moduleTitle: modTitle,
            avId: ref.avId,
            rows: read.rows ?? [],
            columns: ref.columns,
            logs,
            renewHistory,
            members: plugin.settings.members,
            journalDocId,
            membersDocId,
        });
        if (!md) return;
        await upsertDocSection(ref.docId, "rowlogs", md);
    } catch {
        /* 思源文档辅助区块同步失败不阻断主业务事务 */
    }
}

/**
 * 同步更新 `/📒 日常流水与备忘` 思源文档（按【年 ➔ 月 ➔ 日】倒序渲染标准 LifeLog 时间线、双向链接与待办备忘）
 */
export async function syncDailyJournalDoc(
    plugin: any,
    providedLogs?: RowLogs,
): Promise<string | undefined> {
    if (!plugin?.settings?.dbRefs) return undefined;
    try {
        const docId = await ensureDailyJournalDoc(plugin);
        if (!docId) return undefined;

        const logs = providedLogs ?? (await loadRowLogs(plugin));
        const memos = plugin.runtime?.memos ?? [];
        const members: FamilyMember[] = plugin.settings.members ?? [];
        const membersDocId = plugin.settings.dbRefs?.members?.docId;
        const modLabel = (id: string) =>
            typeof plugin.i18nText === "function"
                ? plugin.i18nText(`module.${id}`)
                : String(plugin.i18n?.[`module.${id}`] ?? id);

        const avToModule = new Map<string, { moduleId: string; docId?: string; columns?: Record<string, string> }>();
        for (const [mid, ref] of Object.entries(plugin.settings.dbRefs ?? {}) as Array<[string, any]>) {
            if (ref?.avId) {
                avToModule.set(ref.avId, { moduleId: mid, docId: ref.docId, columns: ref.columns });
            }
        }

        const touchedAvIds = new Set<string>();
        for (const key of Object.keys(logs)) {
            const idx = key.indexOf("|");
            if (idx > 0) touchedAvIds.add(key.slice(0, idx));
        }

        const rowsByAvId = new Map<string, Map<string, AvRow>>();
        for (const avId of touchedAvIds) {
            if (!avToModule.has(avId)) continue;
            try {
                const res = await renderLedgerAll(avId);
                rowsByAvId.set(avId, new Map((res.rows ?? []).map((r) => [r.itemID, r])));
            } catch { /* soft */ }
        }

        const flowItems: DailyJournalFlowItem[] = [];
        const loggedQuickRowIds = new Set<string>();

        for (const [key, grouped] of Object.entries(logs)) {
            if (!grouped || typeof grouped !== "object") continue;
            const idx = key.indexOf("|");
            if (idx <= 0) continue;
            const avId = key.slice(0, idx);
            const rowId = key.slice(idx + 1);
            const modInfo = avToModule.get(avId);
            const moduleId = modInfo?.moduleId ?? "ledger";
            const moduleTitle = modLabel(moduleId);
            const row = rowsByAvId.get(avId)?.get(rowId);
            const rowTitle = rowTitleFromCells(row, modInfo?.columns) || moduleTitle;
            const memberRelIds = modInfo?.columns?.member ? row?.cells?.[modInfo.columns.member]?.relation?.blockIDs : undefined;
            const rowMemberName = Array.isArray(memberRelIds) && memberRelIds[0]
                ? memberNameById(members, memberRelIds[0])
                : "";

            for (const kind of ALL_LOG_KINDS) {
                const rawList = grouped[kind] as unknown as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(rawList) || rawList.length === 0) continue;
                if (kind === "quickflows") loggedQuickRowIds.add(rowId);
                const list = kind === "vitals" ? normalizeVitalsForLifelog(rawList) : rawList;
                for (const entry of list) {
                    if (!entry || typeof entry !== "object") continue;
                    const linkedSpec = describeRowLogAsLifelog(kind, entry, members, rowTitle, {
                        subjectDocId: modInfo?.docId,
                        membersDocId,
                        rowMemberName,
                    });
                    flowItems.push({
                        idKey: buildFlowEntryIdKey(key, kind, entry, linkedSpec),
                        date: linkedSpec.date,
                        time: linkedSpec.time,
                        sortKey: linkedSpec.sortKey,
                        lifelogType: linkedSpec.lifelogType,
                        detailText: linkedSpec.detailText,
                        tags: linkedSpec.tags,
                        docId: modInfo?.docId,
                        moduleTitle: `台账 · ${moduleTitle}`,
                    });
                }
            }
        }

        // 兼容历史已存在于 shopping/snippets 台账但尚未写 quickflows 时间戳的条目
        const readQuickFallback = async (ref: any, mid: string, ltype: string, tag: string, getDetail: (r: any) => string) => {
            if (!ref?.avId || !ref.columns?.name) return;
            try {
                const read = await renderLedgerAll(ref.avId);
                for (const r of (read.rows ?? []).slice(0, 20)) {
                    if (loggedQuickRowIds.has(r.itemID)) continue;
                    const name = rowTitleFromCells(r, ref.columns);
                    if (!name) continue;
                    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(r.itemID);
                    const dateStr = m ? `${m[1]}-${m[2]}-${m[3]}` : normalizeValidDate(undefined);
                    const timeStr = m ? `${m[4]}:${m[5]}` : "09:00";
                    flowItems.push({
                        idKey: `${mid}:${r.itemID}`,
                        date: dateStr,
                        time: timeStr,
                        sortKey: `${dateStr}T${timeStr}:${r.itemID}`,
                        lifelogType: ltype,
                        detailText: [name, getDetail(r)].filter(Boolean).join(" · "),
                        tags: [tag],
                        docId: ref.docId,
                        moduleTitle: `台账 · ${modLabel(mid)}`,
                    });
                }
            } catch { /* soft */ }
        };
        const shopRef = plugin.settings.dbRefs?.shopping;
        await readQuickFallback(shopRef, "shopping", "待买清单", "#待买", (r) => {
            const qty = shopRef?.columns?.qty ? r.cells?.[shopRef.columns.qty]?.number?.content : undefined;
            return qty ? `数量 ${qty}` : "";
        });
        const snipRef = plugin.settings.dbRefs?.snippets;
        await readQuickFallback(snipRef, "snippets", "随手便签", "#便签", (r) => {
            const ck = snipRef?.columns?.content || snipRef?.columns?.note;
            const b = ck ? String(r.cells?.[ck]?.text?.content ?? "").trim() : "";
            return b && b !== rowTitleFromCells(r, snipRef?.columns) ? b.slice(0, 80) : "";
        });

        const md = formatDailyJournalMarkdown({
            docId,
            memos,
            flowItems,
        });
        await replaceJournalDocPreservingFolds(docId, md);
        return docId;
    } catch {
        return undefined;
    }
}

/**
 * 打开 `/📒 日常流水与备忘` 文档（若尚未创建则即时同步创建后打开）
 */
export async function openDailyJournalDoc(plugin: any): Promise<boolean> {
    if (!plugin) return false;
    let docId = plugin.settings?.dbRefs?.adhoc?.docId;
    if (!docId) {
        docId = await syncDailyJournalDoc(plugin);
    }
    if (docId && typeof plugin.showTabDocs === "function") {
        plugin.showTabDocs(docId);
        return true;
    }
    return false;
}

export async function openModuleOrJournalDoc(
    plugin: any,
    moduleId: string,
    rowId?: string,
): Promise<boolean> {
    if (!plugin) return false;
    if (moduleId === "adhoc") return openDailyJournalDoc(plugin);
    const docId = plugin.settings?.dbRefs?.[moduleId]?.docId;
    if (docId && typeof plugin.showTabDocs === "function") {
        plugin.showTabDocs(docId, rowId);
        return true;
    }
    return openDailyJournalDoc(plugin);
}

/**
 * 当 rowlogs 发生变更时，自动将最新 LifeLog 流水同步至涉及的台账文档及 `/📒 日常流水与备忘`
 */
export async function syncRowLogsToSiYuanDocs(plugin: any, logs?: RowLogs): Promise<void> {
    if (!plugin?.settings?.dbRefs) return;
    try {
        const resolvedLogs = logs ?? (await loadRowLogs(plugin));
        const avIds = new Set<string>();
        for (const key of Object.keys(resolvedLogs)) {
            const idx = key.indexOf("|");
            if (idx > 0) avIds.add(key.slice(0, idx));
        }
        for (const [moduleId, ref] of Object.entries(plugin.settings.dbRefs) as Array<[string, any]>) {
            if (ref?.avId && avIds.has(ref.avId)) {
                await syncModuleDocSection(plugin, moduleId, resolvedLogs);
            }
        }
        await syncDailyJournalDoc(plugin, resolvedLogs);
    } catch {
        /* ignore non-fatal doc sync errors */
    }
}
