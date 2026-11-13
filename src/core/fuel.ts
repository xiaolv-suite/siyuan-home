/**
 * 车辆能源记录与油耗/电耗统计。
 *
 * 记录按车辆台账行归属，建议持久化到 rowlogs.json 的 fuelings/chargings
 * 分组。统计采用“满油/满充到下一次满油/满充”的主口径；当用户没有标记
 * 满油/满充时，退化为相邻记录的估算值，并在结果中明确标记 estimated。
 * 本文件不依赖思源 API，便于页面、导入和单测共用。
 */

import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";

export type EnergyKind = "fuel" | "charging";

/** 油品枚举保持开放字符串，避免不同国家/车型新增油品时需要迁移数据库。 */
export type FuelGrade = "92" | "95" | "98" | "0" | "diesel" | "other" | (string & {});

export type ChargingMode = "ac" | "dc" | "other" | (string & {});

/** 一次加油或充电记录。quantity 的单位由 kind 决定：fuel=升，charging=千瓦时。 */
export interface EnergyRecord {
    kind: EnergyKind;
    date: string;
    /** 录入时刻，用于同日多次补能的稳定排序。 */
    at?: string;
    /** 本次加油/充电时的车辆总里程（公里）。 */
    odometer: number;
    /** 加油量（升）或充电量（kWh）。 */
    quantity: number;
    /** 单价（元/升或元/kWh）。未知时可不填。 */
    unitPrice?: number;
    /** 总价（元）。不填时由 quantity × unitPrice 推导。 */
    totalCost?: number;
    /** 是否加满/充满。用于准确的满量法油耗计算。 */
    full?: boolean;
    fuelGrade?: FuelGrade;
    chargingMode?: ChargingMode;
    station?: string;
    note?: string;
}

export interface EnergyInterval {
    fromDate: string;
    toDate: string;
    fromOdometer: number;
    toOdometer: number;
    distance: number;
    quantity: number;
    cost: number;
    /** 区间内费用是否完整；false 时 cost 仅是已知部分和。 */
    costKnown: boolean;
    /** 没有完整满油/满充边界时的相邻记录估算。 */
    estimated: boolean;
    consumptionPer100Km: number;
    costPer100Km: number;
}

export interface EnergyStats {
    kind: EnergyKind;
    /** 原始有效记录数（不含非法数量/里程/日期）。 */
    recordCount: number;
    /** 有效记录中填有费用的条数。 */
    costRecordCount: number;
    /** 每条记录都有费用时为 true；否则 totalCost 是已记录费用小计。 */
    costComplete: boolean;
    /** 所有有效记录的购买/充电总量。 */
    totalQuantity: number;
    /** 统计区间实际覆盖的总量；满量法会排除首个满量点之前的未闭合区间。 */
    coveredQuantity: number;
    totalCost: number;
    totalDistance: number;
    /** 按已填写费用的记录计算加权平均单价；costComplete=false 时仅代表已填写记录。 */
    averageUnitPrice?: number;
    consumptionPer100Km?: number;
    costPer100Km?: number;
    /** full = 至少有一个完整满量区间；estimated = 相邻记录估算。 */
    method: "full" | "estimated";
    intervals: EnergyInterval[];
    warnings: EnergyWarning[];
}

export type EnergyWarning =
    | "insufficient_records"
    | "estimated_consumption"
    | "missing_costs"
    | "incomplete_initial_interval"
    | "incomplete_latest_interval"
    | "non_increasing_odometer";

function finitePositive(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return false;
    const day = value.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function recordCost(record: EnergyRecord): number | undefined {
    if (typeof record.totalCost === "number" && Number.isFinite(record.totalCost) && record.totalCost >= 0) {
        return record.totalCost;
    }
    if (typeof record.unitPrice === "number" && Number.isFinite(record.unitPrice) && record.unitPrice >= 0) {
        return record.quantity * record.unitPrice;
    }
    return undefined;
}

function sortRecords(records: readonly EnergyRecord[], kind: EnergyKind): EnergyRecord[] {
    return records
        .filter((r) => r.kind === kind && validDate(r.date) && finitePositive(r.odometer) && finitePositive(r.quantity))
        .map((r) => ({ ...r }))
        // 同日优先按录入时刻排序；旧记录无 at 时依赖稳定排序保留数组先后。
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.at ?? "").localeCompare(String(b.at ?? "")));
}

