/**
 * 微任务级 SQL 合并器与短缓存熔断降级 (SQLQueryCoalescer)
 *
 * 核心设计与契约：
 * 1. 微任务队列（queueMicrotask）：聚合并发单行查询，将 N+1 次 SQL 自动合并为单次 `WHERE id IN (...)` 批量查询；
 * 2. 5 秒短缓存（TTL 5000ms）：高频视图重渲染时直接命中内存，零 SQL 穿透；
 * 3. 3000ms 熔断保护（withTimeout）：单次批查询超过 3000ms 自动熔断；
 * 4. 逐项降级重试：若批量 IN 查询失败或超时，自动降级为逐项单行重试，杜绝单行异常拖垮整批调用；
 * 5. 依赖注入与可测性：支持自定义 sqlExecutor 构造独立实例进行计数断言测试。
 */

import { sql } from "./siyuan";

export interface SQLQueryCoalescerOptions {
    sqlExecutor?: <T = any>(stmt: string) => Promise<T[]>;
    timeoutMs?: number;
    cacheTTL?: number;
}

interface Waiter<T> {
    resolve: (val: T) => void;
    reject: (err: any) => void;
}

export class SQLQueryCoalescer {
    static readonly MAX_BATCH_SIZE = 100;
    private static readonly FALLBACK_CONCURRENCY = 10;

    private readonly sqlExecutor: <T = any>(stmt: string) => Promise<T[]>;
    private readonly timeoutMs: number;
    private readonly cacheTTL: number;

    // queryDocBox 状态
    private docBoxWaiters = new Map<string, Array<Waiter<string>>>();
    private docBoxPending = new Set<string>();
    private docBoxCache = new Map<string, { box: string; expireAt: number }>();
    private docBoxScheduled = false;
    private docBoxEpochs = new Map<string, number>();

    // checkBlockExists 状态
    private blockExistsWaiters = new Map<string, Array<Waiter<boolean>>>();
    private blockExistsPending = new Set<string>();
    private blockExistsCache = new Map<string, { exists: boolean; expireAt: number }>();
    private blockExistsScheduled = false;
    private blockExistsEpochs = new Map<string, number>();

    constructor(options?: SQLQueryCoalescerOptions) {
        this.sqlExecutor = options?.sqlExecutor ?? ((stmt) => sql(stmt));
        this.timeoutMs = options?.timeoutMs ?? 3000;
        this.cacheTTL = options?.cacheTTL ?? 5000;
    }

    /**
     * 清空全部内存缓存（用于测试隔离）
     */
    clearCache(): void {
        this.docBoxCache.clear();
        this.blockExistsCache.clear();
        this.docBoxEpochs.clear();
        this.blockExistsEpochs.clear();
    }

    /**
     * 单项或多项驱逐缓存（当块/文档创建、修改或删除时调用）
     * 具备代际 epoch 保护：递增代际编号，阻止在途异步查询完成后回写脏缓存。
     */
    invalidate(id: string): void {
        if (!id) return;
        this.docBoxCache.delete(id);
        this.blockExistsCache.delete(id);
        this.docBoxEpochs.set(id, (this.docBoxEpochs.get(id) ?? 0) + 1);
        this.blockExistsEpochs.set(id, (this.blockExistsEpochs.get(id) ?? 0) + 1);
    }

