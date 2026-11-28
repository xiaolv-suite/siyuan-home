/**
 * 汽车台账主表自动汇总列同步引擎（老板 msg#3880 方案 A）：
 * - 保持汽车台账「1 车 1 行」不膨胀；
 * - 兼容已建老台账按需安全补列（只增不改，绝不破坏既有列或老数据）；
 * - 每次保存/更新/删除车辆加油或充电流水时，复用 calculateVehicleCostSummary
 *   将最近补能日、累计油电费、本年油电费、综合油耗/能耗随当前里程一并回写至对应车辆 AV 行。
 */

import { calculateVehicleCostSummary, type MaintenanceRecord } from "./vehicle";
import { normalizeEnergyRecords, type EnergyRecord } from "./fuel";
import { loadRowLogs, getEntries, type RowLogs } from "./rowlog";
import { cellValue } from "./avcell";
import { round2 } from "./ledger-view-model";
import { addAttributeViewColumn, renderLedger, setCellResilient } from "./siyuan";
import { COMMON_COLUMN_ALIASES } from "./provision-common";
import { saveSettings } from "./settings";

export const VEHICLE_SUMMARY_COLUMN_KEYS = [
    "last_fuel_date",
    "total_fuel_cost",
    "yearly_fuel_cost",
    "avg_consumption",
] as const;

export type VehicleSummaryColumnKey = (typeof VEHICLE_SUMMARY_COLUMN_KEYS)[number];

const SUMMARY_COLUMN_TYPES: Record<VehicleSummaryColumnKey, "date" | "number"> = {
    last_fuel_date: "date",
    total_fuel_cost: "number",
    yearly_fuel_cost: "number",
    avg_consumption: "number",
};

export interface VehicleAvSummaryPatch {
    lastFuelDate?: string;
    totalFuelCost: number;
    yearlyFuelCost: number;
    avgConsumption?: number;
}

export function computeVehicleAvSummaryPatch(
    fuelRecords: readonly EnergyRecord[],
    chargingRecords: readonly EnergyRecord[],
    maintenanceRecords: readonly MaintenanceRecord[],
    options?: { currentYear?: number; energyType?: string },
): VehicleAvSummaryPatch {
    const year = options?.currentYear ?? new Date().getFullYear();
    const yearPrefix = `${year}-`;
    const summary = calculateVehicleCostSummary(fuelRecords, chargingRecords, maintenanceRecords);

    const normFuel = normalizeEnergyRecords(fuelRecords, "fuel");
    const normCharging = normalizeEnergyRecords(chargingRecords, "charging");
    const energyDates = [...normFuel, ...normCharging].map((r) => r.date).sort();
    const lastFuelDate = energyDates.length > 0 ? energyDates[energyDates.length - 1] : undefined;

    const yearSummary = calculateVehicleCostSummary(
        normFuel.filter((r) => r.date.startsWith(yearPrefix)),
        normCharging.filter((r) => r.date.startsWith(yearPrefix)),
        [],
    );

    const rawConsumption = options?.energyType === "electric"
        ? (summary.charging.consumptionPer100Km ?? summary.fuel.consumptionPer100Km)
        : (summary.fuel.consumptionPer100Km ?? summary.charging.consumptionPer100Km);

    return {
        lastFuelDate,
        totalFuelCost: round2(summary.fuelCost + summary.chargingCost),
        yearlyFuelCost: round2(yearSummary.fuelCost + yearSummary.chargingCost),
        avgConsumption: rawConsumption !== undefined && Number.isFinite(rawConsumption) ? round2(rawConsumption) : undefined,
    };
}

function resolveColumnDisplayName(plugin: any, colKey: VehicleSummaryColumnKey): string {
    const i18nKey = `field.${colKey}`;
    const fromDict = plugin?.i18n?.[i18nKey]
        ?? (typeof plugin?.i18nText === "function" ? plugin.i18nText(i18nKey) : undefined);
    if (typeof fromDict === "string" && fromDict && fromDict !== i18nKey) return fromDict;
    return COMMON_COLUMN_ALIASES[colKey]?.[0] ?? colKey;
}

/**
 * 兼容已建老汽车台账：只检查缺失的汇总列，优先复用已有同名/别名列，缺失时安全 addAttributeViewColumn 补列。
 * 绝不修改或删除任何既有列与老数据。
 */
