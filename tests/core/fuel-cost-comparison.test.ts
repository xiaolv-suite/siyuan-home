import { describe, it, expect } from "vitest";
import { compareVehiclesCost, type EnergyStats } from "@/core/fuel";

describe("fuel-cost-comparison (Phase 4.2: 多车燃油与纯电能耗成本等效对比分析)", () => {
    const mockFuelStats: EnergyStats = {
        kind: "fuel",
        recordCount: 5,
        costRecordCount: 5,
        costComplete: true,
        totalQuantity: 200,
        coveredQuantity: 200,
        totalCost: 1600,
        totalDistance: 2500,
        costPer100Km: 64, // 64 元 / 100km -> 0.64 元/km
        consumptionPer100Km: 8.0,
        method: "full",
        intervals: [],
        warnings: [],
    };

    const mockEvStats: EnergyStats = {
        kind: "charging",
        recordCount: 8,
        costRecordCount: 8,
        costComplete: true,
        totalQuantity: 360,
        coveredQuantity: 360,
        totalCost: 360,
        totalDistance: 2400,
        costPer100Km: 15, // 15 元 / 100km -> 0.15 元/km
        consumptionPer100Km: 15.0,
        method: "full",
        intervals: [],
        warnings: [],
    };

    const emptyStats: EnergyStats = {
        kind: "charging",
        recordCount: 0,
        costRecordCount: 0,
        costComplete: true,
        totalQuantity: 0,
        coveredQuantity: 0,
        totalCost: 0,
        totalDistance: 0,
        method: "estimated",
        intervals: [],
        warnings: [],
    };

    it("精准核算油车与电车每公里差额与节省比例", () => {
        const vehicles = [
            { name: "燃油SUV", plate: "京A11111", fuel: mockFuelStats, charge: emptyStats, energyType: "gasoline" },
            { name: "纯电轿车", plate: "京AD2222", fuel: emptyStats, charge: mockEvStats, energyType: "ev" },
        ];

        const comp = compareVehiclesCost(vehicles);
        expect(comp).not.toBeNull();
        expect(comp?.bestCostVehicle).toBe("纯电轿车");
        expect(comp?.savingsPerKm).toBe(0.49); // 0.64 - 0.15 = 0.49
        expect(comp?.savingsPct).toBe(77);     // 0.49 / 0.64 = 76.56% -> 77%
    });

    it("单辆车时安全返回 null", () => {
        const vehicles = [
            { name: "单辆车", fuel: mockFuelStats, charge: emptyStats, energyType: "gasoline" },
        ];
        expect(compareVehiclesCost(vehicles)).toBeNull();
    });
});
