/**
 * 思源笔记文档双向落地与同步引擎（doc-sync.ts）
 *
 * 核心职责：
 * 1. 确保所有【快速记录 · 日常流水】（加油/充电、血压/血糖/心率、家务打卡、快捷待买、随手便签）、
 *    【临时备忘（runtime.memos）】以及【各模块行级子记录（rowlogs / 续期历史）】全部以原生 Markdown
 *    超级块（SuperBlock）形式幂等落盘到思源笔记文档中；
 * 2. 维护专用汇总文档 `/📒 日常流水与备忘`（登记于 `settings.dbRefs.adhoc`），并在各模块
 *    `/台账 · XXX` 文档底部同步维护 `## 📋 日常流水与附属记录` 区块，实现插件面板与思源原生文档
 *    100% 双向可查、可跳、可见。
 */

import {
    appendBlock,
    createDocWithMd,
    getBlockKramdown,
    getHPathByID,
    renderLedgerAll,
    updateBlock,
    type AvRow,
} from "./siyuan";
import { ensureNotebook, findLedgerDoc, isDocMissingError, stableAvSeed } from "./provisioner";
import { loadRowLogs, type LogKind, type RowLog, type RowLogs } from "./rowlog";
import { saveSettings } from "./settings";
import type { FamilyMember } from "@/types";

export const DAILY_JOURNAL_TITLE = "日常流水与备忘";
export const DAILY_JOURNAL_HPATH = "/📒 日常流水与备忘";

const ALL_LOG_KINDS: readonly LogKind[] = [
    "fuelings",
    "chargings",
    "maintenance",
    "vitals",
    "chexecs",
    "valuations",
    "moves",
    "prices",
    "transfers",
    "meters",
    "checks",
    "loans",
    "deposits",
];

const knownSectionIds = new Set<string>();
const sectionWriteChains = new Map<string, Promise<unknown>>();

export function sectionBlockId(docId: string, sectionKey: string): string {
    return stableAvSeed(`sec:${sectionKey}`, docId);
}

function enqueueSectionWrite<T>(secId: string, task: () => Promise<T>): Promise<T> {
    const prev = sectionWriteChains.get(secId) ?? Promise.resolve();
    const next = prev.then(task);
    sectionWriteChains.set(
        secId,
        next.catch(() => undefined),
    );
    return next;
}

/**
 * 在指定思源文档中幂等插入或原地更新一个带固定 ID 的超级块分区
 */
export async function upsertDocSection(
    docId: string,
    sectionKey: string,
    markdownBody: string,
): Promise<string> {
    const secId = sectionBlockId(docId, sectionKey);
    const wrapped = `{{{row\n${markdownBody.trim()}\n}}}\n{: id="${secId}" custom-lvhome-sec="${sectionKey}"}`;

    return enqueueSectionWrite(secId, async () => {
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
    });
}

function memberNameById(members: FamilyMember[] | undefined, idOrAvId: unknown): string {
    if (!idOrAvId || typeof idOrAvId !== "string") return "";
    const hit = (members ?? []).find((m) => m.id === idOrAvId || m.avItemId === idOrAvId);
    return hit?.name ?? "";
}

function rowTitleFromCells(row: AvRow | undefined, columns: Record<string, string> | undefined): string {
    if (!row || !columns?.name) return "";
    const cell = row.cells?.[columns.name];
    return String(cell?.text?.content ?? cell?.block?.content ?? "").trim();
}

/**
 * 将单条 rowlog 子记录格式化为易读的 Markdown 列表项文本
 */
