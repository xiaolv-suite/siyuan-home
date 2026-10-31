/**
 * 快速生活流水动作（Quick Event Actions）：
 * 区分“实体资产/长期档案建档（一次性，低频）”与“日常高频流水录入（加油/充放电/生理指标/家务打卡）”。
 * 产出的流水对象与车辆抽屉（EnergyRecord）、健康抽屉（VitalReading）、家务轮换（chexecs）
 * 读取的是同一种结构——快速记录与抽屉录入不再各写一套字段。
 * 纯函数，100% 可单元测试。
 */
import type { EnergyKind, EnergyRecord } from "./fuel";
import type { VitalReading } from "./vitals";

export interface QuickFuelingInput {
    date: string; // YYYY-MM-DD
    kind: EnergyKind;
    /** 当前总里程（公里），油耗/电耗统计必需 */
    mileage: number;
    /** 加油升数或充电度数，统计必需 */
    quantity: number;
    /** 总费用（元），可省略 */
    amount?: number;
    note?: string;
}

export interface QuickVitalInput {
    date: string; // YYYY-MM-DD
    metricType: "bp" | "glucose"; // 血压或血糖
    systolic?: number; // 收缩压
    diastolic?: number; // 舒张压
    glucose?: number; // 血糖值
    glucoseTiming?: "fasting" | "postprandial";
    pulse?: number; // 脉搏
    note?: string;
}

export interface QuickChoreInput {
    date: string;
    /** settings 成员 id（与家务抽屉、积分结算同一 ID 空间） */
    memberId?: string;
    points?: number;
    note?: string;
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** 加油/充电输入校验：返回缺失的字段 key，空数组表示可提交 */
export function validateFuelingInput(input: Partial<QuickFuelingInput>): Array<"mileage" | "quantity" | "amount"> {
    const missing: Array<"mileage" | "quantity" | "amount"> = [];
    if (!positive(input.mileage)) missing.push("mileage");
    if (!positive(input.quantity)) missing.push("quantity");
    if (input.amount !== undefined && input.amount !== null && !(typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount >= 0)) missing.push("amount");
    return missing;
}

/** 血压/血糖输入校验：返回缺失的字段 key，空数组表示可提交 */
export function validateVitalInput(input: Partial<QuickVitalInput>): Array<"systolic" | "diastolic" | "glucose"> {
    if (input.metricType === "glucose") return positive(input.glucose) ? [] : ["glucose"];
    const missing: Array<"systolic" | "diastolic"> = [];
    if (!positive(input.systolic)) missing.push("systolic");
    if (!positive(input.diastolic)) missing.push("diastolic");
    return missing;
}

/** 构建加油/充电流水（EnergyRecord，与车辆抽屉录入同结构） */
export function buildFuelingLog(input: QuickFuelingInput): EnergyRecord {
    const record: EnergyRecord = {
        kind: input.kind,
        date: input.date || new Date().toISOString().slice(0, 10),
        at: new Date().toISOString(),
        odometer: input.mileage,
        quantity: input.quantity,
    };
    if (typeof input.amount === "number" && Number.isFinite(input.amount)) record.totalCost = input.amount;
    if (input.note?.trim()) record.note = input.note.trim();
    return record;
}

/** 构建生理指标读数（VitalReading[]，与健康抽屉录入同结构；血压附带脉搏时额外记一条心率） */
export function buildVitalLog(input: QuickVitalInput): VitalReading[] {
    const date = input.date || new Date().toISOString().slice(0, 10);
    const at = new Date().toISOString();
    const note = input.note?.trim() || undefined;
    const readings: VitalReading[] = [];
    if (input.metricType === "glucose") {
        if (positive(input.glucose)) {
            readings.push({ date, type: "bg", val1: input.glucose, val2: input.glucoseTiming === "postprandial" ? 1 : 0, at, ...(note ? { note } : {}) });
        }
        return readings;
    }
    if (positive(input.systolic)) {
        readings.push({ date, type: "bp", val1: input.systolic, ...(positive(input.diastolic) ? { val2: input.diastolic } : {}), at, ...(note ? { note } : {}) });
    }
    if (positive(input.pulse)) readings.push({ date, type: "hr", val1: input.pulse, at });
    return readings;
}

/** 构建家务打卡记录（chexecs，与家务轮换抽屉同结构；积分结算按 points 汇总） */
export function buildChoreLog(input: QuickChoreInput): Record<string, unknown> {
    const record: Record<string, unknown> = {
        date: input.date || new Date().toISOString().slice(0, 10),
        at: new Date().toISOString(),
    };
    if (input.memberId) record.memberId = input.memberId;
    if (input.note?.trim()) record.note = input.note.trim();
    if (positive(input.points)) record.points = input.points;
    return record;
}
