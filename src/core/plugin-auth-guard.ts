import { showMessage } from "@/libs/notice";
import { compactUserMessage, sameOriginReturnPath } from "@/core/auth";

export interface PluginAuthGuardOptions {
    plugin: any;
    t: (key: string) => string;
    emitHubChanged: () => void;
    scheduleTimeout: (fn: () => void, delay: number) => number;
    showTab: () => void;
}

export interface PluginAuthGuardController {
    checkRestoredAuth(): void;
    dispose(): void;
}

/**
 * 统一处理内核鉴权失效与权限拦截：
 * 避免每个面板各自跳转或留下空白状态，维护 sessionStorage 登录返回点与同源恢复。
 */
export function initPluginAuthGuard(options: PluginAuthGuardOptions): PluginAuthGuardController {
    const { plugin, t, emitHubChanged, scheduleTimeout, showTab } = options;

    let authRedirectScheduled = false;

    const authExpiredHandler = (event: Event) => {
        const detail = (event as CustomEvent<{ returnTo?: unknown }>).detail;
        const currentLocation = typeof location !== "undefined"
            ? `${location.pathname}${location.search}${location.hash}`
            : "/";
        const candidate = typeof detail?.returnTo === "string" && detail.returnTo ? detail.returnTo : currentLocation;
        const returnTo = sameOriginReturnPath(candidate, location?.origin ?? "http://localhost", currentLocation);
        try {
            sessionStorage.setItem("siyuan-home:auth-return", returnTo);
        } catch {
            /* storage may be unavailable */
        }
        if (plugin.runtime?.cache) {
            const errors = (plugin.runtime.cache.errors ?? []).filter((error: any) => error.moduleId !== "auth");
            plugin.runtime.cache = { ...plugin.runtime.cache, errors: [...errors, { moduleId: "auth", message: t("auth.expired") }] };
        }
        if (plugin.scan) {
            const errors = (plugin.scan.errors ?? []).filter((error: any) => error.moduleId !== "auth");
            plugin.scan = { ...plugin.scan, stale: true, errors: [...errors, { moduleId: "auth", message: t("auth.expired") }] };
        }
        emitHubChanged();
        showMessage(t("auth.expired"), 7000, "error");
        const authPath = "/check-auth";
        if (!authRedirectScheduled && location && location.pathname !== authPath && !location.pathname.startsWith(`${authPath}/`)) {
            const target = `${authPath}?returnTo=${encodeURIComponent(returnTo)}`;
            authRedirectScheduled = true;
            scheduleTimeout(() => {
                // Avoid racing a successful login or repeatedly redirecting
                // if several requests fail in the same render cycle.
                if (!location || location.pathname === authPath || location.pathname.startsWith(`${authPath}/`)) return;
                location.assign(target);
            }, 0);
        }
    };

    const permissionDeniedHandler = (event: Event) => {
        const detail = (event as CustomEvent<{ message?: unknown }>).detail;
        const message = compactUserMessage(detail?.message, t("permission.denied"));
        if (plugin.runtime?.cache) {
            const errors = (plugin.runtime.cache.errors ?? []).filter((error: any) => error.moduleId !== "permission");
            plugin.runtime.cache = {
                ...plugin.runtime.cache,
                errors: [...errors, { moduleId: "permission", message }],
            };
        }
        if (plugin.scan) {
            const errors = (plugin.scan.errors ?? []).filter((error: any) => error.moduleId !== "permission");
            plugin.scan = { ...plugin.scan, stale: true, errors: [...errors, { moduleId: "permission", message }] };
        }
        emitHubChanged();
        showMessage(message, 7000, "error");
    };

    if (typeof window !== "undefined") {
        window.addEventListener("siyuan-home:auth-expired", authExpiredHandler);
        window.addEventListener("siyuan-home:permission-denied", permissionDeniedHandler);
    }

    function checkRestoredAuth(): void {
        try {
            if (typeof sessionStorage === "undefined" || typeof location === "undefined") return;
            const restored = sessionStorage.getItem("siyuan-home:auth-return");
            if (restored) {
                const current = `${location.pathname}${location.search}${location.hash}`;
                const targetPath = sameOriginReturnPath(restored, location.origin, current);
                if (targetPath && targetPath !== current) {
                    // Some SiYuan versions honor returnTo themselves and some
                    // return to the workspace root. Restore the same-origin
                    // location saved before redirect in either case.
                    location.replace(new URL(targetPath, location.origin).href);
                } else {
                    sessionStorage.removeItem("siyuan-home:auth-return");
                    scheduleTimeout(() => {
                        showTab();
                        showMessage(t("auth.restored"), 3500, "info");
                    }, 100);
                }
            }
        } catch {
            /* storage may be unavailable */
        }
    }

    function dispose(): void {
        if (typeof window !== "undefined") {
            window.removeEventListener("siyuan-home:auth-expired", authExpiredHandler);
            window.removeEventListener("siyuan-home:permission-denied", permissionDeniedHandler);
        }
        authRedirectScheduled = false;
    }

    return {
        checkRestoredAuth,
        dispose,
    };
}
