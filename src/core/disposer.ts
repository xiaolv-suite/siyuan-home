/**
 * 树状幂等生命周期管理 (DisposerTree / CompositeDisposer)
 *
 * 核心契约：
 * 1. 支持函数及 IDisposable 对象的注册；
 * 2. 严格按 LIFO（后进先出，即逆序）销毁；
 * 3. 异常隔离：单个清理抛错不阻断后续清理；
 * 4. 幂等性：多次调用 dispose() 安全无副作用；
 * 5. 作用域嵌套：支持 createChildScope() 级联管理；
 * 6. 已销毁状态下注册即时销毁；
 * 7. 引用去重：底层使用 Set 存储函数引用，重复注册同一清理函数天然幂等去重。
 */

export interface IDisposable {
    dispose(): void;
}

export type DisposableItem = (() => void) | IDisposable | null | undefined | false;

export class CompositeDisposer implements IDisposable {
    private readonly disposables = new Set<() => void>();
    private _isDisposed = false;

    get isDisposed(): boolean {
        return this._isDisposed;
    }

    get size(): number {
        return this.disposables.size;
    }

    /**
     * 注册清理项，返回撤销注册函数
     */
    add(disposable: DisposableItem): () => void {
        if (!disposable) {
            return () => {};
        }

        const cleanupFn: () => void =
            typeof disposable === "function"
                ? disposable
                : () => {
                      try {
                          disposable.dispose();
                      } catch (err) {
                          console.warn("[CompositeDisposer] disposable.dispose() threw:", err);
                      }
                  };

        if (this._isDisposed) {
            try {
                cleanupFn();
            } catch (err) {
                console.warn("[CompositeDisposer] cleanup error on already-disposed:", err);
            }
            return () => {};
        }

        this.disposables.add(cleanupFn);
        return () => {
            this.disposables.delete(cleanupFn);
        };
    }

    /**
     * 创建子作用域，父级销毁时自动销毁子级
     */
    createChildScope(): CompositeDisposer {
        const child = new CompositeDisposer();
        if (this._isDisposed) {
            child.dispose();
            return child;
        }

        const unbind = this.add(child);
        // 子级主动销毁时，从父级解绑避免常驻 Set
        const originalChildDispose = child.dispose.bind(child);
        child.dispose = () => {
            unbind();
            originalChildDispose();
        };

        return child;
    }

    /**
     * 注册 Timeout 清理器
     */
    addTimeout(timerId: number | NodeJS.Timeout | null | undefined): () => void {
        if (timerId == null) return () => {};
        return this.add(() => {
            if (typeof window !== "undefined" && typeof timerId === "number") {
                window.clearTimeout(timerId);
            } else {
                clearTimeout(timerId as any);
            }
        });
    }

    /**
     * 注册 Interval 清理器
     */
    addInterval(intervalId: number | NodeJS.Timeout | null | undefined): () => void {
        if (intervalId == null) return () => {};
        return this.add(() => {
            if (typeof window !== "undefined" && typeof intervalId === "number") {
                window.clearInterval(intervalId);
            } else {
                clearInterval(intervalId as any);
            }
        });
    }

    /**
     * 执行 LIFO 逆序销毁（幂等、异常隔离）
     */
    dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        // Set 维持插入序，通过 reverse 实现 LIFO 后进先出
        const list = Array.from(this.disposables).reverse();
        this.disposables.clear();

        for (const fn of list) {
            try {
                fn();
            } catch (err) {
                console.warn("[CompositeDisposer] cleanup error:", err);
            }
        }
    }
}
