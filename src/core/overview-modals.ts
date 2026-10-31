/**
 * 总览主屏专业分析与成就报告模态框分发中枢
 * 包含：家庭年度生活指数、急救与应急联络卡、年度生活回顾长图与里程碑分享卡
 */

import type { Reminder } from "@/types";
import { localDateKey } from "./hub/rule";

export interface OverviewModalContext {
    plugin: any;
    allReminders: Reminder[];
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
}

/** 300波里程碑：家庭年度生活指数与幸福资产盘点 */
export async function openLifeIndexModal(ctx: OverviewModalContext): Promise<void> {
    const { plugin, allReminders, t, DialogCls, showMessageFn } = ctx;
    try {
        const { collectFamilyLifeContext, calculateFamilyLifeIndex, openLifeIndexDialog } = await import("./life-index");
        const lifeContext = await collectFamilyLifeContext(plugin, allReminders, localDateKey(new Date()));
        const report = calculateFamilyLifeIndex(lifeContext);
        openLifeIndexDialog(report, t, DialogCls, showMessageFn, lifeContext.failedModules);
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
    }
}

/** 318波：家庭急救与应急联络卡 */
export async function openEmergencyCardModal(ctx: OverviewModalContext): Promise<void> {
    const { plugin, t, DialogCls, showMessageFn } = ctx;
    try {
        const { openEmergencyCardDialog } = await import("./emergency-card-dialog");
        const { renderLedgerAll } = await import("./siyuan");
        const { cellContentText } = await import("./avcell");
        await openEmergencyCardDialog({
            t,
            plugin,
            DialogCls,
            showMessageFn,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellContentText,
        });
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
    }
}

/** 322波：总览主屏一键直达全模块「📍 东西放哪了」存放位置速查（直接打开弹窗，无需切去台账屏竞态派发事件） */
export async function openLocationSearchModal(ctx: OverviewModalContext): Promise<void> {
    const { plugin, t, DialogCls, showMessageFn } = ctx;
    try {
        const { openLocationIndexDialog } = await import("./location-dialog");
        const { renderLedgerAll } = await import("./siyuan");
        const { cellContentText } = await import("./avcell");
        await openLocationIndexDialog({
            t,
            plugin,
            DialogCls,
            showMessageFn,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellContentText,
        });
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
    }
}

/** 320波：家庭生活年度回顾长图与里程碑卡片 */
export async function openYearlyShareCardModal(ctx: OverviewModalContext): Promise<void> {
    const { plugin, allReminders, t, DialogCls, showMessageFn } = ctx;
    try {
        const { openYearlyShareCardDialog } = await import("./sharecard-dialog");
        const { renderLedgerAll } = await import("./siyuan");
        const { cellContentText } = await import("./avcell");
        await openYearlyShareCardDialog({
            t,
            plugin,
            allReminders,
            DialogCls,
            showMessageFn,
            renderLedgerAllFn: renderLedgerAll,
            cellTextFn: cellContentText,
        });
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
    }
}
