/**
 * 台账数据导出、归档清单生成与实物标签打印引擎（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { buildCsv } from "./csv";
import { blockDeepLink, generateQRDataUrl } from "./qr";
import { confirm } from "@/libs/dialog";
import { localDateKey } from "./hub/rule";

export const HIGH_CONSEQUENCE_MODULES = new Set([
    "health",
    "parenting",
    "certs",
    "insurance",
    "assets-real",
    "assets-virtual",
    "contracts",
    "medicine",
    "schooling",
]);

export interface ExportCsvOptions {
    sourceRef?: { avId?: string; columns?: Record<string, string> };
    moduleId: string;
    searchText: string;
    sortKey?: string;
    sortAsc: boolean;
    schemaCatalog?: Record<string, any>;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string, raw?: boolean) => string;
    rowMatchesSearchFn: (row: any, q: string, columns?: Record<string, string>) => boolean;
    sortRowsFn: (rows: any[], sortField?: string, ascending?: boolean, sortType?: string) => any[];
}

export async function exportLedgerCsv(options: ExportCsvOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const {
        sourceRef,
        moduleId,
        searchText,
        sortKey,
        sortAsc,
        schemaCatalog,
        t,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
        rowMatchesSearchFn,
        sortRowsFn,
    } = options;

    if (!sourceRef?.columns || !sourceRef.avId) return;
    const query = searchText.trim().toLowerCase();
    const sortField = sortKey ? sourceRef.columns[sortKey] : undefined;

    const download = async () => {
        try {
            const all = await renderLedgerAllFn(sourceRef.avId!);
            if (!all.complete) {
                showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
                return;
            }
            let list = all.rows;
            if (query) list = list.filter((r) => rowMatchesSearchFn(r, query, sourceRef.columns));
            const sortType = sortKey ? schemaCatalog?.[moduleId]?.columns?.find((column: any) => column.key === sortKey)?.type : undefined;
            list = sortRowsFn(list, sortField, sortAsc, sortType);

            const cols = (schemaCatalog?.[moduleId]?.columns ?? []).filter((c: any) => sourceRef.columns?.[c.key]);
            const label = (c: any) => (t(`field.${c.key}`) !== `field.${c.key}` ? t(`field.${c.key}`) : c.key);
            const csv = buildCsv(
                cols.map(label),
                list.map((r) => cols.map((c: any) => cellTextFn(r.cells?.[sourceRef.columns![c.key]], c.key, true)))
            );
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            const moduleTitle = t(`module.${moduleId}`) !== `module.${moduleId}` ? t(`module.${moduleId}`) : moduleId;
            a.download = `小驴管家-${moduleTitle}-${localDateKey(new Date())}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 0);
            showMessageFn(t("ledger.exportCsvDone") || `${moduleTitle} CSV 导出完成`, 2500, "info");
        } catch (e) {
            showMessageFn(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    };

    if (HIGH_CONSEQUENCE_MODULES.has(moduleId)) {
        confirm(
            t("ledger.exportSensitiveTitle"),
            t("ledger.exportSensitiveBody").replace("${module}", t(`module.${moduleId}`)),
            () => { void download(); }
        );
        return;
    }
    await download();
}

/** 仅将用户选中的行导出为独立 CSV（CAND-18 / POOL-FEAT-14） */
export function exportSelectedRowsToCsv(options: {
    rows: any[];
    moduleId: string;
    sourceRef: { avId?: string; columns?: Record<string, string> };
    schemaCatalog?: Record<string, any>;
    t: (k: string) => string;
    cellTextFn: (cell: any, key?: string, raw?: boolean) => string;
}): void {
    if (typeof document === "undefined" || !options.sourceRef?.columns) return;
    const { rows, moduleId, sourceRef, schemaCatalog, t, cellTextFn } = options;
    const cols = (schemaCatalog?.[moduleId]?.columns ?? []).filter((c: any) => sourceRef.columns?.[c.key]);
    const label = (c: any) => (t(`field.${c.key}`) !== `field.${c.key}` ? t(`field.${c.key}`) : c.key);
    const csv = buildCsv(
        cols.map(label),
        rows.map((r) => cols.map((c: any) => cellTextFn(r.cells?.[sourceRef.columns![c.key]], c.key, true)))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const moduleTitle = t(`module.${moduleId}`) !== `module.${moduleId}` ? t(`module.${moduleId}`) : moduleId;
    a.download = `小驴管家-${moduleTitle}-已选${rows.length}项-${localDateKey(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

export interface ExportArchiveManifestOptions {
    sourceRef?: { avId?: string; columns?: Record<string, string> };
    moduleId: string;
    members?: Array<{ avItemId?: string; name: string }>;
    guestModeActive?: boolean;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
}

export async function exportArchiveManifestFile(options: ExportArchiveManifestOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const {
        sourceRef,
        moduleId,
        members = [],
        guestModeActive = false,
        t,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
    } = options;

    if (!sourceRef?.columns || !sourceRef.avId) return;
    const attCol = sourceRef.columns.attachments;
    if (!attCol) {
        showMessageFn(t("ledger.exportArchiveNoAttCol"), 4000, "info");
        return;
    }

    try {
        const all = await renderLedgerAllFn(sourceRef.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }

        const { buildArchiveManifest, formatArchiveManifestMarkdown, formatArchiveManifestTableMarkdown } = await import("./archive");
        const memberMap = new Map(members.map((m) => [m.avItemId, m.name]));

        const records = all.rows.map((row) => {
            const title = sourceRef.columns?.name ? cellTextFn(row.cells?.[sourceRef.columns.name]) : "未命名记录";
            const memId = sourceRef.columns?.member ? String(row.cells?.[sourceRef.columns.member]?.relation?.blockIDs?.[0] ?? "") : "";
            const memberName = memId ? (memberMap.get(memId) ?? "") : "";
            const attList = row.cells?.[attCol]?.mAsset ?? [];
            return {
                id: row.itemID,
                module: moduleId,
                title,
                memberName,
                date: sourceRef.columns?.date ? cellTextFn(row.cells?.[sourceRef.columns.date]) : undefined,
                expiry: sourceRef.columns?.expiry ? cellTextFn(row.cells?.[sourceRef.columns.expiry]) : undefined,
                attachments: attList,
            };
        }).filter((r) => r.attachments.length > 0);

        if (records.length === 0) {
            showMessageFn(t("ledger.exportArchiveEmpty"), 4000, "info");
            return;
        }

        const manifest = buildArchiveManifest(records, {
            maskSensitive: guestModeActive,
        });
        const md = `${formatArchiveManifestMarkdown(manifest, t)}\n\n## 📊 归档汇总对比富表格\n\n${formatArchiveManifestTableMarkdown(manifest, t)}`;
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `lv-archive-${moduleId}-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
        showMessageFn(t("ledger.exportArchiveSuccess").replace("${n}", String(manifest.totalFiles)), 3500, "info");
    } catch (e) {
        showMessageFn(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}

export interface PrintLabelsOptions {
    sourceRef?: { avId?: string; docId?: string; columns?: Record<string, string> };
    searchText: string;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    rowMatchesSearchFn: (row: any, q: string, columns?: Record<string, string>) => boolean;
}

export async function printLedgerLabels(options: PrintLabelsOptions): Promise<void> {
    if (typeof window === "undefined") return;
    const {
        sourceRef,
        searchText,
        t,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
        rowMatchesSearchFn,
    } = options;

    if (!sourceRef?.avId || !sourceRef.docId) return;
    const query = searchText.trim().toLowerCase();

    try {
        const all = await renderLedgerAllFn(sourceRef.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }
        let list = all.rows;
        if (query) list = list.filter((r) => rowMatchesSearchFn(r, query, sourceRef.columns));
        if (list.length === 0) {
            showMessageFn(t("ledger.printNoRows"), 3000, "info");
            return;
        }

        const labels = await Promise.all(list.map(async (r) => {
            const nameCol = sourceRef.columns?.name;
            const nameVal = nameCol ? r.cells?.[nameCol] : undefined;
            const blockId = nameVal?.type === "block" ? nameVal.block?.id : undefined;
            const name = cellTextFn(nameVal, "name");
            const link = blockDeepLink(blockId || sourceRef.docId!);
            let qr = "";
            try { qr = await generateQRDataUrl(link, 160); } catch { qr = ""; }
            return { name, qr };
        }));

        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${t("ledger.printTitle")}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:20px;color:#1f2328;background:#fff}
.head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid #d0d7de;padding-bottom:10px;margin-bottom:16px}
.head b{font-size:16px;font-weight:600}
.head .sub{font-size:11px;color:#57606a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.label{border:1px solid #d0d7de;border-radius:10px;padding:14px 12px;text-align:center;page-break-inside:avoid}
.label img{width:132px;height:132px}
.label .nm{font-size:13px;font-weight:600;margin-top:8px;word-break:break-all}
.label .tip{font-size:10px;color:#57606a;margin-top:3px}
.printbtn{padding:7px 18px;border:none;border-radius:8px;background:#0969da;color:#fff;font-size:13px;cursor:pointer}
.printbtn:hover{background:#0860c4}
@media print{.noprint{display:none}body{padding:0}}</style></head><body>
<div class="head"><b>${t("ledger.printTitle")}</b><span class="sub">${t("ledger.printScanTip")} · ${new Date().toLocaleString()}</span></div>
<div class="noprint" style="text-align:center;margin-bottom:14px"><button class="printbtn" onclick="window.print()">${t("ledger.printButton")}</button></div>
<div class="grid">${labels.map((l) => `<div class="label"><img src="${l.qr}" alt="QR" width="132" height="132" decoding="async">${l.name ? `<div class="nm">${esc(l.name)}</div>` : ""}<div class="tip">${t("ledger.printScanTip")}</div></div>`).join("")}</div>
<script>window.print()<\/script></body></html>`;

        const w = window.open("", "_blank");
        if (!w) {
            showMessageFn(t("ledger.printBlocked"), 4000, "error");
            return;
        }
        w.document.write(html);
        w.document.close();
    } catch (e) {
        showMessageFn(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}

export interface ExportIcsOptions {
    sourceRef?: { avId?: string; columns?: Record<string, string> };
    moduleId: string;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
}

export async function exportLedgerIcsFile(options: ExportIcsOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { sourceRef, moduleId, t, showMessageFn, renderLedgerAllFn, cellTextFn } = options;
    if (!sourceRef?.columns || !sourceRef.avId) return;

    try {
        const all = await renderLedgerAllFn(sourceRef.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }

        const { buildLedgerRowsIcs } = await import("./ics");
        const moduleTitle = t(`module.${moduleId}`) !== `module.${moduleId}` ? t(`module.${moduleId}`) : moduleId;
        const { count, icsText } = buildLedgerRowsIcs(all.rows, sourceRef.columns, `小驴管家 · ${moduleTitle}`, cellTextFn);

        if (count === 0) {
            showMessageFn(t("ledger.exportIcsEmpty"), 4000, "info");
            return;
        }

        const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `lvhome-${moduleId}-${new Date().toISOString().slice(0, 10)}.ics`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
        showMessageFn(t("ledger.exportIcsDone").replace("${n}", String(count)), 3000, "info");
    } catch (e) {
        showMessageFn(t("ledger.readFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}

export interface LedgerExportContext {
    sourceRef?: { avId?: string; docId?: string; columns?: Record<string, string> };
    moduleId: string;
    searchText: string;
    sortKey?: string;
    sortAsc: boolean;
    schemaCatalog?: Record<string, any>;
    members?: Array<{ avItemId?: string; name: string }>;
    guestModeActive?: boolean;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string, raw?: boolean) => string;
    rowMatchesSearchFn: (row: any, q: string, columns?: Record<string, string>) => boolean;
    sortRowsFn: (rows: any[], sortField?: string, ascending?: boolean, sortType?: string) => any[];
}

/** 统一分发台账导出、归档清单生成与实物标签打印动作 */
export async function executeLedgerExportAction(
    action: "csv" | "archive" | "print" | "ics",
    ctx: LedgerExportContext
): Promise<void> {
    switch (action) {
        case "csv": return exportLedgerCsv(ctx);
        case "archive": return exportArchiveManifestFile(ctx);
        case "print": return printLedgerLabels(ctx);
        case "ics": return exportLedgerIcsFile(ctx);
    }
}

