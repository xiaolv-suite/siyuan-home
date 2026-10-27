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
                DialogCls: class {
                    element = {
                        querySelector: vi.fn().mockReturnValue(null),
                        querySelectorAll: vi.fn().mockReturnValue([]),
                        classList: { add: vi.fn(), toggle: vi.fn() },
                    };
                    destroy = vi.fn();
                } as any,
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                cellTextFn: (cell: any) => cell?.text?.content || "",
                openNewRecordFn: vi.fn(),
                onReload: vi.fn().mockResolvedValue(undefined),
            })
        ).resolves.not.toThrow();
    });
});
