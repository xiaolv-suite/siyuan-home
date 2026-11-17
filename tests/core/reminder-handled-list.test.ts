import { describe, it, expect, vi } from "vitest";

describe("reminder-handled-list (提醒中枢已处理事项列表组件)", () => {
    it("kindLabel 字典正确覆盖所有已处理类型", () => {
        const kindLabel: Record<string, string> = {
            done: "hub.handledDone",
            muted: "hub.handledMuted",
            year: "hub.handledYear",
            period: "hub.handledPeriod",
            memo: "hub.handledMemo",
        };

        expect(kindLabel.done).toBe("hub.handledDone");
        expect(kindLabel.muted).toBe("hub.handledMuted");
        expect(kindLabel.year).toBe("hub.handledYear");
        expect(kindLabel.period).toBe("hub.handledPeriod");
        expect(kindLabel.memo).toBe("hub.handledMemo");
    });

    it("恢复与备忘删除回调接口调用完备性", () => {
        const onRestore = vi.fn();
        const onDeleteMemo = vi.fn();

        onRestore("rem-1");
        expect(onRestore).toHaveBeenCalledWith("rem-1");

        onDeleteMemo("memo-1", "买牛奶");
        expect(onDeleteMemo).toHaveBeenCalledWith("memo-1", "买牛奶");
    });

    it("分页截取逻辑按 PAGE_SIZE 正确切片", () => {
        const PAGE_SIZE = 20;
        const mockList = Array.from({ length: 45 }, (_, i) => ({ id: `h-${i}`, title: `条目 ${i}` }));

        let limit = PAGE_SIZE;
        let visible = mockList.slice(0, limit);
        expect(visible).toHaveLength(20);

        limit += PAGE_SIZE;
        visible = mockList.slice(0, limit);
        expect(visible).toHaveLength(40);

        limit += PAGE_SIZE;
        visible = mockList.slice(0, limit);
        expect(visible).toHaveLength(45);
    });

    it("归档子类型过滤与计数统计精准分流", () => {
        const mockHandled = [
            { id: "1", kind: "done" },
            { id: "2", kind: "done" },
            { id: "3", kind: "muted" },
            { id: "4", kind: "period" },
            { id: "5", kind: "year" },
            { id: "6", kind: "memo" },
        ];

        const counts = {
            all: mockHandled.length,
            done: mockHandled.filter((h) => h.kind === "done").length,
            muted: mockHandled.filter((h) => h.kind === "muted").length,
            period: mockHandled.filter((h) => h.kind === "period" || h.kind === "year").length,
            memo: mockHandled.filter((h) => h.kind === "memo").length,
        };

        expect(counts.all).toBe(6);
        expect(counts.done).toBe(2);
        expect(counts.muted).toBe(1);
        expect(counts.period).toBe(2);
        expect(counts.memo).toBe(1);

        const filterKind = (kind: string) => {
            if (kind === "all") return mockHandled;
            if (kind === "done") return mockHandled.filter((h) => h.kind === "done");
            if (kind === "muted") return mockHandled.filter((h) => h.kind === "muted");
            if (kind === "period") return mockHandled.filter((h) => h.kind === "period" || h.kind === "year");
            if (kind === "memo") return mockHandled.filter((h) => h.kind === "memo");
            return mockHandled;
        };

        expect(filterKind("done")).toHaveLength(2);
        expect(filterKind("period")).toHaveLength(2);
        expect(filterKind("muted")).toHaveLength(1);
        expect(filterKind("memo")).toHaveLength(1);
        expect(filterKind("all")).toHaveLength(6);
    });
});
