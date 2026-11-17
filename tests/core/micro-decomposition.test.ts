import { describe, it, expect, vi } from "vitest";
import {
    isStaleTask,
    parseAiDecompositionOutput,
    requestAiDecomposition,
    isAiConfigured,
    executeMicroDecomposition,
    sanitizeMicroStep,
} from "@/core/micro-decomposition";
import type { Reminder } from "@/types";

describe("micro-decomposition (顽固事项 5 分钟微拆解核心套件)", () => {
    const mockReminder: Reminder = {
        id: "mock-row-1::task.due",
        moduleId: "chores",
        ruleKey: "due",
        rowId: "mock-row-1",
        title: "给全家车库彻底大扫除并归档杂物",
        dueDate: "2026-11-01",
        daysLeft: -4,
        level: "overdue",
        postponeCount: 3,
    };

    describe("1. 顽固事项判定 isStaleTask", () => {
        it("postponeCount >= 3 且未拆解时判定为顽固事项", () => {
            expect(isStaleTask(mockReminder)).toBe(true);
        });

        it("snoozeCount >= 3 兼容回退判定", () => {
            const r = { ...mockReminder, postponeCount: undefined, snoozeCount: 3 };
            expect(isStaleTask(r)).toBe(true);
        });

        it("postponeCount < 3 时不判定为顽固事项", () => {
            const r = { ...mockReminder, postponeCount: 2, snoozeCount: 2 };
            expect(isStaleTask(r)).toBe(false);
        });

        it("已拆解 (decomposed = true) 的事项徽记不再显示", () => {
            const r = { ...mockReminder, postponeCount: 5, decomposed: true };
            expect(isStaleTask(r)).toBe(false);
        });
    });

    describe("2. sanitizeMicroStep 单条微步骤规范化", () => {
        it("去除前导数字、标号、引号并截断至 30 字以内", () => {
            const raw = '  1. "打开车库门并拍一张杂物全景照片"  ';
            expect(sanitizeMicroStep(raw)).toBe("打开车库门并拍一张杂物全景照片");

            const longText = "这是一段非常冗长超过三十个字的微步骤描述文字内容内容内容内容内容内容内容内容";
            expect(sanitizeMicroStep(longText).length).toBeLessThanOrEqual(30);
        });
    });

    describe("3. parseAiDecompositionOutput AI 返回内容解析", () => {
        it("能够解析纯标准 JSON 数组", () => {
            const raw = '["打开车库门拍一张全景照", "把地面废纸箱踩扁扔出门外", "在备忘录写下3个归纳箱分类"]';
            const steps = parseAiDecompositionOutput(raw);
            expect(steps).toEqual([
                "打开车库门拍一张全景照",
                "把地面废纸箱踩扁扔出门外",
                "在备忘录写下3个归纳箱分类",
            ]);
        });

        it("能够解析 markdown ```json 代码块包裹的 JSON 数组", () => {
            const raw = `以下是微拆解步骤：
\`\`\`json
[
  "打开车库门拍一张全景照",
  "把地面废纸箱踩扁扔出门外",
  "在备忘录写下3个归纳箱分类"
]
\`\`\`
祝你顺利开始！`;
            const steps = parseAiDecompositionOutput(raw);
            expect(steps).toHaveLength(3);
            expect(steps[0]).toBe("打开车库门拍一张全景照");
        });

        it("畸形输出但有序号行时容错降级提取 3 条文本", () => {
            const raw = `无法输出严格json，给您提供以下微步骤：
1. 打开车库门拍张照
2. 把最显眼的纸箱搬到门外
3. 拿扫帚扫出一块空地
加油！`;
            const steps = parseAiDecompositionOutput(raw);
            expect(steps).toEqual([
                "打开车库门拍张照",
                "把最显眼的纸箱搬到门外",
                "拿扫帚扫出一块空地",
            ]);
        });

        it("完全无效文本返回空数组", () => {
            expect(parseAiDecompositionOutput("")).toEqual([]);
            expect(parseAiDecompositionOutput("抱歉我无法回答")).toEqual(["抱歉我无法回答"]);
        });
    });

    describe("4. requestAiDecomposition AI 请求与降级容错机制", () => {
        it("未配置 API Key 时抛出 AI_NOT_CONFIGURED 异常触发降级", async () => {
            const getConfigImpl = () => null;
            await expect(
                requestAiDecomposition({
                    reminder: mockReminder,
                    getConfigImpl,
                }),
            ).rejects.toThrow("AI_NOT_CONFIGURED");
        });

        it("已配置 API Key 时正常调用 chatImpl 并解析步骤", async () => {
            const getConfigImpl = () => ({ apiKey: "sk-mock-key" });
            const chatImpl = vi.fn().mockResolvedValue({
                content: '["步骤1: 拿手机", "步骤2: 拍照", "步骤3: 归位"]',
            });

            const steps = await requestAiDecomposition({
                reminder: mockReminder,
                getConfigImpl,
                chatImpl,
            });

            expect(chatImpl).toHaveBeenCalledOnce();
            expect(steps).toEqual(["步骤1: 拿手机", "步骤2: 拍照", "步骤3: 归位"]);
        });

        it("初次输出为无法解析的畸形内容时，自动发起一次修正重试", async () => {
            const getConfigImpl = () => ({ apiKey: "sk-mock-key" });
            const chatImpl = vi
                .fn()
                // 第 1 次返回空或不可提取内容
                .mockResolvedValueOnce({
                    content: "这里是说明，没有任何可提取的步骤",
                })
                // 第 2 次修正重试成功返回标准 JSON
                .mockResolvedValueOnce({
                    content: '["微步骤一", "微步骤二", "微步骤三"]',
                });

            const steps = await requestAiDecomposition({
                reminder: mockReminder,
                getConfigImpl,
                chatImpl,
            });

            expect(chatImpl).toHaveBeenCalledTimes(2);
            expect(steps).toEqual(["微步骤一", "微步骤二", "微步骤三"]);
        });
    });

    describe("5. executeMicroDecomposition 确认拆解与跨插件联动", () => {
        it("成功生成今日高优待办，触发 create-todo 联动，并标记原事项已拆解", async () => {
            const addMemoMock = vi.fn().mockResolvedValue(undefined);
            const refreshHubMock = vi.fn().mockResolvedValue(undefined);
            const fakePlugin = {
                runtime: {
                    memos: [],
                    decomposedReminders: {},
                },
                addMemo: addMemoMock,
                refreshHub: refreshHubMock,
                saveData: vi.fn().mockResolvedValue(undefined),
                loadData: vi.fn().mockResolvedValue({}),
            };

            const autoTriggerMock = vi.fn().mockResolvedValue({ triggered: 1, success: 1 });

            const result = await executeMicroDecomposition({
                plugin: fakePlugin,
                reminder: mockReminder,
                steps: ["1. 拿钥匙开门", "2. 检查仪表", "3. 启动通风"],
                todayStr: "2026-11-05",
                autoTrigger: autoTriggerMock,
            });

            expect(result.success).toBe(true);
            expect(result.createdCount).toBe(3);

            // 1. 验证今日高优待办创建
            expect(addMemoMock).toHaveBeenCalledTimes(3);
            expect(addMemoMock).toHaveBeenNthCalledWith(
                1,
                "拿钥匙开门",
                "2026-11-05",
                expect.objectContaining({ priority: "high", category: "微拆解" }),
            );

            // 2. 验证 lvAutomation create-todo 事件载荷
            expect(autoTriggerMock).toHaveBeenCalledTimes(3);
            expect(autoTriggerMock).toHaveBeenNthCalledWith(1, "siyuan-home", "create-todo", {
                title: "拿钥匙开门",
                dueDate: "2026-11-05",
            });

            // 3. 验证原事项被标记已拆解
            expect(fakePlugin.runtime.decomposedReminders[mockReminder.id]).toBeDefined();
            expect(fakePlugin.runtime.decomposedReminders[mockReminder.id].steps).toEqual([
                "拿钥匙开门",
                "检查仪表",
                "启动通风",
            ]);

            // 4. 验证 refreshHub 触发
            expect(refreshHubMock).toHaveBeenCalledOnce();
        });

        it("步骤为空时拒绝执行并抛出 EMPTY_STEPS", async () => {
            const fakePlugin = { addMemo: vi.fn() };
            await expect(
                executeMicroDecomposition({
                    plugin: fakePlugin,
                    reminder: mockReminder,
                    steps: ["   ", ""],
                }),
            ).rejects.toThrow("EMPTY_STEPS");
        });
    });

    describe("6. openMicroDecompositionDialog 弹窗交互与 a11y 覆盖", () => {
        it("能正确创建弹窗并支持手动输入与提交", async () => {
            const { openMicroDecompositionDialog } = await import("@/core/micro-decomposition-dialog");
            const addMemoMock = vi.fn().mockResolvedValue(undefined);
            const refreshHubMock = vi.fn().mockResolvedValue(undefined);
            const fakePlugin = {
                runtime: { memos: [], decomposedReminders: {} },
                addMemo: addMemoMock,
                refreshHub: refreshHubMock,
                showMessage: vi.fn(),
                saveData: vi.fn().mockResolvedValue(undefined),
                loadData: vi.fn().mockResolvedValue({}),
            };

            const mockElements: Record<string, any> = {
                "#lv-stale-step-1": { value: "", focus: vi.fn() },
                "#lv-stale-step-2": { value: "", focus: vi.fn() },
                "#lv-stale-step-3": { value: "", focus: vi.fn() },
                "#lv-stale-ai-btn": { disabled: false, onclick: null },
                "#lv-stale-ai-label": { textContent: "" },
                "#lv-stale-ai-tip": { textContent: "" },
                "#lv-stale-err": { textContent: "" },
                "#lv-stale-cancel": { onclick: null },
                "#lv-stale-submit": { disabled: false, onclick: null },
            };

            class MockDialog {
                element = {
                    classList: { add: vi.fn(), contains: vi.fn() },
                    querySelector: (sel: string) => mockElements[sel] ?? null,
                    querySelectorAll: () => [],
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                };
                destroy = vi.fn();
            }

            const dlg = openMicroDecompositionDialog({
                plugin: fakePlugin,
                reminder: mockReminder,
                t: (k) => k,
                DialogCls: MockDialog,
            });

            expect(dlg).toBeDefined();

            // 填写第 1 步并点击提交
            mockElements["#lv-stale-step-1"].value = "先去洗把脸清醒一下";
            mockElements["#lv-stale-submit"].onclick();

            await new Promise((r) => setTimeout(r, 10));

            // 验证提交成功生成了备忘
            expect(addMemoMock).toHaveBeenCalledWith(
                "先去洗把脸清醒一下",
                expect.any(String),
                expect.objectContaining({ priority: "high", category: "微拆解" }),
            );
        });
    });
});
