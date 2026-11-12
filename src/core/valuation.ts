/**
 * 实物资产估值汇总与购物转资产映射（§16/§17 289波）：
 * 统计实物资产（assets-real）的初始购入成本、最新估值快照、资产净值增减及品类分布；
 * 提供购物记录向实物资产建档的纯函数字段映射。
 */
import type { AvRow } from "@/core/siyuan";
import type { RowLogs, ValuationEntry } from "@/core/rowlog";
import { getValuations } from "@/core/rowlog";
import { calculateAssetDepreciation } from "./depreciation";
import { bindDialogA11y } from "./dialog-a11y";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};

export interface AssetItemValuation {
    id: string;
    name: string;
    category?: string;
    status: string;
    purchaseAmount: number;
    currentValue: number;
    valueDelta: number;
    valueChangeRate: number; // 百分比
    hasValuationLog: boolean;
    latestValuationDate?: string;
    location?: string;
}

export interface AssetCategoryValuation {
    category: string;
    count: number;
    totalPurchaseAmount: number;
    totalCurrentValue: number;
}

export interface AssetValuationReport {
    totalItems: number;
    activeItems: number;
    disposedItems: number;
    totalInitialCost: number;
    totalCurrentValuation: number;
    netValuationChange: number;
    overallChangeRate: number; // 百分比
    categoryBreakdown: AssetCategoryValuation[];
    topValuedItems: AssetItemValuation[];
    totalDepreciationNetValue: number;
    totalDepreciationAccumulated: number;
    depreciationEligibleCount: number;
}

export interface ShoppingToAssetDraft {
    name: string;
    amount?: number;
    date?: string;
    channel?: string;
    memberId?: string;
    suggestedCategory: string;
    note?: string;
}

function cellString(row: AvRow, keyID?: string): string | undefined {
    if (!keyID) return undefined;
    const cell = row.cells?.[keyID];
    if (!cell) return undefined;
    if (cell.type === "text" && cell.text?.content) return String(cell.text.content).trim();
    if (cell.type === "block" && cell.block?.content) return String(cell.block.content).trim();
    if (cell.type === "date" && cell.date?.content) return String(cell.date.content).trim();
    if (cell.type === "select" && cell.select?.content) return String(cell.select.content).trim();
    return undefined;
}

function cellNumber(row: AvRow, keyID?: string): number | undefined {
    if (!keyID) return undefined;
    const cell = row.cells?.[keyID];
    if (!cell) return undefined;
    if (cell.type === "number" && typeof cell.number?.content === "number" && Number.isFinite(cell.number.content)) {
        return cell.number.content;
    }
    return undefined;
}

function cellMemberId(row: AvRow, keyID?: string): string | undefined {
    if (!keyID) return undefined;
    const cell = row.cells?.[keyID];
    const blockIDs = cell?.relation?.blockIDs;
    return blockIDs && blockIDs.length > 0 ? blockIDs[0] : undefined;
}

/**
 * 汇总计算实物资产库的购入成本与当前估值分析
 */