export function formatRowLogEntryLine(
    kind: LogKind,
    entry: Record<string, unknown>,
    members?: FamilyMember[],
): string {
    const date = String(entry.date ?? entry.at ?? "").slice(0, 10) || "—";
    const note = typeof entry.note === "string" && entry.note.trim() ? ` · ${entry.note.trim()}` : "";

    switch (kind) {
        case "fuelings": {
            const qty = entry.quantity ?? entry.liters;
            const cost = entry.totalCost ?? entry.cost;
            const odo = entry.odometer ?? entry.mileage;
            const station = typeof entry.station === "string" && entry.station.trim() ? ` · ${entry.station.trim()}` : "";
            return `- **${date}** · ⛽ 加油${qty !== undefined ? ` **${qty} L**` : ""}${cost !== undefined ? ` · **¥${cost}**` : ""}${odo !== undefined ? ` · 里程 **${odo} km**` : ""}${station}${note}`;
        }
        case "chargings": {
            const qty = entry.quantity ?? entry.liters;
            const cost = entry.totalCost ?? entry.cost;
            const odo = entry.odometer ?? entry.mileage;
            const station = typeof entry.station === "string" && entry.station.trim() ? ` · ${entry.station.trim()}` : "";
            return `- **${date}** · ⚡ 充电${qty !== undefined ? ` **${qty} kWh**` : ""}${cost !== undefined ? ` · **¥${cost}**` : ""}${odo !== undefined ? ` · 里程 **${odo} km**` : ""}${station}${note}`;
        }
        case "maintenance": {
            const cat = typeof entry.category === "string" && entry.category.trim() ? entry.category.trim() : "常规维保";
            const cost = entry.cost ?? entry.totalCost;
            const odo = entry.odometer ?? entry.mileage;
            const shop = typeof entry.shop === "string" && entry.shop.trim() ? ` · ${entry.shop.trim()}` : "";
            return `- **${date}** · 🔧 维保（**${cat}**）${cost !== undefined ? ` · **¥${cost}**` : ""}${odo !== undefined ? ` · 里程 **${odo} km**` : ""}${shop}${note}`;
        }
        case "vitals": {
            const vtype = String(entry.type ?? "bp");
            if (vtype === "bg") {
                const timing = entry.val2 === 1 || entry.glucoseTiming === "postprandial" ? "餐后" : "空腹";
                return `- **${date}** · 🩸 血糖 **${entry.val1 ?? entry.glucose ?? "—"} mmol/L**（${timing}）${note}`;
            }
            if (vtype === "hr") {
                return `- **${date}** · 💓 心率 **${entry.val1 ?? entry.pulse ?? "—"} bpm**${note}`;
            }
            const sys = entry.val1 ?? entry.systolic ?? "—";
            const dia = entry.val2 ?? entry.diastolic ?? "—";
            const pulse = entry.pulse !== undefined ? ` · 心率 **${entry.pulse} bpm**` : "";
            return `- **${date}** · ❤️ 血压 **${sys}/${dia} mmHg**${pulse}${note}`;
        }
        case "chexecs": {
            const who = memberNameById(members, entry.memberId);
            const pts = typeof entry.points === "number" && entry.points > 0 ? ` · **+${entry.points} 积分**` : "";
            return `- **${date}** · 🧹 家务打卡${who ? ` · 执行人：**${who}**` : ""}${pts}${note}`;
        }
        case "valuations":
            return `- **${date}** · 💰 估值快照 **¥${entry.value ?? "—"}**${note}`;
        case "moves":
        case "transfers":
            return `- **${date}** · 📦 变更记录 **${entry.from || "—"} ➔ ${entry.to || "—"}**${note}`;
        case "prices":
            return `- **${date}** · 🏷 价格记录 **¥${entry.price ?? "—"}**${entry.channel ? ` · ${entry.channel}` : ""}${note}`;
        case "meters":
            return `- **${date}** · ⚡ 抄表读数 **${entry.reading ?? "—"}**${entry.usage !== undefined ? `（本期用量 **${entry.usage}**）` : ""}${note}`;
        case "checks":
            return `- **${date}** · ✅ 盘点核验 **${entry.result ?? "已核对"}**${note}`;
        case "loans":
            return `- **${date}** · 🤝 借出/归还 **${entry.to ?? "—"}**${entry.back ? `（已还 ${entry.back}）` : ""}${note}`;
        case "deposits":
            return `- **${date}** · 🪙 心愿存入 **¥${entry.amount ?? "—"}**${note}`;
        default:
            return `- **${date}** · 记录更新${note}`;
    }
}

