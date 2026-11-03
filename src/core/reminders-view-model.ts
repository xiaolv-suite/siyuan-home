/**
 * 提醒中枢视图模型与纯计算引擎（reminders-view-model）：
 * 负责提醒列表多维过滤、已办条目关联筛选、分组与置顶排序、规则与段位徽章推算、任务块格式化及快速计划排程。
 */
import type { Reminder, ReminderKind } from "@/types";
import type { HandledEntry } from "@/core/hub/runtime";
import { stageBadgeLabel, stageBadge, stagesOf } from "@/core/reminder-stage";
import { formatAsTaskBlock } from "@/core/block-capture";
import { localDateKey } from "@/core/hub/rule";
import { setReminderPlanDate, clearReminderPlanDate } from "@/core/hub/runtime-views";
import { saveRuntime } from "@/core/hub/runtime-store";
import { homeInline } from "@/libs/notice";

/** 提取规则显示文本 */
export function getReminderRuleText(ruleKey: string, t: (k: string) => string): string {
    const key = `rule.${ruleKey}`;
    const val = t(key);
    return val === key ? ruleKey : val;
}

/** 提取提醒类型标签 */
export function getReminderKindText(kind: ReminderKind | undefined, t: (k: string) => string): string {
    if (!kind) return "";
    const map: Record<string, string> = {
        recurring: t("hub.kindRecurring"),
        anniversary: t("hub.kindAnniversary"),
        oneoff: t("hub.kindOneoff"),
        after: t("hub.kindAfter"),
    };
    return map[kind] ?? kind;
}

/** 多维过滤活跃提醒列表 */
export function filterReminders(
    all: Reminder[],
    filter: string,
    filterMember?: string,
    filterModule?: string,
    dueWithin = "all",
): Reminder[] {
    let list = filter === "all" ? all : filter === "handled" ? [] : all.filter((r) => r.level === filter);
    if (filterMember) list = list.filter((r) => !r.memberId || r.memberId === filterMember);
    if (filterModule) list = list.filter((r) => r.moduleId === filterModule);
    if (dueWithin !== "all") {
        const today = new Date();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(dueWithin));
        const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
        list = list.filter((r) => r.dueDate <= endKey);
    }
    return list;
}

/** 多维过滤已处理记录列表 */
export function filterHandledEntries(
    handledEntries: HandledEntry[],
    reminderById: Map<string, Reminder>,
    filterMember?: string,
    filterModule?: string,
    dueWithin = "all",
): HandledEntry[] {
    let list = handledEntries;
    if (filterMember) {
        list = list.filter((entry) => {
            const reminder = reminderById.get(entry.id);
            return !reminder || !reminder.memberId || reminder.memberId === filterMember;
        });
    }
    if (filterModule) list = list.filter((entry) => entry.moduleId === filterModule);
    if (dueWithin !== "all") {
        const today = new Date();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(dueWithin));
        const endKey = [end.getFullYear(), String(end.getMonth() + 1).padStart(2, "0"), String(end.getDate()).padStart(2, "0")].join("-");
        list = list.filter((entry) => !!entry.dueDate && entry.dueDate <= endKey);
    }
    return list;
}

/** 置顶排前排序 */
export function sortPinnedFirst(items: Reminder[], isPinned: (r: Reminder) => boolean): Reminder[] {
    return [...items].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
}

/** 计算分组与置顶排序结果 */
export function computeReminderDisplayGroups(
    filtered: Reminder[],
    filter: string,
    t: (k: string) => string,
    isPinned: (r: Reminder) => boolean,
): { key: string; label: string; items: Reminder[] }[] {
    if (filter === "all") {
        return [
            { key: "overdue", label: t("hub.groupOverdue"), items: sortPinnedFirst(filtered.filter((r) => r.level === "overdue"), isPinned) },
            { key: "soon", label: t("hub.groupSoon"), items: sortPinnedFirst(filtered.filter((r) => r.level === "soon"), isPinned) },
            { key: "lead", label: t("hub.groupLead"), items: sortPinnedFirst(filtered.filter((r) => r.level === "lead"), isPinned) },
        ].filter((g) => g.items.length > 0);
    }
    return [{ key: filter, label: "", items: sortPinnedFirst(filtered, isPinned) }];
}

