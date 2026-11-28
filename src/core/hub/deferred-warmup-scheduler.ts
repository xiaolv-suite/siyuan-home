/**
 * 45s 静默期延迟预热调度器 (DeferredWarmupScheduler)
 *
 * 核心契约：
 * 1. 严格保障 45 秒冷启动最小静默期，避开冷启动 CPU 与 IPC 峰值；
 * 2. 45 秒静默期满后，自动转入 requestIdleCallback 空闲帧软调度；
 * 3. 具备 in-flight Promise 单飞守卫，多次调用与并发请求严格复用同一 Promise；
 * 4. 主动打开界面时（Tab / 提醒 / 台账），即刻取消挂起定时器/空闲帧，抢先触发单飞执行；
 * 5. 实现 IDisposable 接入 CompositeDisposer，卸载时确保 0 定时器与 0 空闲回调残留。
 */

import type { IDisposable } from "@/core/disposer";

export interface DeferredWarmupSchedulerOptions {
    isUnloading: () => boolean;
    scheduleTimeout: (cb: () => void, delayMs: number) => number;
    clearTimeout?: (id: number) => void;
    trigger?: () => Promise<void>;
    runWarmupTasks: () => Promise<void>;
}

export class DeferredWarmupScheduler implements IDisposable {
    static readonly DEFAULT_DELAY_MS = 45 * 1000;

    timerId?: number;
    idleId?: number;
    inFlightPromise: Promise<void> | null = null;
    isCompleted = false;

    private readonly options: DeferredWarmupSchedulerOptions;

    constructor(options: DeferredWarmupSchedulerOptions) {
        this.options = options;
    }

    /**
     * 取消挂起的延迟预热调度（同时清理最小静默期定时器与空闲帧回调）
     */
    cancel(): void {
        if (this.timerId !== undefined && this.timerId !== null) {
            if (this.options.clearTimeout) {
                this.options.clearTimeout(this.timerId);
            } else if (typeof window !== "undefined") {
                window.clearTimeout(this.timerId);
            }
            this.timerId = undefined;
        }

        if (this.idleId !== undefined && this.idleId !== null) {
            if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function") {
                try {
                    (window as any).cancelIdleCallback(this.idleId);
                } catch {
                    /* ignore */
                }
            }
            this.idleId = undefined;
        }
    }

    /**
     * 调度空闲/延迟后台预热：
     * 先通过 setTimeout 建立 45 秒最小静默窗口，确保不抢占冷启动 CPU 与 IPC；
     * 45 秒静默期满后，若存在 requestIdleCallback 则转入空闲帧软调度触发，平滑执行。
     */
    schedule(delayMs = DeferredWarmupScheduler.DEFAULT_DELAY_MS): void {
        if (this.options.isUnloading() || this.isCompleted || this.inFlightPromise) return;
        this.cancel();

        const run = () => {
            if (this.options.isUnloading() || this.isCompleted || this.inFlightPromise) return;
            if (this.options.trigger) {
                void this.options.trigger();
            } else {
                void this.trigger();
            }
        };

        this.timerId = this.options.scheduleTimeout(() => {
            this.timerId = undefined;
            if (this.options.isUnloading() || this.isCompleted || this.inFlightPromise) return;

            if (typeof window !== "undefined" && typeof (window as any).requestIdleCallback === "function") {
                try {
                    this.idleId = (window as any).requestIdleCallback(() => {
                        this.idleId = undefined;
                        run();
                    });
                    return;
                } catch {
                    // 回退到普通直接执行
                }
            }
            run();
        }, delayMs);
    }

    /**
     * 触发后台延迟预热（具备 in-flight Promise 单飞守卫）
     */
    trigger(): Promise<void> {
        if (this.options.isUnloading()) return Promise.resolve();
        if (this.isCompleted) return Promise.resolve();
        if (this.inFlightPromise) return this.inFlightPromise;

        this.cancel();

        if (typeof performance !== "undefined" && typeof performance.mark === "function") {
            performance.mark("lvhome-deferred-warmup-start");
        }

        const task = (async () => {
            try {
                await this.options.runWarmupTasks();
                this.isCompleted = true;
            } catch (e) {
                console.warn("[DeferredWarmupScheduler] deferred background warmup failed:", e instanceof Error ? e.message : e);
            } finally {
                this.inFlightPromise = null;
                if (typeof performance !== "undefined" && typeof performance.mark === "function") {
                    performance.mark("lvhome-deferred-warmup-end");
                    try {
                        performance.measure("lvhome-deferred-warmup", "lvhome-deferred-warmup-start", "lvhome-deferred-warmup-end");
                    } catch {
                        /* performance measure */
                    }
                }
            }
        })();

        this.inFlightPromise = task;
        return task;
    }

    dispose(): void {
        this.cancel();
        this.inFlightPromise = null;
    }
}