    private chunkArray<T>(items: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }
        return chunks;
    }

    private withTimeout<T>(promise: Promise<T>, ms: number, errMsg: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error(errMsg));
                }
            }, ms);

            promise.then(
                (val) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(val);
                    }
                },
                (err) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        reject(err);
                    }
                }
            );
        });
    }

    /**
     * 查询文档所在笔记本 box（微任务合并 + 短缓存 + 3s熔断降级）
     */
    async queryDocBox(docId: string): Promise<string> {
        if (!docId) return "";

        const cached = this.docBoxCache.get(docId);
        if (cached && cached.expireAt > Date.now()) {
            return cached.box;
        }

        return new Promise<string>((resolve, reject) => {
            if (!this.docBoxWaiters.has(docId)) {
                this.docBoxWaiters.set(docId, []);
            }
            this.docBoxWaiters.get(docId)!.push({ resolve, reject });
            this.docBoxPending.add(docId);
            this.scheduleFlushDocBox();
        });
    }

    private scheduleFlushDocBox(): void {
        if (this.docBoxScheduled) return;
        this.docBoxScheduled = true;

        queueMicrotask(async () => {
            this.docBoxScheduled = false;
            const batch = Array.from(this.docBoxPending);
            this.docBoxPending.clear();
            if (batch.length === 0) return;

            // 记录批次在途启动时的代际快照
            const startEpochs = new Map(batch.map((id) => [id, this.docBoxEpochs.get(id) ?? 0]));

            try {
                // 1. 自动将 N 次单行查询分批合并为批量 IN 查询（大批次自动按 MAX_BATCH_SIZE 分块）
                const chunks = this.chunkArray(batch, SQLQueryCoalescer.MAX_BATCH_SIZE);
                const chunkPromises = chunks.map(async (chunk) => {
                    const inList = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
                    const stmt = `SELECT id, box FROM blocks WHERE id IN (${inList})`;
                    return this.withTimeout(
                        this.sqlExecutor<{ id: string; box: string }>(stmt),
                        this.timeoutMs,
                        `[SQLQueryCoalescer] queryDocBox batch timed out after ${this.timeoutMs}ms`
                    );
                });

                const chunkResults = await Promise.all(chunkPromises);
                const rows = chunkResults.flat();

                const boxMap = new Map<string, string>();
                if (Array.isArray(rows)) {
                    for (const r of rows) {
                        if (r && r.id) boxMap.set(r.id, r.box || "");
                    }
                }

                const now = Date.now();
                for (const id of batch) {
                    const box = boxMap.get(id) || "";
                    const currentEpoch = this.docBoxEpochs.get(id) ?? 0;
                    // 代际防护：仅当在途期间该 id 未被 invalidate 递增代际时，方可安全回写正向缓存
                    if (box && currentEpoch === startEpochs.get(id)) {
                        this.docBoxCache.set(id, { box, expireAt: now + this.cacheTTL });
                    }
                    const waiters = this.docBoxWaiters.get(id);
                    this.docBoxWaiters.delete(id);
                    if (waiters) {
                        for (const w of waiters) w.resolve(box);
                    }
                }
            } catch (batchErr) {
                // 2. 批量失败/超时降级：按有界并发逐项单行重试
                console.warn("[SQLQueryCoalescer] queryDocBox batch failed, falling back to individual queries:", batchErr);
                for (let i = 0; i < batch.length; i += SQLQueryCoalescer.FALLBACK_CONCURRENCY) {
                    const slice = batch.slice(i, i + SQLQueryCoalescer.FALLBACK_CONCURRENCY);
                    await Promise.allSettled(
                        slice.map(async (id) => {
                            const waiters = this.docBoxWaiters.get(id);
                            this.docBoxWaiters.delete(id);
                            if (!waiters || waiters.length === 0) return;

                            try {
                                const singleStmt = `SELECT box FROM blocks WHERE id = '${id.replace(/'/g, "''")}' LIMIT 1`;
                                const singleRows = await this.withTimeout(
                                    this.sqlExecutor<{ box: string }>(singleStmt),
                                    this.timeoutMs,
                                    `[SQLQueryCoalescer] individual queryDocBox timed out for ${id}`
                                );
                                const box = singleRows?.[0]?.box || "";
                                const currentEpoch = this.docBoxEpochs.get(id) ?? 0;
                                if (box && currentEpoch === startEpochs.get(id)) {
                                    this.docBoxCache.set(id, { box, expireAt: Date.now() + this.cacheTTL });
                                }
                                for (const w of waiters) w.resolve(box);
                            } catch (singleErr) {
                                for (const w of waiters) w.reject(singleErr);
                            }
                        })
                    );
                }
            }
        });
    }

    /**
     * 校验块是否存在（微任务合并 + 短缓存 + 3s熔断降级）
     */
    async checkBlockExists(blockId: string): Promise<boolean> {
        if (!blockId) return false;

        const cached = this.blockExistsCache.get(blockId);
        if (cached && cached.expireAt > Date.now()) {
            return cached.exists;
        }

        return new Promise<boolean>((resolve, reject) => {
            if (!this.blockExistsWaiters.has(blockId)) {
                this.blockExistsWaiters.set(blockId, []);
            }
            this.blockExistsWaiters.get(blockId)!.push({ resolve, reject });
            this.blockExistsPending.add(blockId);
            this.scheduleFlushBlockExists();
        });
    }

    private scheduleFlushBlockExists(): void {
        if (this.blockExistsScheduled) return;
        this.blockExistsScheduled = true;

        queueMicrotask(async () => {
            this.blockExistsScheduled = false;
            const batch = Array.from(this.blockExistsPending);
            this.blockExistsPending.clear();
            if (batch.length === 0) return;

            // 记录批次在途启动时的代际快照
            const startEpochs = new Map(batch.map((id) => [id, this.blockExistsEpochs.get(id) ?? 0]));

            try {
                // 1. 批量合并查询（支持 MAX_BATCH_SIZE 分块）
                const chunks = this.chunkArray(batch, SQLQueryCoalescer.MAX_BATCH_SIZE);
                const chunkPromises = chunks.map(async (chunk) => {
                    const inList = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
                    const stmt = `SELECT id FROM blocks WHERE id IN (${inList})`;
                    return this.withTimeout(
                        this.sqlExecutor<{ id: string }>(stmt),
                        this.timeoutMs,
                        `[SQLQueryCoalescer] checkBlockExists batch timed out after ${this.timeoutMs}ms`
                    );
                });

                const chunkResults = await Promise.all(chunkPromises);
                const rows = chunkResults.flat();

                const foundIds = new Set<string>();
                if (Array.isArray(rows)) {
                    for (const r of rows) {
                        if (r && r.id) foundIds.add(r.id);
                    }
                }

                const now = Date.now();
                for (const id of batch) {
                    const exists = foundIds.has(id);
                    const currentEpoch = this.blockExistsEpochs.get(id) ?? 0;
                    // 代际防护：仅当在途期间该 id 未被 invalidate 递增代际时，方可安全回写正向缓存
                    if (exists && currentEpoch === startEpochs.get(id)) {
                        this.blockExistsCache.set(id, { exists: true, expireAt: now + this.cacheTTL });
                    }
                    const waiters = this.blockExistsWaiters.get(id);
                    this.blockExistsWaiters.delete(id);
                    if (waiters) {
                        for (const w of waiters) w.resolve(exists);
                    }
                }
            } catch (batchErr) {
                // 2. 批量失败/超时降级：按有界并发逐项单行重试
                console.warn("[SQLQueryCoalescer] checkBlockExists batch failed, falling back to individual queries:", batchErr);
                for (let i = 0; i < batch.length; i += SQLQueryCoalescer.FALLBACK_CONCURRENCY) {
                    const slice = batch.slice(i, i + SQLQueryCoalescer.FALLBACK_CONCURRENCY);
                    await Promise.allSettled(
                        slice.map(async (id) => {
                            const waiters = this.blockExistsWaiters.get(id);
                            this.blockExistsWaiters.delete(id);
                            if (!waiters || waiters.length === 0) return;

                            try {
                                const singleStmt = `SELECT id FROM blocks WHERE id = '${id.replace(/'/g, "''")}' LIMIT 1`;
                                const singleRows = await this.withTimeout(
                                    this.sqlExecutor<{ id: string }>(singleStmt),
                                    this.timeoutMs,
                                    `[SQLQueryCoalescer] individual checkBlockExists timed out for ${id}`
                                );
                                const exists = Boolean(singleRows && singleRows.length > 0);
                                const currentEpoch = this.blockExistsEpochs.get(id) ?? 0;
                                if (exists && currentEpoch === startEpochs.get(id)) {
                                    this.blockExistsCache.set(id, { exists: true, expireAt: Date.now() + this.cacheTTL });
                                }
                                for (const w of waiters) w.resolve(exists);
                            } catch (singleErr) {
                                for (const w of waiters) w.reject(singleErr);
                            }
                        })
                    );
                }
            }
        });
    }
}

/** 全局单例 */
export const sqlCoalescer = new SQLQueryCoalescer();

/** 快捷方法：查询文档所属笔记本 ID */
export function queryDocBox(docId: string): Promise<string> {
    return sqlCoalescer.queryDocBox(docId);
}

/** 快捷方法：检查块是否存在 */
export function checkBlockExists(blockId: string): Promise<boolean> {
    return sqlCoalescer.checkBlockExists(blockId);
}

/** 快捷方法：驱逐指定块/文档在合并器中的缓存 */
export function invalidateSQLCache(id: string): void {
    sqlCoalescer.invalidate(id);
}
