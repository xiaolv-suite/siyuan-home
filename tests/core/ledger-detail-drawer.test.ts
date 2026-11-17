import { describe, it, expect, vi } from "vitest";
import { openLedgerDetailDrawer } from "@/core/ledger-detail-drawer";

describe("ledger-detail-drawer (台账行详情抽屉完整驱动引擎)", () => {
    it("openLedgerDetailDrawer 安全防御与挂载调用", async () => {
        const mockRow = {
            itemID: "row-detail-1",
            cells: {
                c_name: { type: "text", text: { content: "家庭医保卡" } },
                c_category: { type: "select", select: { content: "insurance" } },
            },
        };

        const originalDoc = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation(() => ({
                className: "",
                style: {},
                dataset: {},
                appendChild: vi.fn(),
                append: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                setAttribute: vi.fn(),
                getAttribute: vi.fn(),
                removeAttribute: vi.fn(),
                classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
            })),
        };

        let dialogContent = "";
        class TestDialog {
            element = {
                querySelector: vi.fn().mockImplementation((sel: string) => ({
                    onclick: vi.fn(),
                    classList: { add: vi.fn(), toggle: vi.fn() },
                    appendChild: vi.fn(),
                    append: vi.fn(),
                })),
                querySelectorAll: vi.fn().mockReturnValue([]),
                classList: { add: vi.fn(), toggle: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            destroy = vi.fn();
            constructor(options: { content: string }) {
                dialogContent = options.content;
            }
        }

        try {
            await expect(
                openLedgerDetailDrawer({
                    row: mockRow,
                    ref: {
                        avId: "av-detail",
                        columns: {
                            name: "c_name",
                            category: "c_category",
                        },
                    },
                    active: "certs",
                    plugin: {
                        settings: { dbRefs: {}, members: [] },
                        schemaCatalog: {
                            certs: {
                                columns: [
                                    { key: "name", name: "名称", type: "text" },
                                    { key: "category", name: "类别", type: "select" },
                                ],
                            },
                        },
                        runtime: {},
                    },
                    t: (k: string) => k,
                    DialogCls: TestDialog as any,
                    showMessageFn: vi.fn(),
                    renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                    cellTextFn: (cell: any) => cell?.text?.content || "",
                    openNewRecordFn: vi.fn(),
                    onReload: vi.fn().mockResolvedValue(undefined),
                })
            ).resolves.not.toThrow();

            expect(dialogContent).toContain("lv-ui-icon");
            expect(dialogContent).not.toContain("📋");
            expect(dialogContent).not.toContain("🔗");
            expect(dialogContent).not.toContain("📑");
            expect(dialogContent).not.toContain("☑️");
            expect(dialogContent).not.toContain("📖");
        } finally {
            if (originalDoc !== undefined) (globalThis as any).document = originalDoc;
            else delete (globalThis as any).document;
        }
    });

    it("续期流水历史使用 forward 矢量图标替代 Unicode 字符箭头", async () => {
        const mockRow = {
            itemID: "row-detail-2",
            cells: {
                c_name: { type: "text", text: { content: "护照" } },
            },
        };

        const createdElements: any[] = [];
        const originalDoc = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation(() => {
                const el: any = {
                    className: "",
                    style: {},
                    dataset: {},
                    innerHTML: "",
                    textContent: "",
                    appendChild: vi.fn(),
                    append: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    setAttribute: vi.fn(),
                    getAttribute: vi.fn(),
                    removeAttribute: vi.fn(),
                    classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
                };
                createdElements.push(el);
                return el;
            }),
        };

        class TestDialog {
            element = {
                querySelector: vi.fn().mockImplementation(() => ({
                    onclick: vi.fn(),
                    appendChild: vi.fn(),
                    append: vi.fn(),
                    classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
                })),
                querySelectorAll: vi.fn().mockReturnValue([]),
                classList: { add: vi.fn(), toggle: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            destroy = vi.fn();
            constructor(_opts: any) {}
        }

        try {
            await openLedgerDetailDrawer({
                row: mockRow,
                ref: {
                    avId: "av-detail",
                    columns: { name: "c_name" },
                },
                active: "certs",
                plugin: {
                    settings: { dbRefs: {}, members: [] },
                    schemaCatalog: {
                        certs: { columns: [{ key: "name", name: "名称", type: "text" }] },
                    },
                    runtime: {
                        renewHistory: {
                            "row-detail-2": [{ from: "2016-01-01", to: "2026-01-01", at: "2026-01-01T00:00:00Z" }],
                        },
                    },
                },
                t: (k: string) => k,
                DialogCls: TestDialog as any,
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                cellTextFn: (cell: any) => cell?.text?.content || "",
                openNewRecordFn: vi.fn(),
                onReload: vi.fn().mockResolvedValue(undefined),
            });

            const historyLine = createdElements.find((el) => el.className?.includes("lv-dialog-row-text") && el.innerHTML?.includes("2016-01-01"));
            expect(historyLine).toBeDefined();
            expect(historyLine.innerHTML).toContain("lv-ui-icon");
            expect(historyLine.innerHTML).not.toContain("→");
        } finally {
            if (originalDoc !== undefined) (globalThis as any).document = originalDoc;
            else delete (globalThis as any).document;
        }
    });

    it("当行包含存放位置字段时，安全渲染同处空间速查按钮", async () => {
        const mockRow = {
            itemID: "row-detail-loc",
            cells: {
                c_name: { type: "text", text: { content: "护照原件" } },
                c_loc: { type: "text", text: { content: "主卧 › 大衣柜 › 顶层文件箱" } },
            },
        };

        const createdElements: any[] = [];
        const originalDoc = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation((tag: string) => {
                const el: any = {
                    tagName: tag.toUpperCase(),
                    className: "",
                    style: {},
                    dataset: {},
                    innerHTML: "",
                    textContent: "",
                    appendChild: vi.fn(),
                    append: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    setAttribute: vi.fn(),
                    getAttribute: vi.fn(),
                    removeAttribute: vi.fn(),
                    classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn().mockReturnValue(false) },
                };
                createdElements.push(el);
                return el;
            }),
        };

        class TestDialog {
            element = {
                querySelector: vi.fn().mockImplementation(() => ({
                    onclick: vi.fn(),
                    appendChild: vi.fn(),
                    append: vi.fn(),
                    classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
                })),
                querySelectorAll: vi.fn().mockReturnValue([]),
                classList: { add: vi.fn(), toggle: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            destroy = vi.fn();
            constructor(_opts: any) {}
        }

        try {
            await openLedgerDetailDrawer({
                row: mockRow,
                ref: {
                    avId: "av-detail",
                    columns: { name: "c_name", location: "c_loc" },
                },
                active: "certs",
                plugin: {
                    settings: { dbRefs: {}, members: [] },
                    schemaCatalog: {
                        certs: {
                            columns: [
                                { key: "name", name: "名称", type: "text" },
                                { key: "location", name: "存放位置", type: "text" },
                            ],
                        },
                    },
                    runtime: {},
                },
                t: (k: string) => k,
                DialogCls: TestDialog as any,
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({
                    complete: true,
                    rows: [
                        mockRow,
                        {
                            itemID: "row-detail-sibling",
                            cells: {
                                c_name: { type: "text", text: { content: "港澳通行证" } },
                                c_loc: { type: "text", text: { content: "主卧 › 大衣柜 › 顶层文件箱" } },
                            },
                        },
                    ],
                }),
                cellTextFn: (cell: any) => cell?.text?.content || "",
                openNewRecordFn: vi.fn(),
                onReload: vi.fn().mockResolvedValue(undefined),
            });

            const siblingBtn = createdElements.find((el) => el.innerHTML?.includes("ledger.locSiblings"));
            expect(siblingBtn).toBeDefined();
        } finally {
            if (originalDoc !== undefined) (globalThis as any).document = originalDoc;
            else delete (globalThis as any).document;
        }
    });
});