/** 从 schema 规则提取提前量配置并缓存 */
export function getReminderRuleSpec(
    schemaCatalog: Record<string, any> | undefined,
    cache: Map<string, { leadStages?: number[]; leadDays: number }>,
    r: Reminder,
): { leadStages?: number[]; leadDays: number } {
    const key = `${r.moduleId}.${r.ruleKey}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const spec = (schemaCatalog?.[r.moduleId]?.reminders ?? []).find((x: any) => x.key === r.ruleKey);
    const rule = { leadStages: spec?.leadStages, leadDays: typeof spec?.leadDays === "number" ? spec.leadDays : 30 };
    cache.set(key, rule);
    return rule;
}

/** 提取多段提醒阶段徽章信息 */
export function getReminderStage(
    schemaCatalog: Record<string, any> | undefined,
    cache: Map<string, { leadStages?: number[]; leadDays: number }>,
    r: Reminder,
    t: (k: string) => string,
): { label: string; isUrgent: boolean; stages: number[] } | null {
    const rule = getReminderRuleSpec(schemaCatalog, cache, r);
    if (!rule.leadStages || rule.leadStages.length === 0) return null;
    const label = stageBadgeLabel(r.daysLeft, rule, t);
    if (!label) return null;
    const badge = stageBadge(r.daysLeft, rule);
    return { label, isUrgent: badge.isUrgentStage, stages: stagesOf(rule) };
}

/** 复制为思源原生任务块语法 */
export async function copyReminderAsTaskBlock(
    r: Reminder,
    t: (k: string) => string,
    showMessage: (msg: string, time?: number, type?: string) => void,
    targetEl?: HTMLElement | null,
): Promise<void> {
    const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
    const text = formatAsTaskBlock(r.title, r.dueDate, r.rowId || r.id, { moduleName: modTitle });
    try {
        await navigator.clipboard.writeText(text);
        if (targetEl) homeInline(targetEl, t("hub.taskBlockCopied"));
        showMessage(t("hub.taskBlockCopied"), 3000, "info");
    } catch {
        showMessage(t("hub.digestCopyFailed"), 3000, "error");
    }
}

/** 格式化为家庭群通知文本 (CAND-24) */
export function formatFamilyNotice(
    r: Reminder,
    options?: { memberName?: string; moduleName?: string; note?: string },
): string {
    const target = options?.memberName || "全家";
    const mod = options?.moduleName ? ` · ${options.moduleName}` : "";
    const dueHint = r.daysLeft < 0 ? `（已逾期 ${Math.abs(r.daysLeft)} 天）`
        : r.daysLeft === 0 ? "（今日到期）"
        : `（还剩 ${r.daysLeft} 天）`;
    return [
        `📢【家庭提醒${mod}】`,
        `📌 事项：${r.title}`,
        `📅 截止：${r.dueDate} ${dueHint}`,
        `👤 责任人：${target}`,
        ...(options?.note ? [`📝 备注：${options.note}`] : []),
        `💡 来自小驴管家智能提醒`,
    ].join("\n");
}

/** 复制家庭群通知文本到剪贴板 */
export async function copyReminderFamilyNotice(
    r: Reminder,
    t: (k: string) => string,
    showMessage: (msg: string, time?: number, type?: string) => void,
    options?: { memberName?: string; targetEl?: HTMLElement | null },
): Promise<void> {
    const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
    const text = formatFamilyNotice(r, {
        memberName: options?.memberName,
        moduleName: modTitle,
        note: r.tag ? `#${r.tag}` : undefined,
    });
    try {
        await navigator.clipboard.writeText(text);
        if (options?.targetEl) homeInline(options.targetEl, t("hub.familyNoticeCopied"));
        showMessage(t("hub.familyNoticeCopied"), 2500, "info");
    } catch {
        showMessage(t("hub.digestCopyFailed"), 3000, "error");
    }
}

/** 切换今日快速计划日期 */
export async function toggleReminderQuickPlanToday(
    r: Reminder,
    plugin: any,
    t: (k: string) => string,
    showMessage: (msg: string, time?: number, type?: string) => void,
): Promise<void> {
    const todayKey = localDateKey(new Date());
    const planDates = plugin.runtime.planDates ?? {};
    const previousDate = planDates[r.id];
    const isAlreadyToday = previousDate === todayKey;
    try {
        if (isAlreadyToday) {
            clearReminderPlanDate(plugin.runtime, r.id);
            showMessage(t("hub.planDateCleared"), 2000, "info");
        } else {
            setReminderPlanDate(plugin.runtime, r.id, todayKey);
            showMessage(t("hub.planDateSaved"), 2000, "info");
        }
        await saveRuntime(plugin, plugin.runtime);
        await plugin.refreshHub?.(undefined, true);
    } catch (e) {
        // 乐观更新失败时严格回滚内存态，防止脏状态扩散
        if (previousDate !== undefined) {
            setReminderPlanDate(plugin.runtime, r.id, previousDate);
        } else {
            clearReminderPlanDate(plugin.runtime, r.id);
        }
        showMessage(t("hub.filterSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}
