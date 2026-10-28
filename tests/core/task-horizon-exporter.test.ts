import { describe, expect, it } from "vitest";
import {
    formatReminderAsTaskHorizonItem,
    formatRemindersAsTaskHorizonChecklist,
} from "@/core/task-horizon-exporter";
import type { Reminder } from "@/types";

describe("管家到期提醒向 Task Horizon 标准任务块导出", () => {
    const mockOverdue: Reminder = {
        id: "r1::vehicle.insurance",
        moduleId: "vehicle",
        ruleKey: "insurance",
        rowId: "20261028-row1",
        title: "保时捷车险续保",
        dueDate: "2026-10-31",
        daysLeft: -3,
        level: "overdue",
    };

    const mockSoon: Reminder = {
        id: "r2::property.fee",
        moduleId: "property",
        ruleKey: "fee",
        rowId: "20261028-row2",
        title: "第四季度物业费缴纳",
        dueDate: "2026-11-05",
        daysLeft: 8,
        level: "soon",
    };

    it("单个逾期提醒规范转换为带 high 优先级与反链的 Task Horizon 任务行", () => {
        const md = formatReminderAsTaskHorizonItem(mockOverdue, { moduleName: "车辆管理" });
        expect(md).toContain("- [ ] 【❗逾期待办·车辆管理】保时捷车险续保");
        expect(md).toContain('custom-status="todo"');
        expect(md).toContain('custom-priority="high"');
        expect(md).toContain('custom-completion-time="2026-10-31"');
        expect(md).toContain("custom-remark=\"(( 20261028-row1 '管家·车辆管理' ))\"");
    });

    it("批量提醒转换为带大标题的多行清单", () => {
        const listMd = formatRemindersAsTaskHorizonChecklist([mockOverdue, mockSoon], {
            headerTitle: "家庭到期事务清单",
            moduleMap: { vehicle: "车辆", property: "房产" },
        });
        expect(listMd).toContain("## 家庭到期事务清单");
        expect(listMd).toContain("【❗逾期待办·车辆】保时捷车险续保");
        expect(listMd).toContain("【生活待办·房产】第四季度物业费缴纳");
        expect(listMd.split("\n").filter((l) => l.startsWith("- [ ]"))).toHaveLength(2);
    });

    it("空输入或异常数据安全降级", () => {
        expect(formatReminderAsTaskHorizonItem(null as any)).toBe("");
        expect(formatRemindersAsTaskHorizonChecklist([])).toBe("");
    });
});
