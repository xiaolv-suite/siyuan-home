/**
 * 一键梯度推迟（Tasks.org 标杆规格：One-Tap Snooze Presets）。
 *
 * 提供零思考梯度推迟：
 * 1. 推迟 1 天（明天的此时）
 * 2. 推迟至周末（本周六；若今天已是周六/周日，则顺延至下周六）
 * 3. 推迟至下周一（下个星期一）
 */

import { addDays, localDateKey } from "./hub/rule";

export type SnoozePresetId = "1d" | "weekend" | "next_monday";

export interface SnoozePreset {
    id: SnoozePresetId;
    labelKey: string;
    days: number;
    targetDate: string; // yyyy-MM-dd
}

/**
 * 计算梯度推迟目标日期与天数
 */
export function calculateSnoozeTarget(presetId: SnoozePresetId, today: Date = new Date()): { targetDate: string; days: number } {
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayOfWeek = today0.getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat

    if (presetId === "1d") {
        const target = addDays(today0, 1);
        return { targetDate: localDateKey(target), days: 1 };
    }

    if (presetId === "weekend") {
        // 周末：目标为周六 (day=6)
        // 若今天为周一(1) -> +5 天；周五(5) -> +1 天；周六(6)或周日(0) -> 下周六
        let days = (6 - dayOfWeek + 7) % 7;
        if (days === 0) days = 7;
        const target = addDays(today0, days);
        return { targetDate: localDateKey(target), days };
    }

    if (presetId === "next_monday") {
        // 下周一：目标为周一 (day=1)
        // 若今天为周一(1) -> 下周一 +7 天；周五(5) -> +3 天；周日(0) -> 明天 +1 天
        let days = (1 - dayOfWeek + 7) % 7;
        if (days === 0) days = 7;
        const target = addDays(today0, days);
        return { targetDate: localDateKey(target), days };
    }

    const fallback = addDays(today0, 1);
    return { targetDate: localDateKey(fallback), days: 1 };
}

/**
 * 获取当前所有一键梯度推迟预设
 */
export function getSnoozePresets(today: Date = new Date()): SnoozePreset[] {
    const p1 = calculateSnoozeTarget("1d", today);
    const pw = calculateSnoozeTarget("weekend", today);
    const pm = calculateSnoozeTarget("next_monday", today);

    return [
        { id: "1d", labelKey: "act.snooze1d", days: p1.days, targetDate: p1.targetDate },
        { id: "weekend", labelKey: "act.snoozeWeekend", days: pw.days, targetDate: pw.targetDate },
        { id: "next_monday", labelKey: "act.snoozeNextMonday", days: pm.days, targetDate: pm.targetDate },
    ];
}
