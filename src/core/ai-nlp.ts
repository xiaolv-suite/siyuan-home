/**
 * 小驴管家 · AI 自然语言解析与效期全局体检引擎 (Epoch 7 Phase 6)
 * 基于全生态统一 AI 网关 (lvAi)，支持免 Key 共享、自动并发限流与离线规则降级
 */
import { lvAi } from "@/libs/notice";
import { parseQuickAdd, type QuickAddResult } from "./quick-add";
import { localDateKey } from "./hub/rule";
import type { Reminder } from "@/types";

export interface ParsedAiQuickEntry extends QuickAddResult {
    /** 是否成功由大语言模型增强解析（false 为本地规则引擎回退） */
    isAiParsed: boolean;
}

export interface LifeHealthAuditResult {
    /** 结构化 Markdown 洞察体检报告 */
    reportText: string;
    /** 是否由 AI 深度洞察生成 */
    isAiGenerated: boolean;
    /** 逾期/高危项数量 */
    urgentCount: number;
    /** 30天内到期项数量 */
    upcomingCount: number;
    /** 扫描日期 */
    auditDate: string;
}

/**
 * 自然语言极速记账与备忘解析器 (NLP Quick Parser)
 * 接收一句话自然语言输入，优先通过 lvAi.chat 提取事项名、到期时间、分类、金额；
 * 若未配置大模型或调用超时，平滑回退至本地 QuickAdd 规则引擎。
 */
export async function parseQuickEntryWithAi(
    input: string,
    options?: { signal?: AbortSignal; now?: Date }
): Promise<ParsedAiQuickEntry> {
    const raw = String(input ?? "").trim();
    if (!raw) {
        return {
            cleanTitle: "",
            raw: "",
            isAiParsed: false,
        };
    }

    const now = options?.now ?? new Date();
    const todayISO = localDateKey(now);

    // 先做一次本地基础解析作为保底
    const fallback = parseQuickAdd(raw, now);

    try {
        const systemPrompt = `你是一个家庭生活管家 AI 助理。请从用户的日常一句话输入中，提取结构化生活备忘或记账数据。
请必须且仅输出一个合法的 JSON 对象，不要包含 markdown 标记代码块（禁止出现 \`\`\`json 等标记），不要输出任何解释说明。
JSON 字段规范：
{
  "title": "事项名称或备忘核心内容（简练准确，剥离时间/金额修饰词）",
  "dueDate": "YYYY-MM-DD 格式的目标日期，基于当前基准日期推算",
  "time": "HH:mm 格式时间（可选，如 10:00）",
  "category": "task | shopping | finance | cert | medicine | car | general",
  "priority": "high | medium | low",
  "amount": 数字金额（仅纯数字，如 120，无金额填 null）
}
当前基准日期为：${todayISO}。输入语句："${raw}"`;

        const response = await lvAi.chat({
            source: "管家",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: raw },
            ],
            temperature: 0.2,
            priority: "high",
            signal: options?.signal,
        });

        const content = response?.content ? response.content.trim() : "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const title = typeof parsed.title === "string" && parsed.title.trim()
                ? parsed.title.trim()
                : fallback.cleanTitle || raw;

            let dueDate = typeof parsed.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)
                ? parsed.dueDate
                : fallback.dueDate;

            let priority = parsed.priority === "high" || parsed.priority === "medium" || parsed.priority === "low"
                ? parsed.priority
                : fallback.priority;

            const category = typeof parsed.category === "string" ? parsed.category : fallback.category;
            const amount = typeof parsed.amount === "number" && Number.isFinite(parsed.amount)
                ? parsed.amount
                : fallback.amount;

            return {
                cleanTitle: title,
                raw,
                dueDate,
                priority,
                category,
                amount,
                cycle: fallback.cycle,
                cycleToken: fallback.cycleToken,
                recurrenceAnchor: fallback.recurrenceAnchor,
                isAiParsed: true,
            };
        }
    } catch {
        /* 网络未通或未配 Key 时平滑回退 */
    }

    return {
        ...fallback,
        isAiParsed: false,
    };
}

/**
 * 证件与生活效期全局体检洞察 (Life Health Audit)
 * 对证件、药品、保单效期进行全局智能分析，输出换发与续费预警
 */
