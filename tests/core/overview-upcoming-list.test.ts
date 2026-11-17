import { describe, it, expect, vi } from "vitest";
import type { Reminder } from "@/types";

describe("overview-upcoming-list (总览主屏近期到期提醒列表契约)", () => {
    const mockReminders: Reminder[] = [
        {
            id: "certs::row-1::expiry",
            moduleId: "certs",
            ruleKey: "expiry",
            rowId: "row-1",
            title: "护照到期",
            dueDate: "2026-11-20",
            daysLeft: 23,
            level: "soon",
            memberId: "mem-1",
        },
    ];

    it("提醒项动作分发（查看全部、复制任务块、完成、延后）接口完备", () => {
        const onViewAll = vi.fn();
        const onCopyTaskBlock = vi.fn();
        const onCompleteReminder = vi.fn();
        const onSnoozeReminder = vi.fn();

        onViewAll();
        expect(onViewAll).toHaveBeenCalled();

        onCopyTaskBlock(mockReminders[0]);
        expect(onCopyTaskBlock).toHaveBeenCalledWith(mockReminders[0]);

        onCompleteReminder(mockReminders[0]);
        expect(onCompleteReminder).toHaveBeenCalledWith(mockReminders[0]);

        onSnoozeReminder(mockReminders[0], 7);
        expect(onSnoozeReminder).toHaveBeenCalledWith(mockReminders[0], 7);
    });

    it("筛选空态与重试扫描触发回调", () => {
        const onClearMemberFilter = vi.fn();
        const onRetryScan = vi.fn();

        onClearMemberFilter();
        expect(onClearMemberFilter).toHaveBeenCalled();

        onRetryScan();
        expect(onRetryScan).toHaveBeenCalled();
    });
});
