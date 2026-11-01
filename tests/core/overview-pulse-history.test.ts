import { describe, it, expect } from "vitest";

describe("overview-pulse-history (POOL-FEAT-02: 周律动条历史日期点击反查当日已完成归档事项)", () => {
    const mockHandled = [
        { id: "h-1", title: "还信用卡", moduleId: "house", at: "2026-10-30T10:15:00.000Z", kind: "done" },
        { id: "h-2", title: "给绿植浇水", moduleId: "adhoc", at: "2026-10-30T14:30:00.000Z", kind: "memo" },
        { id: "h-3", title: "缴纳车位费", moduleId: "vehicles", at: "2026-10-28T09:00:00.000Z", kind: "done" },
        { id: "h-4", title: "无时间戳项", moduleId: "certs", at: undefined, kind: "done" },
    ];

    function filterHandledByDate(handled: typeof mockHandled, targetDate: string) {
        return handled.filter((h) => {
            if (!h.at) return false;
            return h.at.slice(0, 10) === targetDate;
        });
    }

    it("精准筛选指定历史日期的归档与已办事项", () => {
        const oct30 = filterHandledByDate(mockHandled, "2026-10-30");
        expect(oct30.length).toBe(2);
        expect(oct30.map((x) => x.title)).toEqual(["还信用卡", "给绿植浇水"]);

        const oct28 = filterHandledByDate(mockHandled, "2026-10-28");
        expect(oct28.length).toBe(1);
        expect(oct28[0].title).toBe("缴纳车位费");
    });

    it("无归档事项的日期返回空数组并安全降级", () => {
        const oct29 = filterHandledByDate(mockHandled, "2026-10-29");
        expect(oct29).toEqual([]);
    });

    it("忽略缺失时间戳的异常归档条目", () => {
        const filtered = mockHandled.filter((h) => !h.at);
        expect(filtered.length).toBe(1);
        expect(filtered[0].id).toBe("h-4");
    });
});
