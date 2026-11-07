/**
 * 快速生活流水动作（Quick Event Actions）：
 * 区分“实体资产/长期档案建档（一次性，低频）”与“日常高频流水录入（加油/充放电/生理指标/家务打卡）”。
 * 产出的流水对象与车辆抽屉（EnergyRecord）、健康抽屉（VitalReading）、家务轮换（chexecs）
 * 读取的是同一种结构——快速记录与抽屉录入不再各写一套字段。
 * 纯函数，100% 可单元测试。
 */
import type { EnergyKind, EnergyRecord } from "./fuel";
import type { VitalReading } from "./vitals";
import { localDateKey } from "./hub/rule";

export interface QuickFuelingInput {
    date: string; // YYYY-MM-DD
    /** 可选 HH:mm 本地时间（用于生成标准 LifeLog 时间戳） */
    time?: string;
    kind: EnergyKind;
    /** 当前总里程（公里），油耗/电耗统计必需 */
    mileage: number;
    /** 加油升数或充电度数，统计必需 */
    quantity: number;
    /** 总费用（元），可省略 */
    amount?: number;
    /** 单价（元/升或元/kWh） */
    unitPrice?: number;
    /** 是否加满/充满 */
    full?: boolean;
    fuelGrade?: string;
    chargingMode?: string;
    station?: string;
    note?: string;
}

export interface QuickVitalInput {
    date: string; // YYYY-MM-DD
    /** 可选 HH:mm 本地时间（用于生成标准 LifeLog 时间戳） */
    time?: string;
    metricType: "bp" | "glucose" | "weight" | "temp"; // 血压/血糖/体重/体温
    systolic?: number; // 收缩压
    diastolic?: number; // 舒张压
    glucose?: number; // 血糖值
    glucoseTiming?: "fasting" | "postprandial";
    pulse?: number; // 脉搏
    weight?: number; // 体重 (kg)
    temperature?: number; // 体温 (℃)
    note?: string;
}

export interface QuickChoreInput {
    date: string;
    /** 可选 HH:mm 本地时间（用于生成标准 LifeLog 时间戳） */
    time?: string;
    /** settings 成员 id（与家务抽屉、积分结算同一 ID 空间） */
    memberId?: string;
    points?: number;
    note?: string;
}

/** 获取当前本地时间的 HH:mm 字符串（LifeLog 标准 24 小时制行首格式） */
export function currentLocalHHMM(now = new Date()): string {
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** 归一化 HH:mm 时间；若未传则从 ISO 时间戳提取本地 HH:mm，再兜底当前时刻 */
export function normalizeLifelogTime(time?: unknown, fallbackIso?: unknown): string {
    if (typeof time === "string") {
        const m = time.trim().match(/^(\d{1,2}):(\d{2})/);
        if (m) {
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
                return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
            }
        }
    }
    if (typeof fallbackIso === "string" && fallbackIso.trim()) {
        const d = new Date(fallbackIso);
        if (!Number.isNaN(d.getTime())) {
            return currentLocalHHMM(d);
        }
    }
    return "09:00";
}

