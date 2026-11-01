/**
 * 台账视图数据模型与单元格渲染辅助引擎
 * 解耦自 ledger.svelte，集中承载单元格格式化、访客脱敏、动态地点/字段建议、排序与多字段拼音搜索
 */

import { optLabel, optLabelText, SENSITIVE_CREDENTIAL_KEYS } from "./format";
import { maskCredentialNumber, maskIdNumber } from "./idcard";
import { selectCellContent, selectCellValue, cellContentText } from "./avcell";
import { localDateKey } from "./hub/rule";
import { searchMatch } from "./pinyin";
import { maskValueForGuest, createDefaultGuestConfig } from "./guest-mode";

export const DEFAULT_LOCATIONS = ["主卧抽屉", "客厅药箱", "玄关柜", "书房书架", "储藏室", "冰箱冷藏", "厨房吊柜"];

export type LedgerTone = "danger" | "warn" | "ok" | "none";

export function formatLedgerCellText(
    v: any,
    colKey: string | undefined,
    t: (k: string) => string,
    guestModeActive = false,
    revealSensitive = false,
    members?: any[],
): string {
    if (!v) return "—";
    if (guestModeActive) {
        const guestConfig = createDefaultGuestConfig(true);
        const rawVal = v.type === "number" && v.number?.isNotEmpty ? v.number.content : (v.text?.content ?? "");
        const masked = maskValueForGuest(rawVal, colKey ?? "", guestConfig);
        if (masked !== rawVal) return String(masked);
    }
    switch (v.type) {
        case "text": {
            const content = v.text?.content ?? "—";
            if (!revealSensitive && colKey === "x_cert_id_number" && content !== "—") return maskIdNumber(content);
            if (!revealSensitive && SENSITIVE_CREDENTIAL_KEYS.has(colKey ?? "") && content !== "—") return maskCredentialNumber(content);
            return content;
        }
        case "date": {
            if (!v.date || v.date.isNotEmpty === false || v.date.content === undefined || v.date.content === null) return "—";
            const raw = v.date.content;
            const num = Number(raw);
            if (!isNaN(num) && (num === 0 || num <= -60000000000000)) return "—";
            const d = !isNaN(num) && num > 100000000 ? new Date(num) : new Date(String(raw));
            return isNaN(d.getTime()) || d.getFullYear() < 1900 ? "—" : localDateKey(d);
        }
        case "select": {
            const s = selectCellContent(v) ?? "—";
            return colKey && s !== "—" ? optLabel(t, colKey, s) : s;
        }
        case "mSelect": {
            const list = v.mSelect?.length ? v.mSelect.map((o: any) => o?.content).filter(Boolean).join(", ") : "—";
            return colKey && list !== "—" ? optLabelText(t, colKey, list) : list;
        }
        case "number": return typeof v.number?.content === "number" && !isNaN(v.number.content) ? String(v.number.content) : (v.number?.content !== undefined && !isNaN(Number(v.number.content)) ? String(Number(v.number.content)) : "—");
        case "url": return v.url?.content ?? "—";
        case "checkbox": return v.checkbox?.checked ? "是" : "—";
        case "block": return v.block?.content ?? "—";
        case "relation": {
            const fromContents = (v.relation?.contents ?? []).map((c: any) => c.block?.content ?? "").filter(Boolean);
            if (fromContents.length > 0) return fromContents.join("、");
            if (v.relation?.blockIDs?.length && members?.length) {
                const fromIds = (v.relation.blockIDs as string[])
                    .map((id) => members.find((m: any) => m.avItemId === id || m.id === id)?.name)
                    .filter(Boolean);
                if (fromIds.length > 0) return fromIds.join("、");
            }
            return "—";
        }
        case "mAsset": return (v.mAsset ?? []).map((asset: any) => asset?.name ?? asset?.content ?? "").filter(Boolean).join(", ") || "—";
        default: {
            const fallback = cellContentText(v);
            return fallback || "—";
        }
    }
}

export function calculateLedgerTone(r: any, columns?: Record<string, string>, warnDays = 30): LedgerTone {
    const col = columns?.expiry ?? columns?.due;
    if (!col) return "none";
    const v = r.cells?.[col];
    const s = v?.type === "date" && v.date?.isNotEmpty && v.date.content ? localDateKey(new Date(v.date.content)) : "";
    if (!s) return "none";
    const today = localDateKey(new Date());
    if (s < today) return "danger";
    const end = localDateKey(new Date(Date.now() + warnDays * 86400000));
    return s <= end ? "warn" : "ok";
}

export function toneCls(tone: LedgerTone): string {
    return tone === "danger" ? "red" : tone === "warn" ? "orange" : tone === "ok" ? "green" : "gray";
}

export function toneColor(tone: LedgerTone): string {
    return tone === "danger" ? "var(--lv-danger)" : tone === "warn" ? "var(--lv-warn)" : "";
}

export function computeColumnSuggestions(
    rows: any[],
    columns?: Record<string, string>,
    cellTextFn?: (cell: any, key?: string) => string,
): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    if (!columns || !cellTextFn) return map;
    for (const [colKey, colId] of Object.entries(columns)) {
        if (["name", "location", "store_place", "copy_location", "brand_model", "channel", "hospital", "doctor", "party", "unit"].includes(colKey)) {
            const valuesSet = new Set<string>();
            for (const r of rows) {
                const txt = String(cellTextFn(r.cells?.[colId], colKey) ?? "").trim();
                if (txt && txt !== "—" && txt.length <= 40) {
                    valuesSet.add(txt);
                }
            }
            if (valuesSet.size > 0) {
                map[colKey] = Array.from(valuesSet).slice(0, 15);
            }
        }
    }
    return map;
}

