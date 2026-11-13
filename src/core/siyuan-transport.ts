/**
 * 思源内核 API 底层 HTTP 传输与请求控制引擎
 * 提供：超时控制、失败重试指数退避、幂等请求去重、最新版本获胜机制与鉴权状态广播
 */

/** fetchSyncPost 的结构化返回（避免测试环境加载 siyuan 包） */
export interface IRawResponse {
    code: number;
    msg: string;
    data?: any;
}

export interface RequestOptions {
    /** 外部取消信号。旧版内核 transport 不接受 signal 时也会停止向调用方交付结果。 */
    signal?: AbortSignal;
    /** 请求截止时间，默认 15 秒。 */
    timeoutMs?: number;
    /** 最大重试次数；默认读端点 1 次、写端点 0 次。 */
    retries?: number;
    /** 本机操作关联/重复点击去重 key；不等同于内核服务端幂等保证。 */
    idempotencyKey?: string;
    /** 同一资源的新请求会使旧请求失效。 */
    latestKey?: string;
}

export interface TransportOptions {
    signal?: AbortSignal;
    idempotencyKey?: string;
}

export type Transport = (endpoint: string, payload: object, options?: TransportOptions) => Promise<IRawResponse>;

let transport: Transport | null = null;
const inFlight = new Map<string, Promise<IRawResponse>>();
export const REQUEST_TIMEOUT_MS = 15_000;
const READ_RETRY_ENDPOINTS = new Set([
    "/api/query/sql",
    "/api/notebook/lsNotebooks",
    "/api/filetree/getHPathByID",
    "/api/block/getBlockKramdown",
    "/api/av/renderAttributeView",
    "/api/av/getAttributeViewPrimaryKeyValues",
    "/api/asset/getOCRConfig",
    "/api/asset/getImageOCRText",
]);
const MAX_RETRIES = 2;
export const IDEMPOTENCY_TTL_MS = 60_000;
const completedIdempotent = new Map<string, { expiresAt: number; fingerprint: string; response: IRawResponse }>();
const latestVersions = new Map<string, number>();

// SiYuan does not document X-Idempotency-Key as a server-side deduplication
// contract. Creation endpoints therefore never receive automatic replays;
// the key only protects duplicate calls while the original is in flight.
const NON_REPLAYABLE_WRITE_ENDPOINTS = new Set([
    "/api/notebook/createNotebook",
    "/api/filetree/createDocWithMd",
    "/api/block/insertBlock",
    "/api/av/addAttributeViewBlocks",
    "/api/av/addAttributeViewKey",
    "/api/asset/upload",
]);

/** 请求被调用方取消，UI 应保留现有数据并停止 loading。 */
export class RequestAbortedError extends Error {
    readonly endpoint: string;
    readonly mayHaveReachedServer: boolean;
    constructor(endpoint: string, message = "request aborted", mayHaveReachedServer = false) {
        super(`[${endpoint}] ${message}`);
        this.name = "RequestAbortedError";
        this.endpoint = endpoint;
        this.mayHaveReachedServer = mayHaveReachedServer;
    }
}

/** 同一资源发起新请求后，旧响应被丢弃，避免覆盖最新结果。 */
export class RequestSupersededError extends Error {
    readonly endpoint: string;
    readonly latestKey: string;
    constructor(endpoint: string, latestKey: string) {
        super(`[${endpoint}] superseded by a newer request`);
        this.name = "RequestSupersededError";
        this.endpoint = endpoint;
        this.latestKey = latestKey;
    }
}

export function isRequestAborted(e: unknown): e is RequestAbortedError | RequestSupersededError {
    return e instanceof RequestAbortedError || e instanceof RequestSupersededError;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stableValue(item)]));
    }
    return value;
}

function requestKey(endpoint: string, payload: object): string {
    return `${endpoint}:${JSON.stringify(stableValue(payload))}`;
}

/** 测试注入点：替换底层传输（默认为懒加载的 fetchSyncPost） */
export function setTransport(t: Transport | null): void {
    transport = t;
    // 测试注入、热重载或宿主切换时不能把上一套 transport 的响应交给新实例。
    inFlight.clear();
    completedIdempotent.clear();
    latestVersions.clear();
}

async function defaultTransport(endpoint: string, payload: object, options?: TransportOptions): Promise<IRawResponse> {
    const { fetchSyncPost } = require("siyuan") as {
        fetchSyncPost: (url: string, data: object, headers?: Record<string, string>, process?: boolean, signal?: AbortSignal) => Promise<IRawResponse>;
    };
    return fetchSyncPost(endpoint, payload, undefined, undefined, options?.signal) as unknown as Promise<IRawResponse>;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, endpoint: string, signal?: AbortSignal, onTimeout?: () => void, mayHaveReachedServer?: () => boolean): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new KernelError(endpoint, -408, "request timeout"));
                    onTimeout?.();
                }, timeoutMs);
                if (signal) {
                    abortListener = () => reject(new RequestAbortedError(endpoint, "request aborted", mayHaveReachedServer?.() ?? false));
                    if (signal.aborted) abortListener();
                    else signal.addEventListener("abort", abortListener, { once: true });
                }
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }
}