function makeInterval(from: EnergyRecord, to: EnergyRecord, quantity: number, cost: number, costKnown: boolean, estimated: boolean): EnergyInterval | undefined {
    const distance = to.odometer - from.odometer;
    if (!(distance > 0) || !(quantity > 0)) return undefined;
    return {
        fromDate: from.date,
        toDate: to.date,
        fromOdometer: from.odometer,
        toOdometer: to.odometer,
        distance,
        quantity,
        cost,
        costKnown,
        estimated,
        consumptionPer100Km: (quantity / distance) * 100,
        costPer100Km: (cost / distance) * 100,
    };
}

/**
 * 计算某一车辆某种能源的统计。
 *
 * 满量法：从一个 full 记录开始，累积后续记录的数量和费用，到下一个
 * full 记录时结算。没有两个 full 记录时使用相邻记录估算，避免页面显示
 * “暂无数据”而用户又不知道需要如何录入。
 */
export function calculateEnergyStats(records: readonly EnergyRecord[], kind: EnergyKind): EnergyStats {
    const valid = sortRecords(records, kind);
    const costs = valid.map(recordCost);
    const totalQuantity = valid.reduce((sum, r) => sum + r.quantity, 0);
    const totalCost = costs.reduce((sum, value) => sum + (value ?? 0), 0);
    const costRecordCount = costs.filter((value) => value !== undefined).length;

    const fullIntervals: EnergyInterval[] = [];
    let baseline: EnergyRecord | undefined;
    let pendingQuantity = 0;
    let pendingCost = 0;
    let pendingCostsComplete = true;
    let pendingRecordCount = 0;
    let hadRecordsBeforeBaseline = false;
    let nonIncreasingOdometer = false;
    let previousRecord: EnergyRecord | undefined;

    for (const record of valid) {
        if (previousRecord && record.odometer <= previousRecord.odometer) {
            nonIncreasingOdometer = true;
            // 里程表回退/重置时切断当前区间，避免把错误距离用于油耗。
            baseline = record.full ? record : undefined;
            pendingQuantity = 0;
            pendingCost = 0;
            pendingCostsComplete = true;
            pendingRecordCount = 0;
            previousRecord = record;
            continue;
        }
        if (!baseline) {
            if (record.full) baseline = record;
            else hadRecordsBeforeBaseline = true;
            previousRecord = record;
            continue;
        }
        pendingQuantity += record.quantity;
        pendingRecordCount += 1;
        const cost = recordCost(record);
        if (cost !== undefined) {
            pendingCost += cost;
        } else {
            pendingCostsComplete = false;
        }
        if (record.full) {
            const interval = makeInterval(baseline, record, pendingQuantity, pendingCost, pendingCostsComplete, false);
            if (interval) fullIntervals.push(interval);
            else if (record.odometer <= baseline.odometer) nonIncreasingOdometer = true;
            baseline = record;
            pendingQuantity = 0;
            pendingCost = 0;
            pendingCostsComplete = true;
            pendingRecordCount = 0;
        }
        previousRecord = record;
    }

    let intervals = fullIntervals;
    let method: EnergyStats["method"] = "full";
    if (intervals.length === 0 && !nonIncreasingOdometer) {
        method = "estimated";
        intervals = [];
        for (let i = 1; i < valid.length; i++) {
            const current = valid[i];
            const cost = recordCost(current) ?? 0;
            const interval = makeInterval(valid[i - 1], current, current.quantity, cost, recordCost(current) !== undefined, true);
            if (interval) intervals.push(interval);
            else if (current.odometer <= valid[i - 1].odometer) nonIncreasingOdometer = true;
        }
    }

    const totalDistance = intervals.reduce((sum, interval) => sum + interval.distance, 0);
    const coveredQuantity = intervals.reduce((sum, interval) => sum + interval.quantity, 0);
    const coveredCost = intervals.reduce((sum, interval) => sum + interval.cost, 0);
    const allIntervalCostsKnown = intervals.length > 0 && intervals.every((interval) => interval.costKnown);
    const weightedQuantity = valid.reduce((sum, record, index) => sum + (costs[index] !== undefined ? record.quantity : 0), 0);
    const costComplete = costRecordCount === valid.length && valid.length > 0;
    const averageUnitPrice = weightedQuantity > 0 ? totalCost / weightedQuantity : undefined;
    const warnings: EnergyWarning[] = [];
    if (valid.length < 2) warnings.push("insufficient_records");
    if (method === "estimated") warnings.push("estimated_consumption");
    if (costRecordCount < valid.length) warnings.push("missing_costs");
    if (hadRecordsBeforeBaseline && fullIntervals.length > 0) warnings.push("incomplete_initial_interval");
    if (pendingRecordCount > 0 && fullIntervals.length > 0) warnings.push("incomplete_latest_interval");
    if (nonIncreasingOdometer) warnings.push("non_increasing_odometer");

    return {
        kind,
        recordCount: valid.length,
        costRecordCount,
        costComplete,
        totalQuantity,
        coveredQuantity,
        totalCost,
        totalDistance,
        averageUnitPrice,
        consumptionPer100Km: totalDistance > 0 ? (coveredQuantity / totalDistance) * 100 : undefined,
        costPer100Km: allIntervalCostsKnown && totalDistance > 0 ? (coveredCost / totalDistance) * 100 : undefined,
        method,
        intervals,
        warnings,
    };
}

