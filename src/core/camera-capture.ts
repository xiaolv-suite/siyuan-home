/**
 * 跨端设备拍照与本地照片预处理底座（老板 msg#3896）：
 * - 移动端（或无 getUserMedia 环境）：唤起 <input type="file" accept="image/*" capture="environment"> 直呼系统相机；
 * - 桌面端（支持 navigator.mediaDevices.getUserMedia）：开启轻量实时取景弹窗，拍完自动转 File 并停流关灯；
 *   若无摄像头或用户拒绝授权，平滑提示并自动回退到本地文件选择。
 */

import { compressImageTo300KB } from "./assets";
import { bindDialogA11y } from "./dialog-a11y";

export function isMobileCapturePreferred(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return true;
    const w = window as any;
    if (w.siyuan?.config?.system?.isMobile) return true;
    if (typeof document !== "undefined" && document.body?.classList?.contains("body--mobile")) return true;
    if (typeof window.innerWidth === "number" && window.innerWidth <= 640) return true;
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "")) return true;
    return false;
}

export async function preparePhotoFile(file: File, options?: { compress?: boolean }): Promise<File> {
    if (options?.compress === false || !file.type.startsWith("image/")) return file;
    try {
        const compressed = await compressImageTo300KB(file);
        return compressed || file;
    } catch {
        return file;
    }
}

export interface CapturePhotoOptions {
    DialogCls?: new (opts: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    t: (k: string) => string;
    showMessageFn?: (msg: string, timeout?: number, type?: string) => void;
    fallbackFileInput?: () => void;
    onFileCaptured: (file: File) => Promise<void> | void;
}

function tx(t: (k: string) => string, key: string, fallback: string): string {
    const val = t(key);
    return val && val !== key ? val : fallback;
}

export async function capturePhotoFromDevice(options: CapturePhotoOptions): Promise<"camera_dialog" | "fallback_input"> {
    const { DialogCls, t, showMessageFn, fallbackFileInput, onFileCaptured } = options;

    if (
        isMobileCapturePreferred() ||
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        !DialogCls ||
        typeof document === "undefined"
    ) {
        fallbackFileInput?.();
        return "fallback_input";
    }

    let stream: MediaStream | null = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
        });
    } catch {
        showMessageFn?.(
            tx(t, "capture.cameraFallbackHint", "未检测到可用摄像头或未授权，已为您切换为本地选择文件"),
            3500,
            "info",
        );
        fallbackFileInput?.();
        return "fallback_input";
    }

    const stopStream = () => {
        try {
            stream?.getTracks?.().forEach((tr) => tr.stop());
        } catch { /* soft */ }
        stream = null;
    };

    const dlg = new DialogCls({
        title: tx(t, "capture.cameraTitle", "拍照留存"),
        content: `<div class="b3-dialog__content lv-dialog-col" id="lv-camera-body">
            <video id="lv-camera-video" autoplay playsinline muted style="width:100%;max-height:55vh;border-radius:8px;background:#000;object-fit:cover;"></video>
        </div>
        <div class="b3-dialog__action">
            <button type="button" class="b3-button b3-button--cancel" id="lv-camera-cancel">${tx(t, "cancel", "取消")}</button>
            <button type="button" class="b3-button b3-button--outline" id="lv-camera-upload">${tx(t, "capture.cameraUseUpload", "改用本地上传")}</button>
            <span class="fn__flex-1"></span>
            <button type="button" class="b3-button" id="lv-camera-snap">📷 ${tx(t, "capture.cameraSnap", "拍照")}</button>
        </div>`,
        width: "min(520px, 94vw)",
    });

    bindDialogA11y({ dlg, onClose: stopStream });

    const video = dlg.element.querySelector("#lv-camera-video") as HTMLVideoElement | null;
    if (video) {
        try {
            (video as any).srcObject = stream;
            await video.play?.().catch(() => undefined);
        } catch { /* soft */ }
    }

    const closeAndStop = () => {
        stopStream();
        dlg.destroy();
    };

    const cancelBtn = dlg.element.querySelector("#lv-camera-cancel") as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.onclick = closeAndStop;

    const uploadFallbackBtn = dlg.element.querySelector("#lv-camera-upload") as HTMLButtonElement | null;
    if (uploadFallbackBtn) {
        uploadFallbackBtn.onclick = () => {
            closeAndStop();
            fallbackFileInput?.();
        };
    }

    const snapBtn = dlg.element.querySelector("#lv-camera-snap") as HTMLButtonElement | null;
    if (snapBtn) {
        snapBtn.onclick = async () => {
            if (!video) return;
            snapBtn.disabled = true;
            try {
                const w = video.videoWidth || 1280;
                const h = video.videoHeight || 720;
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext?.("2d");
                if (!ctx) {
                    closeAndStop();
                    fallbackFileInput?.();
                    return;
                }
                ctx.drawImage(video, 0, 0, w, h);
                const blob = await new Promise<Blob | null>((resolve) =>
                    canvas.toBlob ? canvas.toBlob(resolve, "image/jpeg", 0.9) : resolve(null),
                );
                if (!blob) {
                    closeAndStop();
                    fallbackFileInput?.();
                    return;
                }
                const rawFile = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
                const prepared = await preparePhotoFile(rawFile);
                closeAndStop();
                await onFileCaptured(prepared);
            } catch {
                closeAndStop();
                fallbackFileInput?.();
            }
        };
    }

    return "camera_dialog";
}
