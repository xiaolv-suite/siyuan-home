import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvTicker, withDocLock } from "@/libs/notice";

describe("lvTicker & withDocLock (生态协同基础设施测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lvTicker 在测试环境下安全订阅与注销，不抛异常", () => {
        const cb = vi.fn();
        const unsub = lvTicker.subscribe("siyuan-home", 30000, cb);
        expect(typeof unsub).toBe("function");
        expect(() => unsub()).not.toThrow();
    });

    it("lvTicker.onDateCross 在测试环境下支持注册零点跨日回调", () => {
        const dcCb = vi.fn();
        const unsub = lvTicker.onDateCross("siyuan-home", dcCb);
        expect(typeof unsub).toBe("function");
        expect(() => unsub()).not.toThrow();
    });

    it("withDocLock 支持针对指定 docId 串行排队执行异步写入任务", async () => {
        const order: number[] = [];
        const task1 = () => new Promise<void>((resolve) => setTimeout(() => { order.push(1); resolve(); }, 30));
        const task2 = () => new Promise<void>((resolve) => setTimeout(() => { order.push(2); resolve(); }, 10));

        await Promise.all([
            withDocLock("doc-test-1", task1),
            withDocLock("doc-test-1", task2),
        ]);

        // task1 先入锁，即使 task2 延时短，也必须等待 task1 完成后才执行
        expect(order).toEqual([1, 2]);
    });

    it("withDocLock 在不同 docId 时可并发执行不互相阻塞", async () => {
        const order: number[] = [];
        const task1 = () => new Promise<void>((resolve) => setTimeout(() => { order.push(1); resolve(); }, 30));
        const task2 = () => new Promise<void>((resolve) => setTimeout(() => { order.push(2); resolve(); }, 10));

        await Promise.all([
            withDocLock("doc-a", task1),
            withDocLock("doc-b", task2),
        ]);

        // doc-b 延时短，应先完成
        expect(order).toEqual([2, 1]);
    });
});
