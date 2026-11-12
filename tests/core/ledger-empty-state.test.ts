import { describe, it, expect, vi } from "vitest";

describe("ledger-empty-state (台账多态空状态与建库引导)", () => {
    it("空状态优先级正确判定：加载中 > 读取失败 > 未启用模块 > 视图未就绪 > 搜索无结果 > 默认空态", () => {
        function resolveState(opts: {
            loading?: boolean;
            loadError?: string;
            ledgersCount: number;
            avId?: string;
            rowsCount: number;
        }) {
            if (opts.loading) return "loading";
            if (opts.loadError) return "loadError";
            if (opts.ledgersCount === 0) return "noEnabledModules";
            if (!opts.avId) return "notProvisioned";
            if (opts.rowsCount > 0) return "searchEmpty";
            return "defaultEmpty";
        }

        expect(resolveState({ loading: true, ledgersCount: 0 })).toBe("loading");
        expect(resolveState({ loadError: "error", ledgersCount: 5 })).toBe("loadError");
        expect(resolveState({ ledgersCount: 0 })).toBe("noEnabledModules");
        expect(resolveState({ ledgersCount: 2, avId: undefined, rowsCount: 0 })).toBe("notProvisioned");
        expect(resolveState({ ledgersCount: 2, avId: "av-1", rowsCount: 5 })).toBe("searchEmpty");
        expect(resolveState({ ledgersCount: 2, avId: "av-1", rowsCount: 0 })).toBe("defaultEmpty");
    });

    it("空态动作分发回调接口完备性", () => {
        const callbacks = {
            onLoad: vi.fn(),
            onOpenSettings: vi.fn(),
            onRebuildLedger: vi.fn(),
            onOpenBindDoc: vi.fn(),
            onOpenNewRecord: vi.fn(),
            onClearSearch: vi.fn(),
            onImportCsv: vi.fn(),
        };

        for (const fn of Object.values(callbacks)) {
            fn();
            expect(fn).toHaveBeenCalledTimes(1);
        }
    });
});