export function calculateAssetValuationStats(
    rows: AvRow[],
    cols: Record<string, string>,
    rowLogs?: RowLogs,
    avId?: string,
): AssetValuationReport {
    let activeItems = 0;
    let disposedItems = 0;
    let totalInitialCost = 0;
    let totalCurrentValuation = 0;
    let totalDepreciationNetValue = 0;
    let totalDepreciationAccumulated = 0;
    let depreciationEligibleCount = 0;

    const items: AssetItemValuation[] = [];
    const catMap = new Map<string, { count: number; totalPurchase: number; totalCurrent: number }>();

    for (const row of rows) {
        const name = cellString(row, cols.name) || "未命名资产";
        const status = cellString(row, cols.status) || "inuse";
        const category = cellString(row, cols.category) || "other_ar";
        const purchaseAmount = cellNumber(row, cols.amount) ?? 0;
        const location = cellString(row, cols.location);

        if (status === "disposed") {
            disposedItems++;
            continue; // 已处置资产不计入在役净值
        }

        activeItems++;

        // 获取最新估值记录；若无估值流水则以原购入价作为基准估值
        let currentValue = purchaseAmount;
        let hasValuationLog = false;
        let latestValuationDate: string | undefined;

        if (rowLogs && avId) {
            const vals: ValuationEntry[] = getValuations(rowLogs, avId, row.itemID);
            if (vals.length > 0) {
                // 取最新日期的估值
                const sorted = [...vals].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                const latest = sorted[0];
                if (typeof latest.value === "number" && Number.isFinite(latest.value)) {
                    currentValue = latest.value;
                    hasValuationLog = true;
                    latestValuationDate = latest.date;
                }
            }
        }

        const valueDelta = currentValue - purchaseAmount;
        const valueChangeRate = purchaseAmount > 0
            ? Math.round((valueDelta / purchaseAmount) * 1000) / 10
            : 0;

        totalInitialCost += purchaseAmount;
        totalCurrentValuation += currentValue;

        const dateStr = cellString(row, cols.date);
        if (purchaseAmount > 0 && dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const dep = calculateAssetDepreciation({ initialCost: purchaseAmount, purchaseDate: dateStr });
            if (dep) {
                totalDepreciationNetValue += dep.currentNetValue;
                totalDepreciationAccumulated += dep.accumulatedDepreciation;
                depreciationEligibleCount++;
            }
        }

        items.push({
            id: row.itemID,
            name,
            category,
            status,
            purchaseAmount,
            currentValue,
            valueDelta,
            valueChangeRate,
            hasValuationLog,
            latestValuationDate,
            location,
        });

        // 类别统计
        let cStat = catMap.get(category);
        if (!cStat) {
            cStat = { count: 0, totalPurchase: 0, totalCurrent: 0 };
            catMap.set(category, cStat);
        }
        cStat.count++;
        cStat.totalPurchase += purchaseAmount;
        cStat.totalCurrent += currentValue;
    }

    // 按当前估值降序
    items.sort((a, b) => b.currentValue - a.currentValue);

    const netValuationChange = totalCurrentValuation - totalInitialCost;
    const overallChangeRate = totalInitialCost > 0
        ? Math.round((netValuationChange / totalInitialCost) * 1000) / 10
        : 0;

    const categoryBreakdown: AssetCategoryValuation[] = Array.from(catMap.entries())
        .map(([category, stat]) => ({
            category,
            count: stat.count,
            totalPurchaseAmount: Math.round(stat.totalPurchase * 100) / 100,
            totalCurrentValue: Math.round(stat.totalCurrent * 100) / 100,
        }))
        .sort((a, b) => b.totalCurrentValue - a.totalCurrentValue);

    return {
        totalItems: activeItems + disposedItems,
        activeItems,
        disposedItems,
        totalInitialCost: Math.round(totalInitialCost * 100) / 100,
        totalCurrentValuation: Math.round(totalCurrentValuation * 100) / 100,
        netValuationChange: Math.round(netValuationChange * 100) / 100,
        overallChangeRate,
        categoryBreakdown,
        topValuedItems: items.slice(0, 10),
        totalDepreciationNetValue,
        totalDepreciationAccumulated,
        depreciationEligibleCount,
    };
}

/**
 * 快速判断某单件资产的折旧健康度
 */
export function getAssetDepreciationHealth(amount?: number, dateStr?: string): {
    hasDepreciation: boolean;
    netValue?: number;
    statusLabel?: string;
    status?: string;
} {
    if (!amount || amount <= 0 || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return { hasDepreciation: false };
    }
    const dep = calculateAssetDepreciation({ initialCost: amount, purchaseDate: dateStr });
    if (!dep) return { hasDepreciation: false };
    return {
        hasDepreciation: true,
        netValue: dep.currentNetValue,
        statusLabel: dep.statusLabel,
        status: dep.status,
    };
}


/**
 * 将购物（shopping）台账行映射为实物资产（assets-real）建档草稿
 */
export function mapShoppingToAssetReal(
    shoppingRow: AvRow,
    shoppingCols: Record<string, string>,
): ShoppingToAssetDraft {
    const name = cellString(shoppingRow, shoppingCols.name) || "";
    const amount = cellNumber(shoppingRow, shoppingCols.amount);
    const date = cellString(shoppingRow, shoppingCols.date);
    const channel = cellString(shoppingRow, shoppingCols.channel);
    const memberId = cellMemberId(shoppingRow, shoppingCols.member);
    const rawCat = cellString(shoppingRow, shoppingCols.category) || "";
    const note = cellString(shoppingRow, shoppingCols.note);

    let suggestedCategory = "other_ar";
    if (rawCat === "digital") {
        suggestedCategory = "digital";
    } else if (rawCat === "apparel") {
        suggestedCategory = "apparel";
    } else if (rawCat === "daily") {
        suggestedCategory = "appliance";
    }

    return {
        name,
        amount,
        date,
        channel,
        memberId,
        suggestedCategory,
        note,
    };
}

