import { localDateKey } from "./rule";
import type { HubRuntime, ReminderNamedView } from "./runtime";

/**
 * 提醒命名视图、计划处理日（双日期排期）与置顶状态管理引擎
 */

/**
 * 保存或更新命名视图（§17 命名视图切换与跨会话持久化）
 */
export function saveNamedView(
    runtime: HubRuntime,
    view: Omit<ReminderNamedView, "id"> & { id?: string },
): ReminderNamedView {
    runtime.namedViews = runtime.namedViews ?? [];
    const id = view.id || `view-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const saved: ReminderNamedView = {
        id,
        name: view.name.trim(),
        filter: view.filter,
        memberId: view.memberId,
        moduleId: view.moduleId,
        dueWithin: view.dueWithin,
    };
    const index = runtime.namedViews.findIndex((v) => v.id === id);
    if (index >= 0) {
        runtime.namedViews[index] = saved;
    } else {
        runtime.namedViews.push(saved);
    }
    runtime.activeNamedViewId = id;
    return saved;
}

/**
 * 删除命名视图
 */
export function removeNamedView(runtime: HubRuntime, id: string): boolean {
    if (!runtime.namedViews) return false;
    const initialLen = runtime.namedViews.length;
    runtime.namedViews = runtime.namedViews.filter((v) => v.id !== id);
    if (runtime.activeNamedViewId === id) {
        runtime.activeNamedViewId = undefined;
    }
    return runtime.namedViews.length < initialLen;
}

/**
 * 应用命名视图到 runtime 筛选状态
 */
export function applyNamedView(runtime: HubRuntime, view: ReminderNamedView): void {
    runtime.hubFilter = view.filter;
    runtime.hubMemberId = view.memberId;
    runtime.hubModuleId = view.moduleId;
    runtime.hubDueWithin = view.dueWithin;
    runtime.activeNamedViewId = view.id;
}

export interface ReminderPlanStatus {
    hasPlan: boolean;
    planDate?: string;
    isOverdueDeadline: boolean;
    isPlannedNow: boolean;
    planDaysDiff?: number;
}

/** 设置提醒计划处理日（§17/284波 双日期模式） */
export function setReminderPlanDate(runtime: HubRuntime, id: string, date: string): void {
    runtime.planDates = runtime.planDates ?? {};
    runtime.planDates[id] = date.trim();
}

/** 清除提醒计划处理日 */
export function clearReminderPlanDate(runtime: HubRuntime, id: string): boolean {
    if (!runtime.planDates || !runtime.planDates[id]) return false;
    delete runtime.planDates[id];
    return true;
}

/** 计算提醒的双日期状态与计划偏离度 */
export function getReminderPlanStatus(
    today: string,
    dueDate: string,
    planDate?: string,
): ReminderPlanStatus {
    const isOverdueDeadline = today > dueDate;
    if (!planDate || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
        return {
            hasPlan: false,
            isOverdueDeadline,
            isPlannedNow: false,
        };
    }

    const [ty, tm, td] = today.split("-").map(Number);
    const [py, pm, pd] = planDate.split("-").map(Number);
    const todayTime = new Date(ty, (tm ?? 1) - 1, td ?? 1).getTime();
    const planTime = new Date(py, (pm ?? 1) - 1, pd ?? 1).getTime();
    const planDaysDiff = Math.round((planTime - todayTime) / (24 * 60 * 60 * 1000));

    const isPlannedNow = today >= planDate && !isOverdueDeadline;

    return {
        hasPlan: true,
        planDate,
        isOverdueDeadline,
        isPlannedNow,
        planDaysDiff,
    };
}

/**
 * 切换提醒置顶状态（304波）：支持任意重要提醒（证件/合同/台账/备忘）
 */
export function toggleReminderPinInRuntime(runtime: HubRuntime, reminderId: string): boolean {
    runtime.pinnedReminderIds = runtime.pinnedReminderIds ?? [];
    const idx = runtime.pinnedReminderIds.indexOf(reminderId);
    if (idx >= 0) {
        runtime.pinnedReminderIds.splice(idx, 1);
        return false;
    }
    runtime.pinnedReminderIds.push(reminderId);
    return true;
}

/**
 * 判断指定提醒是否处于置顶状态（兼容旧版 pinnedMemoIds 与通用 pinnedReminderIds）
 */
export function isReminderPinned(runtime: HubRuntime | undefined, reminder: { id: string; moduleId?: string }): boolean {
    if (!runtime) return false;
    if (runtime.pinnedReminderIds && runtime.pinnedReminderIds.includes(reminder.id)) return true;
    const memoId = reminder.id.startsWith("adhoc::") ? reminder.id.slice("adhoc::".length) : reminder.id;
    return (runtime.pinnedMemoIds ?? []).includes(memoId);
}

/**
 * 批量将一组提醒一键推入今日计划排期（标记为今日专注事项）
 */
export function batchPushRemindersToTodayPlan(
    runtime: HubRuntime,
    reminderIds: string[],
    today: string = localDateKey(new Date())
): number {
    runtime.planDates = runtime.planDates ?? {};
    let count = 0;
    for (const id of reminderIds) {
        if (!id) continue;
        runtime.planDates[id] = today;
        count++;
    }
    return count;
}
