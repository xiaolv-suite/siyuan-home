/**
 * av 单元格读写的内核兼容层（R8 发现，2026-10-09）：
 * 思源 v3.7.0 起 setAttributeViewBlockAttr 移除 rowID、且 select 值按 MSelect 数组读取
 * （内核 UpdateAttributeViewCell 只认 val.MSelect；issue #15727 / #15533）。
 * - 写：selectCellValue(content) 统一产出 双形态 payload（select 单值 + mSelect 数组），
 *   新旧内核均能命中；
 * - 读：selectCellContent(cell) 先 mSelect 后 select（旧数据兼容）。
 */

export interface AvCellLike {
    type?: string;
    select?: { content?: string };
    mSelect?: { content?: string }[];
    text?: { content?: string };
    block?: { content?: string; id?: string };
    number?: { content?: number; isNotEmpty?: boolean };
    date?: { content?: number; isNotEmpty?: boolean };
    url?: { content?: string };
    checkbox?: { checked?: boolean };
    relation?: { blockIDs?: string[]; contents?: unknown };
    mAsset?: { name?: string; content?: string }[];
    [key: string]: unknown;
}

export interface SelectNormalizationSpec {
    options?: readonly string[];
    default?: string;
}

export interface NormalizeSelectOptions {
    /** 无值或不在枚举内时，若字段声明了 default（或 fallbackAnyFirst=true），则兜底返回默认值 */
    fallbackToDefault?: boolean;
    /** 即便字段未显式声明 default，也允许回退到 options[0] */
    fallbackToFirstOption?: boolean;
    /** 若值不在 options 内，是否保留去空白后的原值（如 chores.cycle 支持 "14d" 自定义周期） */
    preserveUnknown?: boolean;
    /** 可选的本地化标签解析器，用于把“有效”等展示名归一化回 schema 枚举键 */
    labelOf?: (opt: string) => string;
}

/**
 * 归一化 select 枚举值：
 * 1) 去除首尾空白，精确命中优先；
 * 2) 忽略大小写命中次之；
 * 3) 若提供 labelOf，则按展示标签反查标准枚举键；
 * 4) 空白或越界值按需兜底到 schema.default（或 options[0]）。
 */
export function normalizeSelectValue(
    raw: unknown,
    spec?: SelectNormalizationSpec | null,
    opts?: NormalizeSelectOptions,
): string | undefined {
    const trimmed = typeof raw === "string" ? raw.trim() : (raw !== undefined && raw !== null ? String(raw).trim() : "");
    const options = spec?.options ?? [];
    const fallback = (opts?.fallbackToDefault || opts?.fallbackToFirstOption)
        ? (spec?.default !== undefined && (options.length === 0 || options.includes(spec.default))
            ? spec.default
            : (opts?.fallbackToFirstOption && options.length > 0 ? options[0] : undefined))
        : undefined;

    if (!trimmed || trimmed === "—") {
        return fallback;
    }
    if (options.length === 0) {
        return trimmed;
    }
    if (options.includes(trimmed)) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    const caseHit = options.find((o) => o.toLowerCase() === lower);
    if (caseHit) return caseHit;
    if (opts?.labelOf) {
        const labelHit = options.find((o) => {
            const lbl = opts.labelOf!(o)?.trim();
            return lbl && lbl.toLowerCase() === lower;
        });
        if (labelHit) return labelHit;
    }
    if (opts?.preserveUnknown) {
        return trimmed;
    }
    return fallback;
}

/** 写入：select 列统一双形态 payload（内核 3.8.x 读 MSelect 数组） */
export function selectCellValue(
    content: string,
    spec?: SelectNormalizationSpec | null,
    opts?: NormalizeSelectOptions,
): { type: string; select: { content: string }; mSelect: { content: string }[] } {
    const normalized = spec ? (normalizeSelectValue(content, spec, opts) ?? content) : content;
    return { type: "select", select: { content: normalized }, mSelect: [{ content: normalized }] };
}

/** 读取：select 单元格内容（mSelect 优先——内核存储形态；select 单值为旧数据兼容） */
export function selectCellContent(cell: AvCellLike | undefined | null): string | undefined {
    if (!cell) return undefined;
    const m = cell.mSelect?.map((o) => o?.content).filter((c): c is string => !!c) ?? [];
    if (m.length > 0) return m[0];
    return cell.select?.content || undefined;
}

/** 读取：relation 单元格关联的 blockIDs（无关联时返回空数组） */
export function relationCellBlockIDs(cell: AvCellLike | undefined | null): string[] {
    if (!cell) return [];
    const raw = cell.relation?.blockIDs ?? (cell as any).value?.relation?.blockIDs;
    if (!Array.isArray(raw)) return [];
    return raw.map((id) => String(id ?? "").trim()).filter(Boolean);
}

/** 读取并归一化 select 单元格内容（先 mSelect 后 select，再按 schema options/default 归一化兜底） */
export function normalizedSelectCellContent(
    cell: AvCellLike | undefined | null,
    spec?: SelectNormalizationSpec | null,
    opts?: NormalizeSelectOptions,
): string | undefined {
    const raw = selectCellContent(cell) ?? (typeof cell?.text?.content === "string" ? cell.text.content : undefined);
    return normalizeSelectValue(raw, spec, opts);
}

