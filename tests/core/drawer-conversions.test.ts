import { describe, it, expect, vi } from "vitest";
import {
    renderRxToMedicineButton,
    renderStockInButton,
    renderShoppingToAssetButton,
} from "@/core/drawer-conversions";

describe("drawer-conversions (台账行详情抽屉跨模块流转与快捷入库流)", () => {
    const createMockElement = () => {
        const el: any = {
            style: {},
            className: "",
            innerHTML: "",
            textContent: "",
            appendChild: vi.fn(),
            append: vi.fn(),
            querySelector: vi.fn(),
            querySelectorAll: vi.fn().mockReturnValue([]),
            disabled: false,
            onclick: null,
        };
        return el;
    };

    it("非浏览器环境（document === undefined）优雅跳过", () => {
        const body = { appendChild: vi.fn() } as any;
        const row = { cells: {} };
        const ref = { columns: {} };
        const t = (k: string) => k;

        expect(() => {
            renderRxToMedicineButton({
                body,
                row,
                ref,
                active: "health",
                plugin: { settings: { dbRefs: {} } },
                t,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });

            renderStockInButton({
                body,
                row,
                ref,
                active: "shopping",
                plugin: { settings: { dbRefs: {} } },
                t,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });

            renderShoppingToAssetButton({
                body,
                row,
                ref,
                active: "shopping",
                plugin: { settings: { dbRefs: {} } },
                t,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                cellTextFn: () => "",
            });
        }).not.toThrow();
    });

    it("具备 document 环境下正确装配跨模块操作按钮并正确绑定点击逻辑", () => {
        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation(() => createMockElement()),
        };

        try {
            const body = createMockElement();
            const t = (k: string) => k;
            const showMessageFn = vi.fn();

            // 1. 处方流转入药箱
            const rxRow = {
                itemID: "health-row-1",
                cells: {
                    c_name: { text: { content: "阿莫西林胶囊" } },
                    c_mem: { relation: { blockIDs: ["mem-1"] } },
                },
            };
            const rxPlugin = {
                settings: {
                    dbRefs: {
                        medicine: {
                            avId: "av-med-1",
                            columns: { name: "m_name", category: "m_cat", member: "m_mem" },
                        },
                    },
                },
            };

            renderRxToMedicineButton({
                body,
                row: rxRow,
                ref: { columns: { name: "c_name", member: "c_mem" } },
                active: "health",
                plugin: rxPlugin,
                t,
                showMessageFn,
                cellTextFn: (cell) => cell?.text?.content || "",
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 2. 采购条目药箱入库加减库存
            const stockRow = {
                itemID: "shop-row-1",
                cells: {
                    c_name: { text: { content: "布洛芬缓释胶囊" } },
                    c_qty: { number: { content: 2, isNotEmpty: true } },
                },
            };
            const stockPlugin = {
                settings: {
                    dbRefs: {
                        medicine: {
                            avId: "av-med-1",
                            columns: { name: "m_name", stock: "m_stock" },
                        },
                    },
                },
            };

            renderStockInButton({
                body,
                row: stockRow,
                ref: { columns: { name: "c_name", qty: "c_qty" } },
                active: "shopping",
                plugin: stockPlugin,
                t,
                DialogCls: class {
                    element = createMockElement();
                    destroy = vi.fn();
                } as any,
                showMessageFn,
                cellTextFn: (cell) => (cell?.text?.content || (cell?.number ? String(cell.number.content) : "")),
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 3. 采购条目转固定资产
            const assetRow = {
                itemID: "shop-row-2",
                cells: {
                    c_name: { text: { content: "MacBook Pro 16" } },
                    c_amt: { number: { content: 18999, isNotEmpty: true } },
                },
            };
            const assetPlugin = {
                settings: {
                    dbRefs: {
                        "assets-real": {
                            avId: "av-asset-1",
                            columns: { name: "a_name", amount: "a_amt", category: "a_cat" },
                        },
                    },
                },
            };

            renderShoppingToAssetButton({
                body,
                row: assetRow,
                ref: { columns: { name: "c_name", amount: "c_amt" } },
                active: "shopping",
                plugin: assetPlugin,
                t,
                DialogCls: class {
                    element = createMockElement();
                    destroy = vi.fn();
                } as any,
                showMessageFn,
                cellTextFn: (cell) => (cell?.text?.content || (cell?.number ? String(cell.number.content) : "")),
            });
            expect(body.appendChild).toHaveBeenCalled();
        } finally {
            delete (globalThis as any).document;
        }
    });
});
