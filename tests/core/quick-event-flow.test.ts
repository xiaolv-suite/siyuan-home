import { describe, it, expect } from "vitest";

describe("quick-event-flow (快速记录四合一日常高频流水组件)", () => {
    it("流水子动作循环切签与边界处理", () => {
        const subActions = ["fuel", "vital", "chore", "shopping", "snippet"] as const;
        function getNextIndex(current: number, key: string): number {
            if (key === "Home") return 0;
            if (key === "End") return subActions.length - 1;
            const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
            return (current + delta + subActions.length) % subActions.length;
        }

        expect(getNextIndex(0, "ArrowRight")).toBe(1);
        expect(getNextIndex(1, "ArrowRight")).toBe(2);
        expect(getNextIndex(3, "ArrowRight")).toBe(4);
        expect(getNextIndex(4, "ArrowRight")).toBe(0); // 循环回开头

        expect(getNextIndex(0, "ArrowLeft")).toBe(4); // 倒回末尾
        expect(getNextIndex(2, "Home")).toBe(0);
        expect(getNextIndex(1, "End")).toBe(4);
    });
});
