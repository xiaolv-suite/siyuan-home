/**
 * 快速记录常用流水（车能耗、健康体征、家务打卡、待买、便签）底层数据保存引擎
 * 抽离自 quick-event-flow.svelte，消除 Svelte 5 编译庞大水合状态机与异步调度开销
 */

import { renderLedgerAll, newSiYuanId } from "./siyuan";
import { verifyAvRefBound } from "./provision-common";
import { DiaryShardWriteError, recordHighFrequencyDiaryEvent, type RecordDiaryEventInput } from "./diary-envelope";
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
import { syncVehicleSummaryToAv } from "./vehicle-summary-sync";
import { syncModuleDocSection } from "./doc-sync";
import { homeNotify } from "@/libs/notice";

function warnIfPartialFields(failed: string[], context: string): void {
    if (!failed || failed.length === 0) return;
    try {
        homeNotify(`${context}：行已保存，但部分字段写入失败（${failed.join(", ")}）`, 5000, "error");
    } catch { /* ignore */ }
}

async function recordDiarySafely(
    plugin: any,
    input: RecordDiaryEventInput,
): Promise<{ eventId: string; blockId: string; docId: string } | undefined> {
    try {
        return await recordHighFrequencyDiaryEvent(plugin, input);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[LvHome] recordHighFrequencyDiaryEvent failed:", msg);
        if (err instanceof DiaryShardWriteError && err.blockId && err.eventId && err.docId) {
            try { homeNotify(`日记块已写入，但同步分片写入失败：${msg}`, 5000, "error"); } catch { /* ignore */ }
            return { eventId: err.eventId, blockId: err.blockId, docId: err.docId };
        }
        return undefined;
    }
}

export async function ensureModuleTargetRef(
    plugin: any,
    mod: string,
    options: { autoEnable?: boolean } = {},
): Promise<any> {
    if (options.autoEnable && Array.isArray(plugin.settings?.enabledModules) && !plugin.settings.enabledModules.includes(mod)) {
        plugin.settings.enabledModules = [...plugin.settings.enabledModules, mod];
        try {
            const { saveSettings } = await import("./settings");
            await saveSettings(plugin, plugin.settings);
        } catch { /* soft */ }
    }
    let r = plugin.settings.dbRefs?.[mod];
    if (!r?.avId) {
        await plugin.repairModule?.(mod);
        r = plugin.settings.dbRefs?.[mod];
    }
    if (!r?.avId) throw new Error(`缺少目标模块 ${mod} 的台账引用`);
    await verifyAvRefBound(r);
    return r;
}

