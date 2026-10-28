import { describe, it, expect, vi } from "vitest";
import {
    renderRenewChainSection,
    renderFavorsSyncSection,
    renderRxToMedicineButton,
    renderStockInButton,
    renderShoppingToAssetButton,
} from "@/core/drawer-sections";

describe("drawer-sections (台账详情抽屉专属扩展区块与跨台账联动)", () => {
    it("各联动函数在无DOM或缺字段环境安全防护", () => {
        const body = { appendChild: vi.fn() } as any;

        expect(() => {
            renderRenewChainSection({
                body,
                row: { cells: {} },
                rows: [],
                ref: { columns: {} },
                active: "certs",
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });

            renderFavorsSyncSection({
                body,
                row: { cells: {} },
                ref: { columns: {} },
                active: "favors",
                plugin: {},
                t: (k) => k,
                showMessageFn: vi.fn(),
                selectContentFn: () => undefined,
                rawDateFn: () => "",
            });

            renderRxToMedicineButton({
                body,
                row: { cells: {} },
                ref: { columns: {} },
                active: "health",
                plugin: { settings: { dbRefs: {} } },
                t: (k) => k,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });

            renderStockInButton({
                body,
                row: { cells: {} },
                ref: { columns: {} },
                active: "shopping",
                plugin: { settings: { dbRefs: {} } },
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });

            renderShoppingToAssetButton({
                body,
                row: { cells: {} },
                ref: { columns: {} },
                active: "shopping",
                plugin: { settings: { dbRefs: {} } },
                t: (k) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });
        }).not.toThrow();
    });

    it("renderRowLogSection 与 renderDrawerQrSection 在非DOM环境安全跳过", async () => {
        const { renderRowLogSection, renderDrawerQrSection } = await import("@/core/drawer-sections");

        await expect(
            renderRowLogSection({
                body: {} as any,
                row: { itemID: "row-1", cells: {} },
                active: "health",
                t: (k) => k,
                showMessageFn: vi.fn(),
                title: "用药记录",
                emptyText: "无记录",
                addLabel: "添加",
                fields: [],
                load: vi.fn().mockResolvedValue([]),
                add: vi.fn().mockResolvedValue(true),
                remove: vi.fn().mockResolvedValue(undefined),
                format: () => "",
            })
        ).resolves.toBeUndefined();

        expect(() => {
            renderDrawerQrSection({
                body: {} as any,
                row: { itemID: "row-1", cells: {} },
                ref: { docId: "doc-1" },
                active: "certs",
                t: (k) => k,
            });
        }).not.toThrow();
    });
});
