/**
 * 顽固事项 5 分钟微步骤拆解（Stale Task Micro-Decomposition）
 *
 * 针对顺延 ≥3 次的顽固事项，提供手动 3 步或 AI 帮拆路径，
 * 将拖延大石块拆碎为 5 分钟可执行的微行动，排入今日高优待办流，
 * 并通过 lvAutomation("siyuan-home", "create-todo") 与打卡生态既有管道协同。
 */

import type { Reminder } from "@/types";
import { localDateKey } from "./hub/rule";
import { withRuntime } from "./hub/actions";
import { lvAi, lvAutomation, lvLaunchpad } from "@/libs/lv-notice-kit";

export const STALE_POSTPONE_THRESHOLD = 3;
export const MAX_STEP_LENGTH = 30;

/**
 * 判定事项是否为顺延 ≥3 次且尚未拆解的顽固事项
 */
export function isStaleTask(r: Reminder): boolean {
    if (!r) return false;
    if (r.decomposed) return false;
    const count = r.postponeCount ?? r.snoozeCount ?? 0;
    return count >= STALE_POSTPONE_THRESHOLD;
}

/**
 * 清理与规范化单条微步骤文本（≤30 字）
 */
export function sanitizeMicroStep(text: string): string {
    let clean = String(text ?? "").trim();
    let prev = "";
    while (clean !== prev) {
        prev = clean;
        clean = clean
            .replace(/^[\s\d.、\-*•[\](（)]+/, "")
            .replace(/^["'“‘]+/, "")
            .replace(/["'”’]+$/, "")
            .trim();
    }
    return clean.slice(0, MAX_STEP_LENGTH).trim();
}

/**
 * 尝试直接从文本中提取规范的 JSON 数组微步骤
 */
export function extractJsonSteps(raw: string): string[] | null {
    if (!raw || typeof raw !== "string") return null;
    const jsonMatch = raw.match(/\[\s*(?:["'][^"']+["']\s*,?\s*)+\]/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
            const steps = parsed.map(sanitizeMicroStep).filter(Boolean);
            if (steps.length > 0) return steps.slice(0, 3);
        }
    } catch {
        /* fallback */
    }
    return null;
}

/**
 * 解析 AI 返回的文本为 2~3 条微步骤数组（含 JSON 提取与纯文本容错降级）
 */
export function parseAiDecompositionOutput(raw: string): string[] {
    if (!raw || typeof raw !== "string") return [];

    // 1. 优先尝试直接或从 markdown 代码块中提取 JSON 数组
    const fromJson = extractJsonSteps(raw);
    if (fromJson && fromJson.length > 0) {
        return fromJson;
    }

    // 2. 纯文本逐行或标号分词降级提取
    const lines = raw
        .split(/\r?\n/)
        .map((line) => sanitizeMicroStep(line))
        .filter((line) => line.length >= 2 && !line.startsWith("```") && !line.includes("json"));

    const validSteps: string[] = [];
    for (const line of lines) {
        if (validSteps.length >= 3) break;
        if (!validSteps.includes(line)) {
            validSteps.push(line);
        }
    }

    return validSteps;
}

export interface AiDecompositionOptions {
    reminder: Reminder;
    signal?: AbortSignal;
    chatImpl?: (opts: any) => Promise<{ content: string }>;
    getConfigImpl?: () => { apiKey?: string; [key: string]: any } | null;
}

/**
 * 检查小驴共享 AI 是否已配置凭据
 */
export function isAiConfigured(getConfigImpl: () => { apiKey?: string; [key: string]: any } | null = () => lvAi.getConfig()): boolean {
    try {
        const cfg = getConfigImpl();
        return Boolean(cfg?.apiKey && cfg.apiKey.trim().length > 0);
    } catch {
        return false;
    }
}

/**
 * 向小驴 AI 网关请求敏捷微拆解（含畸形输出容错重试一次）
 */
export async function requestAiDecomposition(options: AiDecompositionOptions): Promise<string[]> {
    const { reminder, signal, chatImpl = (opts) => lvAi.chat(opts), getConfigImpl = () => lvAi.getConfig() } = options;

    if (!isAiConfigured(getConfigImpl)) {
        throw new Error("AI_NOT_CONFIGURED");
    }

    const systemPrompt = "你是一位敏捷行动力专家与拖延降阻大师。用户的某个事项已拖延顺延多次，请将其拆解为 2~3 个具体、立即可执行、5 分钟内能做完的微步骤（Micro-steps）。每步不超过 25 个字，必须包含明确动词和即时终点（例如：打开XX网页、写出前两句话、找出发票拍个照）。严格只输出一个包含 3 个字符串的 JSON 数组，不要任何 markdown 标记、不要包含反引号、不要任何前言后语。示例格式：[\"步骤1\", \"步骤2\", \"步骤3\"]";
    const userPrompt = `事项名称：${reminder.title}\n逾期或距今：${Math.abs(reminder.daysLeft)}天\n请拆解为 3 个 5 分钟微步骤。`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];

    let response = await chatImpl({
        source: "管家",
        messages,
        temperature: 0.3,
        signal,
    });

    let steps = extractJsonSteps(response?.content ?? "");

    // 容错机制：若初次输出未提取出有效 JSON 步骤，自动发起一次修正重试
    if ((!steps || steps.length === 0) && !signal?.aborted) {
        const retryMessages = [
            ...messages,
            { role: "assistant", content: response?.content ?? "" },
            { role: "user", content: "格式错误。请严格只输出标准 JSON 字符串数组，例如 [\"第一步\", \"第二步\", \"第三步\"]，禁止任何多余解释。" },
        ];
        try {
            response = await chatImpl({
                source: "管家",
                messages: retryMessages,
                temperature: 0.1,
                signal,
            });
            steps = extractJsonSteps(response?.content ?? "");
        } catch (err) {
            if (signal?.aborted) throw err;
            /* soft fail, fall through to fallback parsing */
        }
    }

    return (steps && steps.length > 0) ? steps : parseAiDecompositionOutput(response?.content ?? "");
}

/**
 * 标记事项为已拆解
 */
export async function markReminderDecomposed(plugin: any, reminderId: string, steps: string[]): Promise<void> {
    await withRuntime(plugin, (rt) => {
        rt.decomposedReminders = rt.decomposedReminders ?? {};
        rt.decomposedReminders[reminderId] = {
            at: new Date().toISOString(),
            steps,
        };
        // 若为单次备忘，同步标记备忘自身
        if (reminderId.startsWith("adhoc::")) {
            const memoId = reminderId.replace(/^adhoc::/, "");
            const m = (rt.memos ?? []).find((x) => x.id === memoId);
            if (m) {
                (m as any).decomposed = true;
            }
        }
    });
}

export interface ExecuteMicroDecompositionOptions {
    plugin: any;
    reminder: Reminder;
    steps: string[];
    todayStr?: string;
    autoTrigger?: (sourcePlugin: string, eventType: string, payload: unknown) => Promise<unknown>;
}

/**
 * 确认拆解：生成今日高优待办、触发 lvAutomation.trigger("create-todo")、标记原事项已拆解
 */
export async function executeMicroDecomposition(
    options: ExecuteMicroDecompositionOptions,
): Promise<{ success: boolean; createdCount: number }> {
    const { plugin, reminder, steps, todayStr = localDateKey(new Date()), autoTrigger = lvAutomation.trigger } = options;

    const validSteps = steps
        .map((s) => sanitizeMicroStep(s))
        .filter((s) => s.length > 0)
        .slice(0, 3);

    if (validSteps.length === 0) {
        throw new Error("EMPTY_STEPS");
    }

    // 1. 生成今日高优备忘（待办流）
    for (const stepTitle of validSteps) {
        if (plugin?.addMemo) {
            await plugin.addMemo(stepTitle, todayStr, {
                priority: "high",
                category: "微拆解",
            });
        }

        // 2. 跨插件智能自动化联动（打卡仓既有规则消费）
        try {
            await autoTrigger("siyuan-home", "create-todo", {
                title: stepTitle,
                dueDate: todayStr,
            });
        } catch (e) {
            console.warn("[LvHome] automation trigger create-todo soft fail:", e);
        }
    }

    // 3. 原事项标记已拆解，卡片徽记消失
    await markReminderDecomposed(plugin, reminder.id, validSteps);

    // 4. 触感确认
    try {
        lvLaunchpad.haptic(10);
    } catch {
        /* soft */
    }

    // 5. 刷新状态机并触发徽记/badge 刷新
    try {
        if (plugin?.refreshHub) {
            await plugin.refreshHub();
        }
    } catch {
        /* soft */
    }

    return {
        success: true,
        createdCount: validSteps.length,
    };
}
