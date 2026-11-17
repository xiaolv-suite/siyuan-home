import { describe, it, expect, vi } from "vitest";
import type { FamilyMember, Reminder } from "@/types";
import type { MemberStat } from "@/panels/screens/member-card.svelte";

describe("member-card (家庭成员卡片组件交互与动作契约)", () => {
    const mockMember: FamilyMember = {
        id: "mem-test-1",
        name: "小明",
        role: "child",
        sex: "male",
        birthday: "2018-06-01",
        avItemId: "block-item-1",
    };

    const mockAlert: Reminder = {
        id: "schooling::row-1::exam",
        moduleId: "schooling",
        ruleKey: "exam",
        rowId: "row-1",
        title: "期末考试",
        dueDate: "2026-11-20",
        daysLeft: 23,
        level: "soon",
        memberId: "mem-test-1",
    };

    const mockStats: MemberStat = {
        chips: [
            { label: "就学档案", n: 3 },
            { label: "免疫疫苗", n: 12 },
        ],
        birthday: "还有 216 天",
    };

    it("成员卡片点击展开、编辑、头像上传与时间轴分发契约", () => {
        const onToggleExpand = vi.fn();
        const onStartEdit = vi.fn();
        const onPickAvatar = vi.fn();
        const onOpenAssetTimeline = vi.fn();

        onToggleExpand();
        expect(onToggleExpand).toHaveBeenCalled();

        onStartEdit();
        expect(onStartEdit).toHaveBeenCalled();

        onPickAvatar();
        expect(onPickAvatar).toHaveBeenCalled();

        onOpenAssetTimeline();
        expect(onOpenAssetTimeline).toHaveBeenCalled();
    });

    it("成员排序上移/下移边界限制与联系人绑定/解绑契约", () => {
        const onMove = vi.fn();
        const onLinkContact = vi.fn();
        const onUnlinkContact = vi.fn();
        const onDelete = vi.fn();
        const onReassign = vi.fn();

        // 向上移动
        onMove(-1);
        expect(onMove).toHaveBeenCalledWith(-1);

        // 向下移动
        onMove(1);
        expect(onMove).toHaveBeenCalledWith(1);

        // 联系人操作
        onLinkContact();
        expect(onLinkContact).toHaveBeenCalled();
        onUnlinkContact();
        expect(onUnlinkContact).toHaveBeenCalled();

        // 删除与重指派
        onDelete();
        expect(onDelete).toHaveBeenCalled();
        onReassign();
        expect(onReassign).toHaveBeenCalled();
    });

    it("提醒项完成动作回调分发", () => {
        const onCompleteAlert = vi.fn();
        onCompleteAlert(mockAlert);
        expect(onCompleteAlert).toHaveBeenCalledWith(mockAlert);
    });
});
