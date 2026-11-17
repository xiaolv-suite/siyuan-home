/**
 * CSV 导出纯逻辑（第八十四轮自组件抽出可单测）：RFC 4180 转义 + UTF-8 BOM + CRLF 行结束。
 * 组件侧只负责表头文案（i18n/列键回退）与单元格取文本。
 */

/** 电子表格公式注入防御 (OWASP CSV Injection Defense)：
 * 若以 =、@、\t 开头，或以 + / - 开头且非合法纯数值，前置单引号以强制电子表格以纯文本呈现，杜绝远程命令执行或公式滥用。
 */
export function neutralizeFormula(v: string): string {
    if (!v || typeof v !== "string") return v || "";
    if (/^\s*[=@\t]/.test(v) || (/^\s*[+\-]/.test(v) && !/^\s*[+\-]?\d+(\.\d+)?\s*$/.test(v))) {
        return `'${v}`;
    }
    return v;
}

/** RFC 4180 转义：含 逗号/引号/换行 任一则整体加引号，内部引号翻倍；自动进行公式注入中和 */
export function csvEscape(v: string): string {
    const val = neutralizeFormula(v);
    return /[",\r\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
}

/** 组装 CSV 文件内容：表头 + 数据行，CRLF 行结束，前缀 UTF-8 BOM（Excel 兼容） */
export function buildCsv(head: string[], rows: string[][]): string {
    const lines = [head.map(csvEscape), ...rows.map((r) => r.map(csvEscape))];
    return "\uFEFF" + lines.map((l) => l.join(",")).join("\r\n");
}

/** RFC 4180 解析（16 组/191 波：CSV 批量导入）：剥 BOM；引号字段可含逗号/换行/双引号（"" 转义）；
 * \r\n 与 \n 行结束皆收；空行跳过。返回行数组（首行为表头，由调用方处理）。 */
export function parseCsv(text: string): string[][] {
    const src = text.replace(/^\uFEFF/, "");
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    const pushField = () => { row.push(field); field = ""; };
    const pushRow = () => { pushField(); if (row.some((c) => c !== "")) rows.push(row); row = []; };
    while (i < src.length) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }
        if (ch === '"' && field === "") { inQuotes = true; i++; continue; }
        if (ch === ",") { pushField(); i++; continue; }
        if (ch === "\r") { if (src[i + 1] === "\n") i++; pushRow(); i++; continue; }
        if (ch === "\n") { pushRow(); i++; continue; }
        field += ch; i++;
    }
    if (field !== "" || row.length > 0) pushRow();
    return rows;
}
