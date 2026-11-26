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
    foldBlock,
    getBlockKramdown,
    getChildBlocks,
    renderLedgerAll,
    removeDoc,
    sql,
    updateBlock,
    type AvRow,
} from "./siyuan";
import { stableAvSeed } from "./provision-common";
import { normalizeLifelogTime } from "./format";
import { loadRowLogs, setRowLogSyncHook, type LogKind, type RowLog, type RowLogs } from "./rowlog";
import { localDateKey } from "./hub/rule";
import { withDocLock } from "@/libs/notice";
import type { FamilyMember } from "@/types";

export const DAILY_JOURNAL_TITLE = "日常流水与备忘";
export const DAILY_JOURNAL_HPATH = "/📒 日常流水与备忘";

export const ACTIVE_MEMOS_TITLE = "生活待办与周期清单";
export const ACTIVE_MEMOS_HPATH = "/📌 生活待办与周期清单";

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
    const isBlockNotFoundError = (err: unknown): boolean => {
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err ?? "").toLowerCase();
        return (
            msg.includes("not found") ||
            msg.includes("invalid id") ||
            msg.includes("未找到") ||
            msg.includes("不存在")
        );
    };

    return withDocLock(docId, () =>
        enqueueSectionWrite(secId, async () => {
            let exists = knownSectionIds.has(secId);
            let liveConfirmedMissing = false;

            // 1. SQL 快速路径：仅当 SQL 明确命中时直接判定存在；未命中或异常绝不直接视作不存在
            if (!exists) {
                try {
                    const rows = await sql<{ id: string }>(
                        `SELECT id FROM blocks WHERE id='${secId.replace(/'/g, "''")}' LIMIT 1`,
                        { retries: 0 },
                    );
                    if (Array.isArray(rows) && rows.length > 0) {
                        exists = true;
                    }
                } catch {
                    /* SQL 查询异常时交由实时文档子块核验 */
                }
            }

            // 2. 实时文档子块核验（查询 docId 避免触发思源原生 block not found toast）
            if (!exists) {
                try {
                    const children = await getChildBlocks(docId, { retries: 0 });
                    if (Array.isArray(children)) {
                        exists = children.some((c) => c?.id === secId);
                        if (!exists) {
                            liveConfirmedMissing = true;
                        }
                    }
                } catch {
                    /* getChildBlocks 不可用时交由保守核验，绝不盲目追加 */
                }
            }

            // 3. 当 SQL 与 getChildBlocks 均未能确凿确认（如接口失败或返回非数组）时，退回保守 getBlockKramdown 核验
            if (!exists && !liveConfirmedMissing) {
                try {
                    const res = await getBlockKramdown(secId, { retries: 0 });
                    if (res?.id) {
                        exists = true;
                    } else {
                        liveConfirmedMissing = true;
                    }
                } catch (err) {
                    if (!isBlockNotFoundError(err)) {
                        throw err;
                    }
                    liveConfirmedMissing = true;
                }
            }

            if (exists) {
                try {
                    await updateBlock(secId, wrapped, { retries: 0 });
                    knownSectionIds.add(secId);
                    return secId;
                } catch (err) {
                    knownSectionIds.delete(secId);
                    if (!isBlockNotFoundError(err)) {
                        throw err;
                    }
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
        // 2026-11-21 走查修复：旧版遗留头识别从「chunk 任意位置包含」收窄为「chunk 起始的精确遗留标题」。
        // 原启发式会把正文里提到「小驴管家 · 日常流水」的用户手写段落、以及「# 📒 我的读书笔记」等
        // 用户自拟标题误判为插件托管块而静默丢弃（零污染红线边界）。
        if (chunk.startsWith("小驴管家 · 日常流水") || chunk.startsWith("# 📒 日常流水")) continue;
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
    loans: {
        type: "借还记录",
        tags: ["#借还"],
        format: (e) => {
            const to = e.to ?? "—";
            if (e.returned || e.isReturned) return `${to} · 已还 ${e.back || ""}`.trim();
            if (e.back) {
                const todayStr = localDateKey(new Date());
                return String(e.back) < todayStr
                    ? `${to} · 逾期未还 (应还 ${e.back})`
                    : `${to} · 在借 (预计 ${e.back} 归还)`;
            }
            return `${to} · 在借中`;
        },
    },
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
        ? `，已与 ((${journalDocId} "📅 今日日记")) 建立双向链接`
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
 * @deprecated 彻底废除独立日常流水与备忘文档，流水与待办已全部统一进入思源默认当日日记
 */
export async function ensureDailyJournalDoc(_plugin: any): Promise<string | undefined> {
    return undefined;
}

/**
 * 生成汽车台账文档底部的思源原生动态 SQL 嵌入查询块（方案 C：零重复存储、实时汇聚各日日记中的车务记录）
 */
export function buildVehicleDiarySqlSectionMarkdown(): string {
    const sqlStmt = `SELECT b.* FROM blocks b WHERE (instr(b.ial, 'custom-lv-module="vehicles"') > 0 OR instr(b.content, '#车辆') > 0) AND b.type IN ('p', 'i') ORDER BY b.created DESC LIMIT 50`;
    return [
        `## 🚗 日记车务动态流水（自动聚合）`,
        ``,
        `> 💡 自动汇聚散落在每日日记中的车辆加油、充电、维保与关联随手记，点击条目可直达原日记块。`,
        ``,
        `{{${sqlStmt}}}`,
    ].join("\n");
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
        if (moduleId === "vehicles") {
            await upsertDocSection(ref.docId, "vehicle-diary-sql", buildVehicleDiarySqlSectionMarkdown());
        }

        const logs = providedLogs ?? (typeof plugin?.loadData === "function" ? await loadRowLogs(plugin) : {});
        const renewHistory = plugin.runtime?.renewHistory ?? {};
        const prefix = `${ref.avId}|`;
        const hasModuleLogs = Object.keys(logs).some((k) => k.startsWith(prefix));
        const hasRenews = Object.keys(renewHistory).length > 0;
        const secId = sectionBlockId(ref.docId, "rowlogs");
        if (!hasModuleLogs && !hasRenews && !knownSectionIds.has(secId)) return;

        // 流水反链优先尝试指向今日日记正身，绝不主动创建独立流水文档
        let journalDocId: string | undefined;
        try {
            const { findTodayDailyNoteDocId } = await import("@/libs/lv-notice-kit");
            journalDocId = (await findTodayDailyNoteDocId().catch(() => null)) || undefined;
        } catch { /* soft */ }

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
 * 格式化待办备忘轻量清单 Markdown（仅保留未完成的待办与周期事项，彻底剥离历史流水，永不膨胀）
 */
export function formatActiveMemosMarkdown(
    memos: Array<{
        id: string;
        title: string;
        dueDate: string;
        category?: string;
        priority?: string;
        cycleDays?: number;
        amount?: number;
    }>,
    docId?: string,
): string {
    const blockIdFor = (seedKey: string) => (docId ? stableAvSeed(seedKey, docId) : undefined);
    const introId = blockIdFor("bq:intro");
    const intro = `> 🏠 **小驴管家 · ${ACTIVE_MEMOS_TITLE}**\n{: ${introId ? `id="${introId}" ` : ""}custom-lvhome="1"}`;
    const active = memos.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (active.length === 0) {
        const h2Id = blockIdFor("h2:pending-memos");
        const pId = blockIdFor("p:empty-memos");
        return `${intro}\n\n## 📌 活跃待办与周期备忘\n{: ${h2Id ? `id="${h2Id}" ` : ""}custom-lvhome="1"}\n\n暂无待办事项。\n{: ${pId ? `id="${pId}" ` : ""}custom-lvhome="1"}`;
    }
    const lines = active.map((m) => {
        const pri = m.priority === "high" ? " · 🔴 紧急" : m.priority === "low" ? " · ⚪ 次要" : "";
        const cat = m.category ? ` · #${m.category.replace(/\s+/g, "_")}` : "";
        const cyc = m.cycleDays ? ` · 🔁 每 ${m.cycleDays} 天` : "";
        const amt = typeof m.amount === "number" && m.amount > 0 ? ` · 💰 ¥${m.amount}` : "";
        const memoBlockId = blockIdFor(`memo:${m.id}`);
        return `- [ ] **${m.title}** · 到期 \`${m.dueDate}\`${amt}${pri}${cat}${cyc} {: ${memoBlockId ? `id="${memoBlockId}" ` : ""}custom-lvhome-memo="${m.id}" }`;
    });
    const h2Id = blockIdFor("h2:pending-memos");
    return `${intro}\n\n## 📌 活跃待办与周期备忘（${active.length} 项）\n{: ${h2Id ? `id="${h2Id}" ` : ""}custom-lvhome="1"}\n\n${lines.join("\n")}`;
}

/**
 * @deprecated 待办已统一沉淀至思源当日日记，不再创建独立汇总待办文档
 */
export async function ensureActiveMemosDoc(_plugin: any): Promise<string | undefined> {
    return undefined;
}

/**
 * @deprecated 待办已统一沉淀至思源当日日记，不再覆写任何独立待办文档
 */
export async function syncActiveMemosDoc(_plugin: any): Promise<string | undefined> {
    return undefined;
}

/**
 * 将最新的一笔日常流水作为标准 LifeLog 单行增量追加至当日日记（增量模式，完全规避大文档冲突）
 */
export async function appendRecentRowLogToDailyNote(
    plugin: any,
    moduleId: string,
    providedLogs?: RowLogs,
): Promise<{ ok: boolean; line?: string; docId?: string; error?: string }> {
    try {
        const logs = providedLogs ?? (await loadRowLogs(plugin));
        const ref = plugin.settings?.dbRefs?.[moduleId];
        const avId = ref?.avId;
        if (!avId) return { ok: false, error: "missing-avId" };

        const prefix = `${avId}|`;
        const matchedKeys = Object.keys(logs).filter((k) => k.startsWith(prefix));
        if (matchedKeys.length === 0) return { ok: false, error: "no-matched-log" };

        const members: FamilyMember[] = plugin.settings?.members ?? [];
        const membersDocId = plugin.settings?.dbRefs?.members?.docId;
        const modTitle = typeof plugin.i18nText === "function"
            ? plugin.i18nText(`module.${moduleId}`)
            : String(plugin.i18n?.[`module.${moduleId}`] ?? moduleId);

        let latestEntry: Record<string, unknown> | null = null;
        let latestKind: LogKind = "quickflows";
        let latestAt = 0;

        for (const key of matchedKeys) {
            const grouped = logs[key];
            if (!grouped || typeof grouped !== "object") continue;
            for (const kind of ALL_LOG_KINDS) {
                const list = grouped[kind] as unknown as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(list) || list.length === 0) continue;
                const last = list[list.length - 1];
                if (!last) continue;
                const at = typeof last.at === "number" ? last.at : new Date(String(last.date || "") + "T" + String(last.time || "00:00")).getTime();
                if (at >= latestAt) {
                    latestAt = at;
                    latestEntry = last;
                    latestKind = kind;
                }
            }
        }

        if (!latestEntry) return { ok: false, error: "no-entry-found" };

        const linkedSpec = describeRowLogAsLifelog(latestKind, latestEntry, members, modTitle, {
            subjectDocId: ref.docId,
            membersDocId,
        });

        const tag = linkedSpec.tags?.length ? ` ${linkedSpec.tags.join(" ")}` : "";
        const refLink = ref.docId ? ` ((${ref.docId} "台账 · ${modTitle}"))` : "";
        const lineText = buildLifelogLine(linkedSpec.time, linkedSpec.lifelogType, `${linkedSpec.detailText}${tag}${refLink}`);

        const {
            createSiyuanDiaryTransport,
            recordHighFrequencyDiaryEvent,
        } = await import("./diary-envelope");
        const { newSiYuanId } = await import("./siyuan");
        const transport = createSiyuanDiaryTransport(plugin);
        const eventId = typeof (latestEntry as any).diaryEventId === "string" && (latestEntry as any).diaryEventId
            ? String((latestEntry as any).diaryEventId)
            : `evt-${newSiYuanId()}`;
        const blockId = newSiYuanId();

        const res = await recordHighFrequencyDiaryEvent(plugin, {
            eventId,
            blockId,
            module: moduleId,
            action: String(latestKind),
            target: String(matchedKeys[0]?.split("|")[1] || ""),
            avId: ref.avId,
            bizDate: linkedSpec.date,
            recordedAt: String((latestEntry as any).at || new Date().toISOString()),
            text: lineText,
            extraAttrs: {
                "custom-lifelog-type": cleanLifelogType(linkedSpec.lifelogType),
                "custom-lvhome": "1",
            },
            transport,
        });
        return { ok: true, line: lineText, docId: res.docId };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * 当备忘被勾选办结时，优先在思源当日日记中将原 `- [ ]` 原地更新为 `- [x]` 已完成；若未查到原块则回退追加流水
 */
export async function markMemoDoneInDailyNote(
    plugin?: any,
    memoOrReminder?: any,
): Promise<{ ok: boolean; line?: string; docId?: string }> {
    try {
        const rawId = String(memoOrReminder?.id || memoOrReminder?.content || "").trim();
        const cleanId = rawId.replace(/^adhoc::/, "");
        if (cleanId) {
            const { sql, updateBlock } = await import("@/core/siyuan");
            const safeMemoId = cleanId.replace(/'/g, "''");
            const rows = await sql<Array<{ id: string; content?: string; markdown?: string; root_id?: string }>>(
                `SELECT id, content, markdown, root_id FROM blocks WHERE instr(ial, 'custom-lvhome-memo="${safeMemoId}"') > 0 LIMIT 1`
            ).catch(() => []);
            const block = Array.isArray(rows) && rows[0]?.id ? rows[0] : null;
            if (block && typeof block.markdown === "string") {
                const cleanMd = block.markdown.replace(/^-\s*\[\s*\]/, "- [x]");
                await updateBlock(block.id, cleanMd);
                return { ok: true, docId: (block as any).root_id };
            }
        }
        return appendDoneMemoToDailyNote(plugin, memoOrReminder);
    } catch {
        return appendDoneMemoToDailyNote(plugin, memoOrReminder);
    }
}

/**
 * 当修改待办标题、到期日、优先级或分类时，联动更新思源日记中的对应任务块
 */
export async function updateMemoInDailyNote(
    _plugin: any,
    memoId: string,
    patch: { title?: string; dueDate?: string; priority?: string; category?: string }
): Promise<boolean> {
    try {
        const cleanId = String(memoId || "").replace(/^adhoc::/, "").trim();
        if (!cleanId) return false;
        const { sql, updateBlock } = await import("@/core/siyuan");
        const safeMemoId = cleanId.replace(/'/g, "''");
        const rows = await sql<Array<{ id: string; content?: string; markdown?: string; root_id?: string }>>(
            `SELECT id, content, markdown, root_id FROM blocks WHERE instr(ial, 'custom-lvhome-memo="${safeMemoId}"') > 0 LIMIT 1`
        ).catch(() => []);
        const block = Array.isArray(rows) && rows[0]?.id ? rows[0] : null;
        if (!block) return false;

        const title = String(patch.title || "").replace(/[\r\n]+/g, " ").trim();
        const due = patch.dueDate ? ` · 到期 \`${patch.dueDate}\`` : "";
        const cat = patch.category ? ` #${String(patch.category).replace(/\s+/g, "_")}` : "";
        const pri = patch.priority === "high" ? " · 🔴 紧急" : patch.priority === "low" ? " · ⚪ 次要" : "";
        const isDone = block.markdown ? /^-\s*\[[xX]\]/.test(block.markdown) : false;
        const checkbox = isDone ? "- [x]" : "- [ ]";
        const memoIdAttr = ` custom-lvhome-memo="${cleanId}"`;
        const nextMd = `${checkbox} **${title}**${due}${pri}${cat} #备忘\n{: custom-lvhome="1"${memoIdAttr} }`;
        await updateBlock(block.id, nextMd);
        return true;
    } catch {
        return false;
    }
}

/**
 * 删除待办时，联动删除思源日记中对应的任务块，不留孤儿任务
 */
export async function deleteMemoFromDailyNote(_plugin: any, memoId: string): Promise<boolean> {
    try {
        const cleanId = String(memoId || "").replace(/^adhoc::/, "").trim();
        if (!cleanId) return false;
        const { sql, post } = await import("@/core/siyuan");
        const safeMemoId = cleanId.replace(/'/g, "''");
        const rows = await sql<Array<{ id: string; root_id?: string }>>(
            `SELECT id, root_id FROM blocks WHERE instr(ial, 'custom-lvhome-memo="${safeMemoId}"') > 0 LIMIT 1`
        ).catch(() => []);
        const blockId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
        if (blockId) {
            await post("/api/block/deleteBlock", { id: blockId }).catch(() => undefined);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * 启动或刷新时扫描日记中已打勾 `- [x]` 的待办块，反向自愈管家中枢运行态为办结
 */
export async function autoHealMemosFromDailyNote(plugin: any): Promise<number> {
    if (!plugin?.runtime?.memos?.length) return 0;
    try {
        const { sql } = await import("@/core/siyuan");
        const rows = await sql<Array<{ id: string; ial: string; markdown: string }>>(
            `SELECT id, ial, markdown FROM blocks WHERE instr(ial, 'custom-lvhome-memo="') > 0 AND (markdown LIKE '- [x]%' OR markdown LIKE '- [X]%')`
        ).catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        let healed = 0;
        for (const row of rows) {
            const m = /custom-lvhome-memo="([^"]+)"/.exec(row.ial);
            if (m?.[1]) {
                const memoId = m[1];
                const target = plugin.runtime.memos.find((item: any) => item.id === memoId);
                if (target) {
                    // 已办结的不重复自愈，杜绝虚增月度完成统计
                    if (target.doneAt) continue;
                    // 周期性备忘不被历史日记中的勾选项触发无限循环跳期
                    if (target.cycle) continue;
                    if (typeof plugin.complete === "function") {
                        await plugin.complete({ id: `adhoc::${memoId}`, moduleId: "adhoc" }).catch(() => undefined);
                    }
                    healed++;
                }
            }
        }
        return healed;
    } catch {
        return 0;
    }
}

/**
 * 当备忘被勾选办结时，自动将办结事实以标准 LifeLog 格式增量追加至今日日记
 */
export async function appendDoneMemoToDailyNote(
    _plugin?: any,
    memoOrReminder?: any,
): Promise<{ ok: boolean; line?: string; docId?: string }> {
    try {
        const title = String(memoOrReminder.title || memoOrReminder.content || "生活备忘").trim();
        const now = new Date();
        const pad = (v: number) => String(v).padStart(2, "0");
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const cat = memoOrReminder.category ? ` #${String(memoOrReminder.category).replace(/\s+/g, "_")}` : "";
        const lineText = buildLifelogLine(timeStr, "备忘办结", `${title}${cat} #备忘`);

        const { appendXiaolvLifeLogToDailyNote } = await import("@/libs/lv-notice-kit");
        // 铁律：备忘办结日志一律落入思源原生默认当日日记「#### 🐴 小驴记录」折叠区并附统一 LifeLog 属性
        const res = await appendXiaolvLifeLogToDailyNote({
            time: timeStr,
            type: "备忘办结",
            body: `${title}${cat} #备忘`,
            source: "siyuan-home",
            module: "memos",
            extraAttrs: { "custom-lvhome": "1" },
        });
        return { ok: res.ok, line: lineText, docId: res.docId };
    } catch {
        return { ok: false };
    }
}

/**
 * @deprecated 彻底废除集中式独立日常流水与备忘文档覆写，所有流水与待办已统一汇入思源默认当日日记
 */
export async function syncDailyJournalDoc(
    _plugin: any,
    _providedLogs?: RowLogs,
): Promise<string | undefined> {
    return undefined;
}

/**
 * 打开日常流水与待办备忘对应的思源笔记文档 —— 一律直达思源笔记默认的当日日记！
 */
export async function openDailyJournalDoc(plugin: any): Promise<boolean> {
    if (!plugin) return false;
    try {
        const { openDiaryBottom, findTodayDailyNoteDocId } = await import("@/libs/lv-notice-kit");
        const todayDocId = await findTodayDailyNoteDocId();
        if (todayDocId && typeof plugin.showTabDocs === "function") {
            plugin.showTabDocs(todayDocId);
            return true;
        }
        await openDiaryBottom();
        return true;
    } catch {
        return false;
    }
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
 * 当 rowlogs 发生变更时，自动将最新 LifeLog 流水同步至涉及的台账文档
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
    } catch {
        /* ignore non-fatal doc sync errors */
    }
}

/**
 * 新增待办备忘时，自动作为原生待办任务项增量追加至思源默认当日日记
 */
export async function appendMemoToDailyNote(
    _plugin: any,
    memo: { title: string; dueDate: string; priority?: string; category?: string; id?: string; notebook?: string },
): Promise<{ ok: boolean; line?: string; docId?: string; blockId?: string }> {
    try {
        const title = String(memo.title || "生活备忘").replace(/[\r\n]+/g, " ").trim();
        const due = memo.dueDate ? ` · 到期 \`${memo.dueDate}\`` : "";
        const cat = memo.category ? ` #${String(memo.category).replace(/\s+/g, "_")}` : "";
        const pri = memo.priority === "high" ? " · 🔴 紧急" : memo.priority === "low" ? " · ⚪ 次要" : "";
        const memoIdAttr = memo.id ? ` custom-lvhome-memo="${memo.id}"` : "";
        const lineMd = `- [ ] **${title}**${due}${pri}${cat} #备忘\n{: custom-lvhome="1"${memoIdAttr} }`;

        const { ensureTodayDailyNoteForMemo } = await import("./hub/actions");
        const ensured = await ensureTodayDailyNoteForMemo(memo.notebook);
        if (!ensured?.docId) {
            return { ok: false, line: lineMd };
        }

        // 铁律：待办备忘新建一律落入思源原生默认当日日记「#### 🐴 小驴记录」折叠区
        let blockId = "";
        try {
            const { ensureXiaolvDiaryZone } = await import("@/libs/lv-notice-kit");
            const { post } = await import("./siyuan-transport");
            const zonePostFn = async (endpoint: string, payload: Record<string, unknown>) => {
                try {
                    const data = await post(endpoint, payload, { retries: 0 });
                    return { code: 0, data };
                } catch (err) {
                    return { code: -1, msg: err instanceof Error ? err.message : String(err) };
                }
            };
            const zone = await ensureXiaolvDiaryZone(ensured.docId, { postFn: zonePostFn });
            const insData = await post<any>("/api/block/insertBlock", {
                dataType: "markdown",
                previousID: zone.anchorBlockId,
                parentID: ensured.docId,
                data: lineMd,
            }, { retries: 0 });
            const opId = Array.isArray(insData) ? insData?.[0]?.doOperations?.[0]?.id : undefined;
            if (typeof opId === "string" && opId) blockId = opId;
        } catch { /* fallback to appendBlock */ }
        if (!blockId) {
            blockId = await appendBlock(ensured.docId, lineMd);
        }
        return { ok: true, line: lineMd, docId: ensured.docId, blockId: blockId || undefined };
    } catch {
        return { ok: false };
    }
}

/**
 * 自动检测并清理历史【日常流水与备忘】及多端同步产生的 Conflicted 冲突副本；
 * 将尚未办结的待办项安全回收并迁移至思源当日日记与管家运行态，彻底终结多端冲突。
 */
export async function cleanupLegacyJournalDocs(plugin: any): Promise<{ cleanedCount: number }> {
    let cleanedCount = 0;
    try {
        // 1. 清理 settings 中的旧引用
        let settingsDirty = false;
        if (plugin.settings?.dbRefs?.adhoc) {
            delete plugin.settings.dbRefs.adhoc;
            settingsDirty = true;
        }
        if (plugin.settings?.dbRefs?.activeMemos) {
            delete plugin.settings.dbRefs.activeMemos;
            settingsDirty = true;
        }
        if (plugin.settings?.ledgerJournalMode) {
            delete plugin.settings.ledgerJournalMode;
            settingsDirty = true;
        }
        if (settingsDirty) {
            try {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
            } catch { /* soft */ }
        }

        // 2. 查询需要安全清理的历史文档
        const { sql, getBlockKramdown } = await import("./siyuan");
        const targetRows = await sql<{ id: string; content: string; hpath: string; box: string }>(
            `SELECT id, content, hpath, box FROM blocks WHERE type='d' AND (content LIKE '%日常流水与备忘%' OR content LIKE '%生活待办与周期清单%' OR hpath LIKE '%日常流水与备忘%' OR hpath LIKE '%生活待办与周期清单%')`
        );

        if (Array.isArray(targetRows) && targetRows.length > 0) {
            const currentMemos = plugin.runtime?.memos ?? [];
            const memoTitles = new Set(currentMemos.map((m: any) => String(m.title || "").trim()));

            for (const row of targetRows) {
                try {
                    const kdRes = await getBlockKramdown(row.id, { retries: 0 }).catch(() => null);
                    const kramdown = kdRes?.kramdown ?? "";

                    // 安全回收未记录的备忘待办
                    const taskMatches = kramdown.matchAll(/- \[[ xX]\]\s+\*\*([^*]+)\*\*(?:[^\n]*?到期\s*`?([0-9-]+)`?)?/g);
                    for (const match of taskMatches) {
                        const title = (match[1] || "").trim();
                        const due = match[2] || localDateKey();
                        if (title && !memoTitles.has(title)) {
                            memoTitles.add(title);
                            const { addMemo } = await import("./hub/actions");
                            await addMemo(plugin, title, due);
                        }
                    }

                    // 经思源内核原生 API 安全删除冲突副本与旧文档
                    const nb = row.box;
                    const docId = row.id;
                    try {
                        await removeDoc(nb, `/${docId}.sy`);
                    } catch {
	                        const pRows = await sql<{ parent_id: string }>(`SELECT parent_id FROM blocks WHERE id='${docId.replace(/'/g, "''")}' LIMIT 1`).catch(() => []);
                        const pid = pRows?.[0]?.parent_id;
                        if (pid && pid !== docId) {
                            await removeDoc(nb, `/${pid}/${docId}.sy`).catch(() => null);
                        }
                    }
                    cleanedCount++;
                } catch (err) {
                    console.warn("[siyuan-home] cleanup doc item failed:", row.id, err);
                }
            }
        }
    } catch (e) {
        console.warn("[siyuan-home] cleanupLegacyJournalDocs error:", e);
    }
    return { cleanedCount };
}

// 注册 rowlog 写盘后的自动同步钩子（v4：彻底关闭旧 doc-sync 尾部追写，仅对未直接落盘日记信封的兼容条目增量写入）
setRowLogSyncHook(async (plugin, next, previous) => {
    if (previous) {
        const countEntries = (log?: RowLog): number => {
            if (!log) return 0;
            let sum = 0;
            for (const v of Object.values(log)) {
                if (Array.isArray(v)) sum += v.length;
            }
            return sum;
        };
        const countTotal = (logs: RowLogs): number => {
            let sum = 0;
            for (const log of Object.values(logs)) sum += countEntries(log);
            return sum;
        };
        const currentCount = countTotal(previous);
        const nextCount = countTotal(next);
        if (nextCount > currentCount) {
            for (const [key, val] of Object.entries(next)) {
                const prevVal = previous[key];
                if (!prevVal || countEntries(val) > countEntries(prevVal)) {
                    const avId = key.split("|")[0];
                    const matchedMod = Object.entries((plugin as any).settings?.dbRefs ?? {}).find(([, ref]: any) => ref?.avId === avId)?.[0];
                    if (matchedMod === "vehicles") {
                        await syncModuleDocSection(plugin, "vehicles", next).catch(() => undefined);
                    }
                    // 若新增条目已由 quick-event-saver / diary-envelope 直接写入当日日记，绝不重复双写
                    let alreadyWrittenToDiary = false;
                    for (const kind of ALL_LOG_KINDS) {
                        const nextList = (val[kind] as Array<Record<string, unknown>> | undefined) ?? [];
                        const prevList = (prevVal?.[kind] as Array<Record<string, unknown>> | undefined) ?? [];
                        if (nextList.length > prevList.length) {
                            const newest = nextList[nextList.length - 1];
                            if (newest && typeof newest.diaryEventId === "string" && newest.diaryEventId) {
                                alreadyWrittenToDiary = true;
                            }
                        }
                    }
                    if (alreadyWrittenToDiary) continue;
                    if (matchedMod) {
                        await appendRecentRowLogToDailyNote(plugin, matchedMod, next).catch(() => undefined);
                    }
                }
            }
        }
    }
});