export async function auditLifeHealthWithAi(
    plugin: any,
    options?: { signal?: AbortSignal; now?: Date }
): Promise<LifeHealthAuditResult> {
    const now = options?.now ?? new Date();
    const todayISO = localDateKey(now);

    const reminders: Reminder[] = plugin?.scan?.reminders ?? [];
    const urgentItems = reminders.filter((r) => r.daysLeft <= 7);
    const upcomingItems = reminders.filter((r) => r.daysLeft > 7 && r.daysLeft <= 30);
    const plannedItems = reminders.filter((r) => r.daysLeft > 30 && r.daysLeft <= 90);

    const urgentCount = urgentItems.length;
    const upcomingCount = upcomingItems.length;

    // 汇总体检数据摘要
    const summary = {
        today: todayISO,
        urgentList: urgentItems.slice(0, 15).map((r) => ({
            title: r.title,
            module: r.moduleId,
            dueDate: r.dueDate,
            daysLeft: r.daysLeft,
        })),
        upcomingList: upcomingItems.slice(0, 15).map((r) => ({
            title: r.title,
            module: r.moduleId,
            dueDate: r.dueDate,
            daysLeft: r.daysLeft,
        })),
        plannedCount: plannedItems.length,
        totalTracked: reminders.length,
    };

    try {
        const systemPrompt = `你是一位严谨专业、贴心细致的家庭生活与效期健康顾问。
基于家庭证件、药品、保单与生活待办的效期清单，生成一份高信噪比的【小驴管家 · 生活效期全局体检洞察报告】。
请采用 Markdown 格式，包含：
1. 🚨 高危与即将到期项（包含换证/续费/补药时限预警）
2. ⚠️ 30天内近期关注规划
3. 💡 专业办事与保障避坑建议（如护照出入境建议6个月以上有效期、提前续保优惠等）
字数控制在 280 字以内，语气亲切务实，条理清晰。`;

        const res = await lvAi.chat({
            source: "管家",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(summary) },
            ],
            temperature: 0.3,
            priority: "high",
            signal: options?.signal,
        });

        if (res?.content && res.content.trim()) {
            return {
                reportText: res.content.trim(),
                isAiGenerated: true,
                urgentCount,
                upcomingCount,
                auditDate: todayISO,
            };
        }
    } catch {
        /* 离线回退 */
    }

    // 本地规则离线生成体检洞察报告
    const lines: string[] = [
        `### 🐴 小驴管家 · 生活效期全局体检报告（离线规则版）`,
        `> 体检日期：${todayISO} · 追踪事项共 ${reminders.length} 项`,
        "",
    ];

    if (urgentCount > 0) {
        lines.push(`#### 🚨 高危与即将到期项（共 ${urgentCount} 项）`);
        urgentItems.slice(0, 8).forEach((item) => {
            const statusText = item.daysLeft <= 0 ? "已逾期" : `剩余 ${item.daysLeft} 天`;
            lines.push(`- **[${item.moduleId}]** ${item.title} — *${statusText}*（到期日: ${item.dueDate}）`);
        });
        lines.push("");
    } else {
        lines.push(`- ✅ **当前暂无紧急临期事项**，所有证件与重点生活合约均在有效期内。`);
        lines.push("");
    }

    if (upcomingCount > 0) {
        lines.push(`#### ⚠️ 30天内近期关注（共 ${upcomingCount} 项）`);
        upcomingItems.slice(0, 8).forEach((item) => {
            lines.push(`- **[${item.moduleId}]** ${item.title} — 剩余 ${item.daysLeft} 天（${item.dueDate}）`);
        });
        lines.push("");
    }

    lines.push(`#### 💡 管家办事与保障避坑建议`);
    lines.push(`- 🪪 **证件换发**：出入境证件（护照/港澳通行证）建议预留 6 个月以上效期，以免影响国际航班与签注；`);
    lines.push(`- 💊 **家庭常备药**：建议每季度清理过期药品，慢性病常备药请至少提前 2 周补齐；`);
    lines.push(`- 🛡️ **车辆与保障**：车险到期前 30 天内续保可享最优无赔款优待系数与续保礼遇。`);

    return {
        reportText: lines.join("\n"),
        isAiGenerated: false,
        urgentCount,
        upcomingCount,
        auditDate: todayISO,
    };
}