export interface MultiVehicleComparison {
    vehicles: Array<{
        name: string;
        plate?: string;
        costPerKm?: number;
        consumptionPer100Km?: number;
        totalSpending: number;
        kind: EnergyKind;
    }>;
    bestCostVehicle?: string;
    savingsPerKm?: number;
    savingsPct?: number;
}

/** 多车综合能耗与每百公里成本对比分析 */
export function compareVehiclesCost(
    vehicleStats: Array<{
        name: string;
        plate?: string;
        fuel: EnergyStats;
        charge: EnergyStats;
        energyType: string;
    }>
): MultiVehicleComparison | null {
    if (vehicleStats.length < 2) return null;
    const list: MultiVehicleComparison["vehicles"] = [];
    for (const v of vehicleStats) {
        const isEv = v.energyType === "ev" || v.energyType === "electric";
        const stats = isEv ? v.charge : (v.fuel.recordCount > 0 ? v.fuel : v.charge);
        const costPerKm = stats.costPer100Km !== undefined ? stats.costPer100Km / 100 : undefined;
        list.push({
            name: v.name,
            plate: v.plate,
            costPerKm,
            consumptionPer100Km: stats.consumptionPer100Km,
            totalSpending: (v.fuel.totalCost || 0) + (v.charge.totalCost || 0),
            kind: isEv ? "charging" : "fuel",
        });
    }

    const validCosts = list.filter((x) => x.costPerKm !== undefined && x.costPerKm > 0)
        .sort((a, b) => a.costPerKm! - b.costPerKm!);
    if (validCosts.length < 2) {
        return { vehicles: list };
    }

    const best = validCosts[0];
    const worst = validCosts[validCosts.length - 1];
    const diff = Math.round((worst.costPerKm! - best.costPerKm!) * 100) / 100;
    const pct = Math.round((diff / worst.costPerKm!) * 100);

    return {
        vehicles: list,
        bestCostVehicle: best.name,
        savingsPerKm: diff,
        savingsPct: pct,
    };
}

/** 仅保留合法值并按日期排序，供趋势图和导出共用。 */
export function normalizeEnergyRecords(records: readonly EnergyRecord[], kind: EnergyKind): EnergyRecord[] {
    return sortRecords(records, kind);
}

export interface EnergyDashboardDialogOptions {
    sourceRef: { avId?: string; columns?: Record<string, string> };
    t: (k: string) => string;
    plugin: any;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    selectContentFn: (cell: any) => string | undefined;
    onOpenNewRecord?: () => void;
    onOpenVehicleDetail?: (vehicleRow: any) => void;
}