/** 将 YYYY-MM-DD 与可选 HH:mm 合成为带准确本地时刻的 ISO 字符串 */
export function composeLifelogIsoAt(dateStr: string, timeStr?: string, now = new Date()): string {
    const m = typeof timeStr === "string" ? timeStr.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
    if (m && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const hh = Number(m[1]);
        const mm = Number(m[2]);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
            const sec = String(now.getSeconds()).padStart(2, "0");
            const composed = new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${sec}`);
            if (!Number.isNaN(composed.getTime())) return composed.toISOString();
        }
    }
    return now.toISOString();
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

/** 血压/血糖/体重/体温输入校验：返回缺失的字段 key，空数组表示可提交 */
export function validateVitalInput(input: Partial<QuickVitalInput>): Array<"systolic" | "diastolic" | "glucose" | "weight" | "temperature"> {
    if (input.metricType === "glucose") return positive(input.glucose) ? [] : ["glucose"];
    if (input.metricType === "weight") return positive(input.weight) ? [] : ["weight"];
    if (input.metricType === "temp") return positive(input.temperature) ? [] : ["temperature"];
    const missing: Array<"systolic" | "diastolic"> = [];
    if (!positive(input.systolic)) missing.push("systolic");
    if (!positive(input.diastolic)) missing.push("diastolic");
    return missing;
}

/** 构建加油/充电流水（EnergyRecord，与车辆抽屉录入同结构） */
export function buildFuelingLog(input: QuickFuelingInput): EnergyRecord {
    const date = input.date || localDateKey();
    const at = composeLifelogIsoAt(date, input.time);
    const record: EnergyRecord & { time?: string } = {
        kind: input.kind,
        date,
        at,
        odometer: input.mileage,
        quantity: input.quantity,
    };
    if (input.time) record.time = normalizeLifelogTime(input.time, at);
    if (typeof input.amount === "number" && Number.isFinite(input.amount)) record.totalCost = input.amount;
    if (typeof input.unitPrice === "number" && Number.isFinite(input.unitPrice)) record.unitPrice = input.unitPrice;
    if (typeof input.full === "boolean") record.full = input.full;
    if (input.fuelGrade) record.fuelGrade = input.fuelGrade;
    if (input.chargingMode) record.chargingMode = input.chargingMode;
    if (input.station?.trim()) record.station = input.station.trim();
    if (input.note?.trim()) record.note = input.note.trim();
    return record;
}

/** 构建生理指标读数（VitalReading[]，与健康抽屉录入同结构；血压附带脉搏时额外记一条心率） */
export function buildVitalLog(input: QuickVitalInput): VitalReading[] {
    const date = input.date || localDateKey();
    const at = composeLifelogIsoAt(date, input.time);
    const time = input.time ? normalizeLifelogTime(input.time, at) : undefined;
    const note = input.note?.trim() || undefined;
    const extra = { at, ...(time ? { time } : {}), ...(note ? { note } : {}) };
    const readings: Array<VitalReading & { time?: string; pulse?: number; weight?: number; temperature?: number }> = [];
    if (input.metricType === "glucose") {
        if (positive(input.glucose)) {
            readings.push({ date, type: "bg", val1: input.glucose, val2: input.glucoseTiming === "postprandial" ? 1 : 0, ...extra });
        }
        return readings;
    }
    if (input.metricType === "weight") {
        if (positive(input.weight)) {
            readings.push({ date, type: "weight", val1: input.weight, weight: input.weight, ...extra });
        }
        return readings;
    }
    if (input.metricType === "temp") {
        if (positive(input.temperature)) {
            readings.push({ date, type: "temp", val1: input.temperature, temperature: input.temperature, ...extra });
        }
        return readings;
    }
    if (positive(input.systolic)) {
        readings.push({
            date,
            type: "bp",
            val1: input.systolic,
            ...(positive(input.diastolic) ? { val2: input.diastolic } : {}),
            ...(positive(input.pulse) ? { pulse: input.pulse } : {}),
            ...extra,
        });
    }
    if (positive(input.pulse)) readings.push({ date, type: "hr", val1: input.pulse, at, ...(time ? { time } : {}) });
    return readings;
}

/** 构建家务打卡记录（chexecs，与家务轮换抽屉同结构；积分结算按 points 汇总） */
export function buildChoreLog(input: QuickChoreInput): Record<string, unknown> {
    const date = input.date || localDateKey();
    const at = composeLifelogIsoAt(date, input.time);
    const record: Record<string, unknown> = {
        date,
        at,
    };
    if (input.time) record.time = normalizeLifelogTime(input.time, at);
    if (input.memberId) record.memberId = input.memberId;
    if (input.note?.trim()) record.note = input.note.trim();
    if (positive(input.points)) record.points = input.points;
    return record;
}
