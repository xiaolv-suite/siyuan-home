import { describe, it, expect } from "vitest";
import {
    buildFuelingLog,
    buildVitalLog,
    buildChoreLog,
    validateFuelingInput,
    validateVitalInput,
} from "@/core/quick-actions";
import { normalizeEnergyRecords } from "@/core/fuel";
import { summarizeVitals } from "@/core/vitals";
import { upgradeLegacyRowLogs, type RowLogs } from "@/core/rowlog";

describe("core/quick-actions 快速生活流水与抽屉同结构", () => {
    it("加油流水即 EnergyRecord，能被车辆能耗统计读到", () => {
        const log = buildFuelingLog({ date: "2026-10-21", kind: "fuel", amount: 320, mileage: 45000, quantity: 42.5, note: " 中石化95# " });
        expect(log).toMatchObject({ kind: "fuel", date: "2026-10-21", odometer: 45000, quantity: 42.5, totalCost: 320, note: "中石化95#" });
        expect(log.at).toBeDefined();
        expect(normalizeEnergyRecords([log], "fuel")).toHaveLength(1);
    });

    it("充电流水 kind=charging，金额可省略", () => {
        const log = buildFuelingLog({ date: "2026-10-28", kind: "charging", mileage: 22000, quantity: 40 });
        expect(log.kind).toBe("charging");
        expect(log.totalCost).toBeUndefined();
        expect(normalizeEnergyRecords([log], "charging")).toHaveLength(1);
    });

    it("加油校验：里程与升数必填，金额可空但不能为负", () => {
        expect(validateFuelingInput({ mileage: 100, quantity: 10 })).toEqual([]);
        expect(validateFuelingInput({ quantity: 10 })).toEqual(["mileage"]);
        expect(validateFuelingInput({ mileage: 100, quantity: 0, amount: -1 })).toEqual(["quantity", "amount"]);
    });

    it("血压读数即 VitalReading，附带脉搏时额外记一条心率", () => {
        const readings = buildVitalLog({ date: "2026-10-21", metricType: "bp", systolic: 124, diastolic: 82, pulse: 72 });
        expect(readings).toHaveLength(2);
        expect(readings[0]).toMatchObject({ type: "bp", val1: 124, val2: 82, date: "2026-10-21" });
        expect(readings[1]).toMatchObject({ type: "hr", val1: 72 });
        expect(summarizeVitals(readings.filter((r) => r.type === "bp"), "bp").total).toBe(1);
    });

    it("血糖读数 type=bg，餐后标记 val2=1", () => {
        const [reading] = buildVitalLog({ date: "2026-10-21", metricType: "glucose", glucose: 7.2, glucoseTiming: "postprandial" });
        expect(reading).toMatchObject({ type: "bg", val1: 7.2, val2: 1 });
    });

    it("体征校验：空读数不能提交", () => {
        expect(validateVitalInput({ metricType: "bp" })).toEqual(["systolic", "diastolic"]);
        expect(validateVitalInput({ metricType: "bp", systolic: 120, diastolic: 80 })).toEqual([]);
        expect(validateVitalInput({ metricType: "glucose" })).toEqual(["glucose"]);
        expect(buildVitalLog({ date: "2026-10-21", metricType: "bp" })).toEqual([]);
    });

    it("家务打卡记录与家务轮换抽屉同字段，积分为 0 时不写 points", () => {
        const log = buildChoreLog({ date: "2026-10-21", memberId: "m1", points: 5, note: " 很干净 " });
        expect(log).toMatchObject({ date: "2026-10-21", memberId: "m1", points: 5, note: "很干净" });
        expect(buildChoreLog({ date: "2026-10-21", points: 0 }).points).toBeUndefined();
    });
});

describe("rowlog 旧快速流水补齐标准字段", () => {
    it("旧加油 {cost, liters} 与旧体征补齐标准字段，保留原字段，幂等", () => {
        const logs: RowLogs = {
            "av|v1": {
                fuelings: [{ date: "2026-10-01", cost: 300, liters: 40, odometer: 1000, category: "gasoline", at: "a" }],
                vitals: [
                    { date: "2026-10-02", systolic: 130, diastolic: 85, pulse: 70, at: "b" },
                    { date: "2026-10-03", glucose: 6.1, glucoseTiming: "fasting", at: "c" },
                ],
            },
        };
        upgradeLegacyRowLogs(logs);
        const once = JSON.stringify(logs);
        upgradeLegacyRowLogs(logs);
        expect(JSON.stringify(logs)).toBe(once);
        expect(logs["av|v1"].fuelings![0]).toMatchObject({ kind: "fuel", quantity: 40, totalCost: 300, cost: 300, liters: 40 });
        expect(logs["av|v1"].vitals![0]).toMatchObject({ type: "bp", val1: 130, val2: 85, systolic: 130 });
        expect(logs["av|v1"].vitals![1]).toMatchObject({ type: "bg", val1: 6.1, val2: 0 });
    });

    it("已是标准结构的记录不改动", () => {
        const entry = { kind: "fuel", date: "2026-10-01", odometer: 1, quantity: 2, at: "x" };
        const logs: RowLogs = { k: { fuelings: [{ ...entry }] } };
        upgradeLegacyRowLogs(logs);
        expect(logs.k.fuelings![0]).toEqual(entry);
    });
});
