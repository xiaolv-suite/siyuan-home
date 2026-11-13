/**
 * 快速记录常用流水（车能耗、健康体征、家务打卡、待买、便签）底层数据保存引擎
 * 抽离自 quick-event-flow.svelte，消除 Svelte 5 编译庞大水合状态机与异步调度开销
 */

import { renderLedgerAll } from "./siyuan";
import {
    buildChoreLog,
    buildFuelingLog,
    buildVitalLog,
    composeLifelogIsoAt,
} from "./quick-actions";
import type { EnergyKind } from "./fuel";
import { appendEntry, updateRowLogs } from "./rowlog";
import { saveQuickDefaults } from "./quick-defaults";
import { writeLedgerRow } from "./ledger-writer";

export async function ensureModuleTargetRef(plugin: any, mod: string): Promise<any> {
    let r = plugin.settings.dbRefs?.[mod];
    if (!r?.avId) {
        await plugin.repairModule?.(mod);
        r = plugin.settings.dbRefs?.[mod];
    }
    if (!r?.avId) throw new Error(`缺少目标模块 ${mod} 的台账引用`);
    return r;
}

export function dispatchBackgroundSync(plugin: any, mod: string, nextLogs: any): void {
    queueMicrotask(async () => {
        try {
            const { syncModuleDocSection, syncDailyJournalDoc } = await import("./doc-sync");
            if (mod !== "shopping" && mod !== "snippets") {
                await syncModuleDocSection(plugin, mod, nextLogs);
            }
            await syncDailyJournalDoc(plugin, nextLogs);
        } catch { /* soft */ }
        try { await plugin.refreshHub?.([mod], true); } catch { /* soft */ }
    });
}

export interface QuickFuelingSaveParams {
    plugin: any;
    date: string;
    time: string;
    vehicleId: string;
    kind: EnergyKind;
    amount?: number;
    liters: number;
    mileage: number;
    unitPrice?: number;
    isFull?: boolean;
    fuelGrade?: string;
    chargingMode?: string;
}

export async function saveQuickFuelingRecord(params: QuickFuelingSaveParams): Promise<any> {
    const {
        plugin, date, time, vehicleId, kind, amount, liters,
        mileage, unitPrice, isFull = false, fuelGrade, chargingMode,
    } = params;
    const isCharging = kind === "charging";
    const log = buildFuelingLog({
        date,
        time,
        kind,
        amount,
        quantity: liters,
        mileage,
        unitPrice,
        full: isFull,
        fuelGrade: !isCharging ? fuelGrade : undefined,
        chargingMode: isCharging ? chargingMode : undefined,
    });
    const vRef = await ensureModuleTargetRef(plugin, "vehicles");
    const nextLogs = await updateRowLogs(plugin, (cur) =>
        appendEntry(cur, vRef.avId!, vehicleId, isCharging ? "chargings" : "fuelings", log as unknown as Record<string, unknown>));

    const fullText = isFull ? (isCharging ? "已充满" : "已加满") : "";
    const summaryNote = `最近${isCharging ? "充电" : "加油"}：${date} · ${liters}${isCharging ? "kWh" : "L"}${amount !== undefined ? ` · ¥${amount}` : ""}${fullText ? ` · ${fullText}` : ""} · ${mileage}km`;

    await writeLedgerRow({
        moduleId: "vehicles",
        target: vRef,
        itemId: vehicleId,
        name: "",
        fields: {
            ...(mileage ? { mileage } : {}),
            note: summaryNote,
        },
    });

    saveQuickDefaults(plugin, {
        fuelVehicleId: vehicleId,
        fuelKind: kind,
        ...(isCharging ? {
            chargingMode,
            chargePrice: unitPrice,
            chargeAmount: amount,
            chargeLiters: liters,
            chargeIsFull: isFull,
        } : {
            fuelGrade,
            fuelPrice: unitPrice,
            fuelAmount: amount,
            fuelLiters: liters,
            fuelIsFull: isFull,
        }),
    });

    return nextLogs;
}

export interface QuickVitalSaveParams {
    plugin: any;
    date: string;
    time: string;
    memberId: string;
    metricType: "bp" | "glucose" | "weight" | "temp";
    sys?: number;
    dia?: number;
    pulse?: number;
    glucose?: number;
    timing?: "fasting" | "postprandial";
    weight?: number;
    temp?: number;
}

