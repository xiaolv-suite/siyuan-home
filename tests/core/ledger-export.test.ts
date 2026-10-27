import { describe, it, expect, vi } from "vitest";
import {
    exportLedgerCsv,
    exportArchiveManifestFile,
    printLedgerLabels,
    exportLedgerIcsFile,
    HIGH_CONSEQUENCE_MODULES,
} from "@/core/ledger-export";

describe("ledger-export (台账导出、归档与打印引擎)", () => {
    it("敏感模块常量包含核心财务与健康档案", () => {
        expect(HIGH_CONSEQUENCE_MODULES.has("health")).toBe(true);
        expect(HIGH_CONSEQUENCE_MODULES.has("certs")).toBe(true);
        expect(HIGH_CONSEQUENCE_MODULES.has("assets-real")).toBe(true);
    });

    it("空数据或缺少列时安全防御不抛错", async () => {
        const showMessageFn = vi.fn();

        await expect(
            exportLedgerCsv({
                sourceRef: undefined,
                moduleId: "stock",
                searchText: "",
                sortAsc: true,
                t: (k) => k,
                showMessageFn,
                renderLedgerAllFn: vi.fn(),
                cellTextFn: () => "",
                rowMatchesSearchFn: () => true,
                sortRowsFn: (r) => r,
            })
        ).resolves.not.toThrow();

        await expect(
            exportArchiveManifestFile({
                sourceRef: undefined,
                moduleId: "certs",
                t: (k) => k,
                showMessageFn,
                renderLedgerAllFn: vi.fn(),
                cellTextFn: () => "",
            })
        ).resolves.not.toThrow();

        await expect(
            printLedgerLabels({
                sourceRef: undefined,
                searchText: "",
                t: (k) => k,
                showMessageFn,
                renderLedgerAllFn: vi.fn(),
                cellTextFn: () => "",
                rowMatchesSearchFn: () => true,
            })
        ).resolves.not.toThrow();

        await expect(
            exportLedgerIcsFile({
                sourceRef: undefined,
                moduleId: "house",
                t: (k) => k,
                showMessageFn,
                renderLedgerAllFn: vi.fn(),
                cellTextFn: () => "",
            })
        ).resolves.not.toThrow();
    });
});
