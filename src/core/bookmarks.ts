/**
 * 书签台账链接有效性检测（§17/285波）：
 * 周期性或手动探测书签 URL 有效性，识别失效链接（404/500/格式错误/超时/网络不可达），
 * 并提供汇总报告与结构化文本导出。
 */
import type { AvRow } from "@/core/siyuan";

export type BookmarkLinkStatus = "healthy" | "broken" | "invalid_url" | "timeout" | "unreachable";

export interface BookmarkHealthItem {
    id: string;
    name: string;
    url: string;
    category?: string;
    status: BookmarkLinkStatus;
    statusCode?: number;
    error?: string;
}

export interface BookmarkHealthReport {
    total: number;
    healthyCount: number;
    brokenCount: number;
    items: BookmarkHealthItem[];
    brokenItems: BookmarkHealthItem[];
}

export type LinkProbe = (url: string) => Promise<{ ok: boolean; status?: number; error?: string }>;

function isValidHttpUrl(str: string): boolean {
    try {
        const u = new URL(str);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function cellString(row: AvRow, keyID?: string): string | undefined {
    if (!keyID) return undefined;
    const cell = row.cells?.[keyID];
    if (!cell) return undefined;
    if (cell.type === "url" && cell.url?.content) return String(cell.url.content).trim();
    if (cell.type === "text" && cell.text?.content) return String(cell.text.content).trim();
    if (cell.type === "block" && cell.block?.content) return String(cell.block.content).trim();
    if (cell.type === "select" && cell.select?.content) return String(cell.select.content).trim();
    return undefined;
}

/**
 * 默认浏览器/前端链接探测器（5秒超时，CORS 容错）
 */
export async function defaultLinkProbe(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        // 先尝试 HEAD 请求，减少载荷
        let res: Response;
        try {
            res = await fetch(url, { method: "HEAD", signal: controller.signal, mode: "no-cors" });
        } catch {
            // HEAD 不支持或拦截时尝试 GET
            res = await fetch(url, { method: "GET", signal: controller.signal, mode: "no-cors" });
        }
        // mode: "no-cors" 返回 opaque response 时 status 为 0，但未抛网络错误即代表网络连通、服务在线
        if (res.type === "opaque") {
            return { ok: true, status: 200 };
        }
        if (res.ok || (res.status >= 200 && res.status < 400)) {
            return { ok: true, status: res.status };
        }
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return { ok: false, error: "timeout" };
        }
        return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 批量检测书签台账中的链接健康状态
 */
export async function checkBookmarksHealth(
    rows: AvRow[],
    cols: Record<string, string>,
    probe: LinkProbe = defaultLinkProbe,
): Promise<BookmarkHealthReport> {
    const items: BookmarkHealthItem[] = [];

    for (const row of rows) {
        const name = cellString(row, cols.name) || "未命名书签";
        const url = cellString(row, cols.url) || "";
        const category = cellString(row, cols.category);

        if (!url) {
            items.push({
                id: row.itemID,
                name,
                url,
                category,
                status: "invalid_url",
                error: "空链接",
            });
            continue;
        }

        if (!isValidHttpUrl(url)) {
            items.push({
                id: row.itemID,
                name,
                url,
                category,
                status: "invalid_url",
                error: "URL 格式不合法",
            });
            continue;
        }

        const res = await probe(url);
        if (res.ok) {
            items.push({
                id: row.itemID,
                name,
                url,
                category,
                status: "healthy",
                statusCode: res.status,
            });
        } else {
            let status: BookmarkLinkStatus = "broken";
            if (res.error === "timeout") status = "timeout";
            else if (res.error === "unreachable" || (res.error && res.error.includes("Failed to fetch"))) status = "unreachable";

            items.push({
                id: row.itemID,
                name,
                url,
                category,
                status,
                statusCode: res.status,
                error: res.error,
            });
        }
    }

    const brokenItems = items.filter((item) => item.status !== "healthy");
    const healthyCount = items.length - brokenItems.length;

    return {
        total: items.length,
        healthyCount,
        brokenCount: brokenItems.length,
        items,
        brokenItems,
    };
}

/**
 * 将失效书签报告格式化为易于复制和核对的纯文本
 */
export function formatBookmarkHealthReportText(report: BookmarkHealthReport): string {
    const lines: string[] = [
        `【书签链接健康检测报告】`,
        `· 检测总数：${report.total} 个`,
        `· 正常链接：${report.healthyCount} 个`,
        `· 异常链接：${report.brokenCount} 个`,
    ];

    if (report.brokenItems.length > 0) {
        lines.push("---------------------------");
        lines.push("【异常链接清单】");
        for (const item of report.brokenItems) {
            const errDetail = item.error ? ` (${item.error})` : item.statusCode ? ` (HTTP ${item.statusCode})` : "";
            lines.push(`· ${item.name}：${item.url}${errDetail}`);
        }
    }

    return lines.join("\n");
}

export interface BookmarksCheckDialogOptions {
    rows: AvRow[];
    columns: Record<string, string>;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

export async function openBookmarksCheckDialog(options: BookmarksCheckDialogOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { rows, columns, t, DialogCls, showMessageFn } = options;

    const dlg = new DialogCls({
        title: t("ledger.checkBookmarks"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-bm-check-body" style="max-height:65vh;overflow:auto">
            <div style="display:flex;align-items:center;gap:8px;padding:24px;justify-content:center">
                <span class="lv-caption">${t("ledger.bookmarksChecking").replace("${n}", String(rows.length))}</span>
            </div>
        </div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-bm-check-close">${t("close")}</button><button class="b3-button" id="lv-bm-check-copy" disabled>${t("ledger.bookmarksCopyReport")}</button></div>`,
        width: "560px",
    });
    const body = dlg.element.querySelector("#lv-bm-check-body") as HTMLElement;
    const copyBtn = dlg.element.querySelector("#lv-bm-check-copy") as HTMLButtonElement;

    (dlg.element.querySelector("#lv-bm-check-close") as HTMLButtonElement).onclick = () => dlg.destroy();

    const report = await checkBookmarksHealth(rows, columns);
    body.replaceChildren();

    if (report.total === 0) {
        const empty = document.createElement("div");
        empty.className = "lv-caption";
        empty.style.cssText = "text-align:center;padding:24px 0";
        empty.textContent = t("ledger.bookmarksNoLinks");
        body.appendChild(empty);
        return;
    }

    const metrics = document.createElement("div");
    metrics.style.cssText = "display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:8px";

    const totalCard = document.createElement("div");
    totalCard.className = "lv-metric-lg";
    totalCard.innerHTML = `<span class="lv-caption">${t("ledger.bookmarksTotal")}</span><b class="lv-num" style="font-size:18px">${report.total}</b>`;

    const healthyCard = document.createElement("div");
    healthyCard.className = "lv-metric-lg";
    healthyCard.innerHTML = `<span class="lv-caption">${t("ledger.bookmarksHealthy")}</span><b class="lv-num" style="color:var(--lv-accent);font-size:18px">${report.healthyCount}</b>`;

    const brokenCard = document.createElement("div");
    const brokenColor = report.brokenCount > 0 ? "var(--lv-danger)" : "var(--lv-tx-3)";
    brokenCard.className = "lv-metric-lg";
    brokenCard.innerHTML = `<span class="lv-caption">${t("ledger.bookmarksBroken")}</span><b class="lv-num" style="color:${brokenColor};font-size:18px">${report.brokenCount}</b>`;

    metrics.append(totalCard, healthyCard, brokenCard);
    body.appendChild(metrics);

    if (report.brokenCount === 0) {
        const okMsg = document.createElement("div");
        okMsg.style.cssText = "padding:14px;background:var(--lv-surface-2);border-radius:8px;border:1px solid var(--lv-accent);color:var(--lv-accent);text-align:center;font-size:13px";
        okMsg.textContent = `✓ ${t("ledger.bookmarksAllHealthy")}`;
        body.appendChild(okMsg);
    } else {
        if (copyBtn) copyBtn.disabled = false;
        const sec = document.createElement("div");
        sec.style.cssText = "margin-top:4px";
        sec.innerHTML = `<div class="ft__on-surface lv-section-title" style="font-weight:600;font-size:13px;margin:8px 0 4px">${t("ledger.bookmarksBrokenCount").replace("${n}", String(report.brokenCount))}</div>`;

        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:6px";

        for (const item of report.brokenItems) {
            const rowEl = document.createElement("div");
            rowEl.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line)";

            const left = document.createElement("div");
            left.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";

            const titleSpan = document.createElement("span");
            titleSpan.style.cssText = "font-weight:500;color:var(--lv-tx)";
            titleSpan.textContent = item.name;

            const urlSpan = document.createElement("span");
            urlSpan.className = "lv-caption";
            urlSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
            urlSpan.textContent = item.url || "（空链接）";

            left.append(titleSpan, urlSpan);

            const right = document.createElement("div");
            right.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0";

            const badge = document.createElement("span");
            badge.className = "lv-badge danger";
            badge.textContent = item.error ? item.error : (item.statusCode ? `HTTP ${item.statusCode}` : "失效");

            right.append(badge);

            if (item.url && (item.url.startsWith("http://") || item.url.startsWith("https://"))) {
                const testBtn = document.createElement("button");
                testBtn.className = "b3-button b3-button--text";
                testBtn.style.cssText = "font-size:12px;padding:2px 6px";
                testBtn.textContent = t("ledger.bookmarksOpenTest");
                testBtn.onclick = () => window.open(item.url, "_blank");
                right.append(testBtn);
            }

            rowEl.append(left, right);
            list.appendChild(rowEl);
        }

        sec.appendChild(list);
        body.appendChild(sec);
    }

    if (copyBtn) {
        copyBtn.onclick = async () => {
            const text = formatBookmarkHealthReportText(report);
            try {
                await navigator.clipboard.writeText(text);
                showMessageFn(t("ledger.bookmarksReportCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
            }
        };
    }
}