export async function saveQuickVitalRecord(params: QuickVitalSaveParams): Promise<any> {
    const {
        plugin, date, time, memberId, metricType,
        sys, dia, pulse, glucose, timing, weight, temp,
    } = params;
    const readings = buildVitalLog({
        date,
        time,
        metricType,
        systolic: sys,
        diastolic: dia,
        pulse,
        glucose,
        glucoseTiming: timing,
        weight,
        temperature: temp,
    });
    const healthRef = await ensureModuleTargetRef(plugin, "health");
    const all = await renderLedgerAll(healthRef.avId!);
    let row = memberId
        ? (all.rows ?? []).find((r) => r.cells?.[healthRef.columns?.member ?? ""]?.relation?.blockIDs?.includes(memberId))
        : (all.rows?.[0]);
    const targetMember = plugin.settings.members?.find((m: any) => m.avItemId === memberId || m.id === memberId);
    const memberName = targetMember ? `${targetMember.name}健康档案` : "家庭健康档案";

    const summaryDiag = metricType === "bp" ? `血压 ${sys}/${dia} mmHg${pulse ? ` · 心率 ${pulse} bpm` : ""}`
        : metricType === "glucose" ? `${timing === "postprandial" ? "餐后" : "空腹"}血糖 ${glucose} mmol/L`
        : metricType === "weight" ? `体重 ${weight} kg`
        : `体温 ${temp} ℃`;

    const vitalFields = {
        member: memberId,
        category: "checkup",
        status: "following",
        date,
        diagnosis: summaryDiag,
        note: `${date} 录入：${summaryDiag}`,
    };

    if (!row) {
        const { itemID } = await writeLedgerRow({
            moduleId: "health",
            target: healthRef,
            name: memberName,
            members: plugin.settings.members,
            operationKey: `vital:init:${memberId || "default"}:${Date.now()}`,
            fields: vitalFields,
        });
        row = { itemID, cells: {} };
    } else {
        await writeLedgerRow({
            moduleId: "health",
            target: healthRef,
            itemId: row.itemID,
            name: "",
            members: plugin.settings.members,
            fields: vitalFields,
        });
    }

    const nextLogs = await updateRowLogs(plugin, (cur) => readings.reduce(
        (acc, reading) => appendEntry(acc, healthRef.avId!, row!.itemID, "vitals", reading as unknown as Record<string, unknown>), cur));

    saveQuickDefaults(plugin, {
        vitalMemberId: memberId,
        vitalMetricType: metricType,
    });

    // 跨插件联邦联动：体征录入打卡自动协同（Epoch 6 标准）
    queueMicrotask(async () => {
        try {
            const { logCheckinEventSafely } = await import("@/libs/ecosystem-bridge-kit");
            const matchedBinding = (plugin.settings?.checkinBindings ?? []).find(
                (b: any) => (!b.memberId || b.memberId === memberId) && (b.metric === metricType || b.itemId?.includes(metricType))
            ) || (plugin.settings?.checkinBindings ?? []).find(
                (b: any) => !b.memberId || b.memberId === memberId
            );
            const targetItemId = matchedBinding?.itemId || `home_health_${metricType}`;
            await logCheckinEventSafely({
                itemId: targetItemId,
                value: metricType === "weight" ? weight : metricType === "glucose" ? glucose : 1,
                unit: metricType === "weight" ? "kg" : metricType === "glucose" ? "mmol/L" : "次",
                externalRef: `home:health:${row?.itemID || "vital"}:${date}`,
                note: `${memberName} ${summaryDiag}`,
                occurredAt: `${date}T${time || "08:00"}:00.000Z`,
            });
        } catch { /* 优雅降级 */ }
    });

    return nextLogs;
}

export interface QuickChoreSaveParams {
    plugin: any;
    date: string;
    time: string;
    choreRowId: string;
    memberIds: string[];
    points?: number;
    note?: string;
}

