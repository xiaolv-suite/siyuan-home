import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    setTransport,
    request,
    isRequestAborted,
    isKernelError,
    isAuthExpired,
    isPermissionDenied,
    isWriteResultUnknown,
    withTimeout,
    KernelError,
    AuthExpiredError,
    PermissionDeniedError,
    RequestAbortedError,
    RequestSupersededError,
} from "@/core/siyuan-transport";

describe("siyuan-transport (思源底层 HTTP 传输控制引擎)", () => {
    beforeEach(() => {
        setTransport(null);
    });

    it("错误类型判定与错误类继承契约", () => {
        const ke = new KernelError("/api/test", -1, "fail");
        expect(isKernelError(ke)).toBe(true);
        expect(isKernelError(new Error("standard"))).toBe(false);

        const ae = new AuthExpiredError("/api/test", 401, "unauthorized");
        expect(isAuthExpired(ae)).toBe(true);
        expect(isKernelError(ae)).toBe(true);

        const pe = new PermissionDeniedError("/api/test", 403, "forbidden");
        expect(isPermissionDenied(pe)).toBe(true);
        expect(isKernelError(pe)).toBe(true);

        const ab = new RequestAbortedError("/api/test", "aborted", false);
        const sup = new RequestSupersededError("/api/test", "key-1");
        expect(isRequestAborted(ab)).toBe(true);
        expect(isRequestAborted(sup)).toBe(true);
        expect(isRequestAborted(new Error("fail"))).toBe(false);

        expect(isWriteResultUnknown(new RequestAbortedError("/api/test", "aborted", true))).toBe(true);
        expect(isWriteResultUnknown(new KernelError("/api/test", -408, "timeout"))).toBe(true);
        expect(isWriteResultUnknown(new KernelError("/api/test", 500, "internal error"))).toBe(false);
    });

    it("通过 setTransport 注入 mock 传输并成功解包 code === 0 的数据", async () => {
        const mockTransport = vi.fn().mockResolvedValue({
            code: 0,
            msg: "",
            data: { result: "success" },
        });
        setTransport(mockTransport);

        const res = await request<{ result: string }>("/api/query/sql", { stmt: "SELECT 1" });
        expect(res).toEqual({ result: "success" });
        expect(mockTransport).toHaveBeenCalledWith(
            "/api/query/sql",
            { stmt: "SELECT 1" },
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it("idempotencyKey 相同 payload 命中内存短缓存", async () => {
        const mockTransport = vi.fn().mockResolvedValue({
            code: 0,
            msg: "",
            data: { itemID: "row-unique-123" },
        });
        setTransport(mockTransport);

        const res1 = await request("/api/av/addAttributeViewBlocks", { avID: "av-1" }, {
            idempotencyKey: "test:unique:1",
        });
        const res2 = await request("/api/av/addAttributeViewBlocks", { avID: "av-1" }, {
            idempotencyKey: "test:unique:1",
        });

        expect(res1).toEqual({ itemID: "row-unique-123" });
        expect(res2).toEqual({ itemID: "row-unique-123" });
        // 第二次直接取内存完成记录，不重复打内核
        expect(mockTransport).toHaveBeenCalledTimes(1);
    });

    it("withTimeout 超时快速拒绝", async () => {
        const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));

        await expect(
            withTimeout(slowPromise, 20, "/api/slow")
        ).rejects.toThrow("request timeout");
    });
});