export interface FormatModuleRowLogsInput {
    moduleTitle: string;
    avId: string;
    rows: AvRow[];
    columns?: Record<string, string>;
    logs: RowLogs;
    renewHistory?: Record<string, Array<{ from: string; to: string; at: string }>>;
    members?: FamilyMember[];
}

/**
 * 生成单个台账模块文档底部的 `## 📋 日常流水与附属记录` Markdown 内容
 */
export function formatModuleRowLogsMarkdown(input: FormatModuleRowLogsInput): string {
    const { avId, rows, columns, logs, renewHistory = {}, members } = input;
    const rowById = new Map(rows.map((r) => [r.itemID, r]));
    const prefix = `${avId}|`;
    const sections: string[] = [];

    const rowIds = new Set<string>();
    for (const r of rows) rowIds.add(r.itemID);
    for (const key of Object.keys(logs)) {
        if (key.startsWith(prefix)) rowIds.add(key.slice(prefix.length));
    }

    for (const rowId of rowIds) {
        const grouped: RowLog | undefined = logs[`${avId}|${rowId}`];
        const renews = renewHistory[rowId] ?? [];
        const lines: Array<{ sortKey: string; text: string }> = [];

        if (grouped && typeof grouped === "object") {
            for (const kind of ALL_LOG_KINDS) {
                const list = grouped[kind] as unknown as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(list) || list.length === 0) continue;
                for (const entry of list) {
                    if (!entry || typeof entry !== "object") continue;
                    const sortKey = String(entry.at ?? entry.date ?? "");
                    lines.push({
                        sortKey,
                        text: formatRowLogEntryLine(kind, entry, members),
                    });
                }
            }
        }

        for (const r of renews) {
            lines.push({
                sortKey: String(r.at ?? r.to ?? ""),
                text: `- **${String(r.at ?? "").slice(0, 10) || "—"}** · 🔄 效期续期 **${r.from} ➔ ${r.to}**`,
            });
        }

        if (lines.length === 0) continue;
        lines.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
        const rowTitle = rowTitleFromCells(rowById.get(rowId), columns) || "关联条目";
        sections.push(`### 📌 ${rowTitle}\n\n${lines.map((l) => l.text).join("\n")}`);
    }

    if (sections.length === 0) {
        return "";
    }

    return `## 📋 日常流水与附属记录\n\n> 💡 以下流水由「快速记录 · 日常流水」或台账详情抽屉实时同步，与上方思源属性视图数据库联动。\n\n${sections.join("\n\n")}`;
}

export interface DailyJournalFlowItem {
    date: string;
    sortKey: string;
    moduleId: string;
    moduleTitle: string;
    docId?: string;
    rowTitle: string;
    summaryLine: string;
}

export interface FormatDailyJournalInput {
    memos: Array<{
        id: string;
        title: string;
        dueDate: string;
        doneAt?: string;
        priority?: "high" | "medium" | "low";
        category?: string;
        cycle?: string;
        recurrenceAnchor?: "due" | "completion";
    }>;
    flowItems: DailyJournalFlowItem[];
    quickItems?: Array<{
        date: string;
        kindLabel: string;
        title: string;
        detail?: string;
        docId?: string;
        moduleTitle?: string;
    }>;
}

/**
 * 生成 `/📒 日常流水与备忘` 汇总文档的完整同步区块 Markdown
 */