export async function saveQuickChoreRecord(params: QuickChoreSaveParams): Promise<any> {
    const { plugin, date, time, choreRowId, memberIds, points, note = "" } = params;
    const choreRef = await ensureModuleTargetRef(plugin, "chores");
    const log = buildChoreLog({
        date,
        time,
        memberId: memberIds.length > 0 ? memberIds.join(",") : undefined,
        points,
        note,
    });
    const nextLogs = await updateRowLogs(plugin, (cur) =>
        appendEntry(cur, choreRef.avId!, choreRowId, "chexecs", log));

    const whoNames = (plugin.settings.members ?? [])
        .filter((m: any) => memberIds.includes(m.id))
        .map((m: any) => m.name);
    const whoSummary = whoNames.length > 0 ? whoNames.join("、") : "";
    const summaryNote = `上次完成：${date}${whoSummary ? ` · ${whoSummary}` : ""}${points ? ` · +${points}积分` : ""}${note ? ` (${note})` : ""}`;

    await writeLedgerRow({
        moduleId: "chores",
        target: choreRef,
        itemId: choreRowId,
        name: "",
        fields: {
            date,
            member: memberIds.length > 1 ? memberIds : (memberIds[0] || ""),
            note: summaryNote,
        },
    });

    saveQuickDefaults(plugin, {
        choreRowId,
        choreMemberId: memberIds[0],
        choreMemberIds: memberIds,
    });

    // 跨插件联邦联动：家务打卡自动协同打卡连击（Epoch 6 标准）
    queueMicrotask(async () => {
        try {
            const { logCheckinEventSafely } = await import("@/libs/ecosystem-bridge-kit");
            const primaryMemberId = memberIds[0];
            const matchedBinding = (plugin.settings?.checkinBindings ?? []).find(
                (b: any) => (!b.memberId || b.memberId === primaryMemberId)
            );
            const targetItemId = matchedBinding?.itemId || `home_chores_${choreRowId}`;
            await logCheckinEventSafely({
                itemId: targetItemId,
                value: points || 1,
                unit: points ? "分" : "次",
                externalRef: `home:chores:${choreRowId}:${date}`,
                note: note ? `家务打卡：${note}` : "家务打卡完成",
                occurredAt: `${date}T${time || "12:00"}:00.000Z`,
            });
        } catch { /* 优雅降级 */ }
    });

    return nextLogs;
}

export interface QuickShoppingSaveParams {
    plugin: any;
    date: string;
    time: string;
    name: string;
    qty: number;
    price?: number;
    category: string;
}

export async function saveQuickShoppingRecord(params: QuickShoppingSaveParams): Promise<any> {
    const { plugin, date, time, name, qty, price, category } = params;
    const normalizedCategory = category === "food" ? "food_sh" : category === "other" ? "other_sh" : (category || "daily");
    const shopRef = await ensureModuleTargetRef(plugin, "shopping");
    const { itemID } = await writeLedgerRow({
        moduleId: "shopping",
        target: shopRef,
        name,
        operationKey: `quick:shop:${Date.now()}`,
        fields: {
            qty: qty || 1,
            date,
            category: normalizedCategory,
            ...(price ? { price } : {}),
        },
    });
    const nextLogs = await updateRowLogs(plugin, (cur) => appendEntry(cur, shopRef.avId!, itemID, "quickflows", {
        kind: "shopping",
        date,
        time,
        title: name,
        qty: qty || 1,
        price,
        category: normalizedCategory,
        at: composeLifelogIsoAt(date, time),
    }));

    saveQuickDefaults(plugin, {
        shoppingCategory: normalizedCategory,
    });

    return nextLogs;
}

export interface QuickSnippetSaveParams {
    plugin: any;
    date: string;
    time: string;
    text: string;
    tag: string;
}

export async function saveQuickSnippetRecord(params: QuickSnippetSaveParams): Promise<any> {
    const { plugin, date, time, text, tag } = params;
    const snipRef = await ensureModuleTargetRef(plugin, "snippets");
    const title = text.slice(0, 30);
    const { itemID } = await writeLedgerRow({
        moduleId: "snippets",
        target: snipRef,
        name: title,
        operationKey: `quick:snip:${Date.now()}`,
        fields: {
            content: text,
            category: "other_sn",
            note: text,
        },
    });
    const nextLogs = await updateRowLogs(plugin, (cur) => appendEntry(cur, snipRef.avId!, itemID, "quickflows", {
        kind: "snippet",
        date,
        time,
        title,
        detail: text,
        tag,
        at: composeLifelogIsoAt(date, time),
    }));

    saveQuickDefaults(plugin, {
        snippetTag: tag,
    });

    return nextLogs;
}
