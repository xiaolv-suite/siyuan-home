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
});
