import type { HomeSettings, Reminder } from "@/types";
import { renderLedgerAll } from "./siyuan";
import { loadRowLogs, getEntries } from "./rowlog";
import { calculateSubscriptionStats, normalizeCycleCost } from "./subscriptions";
import { calculateAssetValuationStats } from "./valuation";
import { localDateKey } from "./hub/rule";

export interface OverviewReminderBuckets {
    /** 已临期（含已逾期及 14 天内到期） */
    soon: Reminder[];
    /** 本月到期或后续关注（> 14 天） */
    month: Reminder[];
    /** 30 天内（含逾期）计数 */
    due30Count: number;
    /** 7 天内（含逾期）计数 */
    due7Count: number;
    /** 已逾期计数 */
    overdueCount: number;
}

/**
 * 将筛选后的提醒按紧急度归入「已临期 / 14 天内」与「本月到期 / 后续关注」。
 */
export function bucketUpcomingReminders(reminders: readonly Reminder[]): OverviewReminderBuckets {
    const sorted = [...reminders].sort((a, b) => a.daysLeft - b.daysLeft);
    const soon: Reminder[] = [];
    const month: Reminder[] = [];
    let due30Count = 0;
    let due7Count = 0;
    let overdueCount = 0;

    for (const r of sorted) {
        if (r.daysLeft < 0) overdueCount++;
        if (r.daysLeft <= 7) due7Count++;
        if (r.daysLeft <= 30) due30Count++;
        if (r.daysLeft <= 14) soon.push(r);
        else if (r.daysLeft <= 30) month.push(r);
    }

    // 若 30 天内均无项，但存在更远期提醒，放入 month 保持首页不失焦
    if (soon.length === 0 && month.length === 0 && sorted.length > 0) {
        month.push(...sorted.slice(0, 6));
    }

    return {
        soon: soon.slice(0, 6),
        month: month.slice(0, 6),
        due30Count,
        due7Count,
        overdueCount,
    };
}

export interface OverviewFinancialSummary {
    loaded: boolean;
    /** 已纳管实物资产当前估值合计（元） */
    assetTotalAmount: number;
    /** 已纳管实物资产在役件数 */
    assetCount: number;
    /** 有效保单份数 */
    insuranceCount: number;
    /** 本月车辆油电与养护支出（元） */
    vehicleMonthCost: number;
    /** 本月居家物业/水电支出（元） */
    houseMonthCost: number;
    /** 会员订阅月均折算（元） */
    subscriptionMonthCost: number;
    /** 全家保单月均分摊（元） */
    insuranceMonthCost: number;
    /** 本月车耗与固定订阅合计（元） */
    monthlyVehicleAndSubTotal: number;
    /** 读取失败的模块标识（如 assets-real / vehicles / rowlogs） */
    failedModules: string[];
    /** 尚未启用或未建库的模块标识 */
    unavailableModules: string[];
}

export function emptyOverviewFinancialSummary(): OverviewFinancialSummary {
    return {
        loaded: false,
        assetTotalAmount: 0,
        assetCount: 0,
        insuranceCount: 0,
        vehicleMonthCost: 0,
        houseMonthCost: 0,
        subscriptionMonthCost: 0,
        insuranceMonthCost: 0,
        monthlyVehicleAndSubTotal: 0,
        failedModules: [],
        unavailableModules: [],
    };
}

function readNum(cell: any): number {
    if (cell?.type === "number" && cell?.number?.isNotEmpty !== false && typeof cell?.number?.content === "number" && Number.isFinite(cell.number.content)) {
        return cell.number.content;
    }
    return 0;
}

function readStr(cell: any): string {
    if (!cell) return "";
    if (typeof cell?.select?.content === "string") return cell.select.content;
    if (Array.isArray(cell?.mSelect) && cell.mSelect[0]?.content) return String(cell.mSelect[0].content);
    if (typeof cell?.text?.content === "string") return cell.text.content;
    return "";
}

function readDateStr(cell: any): string {
    const raw = cell?.date?.content ?? cell?.content;
    if (!raw) return "";
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? "" : localDateKey(d);
    }
    return typeof raw === "string" ? raw.slice(0, 10) : "";
}

