import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvBackup, lvEcosystem } from "@/libs/notice";

describe("lvBackup & lvEcosystem (Epoch 7 Phase 4: 全生态联合灾备与自省闭环测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lvBackup 支持插件注册备份与恢复切面并支持注销", async () => {
        const mockBackup = vi.fn().mockResolvedValue({ hello: "world" });
        const mockRestore = vi.fn().mockResolvedValue(true);

        const unregister = lvBackup.register("test-plugin", mockBackup, mockRestore);
        expect(typeof unregister).toBe("function");

        const diag = lvEcosystem.getDiagnostics();
        expect(diag.registeredPlugins).toContain("test-plugin");

        unregister();
        const afterDiag = lvEcosystem.getDiagnostics();
        expect(afterDiag.registeredPlugins).not.toContain("test-plugin");
    });

    it("lvBackup.exportFull 能够聚合生成规范的全家桶总备份包", async () => {
        const unregA = lvBackup.register("plugin-a", async () => ({ keyA: "valA" }), async () => true);
        const unregB = lvBackup.register("plugin-b", async () => ({ keyB: 123 }), async () => true);

        const fullBackup = await lvBackup.exportFull();
        expect(fullBackup.v).toBe(1);
        expect(fullBackup.ecosystem).toBe("xiaolv");
        expect(fullBackup.exportedAt).toBeDefined();
        expect(fullBackup.plugins["plugin-a"]?.data).toEqual({ keyA: "valA" });
        expect(fullBackup.plugins["plugin-b"]?.data).toEqual({ keyB: 123 });

        unregA();
        unregB();
    });

    it("lvBackup.restoreFull 能够调度各插件恢复切面并反馈成功/失败清单", async () => {
        let restoredData: any = null;
        const unreg = lvBackup.register(
            "plugin-success",
            async () => ({ ok: true }),
            async (data) => {
                restoredData = data;
                return true;
            }
        );

        const bundle: any = {
            v: 1,
            ecosystem: "xiaolv",
            exportedAt: new Date().toISOString(),
            plugins: {
                "plugin-success": {
                    plugin: "plugin-success",
                    version: "latest",
                    exportedAt: new Date().toISOString(),
                    data: { restoredKey: "restoredVal" },
                },
                "plugin-unregistered": {
                    plugin: "plugin-unregistered",
                    version: "latest",
                    exportedAt: new Date().toISOString(),
                    data: {},
                },
            },
        };

        const result = await lvBackup.restoreFull(bundle);
        expect(result.success).toContain("plugin-success");
        expect(result.failed.some((f) => f.includes("plugin-unregistered"))).toBe(true);
        expect(restoredData).toEqual({ restoredKey: "restoredVal" });

        unreg();
    });

    it("lvEcosystem.getStatusBadgeText 输出符合规范的协同胶囊文字", () => {
        const text = lvEcosystem.getStatusBadgeText();
        expect(typeof text).toBe("string");
        expect(text).toContain("🐴 小驴全家桶");
        expect(text).toContain("今日活动");
    });
});
