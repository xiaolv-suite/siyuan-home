/**
 * 重点到期卡片化通知引擎 (Priority Reminder Delivery)
 * 遵循小驴生态统一通知套件 Epoch 7 规范
 *
 * 专门针对三大生命线核心模块：
 * 1. certs（证件）：身份证、护照、驾照、签证等；
 * 2. insurance（保单）：车险、寿险、重疾、百万医疗等；
 * 3. medicine（药品）：急救药、慢性病处方药效期、疫苗等；
 * 扩展支持其他重要资产与合同关键逾期事项。
 */
import type { HomeSettings, Reminder } from "@/types";
import type { HubRuntime } from "./runtime";
import { inSilentHours } from "./notify";
import { lvNotify } from "@/libs/lv-notice-kit";

export const PRIORITY_CATEGORY = "priority-reminders";

export const CORE_PRIORITY_MODULES = new Set([
    "certs",
    "insurance",
    "medicine",
    "contracts",
    "vehicles",
]);

export interface PriorityReminderDeliveryOptions {
    reminders: Reminder[];
    settings: HomeSettings;
    runtime: HubRuntime;
    t: (key: string) => string;
    onOpenReminders: () => void;
    onOpenModule?: (moduleId: string) => void;
}

export interface PriorityReminderDeliveryResult {
    delivered: boolean;
    cardId?: string;
    itemCount: number;
    reason?: string;
}

/**
 * 筛选属于重点生命线模块且处于紧迫态（逾期或 7 天内临期）的事项
 */
export function filterPriorityReminders(reminders: Reminder[]): Reminder[] {
    return (reminders || [])
        .filter((r) => {
            const isPriorityMod = CORE_PRIORITY_MODULES.has(r.moduleId);
            const isUrgent = r.level === "overdue" || (r.level === "soon" && r.daysLeft <= 7) || r.daysLeft <= 7;
            return isPriorityMod && isUrgent;
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * 格式化单条重点事项简要文本
 */
export function formatPriorityItemLine(r: Reminder, t: (k: string) => string): string {
    const modLabel = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
    let dueStatus: string;
    if (r.daysLeft < 0) {
        dueStatus = `已逾期 ${Math.abs(r.daysLeft)} 天`;
    } else if (r.daysLeft === 0) {
        dueStatus = "今日到期";
    } else {
        dueStatus = `还剩 ${r.daysLeft} 天到期`;
    }
    return `·【${modLabel}】${r.title}（${dueStatus}）`;
}

/**
 * 派发重点到期交互卡片
 * 支持【去处理】快捷按钮、【稍后提醒】及【今日跳过】
 */
export function deliverPriorityReminderCard(
    options: PriorityReminderDeliveryOptions,
    now: Date = new Date(),
): PriorityReminderDeliveryResult {
    const { reminders, settings, runtime, t, onOpenReminders } = options;

    // 1. 今日免打扰比对
    if (lvNotify.isMutedToday(PRIORITY_CATEGORY)) {
        return { delivered: false, itemCount: 0, reason: "muted_today" };
    }

    // 2. 静默时段防护
    if (inSilentHours(settings, runtime, now)) {
        return { delivered: false, itemCount: 0, reason: "in_silent_hours" };
    }

    // 3. 筛选重点紧迫事项
    const priorityItems = filterPriorityReminders(reminders);
    if (priorityItems.length === 0) {
        return { delivered: false, itemCount: 0, reason: "no_priority_items" };
    }

    const hasOverdue = priorityItems.some((r) => r.daysLeft < 0 || r.level === "overdue");
    const topItems = priorityItems.slice(0, 3);
    const itemLines = topItems.map((r) => formatPriorityItemLine(r, t));

    if (priorityItems.length > 3) {
        itemLines.push(`… 等共 ${priorityItems.length} 项需关注`);
    }

    const title = hasOverdue ? "重点事项逾期警报" : "重要证照与保单药品到期提醒";
    const message = `发现 ${priorityItems.length} 项重要事项需处理：\n${itemLines.join("\n")}`;

    let cardId: string | undefined;
    cardId = lvNotify.card({
        source: "小驴管家",
        category: PRIORITY_CATEGORY,
        title,
        message,
        level: hasOverdue ? "error" : "warn",
        duration: hasOverdue ? 0 : 12000,
        actions: [
            {
                label: "去处理",
                primary: true,
                onClick: () => {
                    onOpenReminders();
                },
            },
            {
                label: "稍后提醒",
                onClick: () => {
                    if (cardId) lvNotify.snooze(cardId, 15 * 60 * 1000);
                },
            },
            {
                label: "今日跳过",
                onClick: () => {
                    lvNotify.muteToday(PRIORITY_CATEGORY);
                },
            },
        ],
        snooze: {
            options: [
                { label: "15分钟后再提醒", durationMs: 15 * 60 * 1000 },
                { label: "1小时后再提醒", durationMs: 60 * 60 * 1000 },
                { label: "今日免打扰", muteToday: true },
            ],
        },
    });

    return {
        delivered: true,
        cardId,
        itemCount: priorityItems.length,
    };
}
