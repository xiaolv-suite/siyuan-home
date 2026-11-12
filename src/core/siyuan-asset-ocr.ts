/**
 * 思源笔记资产上传与 OCR 智能识别独立模块（解耦自 siyuan.ts）
 * 包含：文件上传多通道传输、指纹防重、并发去重、OCR 引擎配置读取与图片文字识别
 */

import {
    type IRawResponse,
    type RequestOptions,
    type TransportOptions,
    KernelError,
    AuthExpiredError,
    RequestAbortedError,
    isWriteResultUnknown,
    withTimeout,
    waitForRetryBackoff,
    REQUEST_TIMEOUT_MS,
    IDEMPOTENCY_TTL_MS,
    looksLikeAuthFailure,
    dispatchAuthExpired,
    post,
} from "./siyuan";

export type UploadTransport = (formData: FormData, options?: TransportOptions) => Promise<IRawResponse>;

let uploadTransport: UploadTransport | null = null;
const uploadInFlight = new Map<string, { fingerprint: string; promise: Promise<IRawResponse> }>();
const uploadCompleted = new Map<string, { expiresAt: number; fingerprint: string; response: IRawResponse }>();

/** 测试注入点：替换底层上传传输（默认 fetch multipart；fetchSyncPost 不支持 FormData） */
export function setUploadTransport(t: UploadTransport | null): void {
    uploadTransport = t;
    uploadInFlight.clear();
    uploadCompleted.clear();
}

async function defaultUploadTransport(formData: FormData, options?: TransportOptions): Promise<IRawResponse> {
    // 严禁传递包含非 ASCII 字符的自定义 Header，避免浏览器 Headers 构造抛出 non ISO-8859-1 异常
    const res = await fetch("/api/asset/upload", { method: "POST", body: formData, signal: options?.signal });
    if (res.status === 401 || res.status === 403) return { code: res.status, msg: "token expired" };
    return (await res.json()) as IRawResponse;
}

/**
 * 上传文件到思源 assets（A2c），返回 { name, path } 供 asset/mAsset 列写入。
 * 端点 /api/asset/upload 与响应 succMap 形态以 3.8.x 实例为准。
 */
