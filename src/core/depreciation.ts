/**
 * 实物资产折旧与残值测算纯函数引擎（依照国家财务折旧准则与家庭大件寿命模型）
 * 100% 纯函数，无网络与 DOM 依赖，可完全单测。
 */

import { localDateKey } from "./hub/rule";

export interface AssetDepreciationResult {
    initialCost: number;
    purchaseDate: string;
    lifespanMonths: number;
    usedMonths: number;
    accumulatedDepreciation: number;
    estimatedSalvageValue: number;
    salvageRatePercent: number; // 预计残值率 %
    currentNetValue: number;
    status: "new" | "normal" | "near_end" | "expired";
    statusLabel: string;
    suggestion: string;
}

/**
 * 依据购入原值、购入日期与预计寿命测算资产折旧与当前净残值
 */
export function calculateAssetDepreciation(options: {
    initialCost: number;
    purchaseDate: string;
    lifespanYears?: number;
    salvageRate?: number; // 默认 5% (0.05)
    currentDate?: string;
}): AssetDepreciationResult | null {
    const {
        initialCost,
        purchaseDate,
        lifespanYears = 5,
        salvageRate = 0.05,
        currentDate = localDateKey(new Date()),
    } = options;

    if (!initialCost || initialCost <= 0 || !purchaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
        return null;
    }

    const pParts = purchaseDate.split("-").map(Number);
    const cParts = currentDate.split("-").map(Number);
    if (pParts.length < 3 || cParts.length < 3) return null;

    const pTime = new Date(pParts[0], pParts[1] - 1, pParts[2]).getTime();
    const cTime = new Date(cParts[0], cParts[1] - 1, cParts[2]).getTime();
    if (cTime < pTime) {
        // 未来购入
        return {
            initialCost,
            purchaseDate,
            lifespanMonths: lifespanYears * 12,
            usedMonths: 0,
            accumulatedDepreciation: 0,
            estimatedSalvageValue: Math.round(initialCost * salvageRate),
            salvageRatePercent: salvageRate * 100,
            currentNetValue: initialCost,
            status: "new",
            statusLabel: "全新就绪",
            suggestion: "新购资产，享受完整原厂保修期。",
        };
    }

    let usedMonths = (cParts[0] - pParts[0]) * 12 + (cParts[1] - pParts[1]);
    if (cParts[2] < pParts[2]) usedMonths--;
    usedMonths = Math.max(0, usedMonths);

    const safeLifespanYears = Number.isFinite(lifespanYears) && lifespanYears > 0 ? lifespanYears : 5;
    const safeSalvageRate = Number.isFinite(salvageRate) ? Math.max(0, Math.min(0.95, salvageRate)) : 0.05;

    const lifespanMonths = Math.max(1, Math.round(safeLifespanYears * 12));
    const estimatedSalvageValue = Math.round(initialCost * safeSalvageRate);
    const depreciableBase = Math.max(0, initialCost - estimatedSalvageValue);

    // 直线折旧法：每月折旧额
    const monthlyDepreciation = depreciableBase / lifespanMonths;

    let accumulatedDepreciation = Math.round(monthlyDepreciation * Math.min(usedMonths, lifespanMonths));
    accumulatedDepreciation = Math.min(accumulatedDepreciation, depreciableBase);

    const currentNetValue = Math.max(estimatedSalvageValue, initialCost - accumulatedDepreciation);

    let status: AssetDepreciationResult["status"];
    let statusLabel: string;
    let suggestion: string;

    const usageRatio = usedMonths / lifespanMonths;

    if (usageRatio < 0.25) {
        status = "new";
        statusLabel = "准新在役";
        suggestion = "处于黄金生命周期，性能与折旧状态良好。";
    } else if (usageRatio < 0.75) {
        status = "normal";
        statusLabel = "正常服役";
        suggestion = "处于稳定服役阶段，建议定期除尘与维护保养。";
    } else if (usageRatio <= 1.0) {
        status = "near_end";
        statusLabel = "临近寿命期";
        suggestion = "已进入寿命后期，建议关注零部件磨损与续保/换新预算。";
    } else {
        status = "expired";
        statusLabel = "超期服役";
        suggestion = "已超过预计使用年限，账面已提足折旧，需重点防范用电与结构安全。";
    }

    return {
        initialCost,
        purchaseDate,
        lifespanMonths,
        usedMonths,
        accumulatedDepreciation,
        estimatedSalvageValue,
        salvageRatePercent: salvageRate * 100,
        currentNetValue,
        status,
        statusLabel,
        suggestion,
    };
}