/**
 * 从真实 AV 台账与 RowLogs 聚合「今日管家」顶部指标与右侧固定支出概览（纯读取，零写操作）。
 */
export async function computeOverviewFinancialSummary(
    plugin: { settings: HomeSettings; loadData?: (name: string) => Promise<any> },
    options: {
        now?: Date;
        renderLedgerFn?: (avId: string) => Promise<{ rows: any[] }>;
        loadRowLogsFn?: (plugin: any) => Promise<any>;
    } = {},
): Promise<OverviewFinancialSummary> {
    const now = options.now ?? new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const renderFn = options.renderLedgerFn ?? renderLedgerAll;
    const logsFn = options.loadRowLogsFn ?? loadRowLogs;
    const dbRefs = plugin.settings?.dbRefs ?? {};

    const failedModules: string[] = [];
    const unavailableModules: string[] = [];

    let rowLogs: any = {};
    try {
        rowLogs = await logsFn(plugin);
    } catch {
        rowLogs = {};
        failedModules.push("rowlogs");
    }

    let assetTotalAmount = 0;
    let assetCount = 0;
    const assetsRef = dbRefs["assets-real"];
    if (assetsRef?.avId && assetsRef.columns) {
        try {
            const res = await renderFn(assetsRef.avId);
            if ((res as any)?.complete === false) failedModules.push("assets-real");
            const report = calculateAssetValuationStats(res.rows ?? [], assetsRef.columns, rowLogs, assetsRef.avId);
            assetTotalAmount = Math.round(report.totalCurrentValuation * 100) / 100;
            assetCount = report.activeItems;
        } catch {
            failedModules.push("assets-real");
        }
    } else {
        unavailableModules.push("assets-real");
    }

    let subscriptionMonthCost = 0;
    const memRef = dbRefs["memberships"];
    if (memRef?.avId && memRef.columns) {
        try {
            const res = await renderFn(memRef.avId);
            if ((res as any)?.complete === false) failedModules.push("memberships");
            const report = calculateSubscriptionStats(res.rows ?? [], memRef.columns);
            subscriptionMonthCost = Math.round(report.totalMonthlyCost * 100) / 100;
        } catch {
            failedModules.push("memberships");
        }
    } else {
        unavailableModules.push("memberships");
    }

    let insuranceCount = 0;
    let insuranceMonthCost = 0;
    const insRef = dbRefs["insurance"];
    if (insRef?.avId && insRef.columns) {
        try {
            const res = await renderFn(insRef.avId);
            if ((res as any)?.complete === false) failedModules.push("insurance");
            const rows = res.rows ?? [];
            for (const row of rows) {
                const status = readStr(row.cells?.[insRef.columns.status ?? ""]);
                if (status === "ins_expired" || status === "surrendered") continue;
                insuranceCount++;
                const prem = readNum(row.cells?.[insRef.columns.premium ?? ""]);
                const cycle = readStr(row.cells?.[insRef.columns.pay_cycle ?? ""]) || "year";
                if (prem > 0) {
                    insuranceMonthCost += normalizeCycleCost(prem, cycle).monthly;
                }
            }
            insuranceMonthCost = Math.round(insuranceMonthCost * 100) / 100;
        } catch {
            failedModules.push("insurance");
        }
    } else {
        unavailableModules.push("insurance");
    }

    let vehicleMonthCost = 0;
    const vehRef = dbRefs["vehicles"];
    if (vehRef?.avId) {
        try {
            const res = await renderFn(vehRef.avId);
            if ((res as any)?.complete === false) failedModules.push("vehicles");
            for (const row of res.rows ?? []) {
                for (const kind of ["fuelings", "chargings", "maintenance"] as const) {
                    const list = getEntries<any>(rowLogs, vehRef.avId, row.itemID, kind);
                    for (const entry of list) {
                        const d = String(entry?.date ?? "");
                        if (d.startsWith(monthPrefix)) {
                            const rawAmt = entry?.totalCost ?? entry?.amount ?? entry?.cost
                                ?? (typeof entry?.unitPrice === "number" && typeof entry?.quantity === "number" ? entry.unitPrice * entry.quantity : 0);
                            const amt = Number(rawAmt);
                            if (Number.isFinite(amt) && amt > 0) vehicleMonthCost += amt;
                        }
                    }
                }
            }
            vehicleMonthCost = Math.round(vehicleMonthCost * 100) / 100;
        } catch {
            failedModules.push("vehicles");
        }
    } else {
        unavailableModules.push("vehicles");
    }

    let houseMonthCost = 0;
    const houseRef = dbRefs["house"];
    if (houseRef?.avId && houseRef.columns) {
        try {
            const res = await renderFn(houseRef.avId);
            if ((res as any)?.complete === false) failedModules.push("house");
            for (const row of res.rows ?? []) {
                let amt = readNum(row.cells?.[houseRef.columns.amount ?? ""]);
                if (amt <= 0 && houseRef.columns.note) {
                    const note = readStr(row.cells?.[houseRef.columns.note]);
                    const m = note.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
                    if (m) {
                        const parsed = Number(m[1]);
                        if (Number.isFinite(parsed) && parsed > 0) amt = parsed;
                    }
                }
                if (amt <= 0) continue;
                const cycle = readStr(row.cells?.[houseRef.columns.cycle ?? ""]);
                if (cycle) {
                    houseMonthCost += normalizeCycleCost(amt, cycle).monthly;
                } else {
                    const d = readDateStr(row.cells?.[houseRef.columns.date ?? houseRef.columns.pay_day ?? ""]);
                    if (!d || d.startsWith(monthPrefix)) houseMonthCost += amt;
                }
            }
            houseMonthCost = Math.round(houseMonthCost * 100) / 100;
        } catch {
            failedModules.push("house");
        }
    } else {
        unavailableModules.push("house");
    }

    return {
        loaded: true,
        assetTotalAmount,
        assetCount,
        insuranceCount,
        vehicleMonthCost,
        houseMonthCost,
        subscriptionMonthCost,
        insuranceMonthCost,
        monthlyVehicleAndSubTotal: Math.round((vehicleMonthCost + subscriptionMonthCost) * 100) / 100,
        failedModules,
        unavailableModules,
    };
}

