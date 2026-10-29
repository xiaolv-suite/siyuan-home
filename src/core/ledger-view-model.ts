/**
 * 台账视图数据模型与单元格渲染辅助引擎
 * 解耦自 ledger.svelte，集中承载单元格格式化、访客脱敏、动态地点/字段建议、排序与多字段拼音搜索
 */

import { optLabel, optLabelText } from "./format";
import { maskCredentialNumber, maskIdNumber } from "./idcard";
import { selectCellContent, cellContentText } from "./avcell";
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
            if (!revealSensitive && ["holder_no", "x_cert_birth_registration_no_last4", "x_cert_vocational_registration_last4", "x_cert_professional_registration_last4", "x_cert_graduation_no_last4", "x_cert_degree_no_last4"].includes(colKey ?? "") && content !== "—") return maskCredentialNumber(content);
            return content;
        }
        case "date": {
            if (v.date?.content === undefined || v.date.content === null) return "—";
            const raw = v.date.content;
            const num = Number(raw);
            const d = !isNaN(num) && num > 100000000 ? new Date(num) : new Date(String(raw));
            return isNaN(d.getTime()) ? "—" : localDateKey(d);
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
        case "relation": return (v.relation?.contents ?? []).map((c: any) => c.block?.content ?? "").join(", ") || "—";
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
    const s = v?.type === "date" && v.date?.isNotEmpty ? localDateKey(new Date(v.date.content)) : "";
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

export function sortLedgerRows(
    list: any[],
    keyID?: string,
    ascending = true,
    keyType?: string,
    cellTextFn?: (cell: any, key?: string) => string,
): any[] {
    if (!keyID || !cellTextFn) return list;
    return [...list].sort((a, b) => {
        const av = cellTextFn(a.cells?.[keyID]);
        const bv = cellTextFn(b.cells?.[keyID]);
        const an = Number(av);
        const bn = Number(bv);
        const cmp = keyType === "number" && Number.isFinite(an) && Number.isFinite(bn) && av !== "—" && bv !== "—"
            ? an - bn
            : av.localeCompare(bv, undefined, { numeric: true });
        return ascending ? cmp : -cmp;
    });
}

export function matchLedgerRowSearch(
    row: any,
    q: string,
    columns?: Record<string, string>,
    cellTextFn?: (cell: any, key?: string) => string,
): boolean {
    if (!columns || !cellTextFn) return false;
    const searchable = Object.values(columns)
        .map((columnId) => cellTextFn(row.cells?.[columnId as string]))
        .join(" ");
    return searchMatch(searchable, q.trim().toLowerCase());
}