export function formatDailyJournalMarkdown(input: FormatDailyJournalInput): string {
    const { memos = [], flowItems = [], quickItems = [] } = input;

    // 1. 日常流水部分
    const flowLines: string[] = [];
    for (const q of quickItems) {
        const ref = q.docId ? ` · ((${q.docId} "${q.moduleTitle || "查看台账"}"))` : "";
        flowLines.push(`- **${q.date}** · ${q.kindLabel} **${q.title}**${q.detail ? ` · ${q.detail}` : ""}${ref}`);
    }
    const sortedFlows = [...flowItems].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    for (const item of sortedFlows) {
        const cleanBody = item.summaryLine.replace(/^-\s*\*\*[^*]+\*\*\s*·\s*/, "");
        const ref = item.docId ? ` · ((${item.docId} "台账 · ${item.moduleTitle}"))` : "";
        flowLines.push(`- **${item.date}** · **${item.rowTitle}**（${item.moduleTitle}）· ${cleanBody}${ref}`);
    }

    const flowsSection = flowLines.length > 0
        ? `## ⚡ 日常流水记录（共 ${flowLines.length} 条）\n\n${flowLines.slice(0, 100).join("\n")}`
        : `## ⚡ 日常流水记录\n\n- 暂无日常流水记录。可在管家「⚡ 快速记录 · 日常流水」中随时录入加油充电、血压血糖、家务打卡、快捷待买与随手便签。`;

    // 2. 临时备忘与周期提醒部分
    const activeMemos = memos.filter((m) => !m.doneAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const doneMemos = memos.filter((m) => !!m.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));

    const memoLines: string[] = [];
    for (const m of activeMemos) {
        const pri = m.priority === "high" ? " · 🔥 高优" : m.priority === "medium" ? " · ⚡ 中优" : m.priority === "low" ? " · 🌱 低优" : "";
        const cat = m.category ? ` · #${m.category}` : "";
        const cyc = m.cycle ? ` · 🔁 ${m.cycle}${m.recurrenceAnchor === "completion" ? "(按完成顺延)" : ""}` : "";
        memoLines.push(`- [ ] **${m.title}** · 📅 到期 \`${m.dueDate}\`${pri}${cat}${cyc}`);
    }
    for (const m of doneMemos.slice(0, 30)) {
        memoLines.push(`- [x] ~~${m.title}~~ · ✅ 完成于 \`${String(m.doneAt).slice(0, 10)}\``);
    }

    const memosSection = memoLines.length > 0
        ? `## 📌 临时备忘与周期事项（待办 ${activeMemos.length} 项）\n\n${memoLines.join("\n")}`
        : `## 📌 临时备忘与周期事项\n\n- 暂无临时备忘。可在总览「快速记录」中输入自然语言备忘（支持 \`@明天 !高 #家务 *!14天\`）。`;

    return `${flowsSection}\n\n---\n\n${memosSection}`;
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
        const found = await findLedgerDoc(notebookId, DAILY_JOURNAL_HPATH, "adhoc");
        if (found?.id) {
            plugin.settings.dbRefs.adhoc = {
                ...existing,
                docId: found.id,
                notebook: found.box || notebookId,
            };
            try { await saveSettings(plugin, plugin.settings); } catch { /* soft */ }
            return found.id;
        }

        const headerMd = `# 📒 ${DAILY_JOURNAL_TITLE}\n\n> 🏠 **小驴管家 · 日常流水与临时备忘总账**\n> 💡 这里实时汇总您在小驴管家录入的**日常流水**（加油/充电、血压/血糖/心率、家务打卡、快捷待买、随手便签）与**临时备忘**，并与各模块台账文档双向联动。\n\n`;
        const docId = await createDocWithMd(notebookId, DAILY_JOURNAL_HPATH, headerMd, {
            idempotencyKey: `provision:doc:adhoc:${notebookId}:${DAILY_JOURNAL_HPATH}`,
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
 * 将指定模块的 rowlogs 与续期历史同步写入该模块对应的 `/台账 · XXX` 思源文档
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
        });
        if (!md) return;
        await upsertDocSection(ref.docId, "rowlogs", md);
    } catch {
        /* 思源文档辅助区块同步失败不阻断主业务事务 */
    }
}