export function computeDynamicLocations(
    rows: any[],
    columns?: Record<string, string>,
    cellTextFn?: (cell: any, key?: string) => string,
): string[] {
    const set = new Set<string>(DEFAULT_LOCATIONS);
    if (!columns || !cellTextFn) return Array.from(set);
    const locCols = [columns.location, columns.store_place, columns.copy_location].filter(Boolean);
    for (const colId of locCols) {
        for (const r of rows) {
            const txt = String(cellTextFn(r.cells?.[colId as string]) ?? "").trim();
            if (txt && txt !== "—" && txt.length <= 20) {
                set.add(txt);
            }
        }
    }
    return Array.from(set).slice(0, 12);
}

const numericCollator = new Intl.Collator(undefined, { numeric: true });
const rowSearchableTextCache = new WeakMap<object, string>();

export function sortLedgerRows(
    list: any[],
    keyID?: string,
    ascending = true,
    keyType?: string,
    cellTextFn?: (cell: any, key?: string) => string,
): any[] {
    if (!keyID || !cellTextFn || list.length <= 1) return list;
    const isNum = keyType === "number";
    // 施瓦茨变换：每行预先提取一次键值，避免排序内部高频重复执行正则掩码与格式化
    const decorated = list.map((item) => {
        const txt = cellTextFn(item?.cells?.[keyID]);
        const num = isNum ? Number(txt) : NaN;
        const validNum = isNum && Number.isFinite(num) && txt !== "—";
        return { item, txt, num, validNum };
    });
    decorated.sort((a, b) => {
        const cmp = a.validNum && b.validNum
            ? a.num - b.num
            : numericCollator.compare(a.txt, b.txt);
        return ascending ? cmp : -cmp;
    });
    return decorated.map((d) => d.item);
}

export function matchLedgerRowSearch(
    row: any,
    q: string,
    columns?: Record<string, string>,
    cellTextFn?: (cell: any, key?: string) => string,
): boolean {
    if (!columns || !cellTextFn || !row) return false;
    let searchable = rowSearchableTextCache.get(row);
    if (searchable === undefined) {
        searchable = Object.values(columns)
            .map((columnId) => cellTextFn(row.cells?.[columnId as string]))
            .join(" ");
        if (typeof row === "object" && row !== null) {
            rowSearchableTextCache.set(row, searchable);
        }
    }
    return searchMatch(searchable, q.trim().toLowerCase());
}

/** 计算视图中缺失的未绑定/失效列 */
export function computeMissingSchemaColumns(
    registeredColumns: Record<string, string> | undefined,
    avCols: any[],
    schemaColumns?: any[],
): any[] {
    if (!registeredColumns || !schemaColumns) return [];
    const existingIds = new Set(avCols.map((c) => c?.id));
    return schemaColumns.filter((sc) => {
        const registeredId = registeredColumns[sc.key];
        return !registeredId || !existingIds.has(registeredId);
    });
}

/** 动态推算台账主表格展示列 */
export function computeTableKeys(
    schemaKeys: string[],
    schemaColumns?: any[],
    preferred = [
        "name",
        "category",
        "amount",
        "qty",
        "stock_qty",
        "member",
        "status",
        "date",
        "expiry",
        "due",
        "brand_model",
        "plate",
        "energy_type",
        "mileage",
        "note",
    ],
): string[] {
    const keys = preferred.filter((key) => schemaKeys.includes(key));
    const columns = schemaColumns ?? [];
    for (const column of columns) {
        if (keys.length >= 6) break;
        if (
            schemaKeys.includes(column.key) &&
            !keys.includes(column.key) &&
            !["asset", "mAsset", "mSelect"].includes(column.type) &&
            !(column.type === "relation" && column.key !== "member")
        ) {
            keys.push(column.key);
        }
    }
    return keys.length > 0 ? keys : schemaKeys.slice(0, 5);
}

/** 推导当前模块的提醒提前期阈值 */
export function computeModuleWarnDays(
    rules: { key: string; leadDays: number }[] | undefined,
    leadOverrides: Record<string, number> | undefined,
    activeModule: string,
): number {
    let max = 0;
    for (const rule of rules ?? []) {
        const lead = leadOverrides?.[`${activeModule}.${rule.key}`] ?? rule.leadDays;
        if (typeof lead === "number" && lead > max) max = lead;
    }
    return max > 0 ? max : 30;
}

/** 构造思源单元格写入值载荷 */
export function buildLedgerCellPayload(type: string, v: any, members?: any[]): unknown | null {
    switch (type) {
        case "select": return selectCellValue(v);
        case "relation": {
            const rawList: string[] = Array.isArray(v)
                ? v.map(String)
                : typeof v === "string" && v.includes(",")
                    ? v.split(",")
                    : typeof v === "string" && v.trim()
                        ? [v.trim()]
                        : [];
            const linkedIds = rawList
                .map((s) => s.trim())
                .filter((id) => id && (members ?? []).some((m) => m.avItemId === id || m.id === id))
                .map((id) => {
                    const m = (members ?? []).find((mem) => mem.avItemId === id || mem.id === id);
                    return m?.avItemId || id;
                });
            return linkedIds.length > 0 ? { type: "relation", relation: { blockIDs: linkedIds, contents: null } } : null;
        }
        case "date": return v === "" ? { type: "date", date: { isNotEmpty: false } } : { type: "date", date: { content: new Date(`${v}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } };
        case "number": return v === "" || v === null ? { type: "number", number: { isNotEmpty: false } } : { type: "number", number: { content: Number(v), isNotEmpty: true } };
        case "url": return { type: "url", url: { content: v } };
        case "checkbox": return { type: "checkbox", checkbox: { checked: !!v } };
        default: return { type: "text", text: { content: String(v) } };
    }
}
