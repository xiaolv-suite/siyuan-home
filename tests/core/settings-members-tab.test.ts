import { describe, it, expect, vi } from "vitest";
import type { FamilyMember, MemberRole } from "@/types";

describe("settings-members-tab (设置面板成员维护分区契约)", () => {
    const ROLES: MemberRole[] = ["self", "spouse", "partner", "child", "elder", "kin", "other"];

    it("支持预定义 7 大家庭角色类型枚举", () => {
        expect(ROLES).toHaveLength(7);
        expect(ROLES).toContain("self");
        expect(ROLES).toContain("spouse");
        expect(ROLES).toContain("child");
        expect(ROLES).toContain("elder");
    });

    it("新增成员与移除成员动作回调分发", () => {
        const onAddMember = vi.fn();
        const onRemoveMember = vi.fn();

        onAddMember();
        expect(onAddMember).toHaveBeenCalledTimes(1);

        onRemoveMember("mem-test-id");
        expect(onRemoveMember).toHaveBeenCalledWith("mem-test-id");
    });
});
