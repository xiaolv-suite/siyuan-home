import { describe, it, expect } from "vitest";
import { calculateAssetDepreciation } from "@/core/depreciation";

describe("depreciation (实物资产折旧与残值测算纯函数引擎)", () => {
    it("正确测算资产折旧与当前净值（5年寿命、5%残值率）", () => {
        // 原值 10000，预计残值 500，应计折旧总额 9500，总月数 60，每月折旧约 158.33
        // 购入 2024-10-27，当前 2026-10-27，已使用 24 个月
        // 累计折旧 = 158.33 * 24 = 3800
        // 当前净值 = 10000 - 3800 = 6200
        const res = calculateAssetDepreciation({
            initialCost: 10000,
            purchaseDate: "2024-10-27",
            lifespanYears: 5,
            currentDate: "2026-10-27",
        });

        expect(res).not.toBeNull();
        expect(res?.usedMonths).toBe(24);
        expect(res?.lifespanMonths).toBe(60);
        expect(res?.estimatedSalvageValue).toBe(500);
        expect(res?.currentNetValue).toBe(6200);
        expect(res?.status).toBe("normal");
    });

    it("超期服役资产自动提足折旧并保留残值底线", () => {
        const res = calculateAssetDepreciation({
            initialCost: 8000,
            purchaseDate: "2015-01-01",
            lifespanYears: 6,
            currentDate: "2026-10-27",
        });

        expect(res).not.toBeNull();
        expect(res?.status).toBe("expired");
        expect(res?.currentNetValue).toBe(400); // 8000 * 0.05
        expect(res?.statusLabel).toContain("超期服役");
    });

    it("未来购入日期或无效参数安全防御", () => {
        const future = calculateAssetDepreciation({
            initialCost: 5000,
            purchaseDate: "2028-10-27",
            currentDate: "2026-10-27",
        });
        expect(future?.status).toBe("new");
        expect(future?.currentNetValue).toBe(5000);

        expect(calculateAssetDepreciation({ initialCost: 0, purchaseDate: "" })).toBeNull();
        expect(calculateAssetDepreciation({ initialCost: -100, purchaseDate: "2026-01-01" })).toBeNull();
    });
});
