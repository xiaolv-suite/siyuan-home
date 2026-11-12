/**
 * 台账写入网关：业务弹窗、抽屉与快速流水新建台账行的唯一出口。
 *
 * 调用方只交“字段 key → 原始值”，列类型一律从 SCHEMA_CATALOG 查，
 * 由这里统一完成：
 * - select 双形态（select + mSelect，内核 3.8.x 只认 mSelect）；
 * - date 转毫秒时间戳（内核不接受日期字符串）；
 * - relation 把 settings 成员 id 换成成员台账行的 avItemId（两套 ID 空间）；
 * - name 列显式写入（addDetachedRow 的标题不会落到 av 名称列）。
 * 单格失败不抛出，按字段 key 收集到 failed，由调用方决定是否继续后续动作。
 */
import { SCHEMA_CATALOG } from "./schema-catalog";
import { cellValue, selectCellValue } from "./avcell";
import { addDetachedRow, setCell, type RequestOptions } from "./siyuan";

export interface LedgerWriteTarget {
    avId?: string;
    columns?: Record<string, string>;
}

export interface WriterMember {
    id: string;
    avItemId?: string;
}

export type AddRowFn = (avId: string, name: string, options?: RequestOptions) => Promise<string>;
export type SetCellFn = (avId: string, keyId: string, itemId: string, value: unknown, options?: RequestOptions) => Promise<unknown>;

/** 成员引用归一：接受 settings 成员 id 或 avItemId，返回 avItemId；无法确认时返回 undefined。 */
export function resolveMemberItemId(raw: unknown, members: readonly WriterMember[] | undefined): string | undefined {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return undefined;
    if (!members) return value;
    const hit = members.find((m) => m.avItemId === value) ?? members.find((m) => m.id === value);
    return hit?.avItemId || undefined;
}

/** 按列类型把原始值转为内核单元格载荷；无法表示时返回 null。 */
export function toLedgerCell(type: string, raw: unknown, members?: readonly WriterMember[]): unknown | null {
    switch (type) {
        case "select":
            return typeof raw === "string" && raw ? selectCellValue(raw) : null;
        case "mSelect": {
            const list = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v ?? "").trim()).filter(Boolean);
            return list.length ? { type: "mSelect", mSelect: list.map((content) => ({ content })) } : null;
        }
        case "relation": {
            const list = Array.isArray(raw) ? raw : (typeof raw === "string" && raw.includes(",") ? raw.split(",") : [raw]);
            const ids = list.map((item) => resolveMemberItemId(item, members)).filter(Boolean) as string[];
            return ids.length ? { type: "relation", relation: { blockIDs: ids, contents: null } } : null;
        }
        case "url":
            return typeof raw === "string" && raw ? { type: "url", url: { content: raw } } : null;
        case "number":
        case "date":
        case "checkbox":
            return cellValue(type, raw);
        default:
            return raw === undefined || raw === null ? null : cellValue("text", String(raw));
    }
}

export function columnTypeOf(moduleId: string, key: string): string {
    if (key === "name") return "text";
    return SCHEMA_CATALOG[moduleId]?.columns?.find((c) => c.key === key)?.type ?? "text";
}

export interface WriteLedgerRowOptions {
    moduleId: string;
    target: LedgerWriteTarget;
    name: string;
    /** 字段 key → 原始值；undefined / null / "" 跳过。 */
    fields?: Record<string, unknown>;
    members?: readonly WriterMember[];
    /** 已有行时只写字段，不新建。 */
    itemId?: string;
    operationKey?: string;
    addRowFn?: AddRowFn;
    setCellFn?: SetCellFn;
}

export interface WriteLedgerRowResult {
    itemID: string;
    /** 写入失败或无法转换的字段 key。 */
    failed: string[];
}

export async function writeLedgerRow(opts: WriteLedgerRowOptions): Promise<WriteLedgerRowResult> {
    const { moduleId, target, members, operationKey } = opts;
    const addRow = opts.addRowFn ?? addDetachedRow;
    const write = opts.setCellFn ?? setCell;
    const avId = target.avId;
    if (!avId) throw new Error(`ledger not provisioned: ${moduleId}`);
    const name = String(opts.name ?? "").trim();
    const itemID = opts.itemId ?? await addRow(avId, name, operationKey ? { idempotencyKey: `${operationKey}:row` } : undefined);
    if (!itemID) throw new Error(`row not created: ${moduleId}`);

    const failed: string[] = [];
    const entries: Array<[string, unknown]> = [];
    if (name && !opts.itemId) entries.push(["name", name]);
    for (const [key, value] of Object.entries(opts.fields ?? {})) {
        if (key === "name" || value === undefined || value === null || value === "") continue;
        entries.push([key, value]);
    }
    for (const [key, value] of entries) {
        const keyId = target.columns?.[key];
        if (!keyId) {
            // name 列缺失不算失败（标题已随行创建）；其余字段如实上报。
            if (key !== "name") failed.push(key);
            continue;
        }
        const cell = toLedgerCell(columnTypeOf(moduleId, key), value, members);
        if (cell === null) { failed.push(key); continue; }
        try {
            await write(avId, keyId, itemID, cell, operationKey ? { idempotencyKey: `${operationKey}:cell:${key}` } : undefined);
        } catch {
            failed.push(key);
        }
    }
    return { itemID, failed };
}
