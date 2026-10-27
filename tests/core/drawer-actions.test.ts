import { describe, it, expect, vi } from "vitest";
import { bindDrawerMoreActions } from "@/core/drawer-actions";

describe("drawer-actions (台账抽屉更多操作菜单绑定器)", () => {
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
});
