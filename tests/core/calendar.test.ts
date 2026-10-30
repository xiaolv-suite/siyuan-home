import { describe, it, expect } from "vitest";
import { monthGrid, daysInMonth, weekGrid } from "@/core/calendar";

describe("月历网格（原生日历视图）", () => {
    it("2026-10：31 天，周一起首（10-01 周四 → 前导 3 天为 9 月末真实日期）", () => {
        const cells = monthGrid(2026, 9);
        expect(daysInMonth(2026, 9)).toBe(31);
        expect(cells.length % 7).toBe(0);
        expect(cells.filter((c) => c.inMonth).length).toBe(31);
        // 前导 3 格 = 2026-09-28/29/30（周一/二/三）
        expect(cells[0].key).toBe("2026-09-28");
        expect(cells[0].day).toBe(28);
        expect(cells[0].inMonth).toBe(false);
        expect(cells[2].key).toBe("2026-09-30");
        expect(cells[3].key).toBe("2026-10-01");
        expect(cells[3].inMonth).toBe(true);
    });

    it("尾补为下月真实日期并补齐整周（34 格 → 补 1 天至 35）", () => {
        const cells = monthGrid(2026, 9);
        expect(cells.length).toBe(35);
        expect(cells[34].key).toBe("2026-11-01");
        expect(cells[34].day).toBe(1);
        expect(cells[34].inMonth).toBe(false);
    });

    it("键为本地 yyyy-MM-dd 且与 day 一致", () => {
        const cells = monthGrid(2026, 9);
        expect(cells[3].key).toBe("2026-10-01");
        expect(cells[33].day).toBe(31);
    });

    it("闰年二月 29 天", () => {
        expect(daysInMonth(2028, 1)).toBe(29);
        expect(daysInMonth(2026, 1)).toBe(28);
    });

    it("月初恰逢周一 → 无前导（2026-06-01 周一）", () => {
        const cells = monthGrid(2026, 5);
        expect(cells[0].inMonth).toBe(true);
        expect(cells[0].key).toBe("2026-06-01");
    });
});

describe("周视图（weekGrid）", () => {
    it("锚点周四 → 从本周周一起 7 天", () => {
        const cells = weekGrid(new Date(2026, 9, 8)); // 2026-10-08 周四
        expect(cells.length).toBe(7);
        expect(cells[0].key).toBe("2026-10-05"); // 周一
        expect(cells[6].key).toBe("2026-10-11"); // 周日
        expect(cells.every((c) => c.inMonth)).toBe(true);
    });

    it("锚点周日 → 仍从本周周一起（跨月不断轴）", () => {
        const cells = weekGrid(new Date(2026, 10, 1)); // 2026-11-01 周日
        expect(cells[0].key).toBe("2026-10-26");
        expect(cells[6].key).toBe("2026-11-01");
    });
});

describe("日历网格键盘导航 (WAI-ARIA APG Calendar Grid)", () => {
    it("PageUp / PageDown 支持跨月翻页", () => {
        let viewMonth = 9; // 10月
        const nav = (delta: number) => {
            viewMonth += delta;
        };

        function moveDayFocus(key: string) {
            if (key === "PageUp") {
                nav(-1);
            } else if (key === "PageDown") {
                nav(1);
            }
        }

        moveDayFocus("PageUp");
        expect(viewMonth).toBe(8); // 9月

        moveDayFocus("PageDown");
        expect(viewMonth).toBe(9); // 10月
    });

    it("方向键与 Home/End 支持二维网格漫游与行首行尾边界", () => {
        const cells = monthGrid(2026, 9); // 35 格
        const cols = 7;

        function getNextIndex(index: number, key: string): number {
            const rowStart = Math.floor(index / cols) * cols;
            return key === "Home" ? rowStart : key === "End" ? Math.min(cells.length - 1, rowStart + cols - 1)
                : key === "ArrowLeft" ? Math.max(0, index - 1) : key === "ArrowRight" ? Math.min(cells.length - 1, index + 1)
                    : key === "ArrowUp" ? Math.max(0, index - cols) : Math.min(cells.length - 1, index + cols);
        }

        // 索引 3 (10-01) -> ArrowRight -> 4
        expect(getNextIndex(3, "ArrowRight")).toBe(4);
        // 索引 3 -> ArrowDown -> 10 (下周同日)
        expect(getNextIndex(3, "ArrowDown")).toBe(10);
        // 索引 10 -> ArrowUp -> 3 (上周同日)
        expect(getNextIndex(10, "ArrowUp")).toBe(3);
        // 索引 3 -> Home -> 0 (本行行首/周一)
        expect(getNextIndex(3, "Home")).toBe(0);
        // 索引 3 -> End -> 6 (本行行尾/周日)
        expect(getNextIndex(3, "End")).toBe(6);
    });
});