export async function uploadAsset(file: File, assetsPath = "/assets/siyuan-home/", options?: RequestOptions): Promise<{ name: string; path: string }> {
    const formData = new FormData();
    formData.append("file[]", file);
    formData.append("assetsPath", assetsPath);
    const idempotencyKey = options?.idempotencyKey?.trim();
    const uploadKey = idempotencyKey ? `asset.upload:${idempotencyKey}` : undefined;
    const uploadFingerprint = `${assetsPath}\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`;
    if (uploadKey) {
        const done = uploadCompleted.get(uploadKey);
        if (done && done.expiresAt > Date.now()) {
            if (done.fingerprint !== uploadFingerprint) throw new KernelError("asset.upload", -409, "idempotency key was already used with a different file");
            const succMap = done.response.data?.succMap ?? {};
            const entry = Object.entries(succMap as Record<string, string>)[0];
            if (entry) return { name: entry[0], path: entry[1] };
        }
        const active = uploadInFlight.get(uploadKey);
        if (active) {
            if (active.fingerprint !== uploadFingerprint) throw new KernelError("asset.upload", -409, "idempotency key was already used with a different file");
            const response = await active.promise;
            const succMap = response.data?.succMap ?? {};
            const entry = Object.entries(succMap as Record<string, string>)[0];
            if (entry) return { name: entry[0], path: entry[1] };
        }
    }
    let callerAborted = options?.signal?.aborted ?? false;
    const attemptControllers = new Set<AbortController>();
    const onAbort = () => {
        callerAborted = true;
        for (const controller of attemptControllers) controller.abort();
    };
    if (options?.signal && !callerAborted) options.signal.addEventListener("abort", onAbort, { once: true });
    let res: IRawResponse;
    const run = async (): Promise<IRawResponse> => {
        const retries = 0;
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (callerAborted) throw new RequestAbortedError("asset.upload");
            const controller = new AbortController();
            attemptControllers.add(controller);
            let timedOut = false;
            try {
                const upload = (uploadTransport ?? defaultUploadTransport)(formData, {
                    signal: controller.signal,
                    idempotencyKey,
                });
                return await withTimeout(upload, Math.max(1, options?.timeoutMs ?? REQUEST_TIMEOUT_MS), "asset.upload", controller.signal, () => {
                    timedOut = true;
                    controller.abort();
                });
            } catch (error) {
                lastError = error;
                if (callerAborted || (controller.signal.aborted && !timedOut) || error instanceof RequestAbortedError || attempt >= retries) throw error;
                await waitForRetryBackoff(180 * (attempt + 1), "asset.upload", options?.signal);
            } finally {
                attemptControllers.delete(controller);
            }
        }
        throw lastError;
    };
    let currentUploadPromise: Promise<IRawResponse> | undefined;
    try {
        if (uploadKey) {
            const active = run();
            currentUploadPromise = active;
            uploadInFlight.set(uploadKey, { fingerprint: uploadFingerprint, promise: active });
            res = await active;
            if (res.code === 0) uploadCompleted.set(uploadKey, { expiresAt: Date.now() + IDEMPOTENCY_TTL_MS, fingerprint: uploadFingerprint, response: res });
        } else {
            res = await run();
        }
    } catch (error) {
        if (callerAborted || error instanceof RequestAbortedError) throw error;
        if (isWriteResultUnknown(error)) {
            throw new KernelError("asset.upload", -408, "upload result is unknown; check the asset list before retrying");
        }
        throw error;
    } finally {
        if (uploadKey) {
            const active = uploadInFlight.get(uploadKey);
            if (active?.promise === currentUploadPromise) uploadInFlight.delete(uploadKey);
        }
        if (options?.signal) options.signal.removeEventListener("abort", onAbort);
    }
    if (callerAborted) throw new RequestAbortedError("asset.upload");
    if (!res || typeof res.code !== "number") throw new KernelError("asset.upload", -1, "malformed response envelope");
    if (res.code !== 0) {
        if (looksLikeAuthFailure(res)) {
            dispatchAuthExpired("asset.upload", res.msg ?? "登录状态已失效");
            throw new AuthExpiredError("asset.upload", res.code, res.msg ?? "登录状态已失效");
        }
        throw new KernelError("asset.upload", res.code, res.msg ?? "upload failed");
    }
    const succMap = res.data?.succMap ?? {};
    const entry = Object.entries(succMap as Record<string, string>)[0];
    if (!entry) throw new KernelError("asset.upload", -3, "no file in succMap");
    return { name: entry[0], path: entry[1] };
}

// ── OCR（手动识别使用思源当前设备的 OCR 配置；不改变自动识别开关）──

export interface OCRConfigData {
    config: {
        provider: string;
        model: string;
        auto: boolean;
        aiModelId?: string;
    };
    providers: { id: string; available: boolean }[];
    models: { id: string; name: string; builtIn: boolean }[];
    aiModels: { id: string; name: string; provider: string }[];
}

/** 获取当前设备 OCR 设置；旧内核不支持时由调用方提供升级/设置指引。 */
export function getOCRConfig(options?: RequestOptions): Promise<OCRConfigData> {
    return post<OCRConfigData>("/api/asset/getOCRConfig", {}, options);
}

/** 读取资源已保存的 OCR 文本，不触发识别。 */
export async function getImageOCRText(path: string, options?: RequestOptions): Promise<string> {
    const data = await post<{ text?: string }>("/api/asset/getImageOCRText", { path }, options);
    return typeof data?.text === "string" ? data.text : "";
}

/** 按当前思源 OCR 提供商识别图片；内核会保存结果并更新 OCR 索引。 */
export async function recognizeAsset(path: string, options?: RequestOptions): Promise<{ text: string; ocrJSON: Record<string, string>[] }> {
    const data = await post<{ text?: string; ocrJSON?: Record<string, string>[] }>("/api/asset/ocr", { path }, options);
    return {
        text: typeof data?.text === "string" ? data.text : "",
        ocrJSON: Array.isArray(data?.ocrJSON) ? data.ocrJSON : [],
    };
}
