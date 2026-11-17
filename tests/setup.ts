// 测试全局环境注入：为 lv-notice-kit 等需要 window 的生态组件提供轻量兼容模拟
if (typeof globalThis.window === "undefined") {
    const storage = new Map<string, string>();
    const fakeLocalStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => { storage.set(k, String(v)); },
        removeItem: (k: string) => { storage.delete(k); },
        clear: () => { storage.clear(); },
    };

    const eventListeners = new Map<string, Set<Function>>();

    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = fakeLocalStorage;
    (globalThis as any).dispatchEvent = (event: any) => {
        const set = eventListeners.get(event?.type || "");
        if (set) {
            for (const fn of set) {
                try { fn(event); } catch { /* ignore */ }
            }
        }
        return true;
    };
    (globalThis as any).addEventListener = (type: string, listener: Function) => {
        if (!eventListeners.has(type)) eventListeners.set(type, new Set());
        eventListeners.get(type)!.add(listener);
    };
    (globalThis as any).removeEventListener = (type: string, listener: Function) => {
        eventListeners.get(type)?.delete(listener);
    };
    if (typeof (globalThis as any).CustomEvent === "undefined") {
        (globalThis as any).CustomEvent = class CustomEvent {
            type: string;
            detail: any;
            constructor(type: string, params: any = {}) {
                this.type = type;
                this.detail = params?.detail;
            }
        };
    }
}

if (typeof (globalThis as any).HTMLElement === "undefined") {
    (globalThis as any).HTMLElement = class HTMLElement {};
}
