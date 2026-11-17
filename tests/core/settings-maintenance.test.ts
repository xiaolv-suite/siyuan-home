import { describe, it, expect, vi } from "vitest";
import {
    cloneSettings,
    settingHintText,
    openDiagnosticsPreviewDialog,
    executeDeepHealthCheck,
    executeDuplicateLedgerCheck,
    executeAdoptHistoryLedgers,
    executeGenerateDemo,
    executeClearDemo,
} from "@/core/settings-maintenance";
import type { HomeSettings } from "@/types";

describe("settings-maintenance (设置面板维护与诊断分发中枢)", () => {
    const mockSettings: HomeSettings = {
        enabledModules: ["certs", "vehicles"],
        members: [{ id: "m-1", name: "张三", role: "self" }],
        leadOverrides: {},
        notifyHour: 8,
        silentFrom: 22,
        silentTo: 8,
        dbRefs: {},
    };

    const mockPlugin = {
        settings: mockSettings,
        getDiagnostics: vi.fn().mockReturnValue({
            version: "0.5.135",
            scannedAt: Date.now(),
            errors: [],
            ledgers: [
                { id: "certs", provisioned: true, provisional: false, columns: 5 },
            ],
            contracts: [],
        }),
        adoptHistoryLedgers: vi.fn().mockResolvedValue({ adoptedCount: 1, adoptedModules: ["证件"] }),
        ensureCoreLedgers: vi.fn().mockResolvedValue({ issues: [] }),
        refreshHub: vi.fn().mockResolvedValue(undefined),
    };

    class MockDialog {
        element = {
            querySelector: vi.fn().mockReturnValue({
                onclick: vi.fn(),
            }),
        };
        destroy = vi.fn();
    }

    it("cloneSettings 能够彻底深拷贝对象切断引用", () => {
        const copy = cloneSettings(mockSettings);
        expect(copy).toEqual(mockSettings);
        copy.enabledModules.push("stock");
        expect(mockSettings.enabledModules).not.toContain("stock");
    });

    it("settingHintText 语言偏好判断", () => {
        expect(settingHintText((k) => k === "settings.importDone" ? "导入完成" : k, "中文提示", "English hint")).toBe("中文提示");
        expect(settingHintText((k) => k === "settings.importDone" ? "Import finished" : k, "中文提示", "English hint")).toBe("English hint");
    });

    it("openDiagnosticsPreviewDialog 安全挂载并展示关键健康指标", () => {
        const showMessageFn = vi.fn();
        expect(() => {
            openDiagnosticsPreviewDialog(mockPlugin, (k) => k, MockDialog, showMessageFn);
        }).not.toThrow();
    });

    it("executeDeepHealthCheck 运行全库健康巡检", async () => {
        const showMessageFn = vi.fn();
        await expect(executeDeepHealthCheck(mockPlugin, (k) => k, showMessageFn)).resolves.not.toThrow();
    });

    it("executeDuplicateLedgerCheck 运行重复台账检测", async () => {
        const showMessageFn = vi.fn();
        await expect(executeDuplicateLedgerCheck(mockPlugin, (k) => k, showMessageFn)).resolves.not.toThrow();
    });

    it("executeAdoptHistoryLedgers 运行历史版本台账找回", async () => {
        const showMessageFn = vi.fn();
        await expect(executeAdoptHistoryLedgers(mockPlugin, (k) => k, showMessageFn)).resolves.not.toThrow();
    });

    it("executeGenerateDemo 与 executeClearDemo 运行示例数据管理", async () => {
        const showMessageFn = vi.fn();
        await expect(executeGenerateDemo(mockPlugin, (k) => k, showMessageFn)).resolves.not.toThrow();
        expect(() => executeClearDemo(mockPlugin, (k) => k, showMessageFn)).not.toThrow();
    });
});
