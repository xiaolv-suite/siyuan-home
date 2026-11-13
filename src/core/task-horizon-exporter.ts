/**
 * 将小驴管家生活到期事项规范化转换为 Task Horizon (任务视界) 兼容的任务块
 * 遵循 Task Horizon 块属性规范：
 * - custom-status="todo"
 * - custom-priority="high" | "medium" | "low"
 * - custom-completion-time="YYYY-MM-DD"
 * - custom-remark="((rowId '备注说明'))"
 */
import type { Reminder } from "@/types";

export interface TaskHorizonExportOptions {
    moduleName?: string;
    moduleMap?: Record<string, string>;
    defaultPriority?: "high" | "medium" | "low" | "none";
}

/**
 * 将单个生活提醒映射为 Task Horizon 标准 Markdown 任务行
 */
export function formatReminderAsTaskHorizonItem(
    reminder: Reminder,
    options: TaskHorizonExportOptions = {}
): string {
    if (!reminder || !reminder.title) return "";

    const modName = options.moduleName || options.moduleMap?.[reminder.moduleId] || reminder.moduleId || "生活事务";
    
    // 优先级映射：逾期 -> high, 即将到期 -> high, 提前预警 -> medium
    let priority: "high" | "medium" | "low" | "none" = options.defaultPriority || "high";
    if (reminder.level === "overdue") {
        priority = "high";
    } else if (reminder.level === "soon") {
        priority = "high";
    } else if (reminder.level === "lead") {
        priority = "medium";
    }

    const titlePrefix = reminder.level === "overdue" ? "❗逾期待办" : "生活待办";
    const dateAttr = reminder.dueDate ? `custom-completion-time="${reminder.dueDate}"` : "";
    const remarkAttr = reminder.rowId ? `custom-remark="(( ${reminder.rowId} '管家·${modName}' ))"` : "";
    const priorityAttr = `custom-priority="${priority}"`;
    const statusAttr = 'custom-status="todo"';

    const attrs = [statusAttr, priorityAttr, dateAttr, remarkAttr].filter(Boolean).join(" ");

    return `- [ ] 【${titlePrefix}·${modName}】${reminder.title} {: ${attrs} }`;
}

/**
 * 批量将多个提醒转换为完整的 Task Horizon 任务清单文本
 */
export function formatRemindersAsTaskHorizonChecklist(
    reminders: readonly Reminder[],
    options: TaskHorizonExportOptions & { headerTitle?: string } = {}
): string {
    if (!Array.isArray(reminders) || reminders.length === 0) return "";

    const lines: string[] = [];
    if (options.headerTitle) {
        lines.push(`## ${options.headerTitle}`, "");
    }

    for (const rem of reminders) {
        const itemLine = formatReminderAsTaskHorizonItem(rem, options);
        if (itemLine) lines.push(itemLine);
    }

    return lines.join("\n");
}