/** Wait between retry attempts while still honoring caller cancellation. */
export async function waitForRetryBackoff(ms: number, endpoint: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new RequestAbortedError(endpoint);
    await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortListener: (() => void) | undefined;
        const cleanup = () => {
            if (timer !== undefined) clearTimeout(timer);
            if (signal && abortListener) signal.removeEventListener("abort", abortListener);
        };
        const finish = () => { cleanup(); resolve(); };
        abortListener = () => { cleanup(); reject(new RequestAbortedError(endpoint)); };
        timer = setTimeout(finish, Math.max(0, ms));
        if (signal) signal.addEventListener("abort", abortListener, { once: true });
        if (signal?.aborted) abortListener();
    });
}

/** 内核调用错误：endpoint/code 可用于诊断区展示（33.5） */
export class KernelError extends Error {
    readonly endpoint: string;
    readonly code: number;
    readonly kernelMsg: string;

    constructor(endpoint: string, code: number, msg: string) {
        super(`[${endpoint}] ${msg}`);
        this.name = "KernelError";
        this.endpoint = endpoint;
        this.code = code;
        this.kernelMsg = msg;
    }
}

export function isKernelError(e: unknown): e is KernelError {
    return e instanceof KernelError;
}

/** token/session 失效。由宿主负责跳转登录；插件通过事件统一通知所有面板。 */
export class AuthExpiredError extends KernelError {
    constructor(endpoint: string, code: number, msg: string) {
        super(endpoint, code, msg || "登录状态已失效");
        this.name = "AuthExpiredError";
    }
}

/** Authenticated request rejected by role/workspace permissions; this is not a login expiry. */
export class PermissionDeniedError extends KernelError {
    constructor(endpoint: string, code: number, msg: string) {
        super(endpoint, code, msg || "当前账号没有执行此操作的权限");
        this.name = "PermissionDeniedError";
    }
}

export function isAuthExpired(e: unknown): e is AuthExpiredError {
    return e instanceof AuthExpiredError;
}

export function isPermissionDenied(e: unknown): e is PermissionDeniedError {
    return e instanceof PermissionDeniedError;
}

/** A write may have reached the kernel even though its response was lost. */
export function isWriteResultUnknown(e: unknown): boolean {
    if (e instanceof RequestAbortedError) return e.mayHaveReachedServer;
    if (e instanceof KernelError) {
        if (e.code === -408) return true;
        if (e.code === -1 && e.kernelMsg === "malformed response envelope") return true;
        return false;
    }
    if (e instanceof TypeError) return true;
    return typeof DOMException !== "undefined" && e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

export function looksLikeAuthFailure(res: IRawResponse): boolean {
    const msg = String(res.msg ?? "").toLowerCase();
    return res.code === 401
        || /unauthori[sz]ed|token.{0,24}(expired|invalid|失效|过期)|(?:expired|invalid).{0,24}token|session.{0,24}(expired|invalid)|not authenticated|login required|登录已失效|未登录|会话失效|鉴权失败/.test(msg);
}

function looksLikePermissionFailure(res: IRawResponse): boolean {
    const msg = String(res.msg ?? "").toLowerCase();
    return res.code === 403 || /forbidden|permission denied|insufficient privilege|无权限|没有权限|权限不足/.test(msg);
}

export function dispatchAuthExpired(endpoint: string, msg: string): void {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
        const currentLocation = typeof location !== "undefined"
            ? `${location.pathname}${location.search}${location.hash}`
            : "/";
        window.dispatchEvent(new CustomEvent("siyuan-home:auth-expired", {
            detail: { endpoint, message: msg, returnTo: currentLocation },
        }));
    } catch {
        // 测试环境或受限宿主没有 CustomEvent 时，继续将错误交给调用方处理。
    }
}

function nextLatestVersion(latestKey?: string): number | undefined {
    if (!latestKey) return undefined;
    const current = (latestVersions.get(latestKey) ?? 0) + 1;
    latestVersions.set(latestKey, current);
    return current;
}

function ensureLatest(endpoint: string, latestKey: string | undefined, version: number | undefined): void {
    if (latestKey && version !== undefined && latestVersions.get(latestKey) !== version) {
        throw new RequestSupersededError(endpoint, latestKey);
    }
}

function cleanupCompletedIdempotent(now = Date.now()): void {
    for (const [key, entry] of completedIdempotent) {
        if (entry.expiresAt <= now) completedIdempotent.delete(key);
    }
}

