/**
 * 小驴管家 · AI 自然语言解析与效期全局体检引擎 (Epoch 7 Phase 6)
 * 基于全生态统一 AI 网关 (lvAi)，支持免 Key 共享、自动并发限流与离线规则降级
 */
import { lvAi } from "@/libs/notice";
import { parseQuickAdd, type QuickAddResult } from "./quick-add";
import { localDateKey } from "./hub/rule";
import type { Reminder } from "@/types";

export function parseSseEventStreamText(raw: string): string {
    if (!raw || typeof raw !== "string") return "";
    const lines = raw.split(/\r?\n/);
    let currentEvent = "";
    let out = "";
    let hasSseFrame = false;
    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) {
            currentEvent = "";
            continue;
        }
        if (line.startsWith("event:")) {
            hasSseFrame = true;
            currentEvent = line.slice(6).trim();
            continue;
        }
        if (line.startsWith("data:")) {
            hasSseFrame = true;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            if (currentEvent === "error") return "";
            try {
                const obj = JSON.parse(payload);
                if (!currentEvent || currentEvent === "content" || currentEvent === "message") {
                    const token =
                        obj?.token ??
                        obj?.delta?.content ??
                        obj?.choices?.[0]?.delta?.content ??
                        obj?.content ??
                        "";
                    if (typeof token === "string") out += token;
                }
            } catch {
                if (!currentEvent || currentEvent === "content" || currentEvent === "message") {
                    out += payload;
                }
            }
        }
    }
    return hasSseFrame ? out.trim() : "";
}

async function readSseResponseBody(res: Response): Promise<string> {
    if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === "function") {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buf = "";
        let currentEvent = "";
        let out = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || "";
            for (const raw of lines) {
                const line = raw.trim();
                if (!line) {
                    currentEvent = "";
                    continue;
                }
                if (line.startsWith("event:")) {
                    currentEvent = line.slice(6).trim();
                } else if (line.startsWith("data:")) {
                    const payload = line.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    if (currentEvent === "error") return "";
                    try {
                        const obj = JSON.parse(payload);
                        if (!currentEvent || currentEvent === "content" || currentEvent === "message") {
                            const token =
                                obj?.token ??
                                obj?.delta?.content ??
                                obj?.choices?.[0]?.delta?.content ??
                                obj?.content ??
                                "";
                            if (typeof token === "string") out += token;
                        }
                    } catch {
                        if (!currentEvent || currentEvent === "content" || currentEvent === "message") {
                            out += payload;
                        }
                    }
                }
            }
        }
        if (buf.trim()) {
            const tail = parseSseEventStreamText(`${currentEvent ? `event: ${currentEvent}\n` : ""}${buf}`);
            if (tail) out += tail;
        }
        return out.trim();
    }
    if (typeof (res as { text?: () => Promise<string> }).text === "function") {
        const text = await res.text();
        return parseSseEventStreamText(text);
    }
    return "";
}

async function requestSseEditorChat(
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; signal?: AbortSignal; taskType?: string },
): Promise<string | null> {
    const signal = options?.signal;
    try {
        const w = (typeof window !== "undefined" ? window : {}) as Record<string, any>;
        const router = w.LvAiRouter || w.__LV_AI_ROUTER__;
        if (router && typeof router.chat === "function") {
            const outcome = await router.chat({
                messages,
                taskType: options?.taskType ?? "extract",
                temperature: options?.temperature,
                signal,
            });
            if (outcome?.ok && typeof outcome.content === "string" && outcome.content.trim()) {
                return outcome.content.trim();
            }
        }
        if (w.lvAiHub && typeof w.lvAiHub.runTask === "function") {
            const res = await w.lvAiHub.runTask({
                capability: "L2",
                taskType: options?.taskType ?? "extract",
                messages,
                signal,
            });
            if (res?.content && typeof res.content === "string" && res.content.trim()) return res.content.trim();
        }
        // 思源 v3.8.12 原生 SSE AI 端点（使用标准 taskID/ids/history/input/action 协议并逐帧解析 SSE）
        if (typeof fetch === "function" && typeof location !== "undefined" && location.protocol?.startsWith("http")) {
            const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean);
            const nonSystem = messages.filter((m) => m.role !== "system");
            const lastMsg = nonSystem[nonSystem.length - 1]?.content ?? "";
            const input = systemParts.length > 0 ? `${systemParts.join("\n")}\n\n${lastMsg}` : lastMsg;
            const history = nonSystem.slice(0, -1).map((m) => ({
                type: m.role === "assistant" ? "ai" : "user",
                content: m.content,
            }));
            const res = await fetch("/api/ai/editor/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
                body: JSON.stringify({
                    taskID: `lv-home-${Date.now()}`,
                    ids: [],
                    history,
                    input,
                    action: "chat",
                }),
                signal,
            });
            if (res.ok) {
                const ct = (res.headers?.get?.("content-type") || "").toLowerCase();
                if (ct.includes("text/event-stream")) {
                    const sseOut = await readSseResponseBody(res);
                    if (sseOut) return sseOut;
                } else if (ct.includes("application/json")) {
                    const j = await res.json();
                    if (j?.code === undefined || j.code === 0) {
                        const text =
                            j?.data?.content ??
                            (typeof j?.data === "string" ? j.data : undefined) ??
                            j?.content ??
                            j?.choices?.[0]?.message?.content;
                        if (typeof text === "string" && text.trim()) return text.trim();
                    }
                } else {
                    const text = await res.text();
                    if (!text || text.startsWith("<!DOCTYPE") || text.startsWith("<html")) return null;
                    const parsedSse = parseSseEventStreamText(text);
                    if (parsedSse) return parsedSse;
                    try {
                        const j = JSON.parse(text);
                        if (j?.code === undefined || j.code === 0) {
                            const jt = j?.data?.content ?? (typeof j?.data === "string" ? j.data : undefined) ?? j?.content;
                            if (typeof jt === "string" && jt.trim()) return jt.trim();
                        }
                        return null;
                    } catch {
                        if (text.trim()) return text.trim();
                    }
                }
            }
        }
    } catch { /* fallback to lvAi.chat / local rule */ }
    return null;
}

export async function runUnifiedAiPrompt(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: { temperature?: number; signal?: AbortSignal; taskType?: string },
): Promise<{ content: string } | null> {
    const sseText = await requestSseEditorChat(messages, options);
    if (sseText) return { content: sseText };
    const response = await lvAi.chat({
        source: "管家",
        messages,
        temperature: options?.temperature ?? 0.2,
        priority: "high",
        signal: options?.signal,
    });
    return response?.content ? { content: response.content } : null;
}

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
    if (options?.signal?.aborted) {
        return {
            ...fallback,
            isAiParsed: false,
        };
    }

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

        const response = await runUnifiedAiPrompt(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: raw },
            ],
            { temperature: 0.2, signal: options?.signal },
        );

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
        if (options?.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        const systemPrompt = `你是一位严谨专业、贴心细致的家庭生活与效期健康顾问。
基于家庭证件、药品、保单与生活待办的效期清单，生成一份高信噪比的【小驴管家 · 生活效期全局体检洞察报告】。
请采用 Markdown 格式，包含：
1. 🚨 高危与即将到期项（包含换证/续费/补药时限预警）
2. ⚠️ 30天内近期关注规划
3. 💡 专业办事与保障避坑建议（如护照出入境建议6个月以上有效期、提前续保优惠等）
字数控制在 280 字以内，语气亲切务实，条理清晰。`;

        const res = await runUnifiedAiPrompt(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(summary) },
            ],
            { temperature: 0.3, signal: options?.signal },
        );

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