export function dispatchBackgroundSync(plugin: any, mod: string, _nextLogs?: any): void {
    queueMicrotask(async () => {
        // updateRowLogs() 已通过 rowLogSyncHook 完成台账文档同步与今日日记单一增量写入，此处仅刷新中枢视图
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
    liters?: number;
    mileage?: number;
    unitPrice?: number;
    isFull?: boolean;
    fuelGrade?: string;
    chargingMode?: string;
    note?: string;
    createHistoryDiaryDoc?: boolean;
}

export async function saveQuickFuelingRecord(params: QuickFuelingSaveParams): Promise<any> {
    const {
        plugin, date, time, vehicleId, kind, amount, liters = 0,
        mileage = 0, unitPrice, isFull = false, fuelGrade, chargingMode, note,
        createHistoryDiaryDoc,
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
        note,
    });
    const vRef = await ensureModuleTargetRef(plugin, "vehicles", { autoEnable: true });
    const diaryEventId = `evt-${newSiYuanId()}`;
    const fullText = isFull ? (isCharging ? "已充满" : "已加满") : "";
    const qtyPart = liters > 0 ? `${liters}${isCharging ? "kWh" : "L"}` : "";
    const amtPart = amount !== undefined ? `¥${amount.toFixed(2)}` : "";
    const milePart = mileage > 0 ? `(${mileage}km)` : "";
    const notePart = note?.trim() ? note.trim() : "";
    const detailParts = [qtyPart, amtPart, fullText, notePart].filter(Boolean).join(" · ");
    const lineText = `${time || "00:00"} ${isCharging ? "🚗 车辆充电" : "🚗 车辆加油"}${detailParts ? `：${detailParts}` : ""}${milePart ? ` ${milePart}` : ""} #车辆 #${isCharging ? "充电" : "加油"}`;

    const diaryRes = await recordDiarySafely(plugin, {
        eventId: diaryEventId,
        module: "vehicles",
        action: isCharging ? "charging" : "fuel",
        target: vehicleId,
        avId: vRef.avId,
        bizDate: date,
        recordedAt: new Date().toISOString(),
        text: lineText,
        amount: amount !== undefined ? amount.toFixed(2) : undefined,
        quantity: liters > 0 ? liters : undefined,
        odometer: mileage > 0 ? mileage : undefined,
        createHistoryDiaryDoc,
    });

    const logWithDiary: Record<string, unknown> = {
        ...(log as unknown as Record<string, unknown>),
        ...(diaryRes ? { diaryEventId: diaryRes.eventId, diaryBlockId: diaryRes.blockId, diaryDocId: diaryRes.docId } : {}),
    };
    const nextLogs = await updateRowLogs(plugin, (cur) =>
        appendEntry(cur, vRef.avId!, vehicleId, isCharging ? "chargings" : "fuelings", logWithDiary));

    let currentMileage: number | undefined;
    if (vRef.avId && vRef.columns?.mileage) {
        try {
            const allVehicles = await renderLedgerAll(vRef.avId);
            const currentRow = allVehicles.rows.find((r) => r.itemID === vehicleId);
            const mileageCell = currentRow?.cells?.[vRef.columns.mileage];
            if (
                mileageCell?.number?.isNotEmpty !== false &&
                typeof mileageCell?.number?.content === "number" &&
                Number.isFinite(mileageCell.number.content)
            ) {
                currentMileage = mileageCell.number.content;
            }
        } catch { /* soft */ }
    }
    const shouldWriteMileage =
        typeof mileage === "number" &&
        Number.isFinite(mileage) &&
        mileage > 0 &&
        (currentMileage === undefined || mileage > currentMileage);

    await syncVehicleSummaryToAv(plugin, vehicleId, nextLogs, {
        mileage: shouldWriteMileage ? mileage : undefined,
        vRef,
    });
    await syncModuleDocSection(plugin, "vehicles", nextLogs).catch(() => undefined);

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

    const bpText = sys && dia ? `${sys}/${dia}` : sys ? `${sys}` : dia ? `${dia}` : "";
    const summaryDiag = metricType === "bp" ? `血压 ${bpText} mmHg${pulse ? ` · 心率 ${pulse} bpm` : ""}`
        : metricType === "glucose" ? `${timing === "postprandial" ? "餐后" : "空腹"}血糖 ${glucose} mmol/L`
        : metricType === "weight" ? `体重 ${weight} kg`
        : `体温 ${temp} ℃`;

    const vitalFields = {
        member: memberId,
        category: "checkup",
        status: "following",
        date,
        diagnosis: summaryDiag,
    };

    if (!row) {
        const writeRes = await writeLedgerRow({
            moduleId: "health",
            target: healthRef,
            name: memberName,
            plugin,
            members: plugin.settings?.members,
            operationKey: `vital:init:${memberId || "default"}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            fields: vitalFields,
        });
        warnIfPartialFields(writeRes.failed, "健康体征");
        row = { itemID: writeRes.itemID, cells: {} };
    } else {
        const writeRes = await writeLedgerRow({
            moduleId: "health",
            target: healthRef,
            itemId: row.itemID,
            name: "",
            plugin,
            members: plugin.settings?.members,
            operationKey: `vital:upd:${row.itemID}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            fields: vitalFields,
        });
        warnIfPartialFields(writeRes.failed, "健康体征");
    }

    const vitalDiaryRes = await recordDiarySafely(plugin, {
        module: "health",
        action: `vital-${metricType}`,
        target: row.itemID,
        avId: healthRef.avId,
        bizDate: date,
        recordedAt: new Date().toISOString(),
        text: `${time || "00:00"} 🩺 ${memberName} · ${summaryDiag} #健康 #体征`,
    });

    const nextLogs = await updateRowLogs(plugin, (cur) => readings.reduce(
        (acc, reading) => appendEntry(acc, healthRef.avId!, row!.itemID, "vitals", {
            ...(reading as unknown as Record<string, unknown>),
            ...(vitalDiaryRes ? { diaryEventId: vitalDiaryRes.eventId, diaryBlockId: vitalDiaryRes.blockId, diaryDocId: vitalDiaryRes.docId } : {}),
        }), cur));

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
                occurredAt: composeLifelogIsoAt(date, time || "08:00"),
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
    const whoNames = (plugin.settings.members ?? [])
        .filter((m: any) => memberIds.includes(m.id))
        .map((m: any) => m.name);
    const whoSummary = whoNames.length > 0 ? whoNames.join("、") : "";

    const choreDiaryRes = await recordDiarySafely(plugin, {
        module: "chores",
        action: "chore-done",
        target: choreRowId,
        avId: choreRef.avId,
        bizDate: date,
        recordedAt: new Date().toISOString(),
        text: `${time || "00:00"} 🧹 家务打卡${whoSummary ? ` · ${whoSummary}` : ""}${points ? ` · +${points}积分` : ""}${note ? ` (${note})` : ""} #家务`,
    });

    const nextLogs = await updateRowLogs(plugin, (cur) =>
        appendEntry(cur, choreRef.avId!, choreRowId, "chexecs", {
            ...log,
            ...(choreDiaryRes ? { diaryEventId: choreDiaryRes.eventId, diaryBlockId: choreDiaryRes.blockId, diaryDocId: choreDiaryRes.docId } : {}),
        }));

    const choreWriteRes = await writeLedgerRow({
        moduleId: "chores",
        target: choreRef,
        itemId: choreRowId,
        name: "",
        plugin,
        members: plugin.settings?.members,
        operationKey: `quick:chore:${choreRowId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        fields: {
            date,
            member: memberIds.length > 1 ? memberIds : (memberIds[0] || ""),
        },
    });
    warnIfPartialFields(choreWriteRes.failed, "家务打卡");

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
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("数量必须大于 0");
    }
    if (price !== undefined && price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
        throw new Error("单价不能小于 0");
    }
    const normalizedCategory = category === "food" ? "food_sh" : category === "other" ? "other_sh" : (category || "daily");
    const shopRef = await ensureModuleTargetRef(plugin, "shopping");
    const { itemID, failed: shopFailed } = await writeLedgerRow({
        moduleId: "shopping",
        target: shopRef,
        name,
        plugin,
        members: plugin.settings?.members,
        operationKey: `quick:shop:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        fields: {
            qty: qty || 1,
            date,
            category: normalizedCategory,
            ...(price !== undefined && price !== null ? { price } : {}),
        },
    });
    warnIfPartialFields(shopFailed, "待买清单");
    const shopDiaryRes = await recordDiarySafely(plugin, {
        module: "shopping",
        action: "quick-shop",
        target: itemID,
        avId: shopRef.avId,
        bizDate: date,
        recordedAt: new Date().toISOString(),
        text: `${time || "00:00"} 🛒 待买清单：${name} ×${qty || 1}${price ? ` · ¥${price}` : ""} #购物`,
        amount: price ? String(price) : undefined,
        quantity: qty || 1,
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
        ...(shopDiaryRes ? { diaryEventId: shopDiaryRes.eventId, diaryBlockId: shopDiaryRes.blockId, diaryDocId: shopDiaryRes.docId } : {}),
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
    linkedVehicleId?: string;
    linkedVehicleName?: string;
}

export async function saveQuickSnippetRecord(params: QuickSnippetSaveParams): Promise<any> {
    const { plugin, date, time, text, tag, linkedVehicleId, linkedVehicleName } = params;
    const snipRef = await ensureModuleTargetRef(plugin, "snippets");
    const title = text.slice(0, 30);
    const { itemID, failed: snipFailed } = await writeLedgerRow({
        moduleId: "snippets",
        target: snipRef,
        name: title,
        plugin,
        members: plugin.settings?.members,
        operationKey: `quick:snip:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        fields: {
            content: text,
            category: "other_sn",
            note: linkedVehicleName ? `[关联车辆: ${linkedVehicleName}] ${text}` : text,
        },
    });
    warnIfPartialFields(snipFailed, "随手便签");

    const trimmedVehicleId = linkedVehicleId?.trim() || "";
    const vRef = trimmedVehicleId ? (plugin.settings?.dbRefs?.vehicles ?? await ensureModuleTargetRef(plugin, "vehicles").catch(() => undefined)) : undefined;
    const isLinkedToVehicle = Boolean(trimmedVehicleId);
    const baseTag = (tag || "#随手记").trim();
    const vehicleTagNeeded = isLinkedToVehicle && !text.includes("#车辆") && !baseTag.includes("#车辆");
    const effectiveTag = vehicleTagNeeded ? `${baseTag} #车辆`.trim() : baseTag;
    const vehiclePrefix = isLinkedToVehicle && linkedVehicleName ? `${linkedVehicleName} · ` : "";
    const diaryText = isLinkedToVehicle
        ? `${time || "00:00"} 🚗 ${vehiclePrefix}${text} ${effectiveTag}`
        : `${time || "00:00"} 📎 ${text} ${effectiveTag}`;

    const snipDiaryRes = await recordDiarySafely(plugin, {
        module: isLinkedToVehicle ? "vehicles" : "snippets",
        action: isLinkedToVehicle ? "note" : "memo",
        target: isLinkedToVehicle ? trimmedVehicleId : itemID,
        avId: isLinkedToVehicle ? (vRef?.avId ?? snipRef.avId) : snipRef.avId,
        bizDate: date,
        recordedAt: new Date().toISOString(),
        text: diaryText,
        ...(isLinkedToVehicle ? { extraAttrs: { "custom-lv-linked-from": "snippets" } } : {}),
    });

    const at = composeLifelogIsoAt(date, time);
    const diaryMeta = snipDiaryRes
        ? { diaryEventId: snipDiaryRes.eventId, diaryBlockId: snipDiaryRes.blockId, diaryDocId: snipDiaryRes.docId }
        : {};
    const nextLogs = await updateRowLogs(plugin, (cur) => {
        let updated = appendEntry(cur, snipRef.avId!, itemID, "quickflows", {
            kind: "snippet",
            date,
            time,
            title,
            detail: text,
            tag: effectiveTag,
            ...(isLinkedToVehicle ? { linkedVehicleId: trimmedVehicleId, linkedVehicleName } : {}),
            at,
            ...diaryMeta,
        });
        if (isLinkedToVehicle && vRef?.avId) {
            updated = appendEntry(updated, vRef.avId, trimmedVehicleId, "quickflows", {
                kind: "vehicle-note",
                date,
                time,
                title,
                detail: text,
                tag: effectiveTag,
                at,
                ...diaryMeta,
            });
        }
        return updated;
    });
    if (isLinkedToVehicle) {
        await syncModuleDocSection(plugin, "vehicles", nextLogs).catch(() => undefined);
    }

    saveQuickDefaults(plugin, {
        snippetTag: tag,
    });

    return nextLogs;
}
