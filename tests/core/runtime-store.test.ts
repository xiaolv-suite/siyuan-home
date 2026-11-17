import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    defaultRuntime,
    semanticRuntimeFingerprint,
    loadRuntime,
    saveRuntime,
    withRuntimeSaveLock,
    RUNTIME_NAME,
} from "@/core/hub/runtime-store";
import type { HubRuntime } from "@/core/hub/runtime";

describe("runtime-store (提醒中枢运行态序列化与持久化中枢)", () => {
    let mockPlugin: any;
    let savedData: Record<string, any>;

    beforeEach(() => {
        savedData = {};
        mockPlugin = {
            loadData: vi.fn(async (file: string) => savedData[file] ?? null),
            saveData: vi.fn(async (file: string, data: any) => {
                savedData[file] = data;
            }),
        };
    });

    it("defaultRuntime 返回符合版本协议的标准空状态", () => {
        const rt = defaultRuntime();
        expect(rt.schemaVersion).toBe(1);
        expect(rt.snoozed).toEqual({});
        expect(rt.muted).toEqual({});
        expect(rt.handledYear).toEqual({});
        expect(rt.handledUntil).toEqual({});
        expect(rt.handled).toEqual({});
        expect(rt.renewHistory).toEqual({});
        expect(rt.memos).toEqual([]);
        expect(rt.namedViews).toEqual([]);
        expect(rt.planDates).toEqual({});
    });

    it("semanticRuntimeFingerprint 剥离易变时间戳，确保实质相同时指纹一致", () => {
        const rt1: HubRuntime = {
            ...defaultRuntime(),
            scannedAt: "2026-10-29T10:00:00.000Z",
            snoozed: { "row-1": "2026-11-01" },
            cache: {
                reminders: [
                    { id: "r-1", moduleId: "certs", ruleKey: "exp", rowId: "1", title: "护照", dueDate: "2026-12-01", daysLeft: 30, level: "soon" },
                ],
                counts: { overdue: 0, soon: 1, lead: 0 },
                errors: [],
                derived: [],
                byModule: {
                    certs: {
                        reminders: [],
                        at: "2026-10-29T10:00:00.000Z", // 易变时间戳
                        rowCount: 10,
                    },
                },
            },
            lastExamStats: { streak: 5, accuracy: 0.9, attempts: 20, generatedAt: 123456 },
            lastCheckinSummary: { items: [], windowDays: 7, pulledAt: 999999 },
        };

        const rt2: HubRuntime = {
            ...defaultRuntime(),
            scannedAt: "2026-10-29T12:30:00.000Z", // 时间不同
            snoozed: { "row-1": "2026-11-01" }, // 实质内容相同
            cache: {
                reminders: [
                    { id: "r-1", moduleId: "certs", ruleKey: "exp", rowId: "1", title: "护照", dueDate: "2026-12-01", daysLeft: 30, level: "soon" },
                ],
                counts: { overdue: 0, soon: 1, lead: 0 },
                errors: [],
                derived: [],
                byModule: {
                    certs: {
                        reminders: [],
                        at: "2026-10-29T12:30:00.000Z", // 时间不同
                        rowCount: 10,
                    },
                },
            },
            lastExamStats: { streak: 5, accuracy: 0.9, attempts: 20, generatedAt: 654321 }, // 时间不同
            lastCheckinSummary: { items: [], windowDays: 7, pulledAt: 888888 }, // 时间不同
        };

        expect(semanticRuntimeFingerprint(rt1)).toBe(semanticRuntimeFingerprint(rt2));

        // 实质修改后指纹应改变
        const rt3: HubRuntime = {
            ...rt1,
            snoozed: { "row-1": "2026-11-02" },
        };
        expect(semanticRuntimeFingerprint(rt1)).not.toBe(semanticRuntimeFingerprint(rt3));
    });

    it("loadRuntime 在数据为空或损坏时安全降级为 defaultRuntime", async () => {
        const rt = await loadRuntime(mockPlugin);
        expect(rt.schemaVersion).toBe(1);
        expect(rt.memos).toEqual([]);
    });

    it("loadRuntime 正常规范化恢复命名视图、备忘与排序偏好", async () => {
        savedData[RUNTIME_NAME] = {
            schemaVersion: 1,
            hubViewMode: "calendar",
            ledgerSortKey: "expiry",
            ledgerSortAsc: true,
            memos: [
                { id: "m-1", title: "交物业费", dueDate: "2026-11-10", createdAt: "2026-10-20T00:00:00Z" },
            ],
            namedViews: [
                { id: "v-1", name: "重要证件", moduleId: "certs" },
            ],
        };

        const rt = await loadRuntime(mockPlugin);
        expect(rt.hubViewMode).toBe("calendar");
        expect(rt.ledgerSortKey).toBe("expiry");
        expect(rt.ledgerSortAsc).toBe(true);
        expect(rt.memos).toHaveLength(1);
        expect(rt.memos[0].title).toBe("交物业费");
        expect(rt.namedViews).toHaveLength(1);
        expect(rt.namedViews?.[0].name).toBe("重要证件");
    });

    it("saveRuntime 自动去重：连续保存实质相同的数据时跳过无意义写盘", async () => {
        const rt = defaultRuntime();
        rt.snoozed = { "row-1": "2026-11-01" };

        await saveRuntime(mockPlugin, rt);
        expect(mockPlugin.saveData).toHaveBeenCalledTimes(1);

        // 仅修改易变时间戳，再次保存
        rt.scannedAt = new Date().toISOString();
        await saveRuntime(mockPlugin, rt);
        // 指纹未变，不会触发第二次实际写盘
        expect(mockPlugin.saveData).toHaveBeenCalledTimes(1);

        // 实质修改，应触发写盘
        rt.snoozed["row-2"] = "2026-11-02";
        await saveRuntime(mockPlugin, rt);
        expect(mockPlugin.saveData).toHaveBeenCalledTimes(2);
    });

    it("withRuntimeSaveLock 确保并发异步写入按顺序串行排队执行", async () => {
        const executionOrder: number[] = [];

        const p1 = withRuntimeSaveLock(mockPlugin, async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            executionOrder.push(1);
        });

        const p2 = withRuntimeSaveLock(mockPlugin, async () => {
            executionOrder.push(2);
        });

        await Promise.all([p1, p2]);
        expect(executionOrder).toEqual([1, 2]);
    });

    it("trash 回收站增删与清空纳入语义指纹，单独修改 trash 时必须触发真实落盘", async () => {
        savedData[RUNTIME_NAME] = {
            schemaVersion: 1,
            trash: [
                {
                    id: "t-1",
                    moduleId: "certs",
                    title: "旧身份证",
                    deletedAt: "2026-10-30T10:00:00.000Z",
                    rowSnapshot: { itemID: "row-1", cells: {} },
                },
                { invalid: true },
            ],
        };

        const rt = await loadRuntime(mockPlugin);
        expect(rt.trash).toHaveLength(1);
        expect(rt.trash?.[0].title).toBe("旧身份证");

        // 清空回收站并保存，指纹必须变化并写入磁盘
        rt.trash = [];
        await saveRuntime(mockPlugin, rt);
        expect(mockPlugin.saveData).toHaveBeenCalledTimes(1);

        // 重新加载验证不会复活僵尸条目
        const reloaded = await loadRuntime(mockPlugin);
        expect(reloaded.trash).toEqual([]);
    });
});