export async function openEnergyDashboardDialog(options: EnergyDashboardDialogOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { sourceRef, t, plugin, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, selectContentFn, onOpenNewRecord, onOpenVehicleDetail } = options;
    if (!sourceRef?.avId) return;

    const dlg = new DialogCls({
        title: t("fuel.dashboardTitle"),
        content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-fuel-dashboard"></div>`,
        width: "620px",
    });
    dlg.element.classList.add("lv-energy-dialog");
    bindDialogA11y({ dlg });
    const body = dlg.element.querySelector("#lv-fuel-dashboard") as HTMLElement;
    if (!body) return;

    const loading = document.createElement("div");
    loading.className = "ft__on-surface";
    loading.textContent = t("fuel.loading");
    body.appendChild(loading);

    try {
        const result = await renderLedgerAllFn(sourceRef.avId);
        if (!result.complete) throw new Error(t("ledger.loadIncomplete"));
        const cols = sourceRef.columns ?? {};
        const vehicles = result.rows;
        body.replaceChildren();

        const intro = document.createElement("p");
        intro.className = "ft__on-surface lv-dialog-intro";
        intro.textContent = t("fuel.dashboardHint");
        body.appendChild(intro);

        if (vehicles.length === 0) {
            const empty = document.createElement("div");
            empty.className = "lv-empty lv-dialog-empty";
            const title = document.createElement("b"); title.textContent = t("fuel.noVehicles");
            const hint = document.createElement("span"); hint.className = "lv-caption"; hint.style.display = "block"; hint.textContent = t("fuel.noVehiclesHint");
            const add = document.createElement("button");
            add.type = "button";
            add.className = "b3-button";
            add.style.marginTop = "8px";
            add.innerHTML = `${uiIcon("add", "", 12)} <span>${t("fuel.addVehicle")}</span>`;
            add.onclick = () => { dlg.destroy(); onOpenNewRecord?.(); };
            empty.append(title, hint, add);
            body.appendChild(empty);
            return;
        }

        const { loadRowLogs, getEntries } = await import("./rowlog");
        const logs = await loadRowLogs(plugin);
        const vehicleType = (row: any) => selectContentFn(row.cells?.[cols.energy_type ?? ""]) ?? "gasoline";
        const formatAmount = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

        const calculatedVehicleStats: Array<{
            name: string;
            plate?: string;
            fuel: EnergyStats;
            charge: EnergyStats;
            energyType: string;
        }> = [];

        const miniStat = (label: string, value: string) => {
            const item = document.createElement("div");
            item.className = "lv-metric-item lv-diag-stat-card";
            const name = document.createElement("span"); name.className = "ft__on-surface lv-caption"; name.textContent = label;
            const val = document.createElement("b"); val.style.overflowWrap = "anywhere"; val.textContent = value;
            item.append(name, val);
            return item;
        };

        for (const vehicle of vehicles) {
            const card = document.createElement("section");
            card.className = "lv-card lv-dialog-card";
            const head = document.createElement("div");
            head.className = "lv-dialog-topbar";
            head.style.marginBottom = "10px";
            head.style.flexWrap = "wrap";
            const title = document.createElement("b");
            title.style.fontSize = "14px";
            title.textContent = cellTextFn(vehicle.cells?.[cols.name ?? ""], "name") || t("ledger.unnamed");
            const plate = document.createElement("span");
            plate.className = "ft__on-surface";
            plate.style.fontSize = "12px";
            plate.textContent = cellTextFn(vehicle.cells?.[cols.plate ?? ""]);
            head.append(title, plate);

            const records = getEntries<EnergyRecord>(logs, sourceRef.avId, vehicle.itemID, "fuelings")
                .concat(getEntries<EnergyRecord>(logs, sourceRef.avId, vehicle.itemID, "chargings"));
            const fuel = calculateEnergyStats(records, "fuel");
            const charge = calculateEnergyStats(records, "charging");
            const hybrid = vehicleType(vehicle) === "hybrid";

            const grid = document.createElement("div");
            grid.className = "lv-diag-grid";
            const consumption = (stats: ReturnType<typeof calculateEnergyStats>, suffix: string) =>
                stats.consumptionPer100Km !== undefined ? `${stats.consumptionPer100Km.toFixed(2)} ${suffix}/100km${stats.method === "estimated" ? ` · ${t("fuel.estimated")}` : ""}` : "—";
            const cost = (stats: ReturnType<typeof calculateEnergyStats>) => stats.costPer100Km !== undefined
                ? `${formatAmount(stats.costPer100Km / 100)} ${t("fuel.currencyPerKm")}` : "—";

            grid.append(
                miniStat(t("fuel.fuelConsumption"), fuel.recordCount ? hybrid ? `${fuel.totalQuantity.toFixed(1)} L · ${t("fuel.totalRecorded")}` : consumption(fuel, "L") : "—"),
                miniStat(t("fuel.fuelCostPerKm"), fuel.recordCount ? hybrid ? t("fuel.hybridNoRate") : cost(fuel) : "—"),
                miniStat(t("fuel.chargeConsumption"), charge.recordCount ? hybrid ? `${charge.totalQuantity.toFixed(1)} kWh · ${t("fuel.totalRecorded")}` : consumption(charge, "kWh") : "—"),
                miniStat(t("fuel.chargeCostPerKm"), charge.recordCount ? hybrid ? t("fuel.hybridNoRate") : cost(charge) : "—"),
                miniStat(t("fuel.fuelRecordedSpending"), fuel.costRecordCount === 0 ? t("fuel.costUnknown") : `${formatAmount(fuel.totalCost)} ${t("fuel.currency")}${fuel.costRecordCount < fuel.recordCount ? ` · ${t("fuel.subtotal")}` : ""}`),
                miniStat(t("fuel.chargeRecordedSpending"), charge.costRecordCount === 0 ? t("fuel.costUnknown") : `${formatAmount(charge.totalCost)} ${t("fuel.currency")}${charge.costRecordCount < charge.recordCount ? ` · ${t("fuel.subtotal")}` : ""}`),
            );

            calculatedVehicleStats.push({
                name: cellTextFn(vehicle.cells?.[cols.name ?? ""], "name") || t("ledger.unnamed"),
                plate: cellTextFn(vehicle.cells?.[cols.plate ?? ""]),
                fuel,
                charge,
                energyType: vehicleType(vehicle),
            });

            const action = document.createElement("button");
            action.type = "button";
            action.className = "b3-button b3-button--text lv-dialog-link";
            action.innerHTML = `<span>${t("fuel.openVehicle")}</span> ${uiIcon("forward", "", 12)}`;
            action.onclick = () => { dlg.destroy(); onOpenVehicleDetail?.(vehicle); };
            card.append(head, grid, action);
            body.appendChild(card);
        }

        if (calculatedVehicleStats.length >= 2) {
            const comparison = compareVehiclesCost(calculatedVehicleStats);
            if (comparison && comparison.bestCostVehicle && comparison.savingsPerKm !== undefined && comparison.savingsPerKm > 0) {
                const escBest = String(comparison.bestCostVehicle).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const banner = document.createElement("div");
                banner.className = "lv-card lv-dialog-card";
                banner.style.marginBottom = "12px";
                banner.style.background = "var(--lv-ok-soft)";
                banner.style.borderColor = "var(--lv-ok)";
                const yearly = Math.round(comparison.savingsPerKm * 10000);
                banner.innerHTML = `<span style="color:var(--lv-ok);font-size:12.5px;font-weight:600;">🚗⚡ ${t("fuel.compareSavings")
                    .replace("${best}", escBest)
                    .replace("${diff}", String(comparison.savingsPerKm))
                    .replace("${pct}", String(comparison.savingsPct))
                    .replace("${yearly}", String(yearly))}</span>`;
                body.insertBefore(banner, body.children[1] || null);
            }
        }
    } catch (error) {
        body.replaceChildren();
        const msg = t("ledger.readFailed").replace("${msg}", error instanceof Error ? error.message : String(error));
        const message = document.createElement("div");
        message.className = "lv-record-error";
        message.textContent = msg;
        body.appendChild(message);
        showMessageFn?.(msg, 5000, "error");
    }
}


