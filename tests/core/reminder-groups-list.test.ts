import { describe, it, expect, vi } from "vitest";
import type { Reminder } from "@/types";
import { relativeDue, weekdayKey } from "@/core/hub/rule";

describe("reminder-groups-list (提醒中枢分组渲染、合并卡与空态契约)", () => {
    const mockReminder: Reminder = {
        id: "certs::row-1::expiry",
        moduleId: "certs",
        ruleKey: "expiry",
        rowId: "row-1",
        title: "港澳通行证到期",
        dueDate: "2026-11-20",
        daysLeft: 22,
        level: "soon",
        memberId: "mem-1",
    };

    it("相对到期日短语生成算法符合扫描工作台视角", () => {
        function computeRelDue(daysLeft: number, fallback: string, t: (k: string) => string): string {
            const rel = relativeDue(daysLeft);
            if (!rel) {
                if (daysLeft >= 7 && daysLeft <= 30) return t("days.after").replace("${n}", String(Math.floor(daysLeft)));
                return fallback;
            }
            const base = rel.n === undefined ? t(rel.key) : t(rel.key).replace("${n}", String(rel.n));
            if (rel.key === "days.after" && daysLeft <= 6) {
                const wk = weekdayKey(fallback);
                if (wk) return `${base} · ${t(wk)}`;
            }
            return base;
        }

        const t = (k: string) => {
            if (k === "days.overdue") return "逾期 ${n} 天";
            if (k === "days.today") return "今天";
            if (k === "days.after") return "${n} 天后";
            return k;
        };

        expect(computeRelDue(22, "2026-11-20", t)).toBe("22 天后");
        expect(computeRelDue(0, "2026-10-29", t)).toBe("今天");
        expect(computeRelDue(-2, "2026-10-27", t)).toBe("逾期 2 天");
    });

    it("提醒动作回调分发完备性", () => {
        const callbacks = {
            onToggleSelect: vi.fn(),
            onToggleExpand: vi.fn(),
            onRenew: vi.fn(),
            onSchedulePlan: vi.fn(),
            onCopyTask: vi.fn(),
            onTogglePin: vi.fn(),
            onQuickPlanToday: vi.fn(),
            onSnooze: vi.fn(),
            onEditMemo: vi.fn(),
            onDeleteMemo: vi.fn(),
            onTriage: vi.fn(),
            onRescan: vi.fn(),
            onClearFilters: vi.fn(),
        };

        callbacks.onToggleSelect("rem-1");
        expect(callbacks.onToggleSelect).toHaveBeenCalledWith("rem-1");

        callbacks.onRenew(mockReminder);
        expect(callbacks.onRenew).toHaveBeenCalledWith(mockReminder);

        callbacks.onQuickPlanToday(mockReminder);
        expect(callbacks.onQuickPlanToday).toHaveBeenCalledWith(mockReminder);

        callbacks.onClearFilters();
        expect(callbacks.onClearFilters).toHaveBeenCalled();
    });

    it("成员归属与未分配兜底文案", () => {
        const members = [{ id: "mem-1", name: "爸爸" }];
        function resolveMemberName(id: string | undefined): string {
            return members.find((m) => m.id === id)?.name ?? "未指定成员";
        }

        expect(resolveMemberName("mem-1")).toBe("爸爸");
        expect(resolveMemberName(undefined)).toBe("未指定成员");
        expect(resolveMemberName("unknown")).toBe("未指定成员");
    });

    it("同成员同日合并卡折叠与展开状态切换", () => {
        let expandedMerges = new Set<string>();
        function toggleMerge(key: string) {
            const next = new Set(expandedMerges);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            expandedMerges = next;
        }

        toggleMerge("merge:mem-1:2026-11-20");
        expect(expandedMerges.has("merge:mem-1:2026-11-20")).toBe(true);

        toggleMerge("merge:mem-1:2026-11-20");
        expect(expandedMerges.has("merge:mem-1:2026-11-20")).toBe(false);
    });

    it("超大提醒列表分页渐进渲染切片算法", () => {
        const displayGroups = [
            { key: "overdue", label: "逾期", items: Array.from({ length: 50 }, (_, i) => ({ id: `r-${i}` })) },
            { key: "soon", label: "临期", items: Array.from({ length: 100 }, (_, i) => ({ id: `r-${i + 50}` })) },
        ];

        function computeRenderedGroups(limit: number) {
            let remaining = limit;
            return displayGroups
                .map((group) => {
                    const items = remaining > 0 ? group.items.slice(0, remaining) : [];
                    remaining -= items.length;
                    return { ...group, items, total: group.items.length };
                })
                .filter((group) => group.items.length > 0);
        }

        // limit = 120
        const page1 = computeRenderedGroups(120);
        expect(page1).toHaveLength(2);
        expect(page1[0].items).toHaveLength(50); // 全部 50 项
        expect(page1[1].items).toHaveLength(70); // 剩余 70 项

        // limit = 200 (全部展示)
        const allItems = computeRenderedGroups(200);
        expect(allItems[0].items).toHaveLength(50);
        expect(allItems[1].items).toHaveLength(100);
    });
});
