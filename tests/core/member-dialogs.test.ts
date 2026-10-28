import { describe, it, expect, vi } from "vitest";
import { openMemberReassignDialog, exportMemberVcf } from "@/core/member-dialogs";
import type { FamilyMember } from "@/types";

describe("member-dialogs (家庭成员业务弹窗中枢)", () => {
    const mockMembers: FamilyMember[] = [
        { id: "mem-1", name: "爸爸", role: "self", avItemId: "av-item-1", birthday: "1980-05-10" },
        { id: "mem-2", name: "妈妈", role: "spouse", avItemId: "av-item-2", birthday: "1982-08-15" },
    ];

    it("openMemberReassignDialog 当无活跃绑定成员时拦截提示", () => {
        const showMessageFn = vi.fn();
        openMemberReassignDialog({
            members: [{ id: "mem-3", name: "孩子", role: "child" }], // 无 avItemId
            plugin: {},
            t: (k) => k,
            DialogCls: class {},
            showMessageFn,
        });

        expect(showMessageFn).toHaveBeenCalledWith("members.reassignNoTargets", 4000, "error");
    });

    it("openMemberReassignDialog 具备绑定成员时正常构建改派对话框", () => {
        const querySelector = vi.fn().mockReturnValue({ onclick: null, value: "av-item-2" });
        class MockDialog {
            element = { querySelector };
            destroy = vi.fn();
        }

        (globalThis as any).document = {
            createElement: vi.fn().mockReturnValue({ append: vi.fn() }),
        };

        try {
            expect(() => {
                openMemberReassignDialog({
                    members: mockMembers,
                    plugin: { settings: { members: mockMembers } },
                    t: (k) => k,
                    DialogCls: MockDialog,
                    showMessageFn: vi.fn(),
                });
            }).not.toThrow();

            expect(querySelector).toHaveBeenCalledWith("#lv-reassign-cancel");
            expect(querySelector).toHaveBeenCalledWith("#lv-reassign-confirm");
        } finally {
            delete (globalThis as any).document;
        }
    });

    it("exportMemberVcf 空成员列表直接返回，有成员时请求确认并导出", () => {
        const confirmFn = vi.fn();
        const showMessageFn = vi.fn();

        // 空列表
        exportMemberVcf({
            members: [],
            t: (k) => k,
            showMessageFn,
            confirmFn,
        });
        expect(confirmFn).not.toHaveBeenCalled();

        // 有成员
        exportMemberVcf({
            members: mockMembers,
            t: (k) => k === "members.exportVcfBody" ? "导出 ${n} 条成员" : k,
            showMessageFn,
            confirmFn,
        });
        expect(confirmFn).toHaveBeenCalledWith(
            "members.exportVcf",
            expect.stringContaining("2"),
            expect.any(Function),
        );
    });
});