/** 提取单元格展示文本（无 UI 依赖纯函数） */
export function cellContentText(cell: AvCellLike | undefined | null): string {
    if (!cell) return "";
    if (cell.text?.content !== undefined && cell.text?.content !== null) return String(cell.text.content);
    if (cell.block?.content !== undefined && cell.block?.content !== null) return String(cell.block.content);
    if (cell.type === "mSelect" && Array.isArray(cell.mSelect)) {
        const list = cell.mSelect.map((o) => o?.content).filter((c): c is string => !!c);
        if (list.length > 0) return list.join(", ");
    }
    const sel = selectCellContent(cell);
    if (sel) return sel;
    if (cell.number?.isNotEmpty !== false && cell.number?.content !== undefined && cell.number?.content !== null) return String(cell.number.content);
    if (cell.date?.isNotEmpty !== false && cell.date?.content !== undefined && cell.date?.content !== null) {
        const raw: unknown = cell.date.content;
        if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(raw.trim())) {
            return raw.trim().slice(0, 10);
        }
        const num = Number(raw);
        if (!isNaN(num) && (num === 0 || num <= -60000000000000)) return "";
        const isEpochMs = (typeof raw === "number" || (typeof raw === "string" && /^-?\d+$/.test(raw.trim()))) && Math.abs(num) > 100000000;
        const d = isEpochMs ? new Date(num) : new Date(String(raw));
        if (!isNaN(d.getTime()) && d.getFullYear() >= 1900) {
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
        return String(raw);
    }
    if (cell.checkbox?.checked !== undefined) return cell.checkbox.checked ? "✓" : "";
    if (cell.url?.content) return cell.url.content;
    return "";
}

/** 从 AV 行安全提取单元格字符串（兼容 date 毫秒时间戳与 mSelect 存储形态） */
export function rowCellString(
    row: { cells?: Record<string, AvCellLike | undefined | null> } | undefined | null,
    keyID?: string,
): string | undefined {
    if (!row || !keyID) return undefined;
    const cell = row.cells?.[keyID];
    if (!cell) return undefined;
    const text = cellContentText(cell).trim();
    return text || undefined;
}

/** 构造 Format 17 KeyTypeBlock 主键单元格（覆写时默认带 rich: null） */
export function blockCellValue(
    itemID: string,
    content: string,
    opts?: { keyID?: string; isDetached?: boolean; includeRichNull?: boolean },
): {
    type: "block";
    keyID?: string;
    isDetached?: boolean;
    itemID: string;
    block: { id: string; content: string };
    rich?: null;
} {
    const cell: {
        type: "block";
        keyID?: string;
        isDetached?: boolean;
        itemID: string;
        block: { id: string; content: string };
        rich?: null;
    } = {
        type: "block",
        itemID,
        isDetached: opts?.isDetached ?? true,
        block: {
            id: itemID,
            content: String(content ?? ""),
        },
    };
    if (opts?.keyID) cell.keyID = opts.keyID;
    if (opts?.includeRichNull !== false) cell.rich = null;
    return cell;
}

/** 构造思源单元格写入值对象 */
export function cellValue(
    type: string,
    v: unknown,
    ctx?: { itemID?: string; keyID?: string; allowEmptyNumber?: boolean },
): unknown | null {
    switch (type) {
        case "block": {
            if (v && typeof v === "object" && "block" in (v as Record<string, unknown>)) {
                const raw = v as { block?: { id?: string; content?: string }; keyID?: string; isDetached?: boolean };
                const itemID = raw.block?.id || ctx?.itemID || "";
                return blockCellValue(itemID, String(raw.block?.content ?? ""), {
                    keyID: raw.keyID ?? ctx?.keyID,
                    isDetached: raw.isDetached,
                    includeRichNull: true,
                });
            }
            if (v === undefined || v === null) return null;
            return blockCellValue(ctx?.itemID || "", String(v), {
                keyID: ctx?.keyID,
                includeRichNull: true,
            });
        }
        case "select":
            return typeof v === "string" ? selectCellValue(v) : null;
        case "mSelect": {
            const rawList = Array.isArray(v)
                ? v
                : typeof v === "string"
                    ? v.split(/[,，、;；]+/)
                    : [];
            const list = Array.from(new Set(rawList.map((item) => String(item ?? "").trim()).filter(Boolean)));
            return { type: "mSelect", mSelect: list.map((content) => ({ content })) };
        }
        case "checkbox":
            return { type: "checkbox", checkbox: { checked: Boolean(v) } };
        case "number": {
            if (typeof v === "number" && Number.isFinite(v)) {
                return { type: "number", number: { content: v, isNotEmpty: true } };
            }
            if (typeof v === "string" && v.trim() !== "") {
                const num = Number(v.trim());
                if (Number.isFinite(num)) {
                    return { type: "number", number: { content: num, isNotEmpty: true } };
                }
            }
            if (ctx?.allowEmptyNumber && (v === "" || v === null || v === undefined)) {
                return { type: "number", number: { isNotEmpty: false } };
            }
            return null;
        }
        case "date": {
            if (!v || v === "") return { type: "date", date: { isNotEmpty: false } };
            const num = Number(v);
            const time = !isNaN(num) && num > 100000000 ? num : new Date(String(v).includes("T") ? String(v) : `${v}T00:00:00`).getTime();
            return isNaN(time) ? { type: "date", date: { isNotEmpty: false } } : { type: "date", date: { content: time, isNotEmpty: true, isNotTime: true } };
        }
        case "text":
        default:
            return typeof v === "string" ? { type: "text", text: { content: v } } : null;
    }
}