export interface AssetValuationDialogOptions {
    rows: AvRow[];
    columns: Record<string, string>;
    logs: RowLogs;
    avId: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

export function openAssetValuationDialog(options: AssetValuationDialogOptions): void {
    if (typeof document === "undefined") return;
    const { rows, columns, logs, avId, t, DialogCls, showMessageFn } = options;
    const report = calculateAssetValuationStats(rows, columns, logs, avId);

    const dlg = new DialogCls({
        title: t("ledger.assetValuationReport"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-asset-val-body"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-asset-val-close">${t("close")}</button><button class="b3-button" id="lv-asset-val-copy">${t("ledger.assetValuationCopy")}</button></div>`,
        width: "560px",
    });
    const body = dlg.element.querySelector("#lv-asset-val-body") as HTMLElement;
    const copyBtn = dlg.element.querySelector("#lv-asset-val-copy") as HTMLButtonElement;

    (dlg.element.querySelector("#lv-asset-val-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });

    if (report.activeItems === 0) {
        body.appendChild(mk("div", "lv-caption fn__text-center", t("ledger.assetValuationEmpty")));
        if (copyBtn) copyBtn.disabled = true;
        return;
    }

    const formatAmountStr = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    const metrics = mk("div", "lv-metric-grid-3");
    const initCard = mk("div", "lv-metric-lg");
    initCard.innerHTML = `<span class="lv-caption">${t("ledger.assetInitialCost")}</span><b class="lv-num lv-metric-val">¥${formatAmountStr(report.totalInitialCost)}</b><span class="lv-caption">${report.activeItems} 件在役</span>`;

    const valCard = mk("div", "lv-metric-lg");
    valCard.innerHTML = `<span class="lv-caption">${t("ledger.assetCurrentValuation")}</span><b class="lv-num lv-metric-val lv-tx-data-accent">¥${formatAmountStr(report.totalCurrentValuation)}</b><span class="lv-caption">最新总估值</span>`;

    const deltaCard = mk("div", "lv-metric-lg");
    const deltaColorClass = report.netValuationChange >= 0 ? "lv-tx-data-accent" : "lv-tx-warn";
    deltaCard.innerHTML = `<span class="lv-caption">${t("ledger.assetNetChange")}</span><b class="lv-num lv-metric-val ${deltaColorClass}">${report.netValuationChange >= 0 ? "+" : "-"}¥${formatAmountStr(Math.abs(report.netValuationChange))}</b><span class="lv-caption">${report.overallChangeRate >= 0 ? "+" : ""}${report.overallChangeRate}%</span>`;

    metrics.append(initCard, valCard, deltaCard);
    body.appendChild(metrics);

    if (report.depreciationEligibleCount > 0) {
        const depBanner = mk("div", "lv-notice-card lv-row-split");
        depBanner.innerHTML = `<span>📉 <b>财务直线折旧测算 (${report.depreciationEligibleCount} 件)</b></span><span>折后净残值: <b class="lv-tx-data-accent">¥${formatAmountStr(report.totalDepreciationNetValue)}</b> · 累计折旧: <b class="lv-tx-danger">¥${formatAmountStr(report.totalDepreciationAccumulated)}</b></span>`;
        body.appendChild(depBanner);
    }

    if (report.topValuedItems.length > 0) {
        const sec = mk("div");
        sec.innerHTML = `<div class="ft__on-surface lv-section-title">${t("ledger.assetTopValued")}</div>`;
        const list = mk("div", "fn__flex-column");

        for (const it of report.topValuedItems) {
            const rowEl = mk("div", "lv-broken-link-row");
            const left = mk("div", "lv-broken-link-row__left");
            left.append(
                mk("b", "", it.name),
                mk("span", "lv-caption", `原价: ¥${formatAmountStr(it.purchaseAmount)}${it.location ? ` · 位置: ${it.location}` : ""}${it.hasValuationLog ? ` · 估值日: ${it.latestValuationDate}` : ""}`)
            );

            const right = mk("div", "lv-broken-link-row__right fn__text-right");
            const chgColor = it.valueDelta >= 0 ? "var(--lv-data-accent)" : "var(--lv-warn)";
            right.innerHTML = `<div><b class="lv-num lv-tx-data-accent">¥${formatAmountStr(it.currentValue)}</b></div><div class="lv-caption" style="color:${chgColor}">${it.valueDelta >= 0 ? "+" : "-"}¥${formatAmountStr(Math.abs(it.valueDelta))} (${it.valueChangeRate >= 0 ? "+" : ""}${it.valueChangeRate}%)</div>`;

            rowEl.append(left, right);
            list.appendChild(rowEl);
        }
        sec.appendChild(list);
        body.appendChild(sec);
    }

    if (copyBtn) {
        copyBtn.onclick = async () => {
            const lines = [
                `【实物资产估值与净值报告】`,
                `· 在役资产：${report.activeItems} 件`,
                `· 初始总成本：¥${formatAmountStr(report.totalInitialCost)}`,
                `· 当前总估值：¥${formatAmountStr(report.totalCurrentValuation)}`,
                `· 资产净变动：${report.netValuationChange >= 0 ? "+" : "-"}¥${formatAmountStr(Math.abs(report.netValuationChange))} (${report.overallChangeRate >= 0 ? "+" : ""}${report.overallChangeRate}% )`,
                `---------------------------`,
                `【高价值资产 TOP】`,
                ...report.topValuedItems.map((it) => `· ${it.name}：当前估值 ¥${formatAmountStr(it.currentValue)} (初始 ¥${formatAmountStr(it.purchaseAmount)}${it.valueDelta !== 0 ? `，变动 ${it.valueDelta >= 0 ? "+" : "-"}¥${formatAmountStr(Math.abs(it.valueDelta))}` : ""})`),
            ];
            try {
                await navigator.clipboard.writeText(lines.join("\n"));
                showMessageFn(t("ledger.assetValuationCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
            }
        };
    }
}

