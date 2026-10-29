import { describe, it, expect } from "vitest";
import { MODULE_GROUPS, getModule } from "@/core/modules";

describe("overview-module-grid (总览全功能模块网格与趋势卡片)", () => {
    it("模块分组契约与定义完备性", () => {
        expect(MODULE_GROUPS.length).toBeGreaterThan(0);
        expect(MODULE_GROUPS).toContain("people");
        expect(MODULE_GROUPS).toContain("assets");
        expect(MODULE_GROUPS).toContain("living");

        const certsModule = getModule("certs");
        expect(certsModule?.group).toBe("people");
    });

    it("近 5 日待办趋势火花线 (sparkline) 比例映射计算", () => {
        const now = new Date();
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const moduleHistory = {
            [fmt(new Date(now.getTime() - 4 * 86400000))]: { certs: 2 },
            [fmt(new Date(now.getTime() - 3 * 86400000))]: { certs: 4 },
            [fmt(new Date(now.getTime() - 2 * 86400000))]: { certs: 6 },
            [fmt(new Date(now.getTime() - 1 * 86400000))]: { certs: 8 },
            [fmt(now)]: { certs: 10 },
        };

        const sparkOf = (mid: string): number[] | null => {
            const days: number[] = [];
            let known = 0;
            let max = 0;
            for (let i = 4; i >= 0; i--) {
                const d = new Date(Date.now() - i * 86400000);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                const v = (moduleHistory as any)[key]?.[mid];
                if (typeof v === "number") known++;
                days.push(typeof v === "number" ? v : 0);
                if (v > max) max = v;
            }
            if (known < 3) return null;
            return days.map((v) => (max > 0 ? Math.max(15, Math.round((v / max) * 100)) : 15));
        };

        const sparks = sparkOf("certs");
        expect(sparks).not.toBeNull();
        expect(sparks).toHaveLength(5);
        expect(sparks![4]).toBe(100);
    });

    it("分组展开逻辑默认展开首个分组或有待办的分组", () => {
        const pendingByModule = new Map<string, number>([
            ["certs", 3],
            ["vehicles", 0],
        ]);

        const isModuleGroupOpen = (
            id: string,
            index: number,
            ids: string[],
            explicitOpen: Record<string, boolean> = {},
            query = "",
            filter = "all"
        ): boolean => {
            if (query || filter !== "all") return ids.length > 0;
            const explicit = explicitOpen[id];
            if (explicit !== undefined) return explicit;
            const hasPending = ids.some((mid) => (pendingByModule.get(mid) ?? 0) > 0);
            return index === 0 || hasPending;
        };

        // 第一个分组无论是否有待办均展开
        expect(isModuleGroupOpen("records", 0, ["vehicles"])).toBe(true);

        // 第二个分组如果有待办则自动展开
        expect(isModuleGroupOpen("records2", 1, ["certs"])).toBe(true);

        // 第二个分组若无待办默认收起
        expect(isModuleGroupOpen("records2", 1, ["vehicles"])).toBe(false);

        // 用户显式操作优先于默认推导
        expect(isModuleGroupOpen("records", 0, ["vehicles"], { records: false })).toBe(false);
    });
});
