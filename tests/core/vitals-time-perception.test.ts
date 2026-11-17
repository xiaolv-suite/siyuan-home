import { describe, it, expect } from "vitest";
import { resolveDefaultVitalMember } from "@/core/vitals";

describe("vitals-time-perception (生理健康测量人时间感知智能预判)", () => {
    const mockMembers = [
        { id: "m-1", avItemId: "av-self", name: "本人", role: "self" },
        { id: "m-2", avItemId: "av-elder", name: "长辈爷爷", role: "elder" },
        { id: "m-3", avItemId: "av-child", name: "大宝", role: "child" },
    ];

    it("晨起时段 (06:00 - 10:59) 优先预选长辈", () => {
        // 早上 8 点
        expect(resolveDefaultVitalMember(mockMembers, 8)).toBe("av-elder");
        // 早上 7 点
        expect(resolveDefaultVitalMember(mockMembers, 7)).toBe("av-elder");
    });

    it("晚间时段 (19:00 - 23:00) 优先预选孩子", () => {
        // 晚上 20 点
        expect(resolveDefaultVitalMember(mockMembers, 20)).toBe("av-child");
        // 晚上 21 点
        expect(resolveDefaultVitalMember(mockMembers, 21)).toBe("av-child");
    });

    it("其余日常时段优先预选本人", () => {
        // 下午 14 点
        expect(resolveDefaultVitalMember(mockMembers, 14)).toBe("av-self");
        // 中午 12 点
        expect(resolveDefaultVitalMember(mockMembers, 12)).toBe("av-self");
    });

    it("空成员列表安全回退空串", () => {
        expect(resolveDefaultVitalMember([], 8)).toBe("");
    });
});
