import { describe, it, expect, vi } from "vitest";
import { fetchLedgerDataset } from "@/core/ledger-data-loader";

vi.mock("@/core/siyuan", () => ({
    renderLedgerAll: vi.fn(),
}));

describe("ledger-data-loader (台账数据加载引擎)", () => {
    it("未提供 avId 时安全回退空列表并触发导航异常回调", async () => {
        const onNavigationError = vi.fn();
        const t = (k: string) => k;

        const res = await fetchLedgerDataset({
            avId: undefined,
            moduleId: "medicine",
            pendingTarget: { moduleId: "medicine", rowId: "r1", requestId: 1 } as any,
            t,
            onNavigationError,
        });

        expect(res.rows).toEqual([]);
        expect(res.columns).toEqual([]);
        expect(res.complete).toBe(true);
        expect(onNavigationError).toHaveBeenCalledTimes(1);
    });

    it("数据加载成功后匹配待激活的目标记录行", async () => {
        const { renderLedgerAll } = await import("@/core/siyuan");
        (renderLedgerAll as any).mockResolvedValue({
            complete: true,
            rows: [
                { itemID: "row-1", cells: {} },
                { itemID: "row-2", cells: {} },
            ],
            columns: [{ id: "c1", name: "name" }],
        });

        const onTargetResolved = vi.fn();
        const t = (k: string) => k;

        // Mock requestAnimationFrame to invoke callback synchronously in tests
        const origRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };

        try {
            const res = await fetchLedgerDataset({
                avId: "av-123",
                moduleId: "certs",
                pendingTarget: { moduleId: "certs", rowId: "row-2", requestId: 2 } as any,
                t,
                onTargetResolved,
            });

            expect(res.complete).toBe(true);
            expect(res.rows.length).toBe(2);
            expect(res.columns.length).toBe(1);
            expect(onTargetResolved).toHaveBeenCalledWith(
                { itemID: "row-2", cells: {} },
                { moduleId: "certs", rowId: "row-2", requestId: 2 }
            );
        } finally {
            globalThis.requestAnimationFrame = origRaf;
        }
    });

    it("加载未完成时返回不完整状态与错误信息", async () => {
        const { renderLedgerAll } = await import("@/core/siyuan");
        (renderLedgerAll as any).mockResolvedValue({
            complete: false,
            rows: [],
            columns: [],
        });

        const t = (k: string) => (k === "ledger.loadIncomplete" ? "数据加载未完成" : k);

        const res = await fetchLedgerDataset({
            avId: "av-456",
            moduleId: "medicine",
            t,
        });

        expect(res.complete).toBe(false);
        expect(res.error).toBe("数据加载未完成");
    });
});
