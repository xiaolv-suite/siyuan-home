import { describe, it, expect, vi } from "vitest";
import { renderModuleSpecificSections } from "@/core/drawer-module-sections";

describe("drawer-module-sections (各生活模块专属扩展板块分发中枢)", () => {
    const mockRow = {
        itemID: "row-item-1",
        cells: {
            c_name: { text: { content: "测试条目" } },
            c_amount: { number: { content: 5000, isNotEmpty: true } },
            c_date: { date: { content: 1730000000000, isNotEmpty: true } },
        },
    };

    const mockRef = {
        avId: "av-test-1",
        docId: "doc-test-1",
        columns: {
            name: "c_name",
            amount: "c_amount",
            date: "c_date",
        },
    };

    const mockPlugin = {
        settings: {
            dbRefs: {},
            members: [],
        },
    };

    it("非浏览器环境（document === undefined）优雅跳过", async () => {
        await expect(renderModuleSpecificSections({
            body: {} as any,
            active: "assets-real",
            row: mockRow,
            ref: mockRef,
            plugin: mockPlugin,
            t: (k) => k,
            DialogCls: class {},
            showMessageFn: vi.fn(),
            renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
            cellTextFn: () => "测试",
            rawFromValue: () => "2026-10-28",
            addRowLogSection: vi.fn().mockResolvedValue(undefined),
        })).resolves.not.toThrow();
    });

    it("在具备 document 环境下安全分发对应模块板块", async () => {
        const mockElement = {
            style: {},
            className: "",
            appendChild: vi.fn(),
            append: vi.fn(),
            replaceChildren: vi.fn(),
            innerHTML: "",
            onclick: null,
        };
        (globalThis as any).document = {
            createElement: vi.fn().mockReturnValue(mockElement),
        };

        const addRowLogSection = vi.fn().mockResolvedValue(undefined);

        try {
            await renderModuleSpecificSections({
                body: mockElement as any,
                active: "assets-real",
                row: mockRow,
                ref: mockRef,
                plugin: mockPlugin,
                t: (k) => k,
                DialogCls: class {},
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                cellTextFn: () => "测试",
                rawFromValue: (_type, _v) => "2026-10-01",
                addRowLogSection,
            });

            expect(addRowLogSection).toHaveBeenCalled();
        } finally {
            delete (globalThis as any).document;
        }
    });
});
