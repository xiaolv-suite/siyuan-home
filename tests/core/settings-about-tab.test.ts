import { describe, it, expect, vi } from "vitest";

describe("settings-about-tab (管家设置关于与系统诊断面板)", () => {
    it("诊断数据与回调绑定完备性", () => {
        const mockDiag = {
            version: "0.5.156",
            scannedAt: Date.now(),
            ledgers: [
                { id: "certs", provisioned: true, provisional: false, columns: 8 },
                { id: "medicine", provisioned: false, columns: 0, error: "not found" },
            ],
            errors: [{ moduleId: "medicine", message: "台账未就绪" }],
            contracts: ["contract violation: test"],
        };

        const mockPlugin = {
            settings: { members: [{ id: "m-1", avItemId: "" }] },
            getDiagnostics: vi.fn().mockReturnValue(mockDiag),
        };

        const onPreviewDiagnostics = vi.fn();
        const onExportDiagnostics = vi.fn();
        const onRunBackfill = vi.fn();
        const onRunDuplicateCheck = vi.fn();

        expect(mockPlugin.getDiagnostics()).toEqual(mockDiag);

        onPreviewDiagnostics();
        expect(onPreviewDiagnostics).toHaveBeenCalledTimes(1);

        onExportDiagnostics();
        expect(onExportDiagnostics).toHaveBeenCalledTimes(1);

        onRunBackfill();
        expect(onRunBackfill).toHaveBeenCalledTimes(1);

        onRunDuplicateCheck();
        expect(onRunDuplicateCheck).toHaveBeenCalledTimes(1);
    });

    it("空诊断报告时优雅回退", () => {
        const mockPlugin = {
            settings: { members: [] },
            getDiagnostics: vi.fn().mockReturnValue(undefined),
        };

        expect(mockPlugin.getDiagnostics()).toBeUndefined();
    });
});