export async function ensureVehicleSummaryColumns(
    plugin: any,
    vRef?: { avId?: string; columns?: Record<string, string> },
): Promise<Record<string, string>> {
    const ref = vRef ?? plugin?.settings?.dbRefs?.vehicles;
    if (!ref?.avId) return ref?.columns ?? {};
    const cols: Record<string, string> = { ...(ref.columns ?? {}) };
    const missing = VEHICLE_SUMMARY_COLUMN_KEYS.filter((k) => !cols[k]);
    if (missing.length === 0) return cols;

    try {
        const av = await renderLedger(ref.avId);
        const liveCols: Array<{ id?: string; name?: string; keyName?: string }> = Array.isArray(av?.columns) ? av.columns : [];
        let changed = false;
        let lastKeyID = liveCols.length > 0 ? String(liveCols[liveCols.length - 1]?.id ?? "") : "";

        for (const colKey of missing) {
            const displayName = resolveColumnDisplayName(plugin, colKey);
            const aliases = new Set([displayName, colKey, ...(COMMON_COLUMN_ALIASES[colKey] ?? [])]);
            const matched = liveCols.find((c) => aliases.has(String(c?.name ?? "")) || aliases.has(String(c?.keyName ?? "")));
            if (matched?.id) {
                cols[colKey] = String(matched.id);
                changed = true;
                continue;
            }
            try {
                const newKeyId = await addAttributeViewColumn(
                    ref.avId,
                    {
                        name: displayName,
                        type: SUMMARY_COLUMN_TYPES[colKey],
                        previousKeyID: lastKeyID,
                    },
                    { idempotencyKey: `veh-summary-col:${ref.avId}:${colKey}`, retries: 1 },
                );
                if (newKeyId) {
                    cols[colKey] = newKeyId;
                    lastKeyID = newKeyId;
                    changed = true;
                }
            } catch (err) {
                console.warn(`[LvHome] ensureVehicleSummaryColumns addColumn ${colKey} skipped:`, err instanceof Error ? err.message : err);
            }
        }

        if (changed) {
            ref.columns = cols;
            if (plugin?.settings?.dbRefs?.vehicles === ref && typeof plugin?.saveData === "function") {
                await saveSettings(plugin, plugin.settings).catch(() => undefined);
            }
        }
    } catch (err) {
        console.warn("[LvHome] ensureVehicleSummaryColumns renderLedger skipped:", err instanceof Error ? err.message : err);
    }
    return cols;
}

export async function syncVehicleSummaryToAv(
    plugin: any,
    vehicleId: string,
    providedLogs?: RowLogs,
    options?: {
        mileage?: number;
        energyType?: string;
        vRef?: { avId?: string; columns?: Record<string, string> };
        currentYear?: number;
    },
): Promise<{ updatedFields: string[]; failed: string[]; summary: VehicleAvSummaryPatch }> {
    const vRef = options?.vRef ?? plugin?.settings?.dbRefs?.vehicles;
    const logs = providedLogs ?? (await loadRowLogs(plugin));
    const avId = vRef?.avId ?? "";

    const fuelRecords = avId ? getEntries<EnergyRecord>(logs, avId, vehicleId, "fuelings") : [];
    const chargingRecords = avId ? getEntries<EnergyRecord>(logs, avId, vehicleId, "chargings") : [];
    const maintenanceRecords = avId ? getEntries<MaintenanceRecord>(logs, avId, vehicleId, "maintenance") : [];
    const summary = computeVehicleAvSummaryPatch(fuelRecords, chargingRecords, maintenanceRecords, {
        currentYear: options?.currentYear,
        energyType: options?.energyType,
    });

    const updatedFields: string[] = [];
    const failed: string[] = [];
    if (!avId || !vehicleId) return { updatedFields, failed, summary };

    const cols = await ensureVehicleSummaryColumns(plugin, vRef);
    const updates: Array<{ key: string; type: "date" | "number"; value: unknown; allowEmpty?: boolean }> = [
        { key: "last_fuel_date", type: "date", value: summary.lastFuelDate ?? "", allowEmpty: true },
        { key: "total_fuel_cost", type: "number", value: summary.totalFuelCost },
        { key: "yearly_fuel_cost", type: "number", value: summary.yearlyFuelCost },
        { key: "avg_consumption", type: "number", value: summary.avgConsumption ?? "", allowEmpty: true },
    ];
    if (typeof options?.mileage === "number" && Number.isFinite(options.mileage) && options.mileage > 0) {
        updates.unshift({ key: "mileage", type: "number", value: options.mileage });
    }

    for (const item of updates) {
        let keyID = cols[item.key];
        if (!keyID) continue;
        const payload = cellValue(item.type, item.value, {
            itemID: vehicleId,
            keyID,
            allowEmptyNumber: item.allowEmpty,
        });
        if (payload === null) continue;
        try {
            await setCellResilient({
                avID: avId,
                keyID,
                itemID: vehicleId,
                value: payload,
                plugin,
                moduleId: "vehicles",
                colKey: item.key,
                ref: vRef as any,
                schemaCol: { key: item.key, type: item.type },
                requestOptions: {
                    idempotencyKey: `veh-summary:${avId}:${vehicleId}:${item.key}:${JSON.stringify(payload)}`,
                    retries: 1,
                },
            });
            updatedFields.push(item.key);
        } catch {
            failed.push(item.key);
        }
    }

    return { updatedFields, failed, summary };
}