/**
 * 同步更新 `/📒 日常流水与备忘` 思源文档（汇总全部日常流水、待买/便签速记与临时备忘）
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
        const modLabel = (id: string) =>
            typeof plugin.i18nText === "function"
                ? plugin.i18nText(`module.${id}`)
                : String(plugin.i18n?.[`module.${id}`] ?? id);

        // 找出 logs 涉及到的模块并读取行名称
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

            for (const kind of ALL_LOG_KINDS) {
                const list = grouped[kind] as unknown as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(list)) continue;
                for (const entry of list) {
                    if (!entry || typeof entry !== "object") continue;
                    const date = String(entry.date ?? entry.at ?? "").slice(0, 10) || "—";
                    const sortKey = String(entry.at ?? entry.date ?? "");
                    flowItems.push({
                        date,
                        sortKey,
                        moduleId,
                        moduleTitle,
                        docId: modInfo?.docId,
                        rowTitle,
                        summaryLine: formatRowLogEntryLine(kind, entry, members),
                    });
                }
            }
        }

        // 同时汇总最近快捷录入的待买清单（shopping）与随手便签（snippets）前 10 条
        const quickItems: NonNullable<FormatDailyJournalInput["quickItems"]> = [];
        const shopRef = plugin.settings.dbRefs?.shopping;
        if (shopRef?.avId && shopRef.columns?.name) {
            try {
                const shopRead = await renderLedgerAll(shopRef.avId);
                for (const r of (shopRead.rows ?? []).slice(0, 10)) {
                    const name = rowTitleFromCells(r, shopRef.columns);
                    if (!name) continue;
                    const qty = shopRef.columns.qty ? r.cells?.[shopRef.columns.qty]?.number?.content : undefined;
                    const dateMs = shopRef.columns.date && r.cells?.[shopRef.columns.date]?.date?.isNotEmpty
                        ? r.cells[shopRef.columns.date].date.content
                        : undefined;
                    const dateStr = typeof dateMs === "number" && dateMs > 0
                        ? new Date(dateMs).toISOString().slice(0, 10)
                        : "近期";
                    quickItems.push({
                        date: dateStr,
                        kindLabel: "🛒 待买清单",
                        title: name,
                        detail: qty ? `数量 ${qty}` : undefined,
                        docId: shopRef.docId,
                        moduleTitle: `台账 · ${modLabel("shopping")}`,
                    });
                }
            } catch { /* soft */ }
        }

        const snipRef = plugin.settings.dbRefs?.snippets;
        if (snipRef?.avId && snipRef.columns?.name) {
            try {
                const snipRead = await renderLedgerAll(snipRef.avId);
                for (const r of (snipRead.rows ?? []).slice(0, 10)) {
                    const name = rowTitleFromCells(r, snipRef.columns);
                    if (!name) continue;
                    const contentKey = snipRef.columns.content || snipRef.columns.note;
                    const bodyText = contentKey ? String(r.cells?.[contentKey]?.text?.content ?? "").trim() : "";
                    quickItems.push({
                        date: "便签",
                        kindLabel: "📝 随手便签",
                        title: name,
                        detail: bodyText && bodyText !== name ? bodyText.slice(0, 60) : undefined,
                        docId: snipRef.docId,
                        moduleTitle: `台账 · ${modLabel("snippets")}`,
                    });
                }
            } catch { /* soft */ }
        }

        const md = formatDailyJournalMarkdown({
            memos,
            flowItems,
            quickItems,
        });
        await upsertDocSection(docId, "journal", md);
        return docId;
    } catch {
        return undefined;
    }
}

/**
 * 打开指定模块台账文档或 `/📒 日常流水与备忘` 文档（若尚未创建则即时同步创建后打开）
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
 * 当 rowlogs 发生变更时，自动将最新流水同步至涉及的台账文档及 `/📒 日常流水与备忘`
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