/** 格式化人民币金额（万级简化或千分位） */
export function formatCnyCompact(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return "¥0";
    if (amount >= 10000) {
        const wan = amount / 10000;
        return `¥${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万`;
    }
    return `¥${Math.round(amount).toLocaleString("zh-CN")}`;
}

export interface OverviewQuickRepairPlan {
    moduleId: "favors" | "house";
    fields: Record<string, unknown>;
}

const FAVOR_QUICK_RE = /人情|随礼|礼金|份子|红包|回礼|送礼|请客|满月|乔迁|婚礼|压岁/;

/**
 * 首页「一键快捷记一笔 → 人情/维修」的严格 Schema 对位规划：
 * - 人情往来落 favors：只写入 FAVORS_SCHEMA 合法列（date / direction / amount / person）
 * - 居家维修落 house：只写入 HOUSE_SCHEMA 合法列（category / pay_day / note），绝不注入 date/amount 脏列
 */
export function buildOverviewQuickRepairPlan(
    rawTitle: string,
    validAmount: number | undefined,
    subText: string,
    today: string,
): OverviewQuickRepairPlan {
    const trimmedSub = subText.trim();
    if (FAVOR_QUICK_RE.test(rawTitle)) {
        return {
            moduleId: "favors",
            fields: {
                date: today,
                direction: "out",
                ...(validAmount !== undefined ? { amount: validAmount } : {}),
                ...(trimmedSub ? { person: trimmedSub } : {}),
            },
        };
    }
    const noteParts = [validAmount !== undefined ? `¥${validAmount}` : "", trimmedSub].filter(Boolean);
    return {
        moduleId: "house",
        fields: {
            category: "maintenance_h",
            pay_day: today,
            ...(noteParts.length > 0 ? { note: noteParts.join(" · ") } : {}),
        },
    };
}
