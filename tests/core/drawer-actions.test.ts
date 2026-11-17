import { describe, it, expect, vi } from "vitest";
import {
    bindDrawerMoreActions,
    renderDrawerEditMode,
    renderDrawerDocTemplates,
    bindDrawerRowOperations,
} from "@/core/drawer-actions";

describe("drawer-actions (台账抽屉更多操作菜单绑定器与行操作引擎)", () => {
    it("bindDrawerMoreActions 安全边界与事件绑定", () => {
        const mockDlg = {
            element: {
                querySelector: vi.fn().mockReturnValue(null),
                querySelectorAll: vi.fn().mockReturnValue([]),
            },
        };

        expect(() => {
            bindDrawerMoreActions({
                dlg: mockDlg,
                row: { itemID: "row-1", cells: {} },
                cardTitle: "测试记录",
                cardDeepLink: "siyuan://blocks/row-1",
                cardRows: [{ label: "名称", value: "测试记录" }],
                active: "certs",
                ref: { avId: "av-1", docId: "doc-1", columns: {} },
                t: (k: string) => k,
                showMessageFn: vi.fn(),
                cellTextFn: () => "测试",
            });
        }).not.toThrow();
    });

    it("renderDrawerEditMode 在非浏览器环境下优雅跳过", () => {
        expect(() => {
            renderDrawerEditMode({
                body: {} as any,
                dlg: { element: { querySelector: vi.fn().mockReturnValue(null) } },
                row: { itemID: "row-1", cells: {} },
                ref: { avId: "av-1", columns: {} },
                active: "certs",
                schemaCols: [],
                plugin: {},
                t: (k: string) => k,
                rawFromValueFn: () => "",
                showMessageFn: vi.fn(),
                onCancel: vi.fn(),
                onReload: vi.fn().mockResolvedValue(undefined),
            });
        }).not.toThrow();
    });

    it("renderDrawerDocTemplates 在非DOM与具备DOM时正确安全调用", () => {
        expect(() => {
            renderDrawerDocTemplates({
                body: {} as any,
                dlg: { element: { querySelector: vi.fn() } },
                row: { itemID: "row-1", cells: {} },
                ref: { avId: "av-1", docId: "doc-1", columns: {} },
                active: "certs",
                schemaCols: [],
                plugin: { schemaCatalog: { certs: { templates: [{ key: "cert_tpl", nameKey: "tpl.cert", file: "certs.md" }] } } },
                t: (k: string) => k,
                cellTextFn: () => "测试",
                showMessageFn: vi.fn(),
            });
        }).not.toThrow();
    });

    it("bindDrawerRowOperations 绑定复制副本与删除操作", () => {
        (globalThis as any).document = {};
        try {
            const dupBtn = { onclick: null as any };
            const delBtn = { onclick: null as any };
            const mockDlg = {
                element: {
                    querySelector: vi.fn().mockImplementation((sel: string) => {
                        if (sel === "#lv-detail-duplicate") return dupBtn;
                        if (sel === "#lv-detail-del") return delBtn;
                        return null;
                    }),
                },
                destroy: vi.fn(),
            };

            const openNewRecordFn = vi.fn();
            const onReload = vi.fn().mockResolvedValue(undefined);

            bindDrawerRowOperations({
                dlg: mockDlg,
                row: {
                    itemID: "row-1",
                    cells: {
                        c_name: { text: { content: "护照原件" } },
                    },
                },
                ref: { avId: "av-1", docId: "doc-1", columns: { name: "c_name" } },
                active: "certs",
                schemaCols: [{ key: "name", type: "text" }],
                plugin: { runtime: {}, settings: { dbRefs: {} } },
                t: (k: string) => k,
                cellTextFn: (cell) => cell?.text?.content || "",
                showMessageFn: vi.fn(),
                openNewRecordFn,
                onReload,
            });

            expect(dupBtn.onclick).toBeDefined();
            expect(delBtn.onclick).toBeDefined();

            // 触发复制副本
            dupBtn.onclick();
            expect(openNewRecordFn).toHaveBeenCalledWith(expect.objectContaining({ name: "护照原件 (副本)" }));
        } finally {
            delete (globalThis as any).document;
        }
    });
});
