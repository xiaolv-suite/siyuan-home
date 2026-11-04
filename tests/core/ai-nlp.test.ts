import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseQuickEntryWithAi, auditLifeHealthWithAi } from "@/core/ai-nlp";
import { lvAi, lvLaunchpad } from "@/libs/notice";

describe("AI 全面接入与自然语言极速记账 (Epoch 7 Phase 6: ai-nlp)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("自然语言极速解析：规则回退兜底（离线/无Key时正常提取金额与分类）", async () => {
        const text = "下周五上午10点去车管所换驾照，费用120元";
        const result = await parseQuickEntryWithAi(text);

        expect(result.raw).toBe(text);
        expect(result.amount).toBe(120);
        expect(result.cleanTitle).toContain("换驾照");
        expect(result.isAiParsed).toBe(false);
    });

    it("自然语言极速解析：大模型成功响应时输出结构化对象 (isAiParsed = true)", async () => {
        const mockAiResponse = {
            content: JSON.stringify({
                title: "车管所换驾照",
                dueDate: "2026-11-13",
                time: "10:00",
                category: "cert",
                priority: "high",
                amount: 120,
            }),
            model: "deepseek-chat",
        };

        vi.spyOn(lvAi, "chat").mockResolvedValueOnce(mockAiResponse);

        const text = "下周五上午10点去车管所换驾照，费用120元";
        const result = await parseQuickEntryWithAi(text);

        expect(result.isAiParsed).toBe(true);
        expect(result.cleanTitle).toBe("车管所换驾照");
        expect(result.dueDate).toBe("2026-11-13");
        expect(result.category).toBe("cert");
        expect(result.priority).toBe("high");
        expect(result.amount).toBe(120);
    });

    it("证件与生活效期全局体检洞察：离线规则版报告生成", async () => {
        const mockPlugin = {
            scan: {
                reminders: [
                    { id: "r1", title: "身份证到期", moduleId: "certs", dueDate: "2026-11-05", daysLeft: 2 },
                    { id: "r2", title: "布洛芬过期", moduleId: "medicine", dueDate: "2026-11-20", daysLeft: 17 },
                    { id: "r3", title: "车险续保", moduleId: "insurance", dueDate: "2026-12-15", daysLeft: 42 },
                ],
            },
        };

        const audit = await auditLifeHealthWithAi(mockPlugin);
        expect(audit.urgentCount).toBe(1);
        expect(audit.upcomingCount).toBe(1);
        expect(audit.reportText).toContain("生活效期全局体检报告");
        expect(audit.reportText).toContain("身份证到期");
        expect(audit.reportText).toContain("布洛芬过期");
        expect(audit.isAiGenerated).toBe(false);
    });

    it("证件与生活效期全局体检洞察：大模型增强版报告生成", async () => {
        const mockPlugin = {
            scan: {
                reminders: [
                    { id: "r1", title: "护照换发", moduleId: "certs", dueDate: "2026-11-06", daysLeft: 3 },
                ],
            },
        };

        vi.spyOn(lvAi, "chat").mockResolvedValueOnce({
            content: "【AI深度效期洞察】：护照即将在3天后失效，出入境需预留6个月效期，请立即预约出入境大厅换发！",
            model: "qwen-plus",
        });

        const audit = await auditLifeHealthWithAi(mockPlugin);
        expect(audit.isAiGenerated).toBe(true);
        expect(audit.reportText).toContain("出入境需预留6个月效期");
        expect(audit.urgentCount).toBe(1);
    });

    it("小驴罗盘 executeAction 能够穿透触发并执行二级行动", async () => {
        const actionSpy = vi.fn();
        const unreg = lvLaunchpad.register({
            id: "siyuan-home-action-test",
            name: "管家",
            fullName: "小驴管家",
            svgIcon: "iconLvHome",
            actions: ["快速记录生活备忘事项", "AI生活效期智能体检"],
            onClick: () => {},
            onAction: actionSpy,
        });

        const ok = lvLaunchpad.executeAction ? lvLaunchpad.executeAction("siyuan-home-action-test", "AI生活效期智能体检") : false;
        expect(ok).toBe(true);
        expect(actionSpy).toHaveBeenCalledWith("AI生活效期智能体检");

        unreg();
    });
});
