import { describe, it, expect } from "vitest";
import { buildFuelingLog, buildVitalLog } from "@/core/quick-actions";

describe("quick-event-flow (快速记录四合一日常高频流水组件)", () => {
    it("正确组装车辆加油/充电记录数据包", () => {
        const gasLog = buildFuelingLog({
            date: "2026-10-28",
            amount: 320,
            liters: 45.2,
            mileage: 18500,
            fuelType: "gasoline",
        });

        expect(gasLog.cost).toBe(320);
        expect(gasLog.liters).toBe(45.2);
        expect(gasLog.odometer).toBe(18500);
        expect(gasLog.category).toBe("gasoline");

        const evLog = buildFuelingLog({
            date: "2026-10-28",
            amount: 50,
            liters: 40, // 度
            mileage: 22000,
            fuelType: "electric",
        });

        expect(evLog.cost).toBe(50);
        expect(evLog.category).toBe("electric");
    });

    it("正确组装生理指标（血压/心率/血糖）数据包", () => {
        const bpLog = buildVitalLog({
            date: "2026-10-28",
            metricType: "bp",
            systolic: 118,
            diastolic: 76,
            pulse: 68,
        });

        expect(bpLog.systolic).toBe(118);
        expect(bpLog.diastolic).toBe(76);
        expect(bpLog.pulse).toBe(68);

        const glucoseLog = buildVitalLog({
            date: "2026-10-28",
            metricType: "glucose",
            glucose: 5.4,
            glucoseTiming: "fasting",
        });

        expect(glucoseLog.glucose).toBe(5.4);
        expect(glucoseLog.glucoseTiming).toBe("fasting");
    });
});