function unwrapResponse<T>(endpoint: string, res: IRawResponse): T {
    if (!res || typeof res.code !== "number") throw new KernelError(endpoint, -1, "malformed response envelope");
    if (res.code !== 0) {
        const msg = res.msg ?? "unknown kernel error";
        if (looksLikeAuthFailure(res)) {
            dispatchAuthExpired(endpoint, msg);
            throw new AuthExpiredError(endpoint, res.code, msg);
        }
        if (looksLikePermissionFailure(res)) {
            if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
                try {
                    window.dispatchEvent(new CustomEvent("siyuan-home:permission-denied", {
                        detail: { endpoint, message: msg },
                    }));
                } catch { /* restricted host/test environment */ }
            }
            throw new PermissionDeniedError(endpoint, res.code, msg);
        }
        throw new KernelError(endpoint, res.code, msg);
    }
    return res.data as T;
}

/**
 * 统一请求服务：请求去重、截止时间、有限读取重试、本地操作短缓存、
 * 最新请求获胜和鉴权失效通知。创建类写入不自动重放，避免未知结果时重复创建。
 */
export async function request<T = any>(endpoint: string, payload: object, options: RequestOptions = {}): Promise<T> {
    const idempotencyKey = options.idempotencyKey?.trim();
    const payloadFingerprint = JSON.stringify(stableValue(payload));
    const canRetry = READ_RETRY_ENDPOINTS.has(endpoint);
    const key = `${requestKey(endpoint, payload)}:${idempotencyKey ?? ""}`;
    cleanupCompletedIdempotent();
    const latestVersion = nextLatestVersion(options.latestKey);
    if (idempotencyKey) {
        const cached = completedIdempotent.get(`${endpoint}:${idempotencyKey}`);
        if (cached && cached.expiresAt > Date.now()) {
            if (cached.fingerprint !== payloadFingerprint) {
                throw new KernelError(endpoint, -409, "idempotency key was already used with a different payload");
            }
            ensureLatest(endpoint, options.latestKey, latestVersion);
            return cached.response.data as T;
        }
    }
    const coalesce = !options.signal && (canRetry || !!idempotencyKey);
    const existing = coalesce ? inFlight.get(key) : undefined;
    if (existing) {
        const res = await existing;
        ensureLatest(endpoint, options.latestKey, latestVersion);
        return unwrapResponse<T>(endpoint, res);
    }
    const replayableWrite = !NON_REPLAYABLE_WRITE_ENDPOINTS.has(endpoint);
    const requestedRetries = options.retries ?? (canRetry || (idempotencyKey && replayableWrite) ? 1 : 0);
    const retries = Math.max(0, Math.min(MAX_RETRIES, (canRetry || (idempotencyKey && replayableWrite)) ? requestedRetries : 0));
    const timeoutMs = Math.max(1, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    let callerAborted = options.signal?.aborted ?? false;
    const attemptControllers = new Set<AbortController>();
    const onAbort = () => {
        callerAborted = true;
        for (const controller of attemptControllers) controller.abort();
    };
    if (options.signal && !callerAborted) options.signal.addEventListener("abort", onAbort, { once: true });
    const run = (async () => {
        let lastError: unknown;
        let timedOut = false;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (callerAborted) throw new RequestAbortedError(endpoint);
            const controller = new AbortController();
            attemptControllers.add(controller);
            timedOut = false;
            let requestStarted = false;
            try {
                requestStarted = true;
                const response = (transport ?? defaultTransport)(endpoint, payload, {
                    signal: controller.signal,
                    idempotencyKey,
                });
                return await withTimeout(response, timeoutMs, endpoint, controller.signal, () => {
                    timedOut = true;
                    controller.abort();
                }, () => requestStarted);
            } catch (error) {
                lastError = error;
                if (callerAborted || (controller.signal.aborted && !timedOut) || error instanceof RequestAbortedError || error instanceof AuthExpiredError || attempt >= retries) throw error;
                await waitForRetryBackoff(180 * (attempt + 1), endpoint, options.signal);
            } finally {
                attemptControllers.delete(controller);
            }
        }
        throw lastError;
    })();
    if (coalesce) inFlight.set(key, run);
    let res: IRawResponse;
    try {
        res = await run;
    } finally {
        if (coalesce && inFlight.get(key) === run) inFlight.delete(key);
        if (options.signal && onAbort) options.signal.removeEventListener("abort", onAbort);
    }
    if (callerAborted) throw new RequestAbortedError(endpoint);
    ensureLatest(endpoint, options.latestKey, latestVersion);
    const value = unwrapResponse<T>(endpoint, res);
    if (idempotencyKey) completedIdempotent.set(`${endpoint}:${idempotencyKey}`, {
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        fingerprint: payloadFingerprint,
        response: res,
    });
    return value;
}

export async function post<T = any>(endpoint: string, payload: object, options?: RequestOptions): Promise<T> {
    return request<T>(endpoint, payload, options);
}
