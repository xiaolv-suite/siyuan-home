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

/** 写入：select 列统一双形态 payload（内核 3.8.x 读 MSelect 数组） */
export function selectCellValue(content: string): { type: string; select: { content: string }; mSelect: { content: string }[] } {
    return { type: "select", select: { content }, mSelect: [{ content }] };
}

/** 读取：select 单元格内容（mSelect 优先——内核存储形态；select 单值为旧数据兼容） */
export function selectCellContent(cell: AvCellLike | undefined | null): string | undefined {
    if (!cell) return undefined;
    const m = cell.mSelect?.map((o) => o?.content).filter((c): c is string => !!c) ?? [];
    if (m.length > 0) return m[0];
    return cell.select?.content || undefined;
}

/** 提取单元格展示文本（无 UI 依赖纯函数） */
export function cellContentText(cell: AvCellLike | undefined | null): string {
    if (!cell) return "";
    if (cell.text?.content !== undefined && cell.text?.content !== null) return String(cell.text.content);
    if (cell.block?.content !== undefined && cell.block?.content !== null) return String(cell.block.content);
    const sel = selectCellContent(cell);
    if (sel) return sel;
    if (cell.number?.isNotEmpty !== false && cell.number?.content !== undefined && cell.number?.content !== null) return String(cell.number.content);
    if (cell.date?.isNotEmpty !== false && cell.date?.content !== undefined && cell.date?.content !== null) {
        const raw = cell.date.content;
        const num = Number(raw);
        if (!isNaN(num) && (num === 0 || num <= -60000000000000)) return "";
        const d = !isNaN(num) && num > 100000000 ? new Date(num) : new Date(String(raw));
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

/** 构造思源单元格写入值对象 */
export function cellValue(type: string, v: unknown): unknown | null {
    switch (type) {
        case "select":
            return typeof v === "string" ? selectCellValue(v) : null;
        case "checkbox":
            return { type: "checkbox", checkbox: { checked: Boolean(v) } };
        case "number": {
            if (typeof v === "number" && Number.isFinite(v)) {
                return { type: "number", number: { content: v } };
            }
            if (typeof v === "string" && v.trim() !== "") {
                const num = Number(v.trim());
                if (Number.isFinite(num)) {
                    return { type: "number", number: { content: num } };
                }
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


