import { showMessage } from "siyuan";
import { addDetachedRow, setCell } from "@/core/siyuan";

export interface ExecuteCaptureToOptions {
    plugin: any;
    moduleId: "bookmarks" | "address" | "snippets";
    text: string;
    captureDedupe: Map<string, number>;
    t: (k: string) => string;
}

/**
 * C6c 收尾：按目标模块写入——bookmarks.url / address.address_full / snippets.content
 * （存入字段与各模块 capture 一致；address 场景=收货/登记地址，全文入 address_full）。
 * 模块未启用给引导；失败保留原文（文本本就在原文档中，不丢数据）。
 */
export async function executeCaptureTo(options: ExecuteCaptureToOptions): Promise<void> {
    const { plugin, moduleId, text, captureDedupe, t } = options;

    if (!plugin.settings.enabledModules.includes(moduleId)) {
        showMessage(t("capture.moduleOff").replace("${module}", t(`module.${moduleId}`)), 5000, "info");
        return;
    }
    const normalizedText = text.trim();
    if (!normalizedText) {
        showMessage(t("capture.empty"), 3000, "info");
        return;
    }
    const dedupeKey = `${moduleId}\u0000${normalizedText}`;
    const now = Date.now();
    for (const [key, at] of captureDedupe) {
        if (now - at > 2_000) captureDedupe.delete(key);
    }
    if (captureDedupe.has(dedupeKey)) return;
    captureDedupe.set(dedupeKey, now);
    const operationKey = `capture:${moduleId}:${now.toString(36)}:${Math.random().toString(36).slice(2)}`;
    try {
        await plugin.ensureCoreLedgers();
        const ref = plugin.settings.dbRefs[moduleId];
        if (!ref?.avId || !ref.columns) throw new Error("ledger not provisioned");
        const targetCol = moduleId === "bookmarks" ? ref.columns.url
            : moduleId === "address" ? ref.columns.address_full
            : ref.columns.content;
        // 目标列缺失时必须在建行前失败，避免留下无法写入正文的空行并误报成功。
        if (!targetCol) throw new Error(`target column unavailable: ${moduleId}`);
        // 码点安全截断（Array.from 按 Unicode 码点切，emoji/生僻字不被劈成乱码）
        const name = Array.from(normalizedText).length > 40 ? `${Array.from(normalizedText).slice(0, 40).join("")}…` : normalizedText;
        const itemID = await addDetachedRow(ref.avId, name, { idempotencyKey: `${operationKey}:row` });
        await setCell(ref.avId, targetCol, itemID, moduleId === "bookmarks"
            ? { type: "url", url: { content: normalizedText } }
            : { type: "text", text: { content: normalizedText } }, { idempotencyKey: `${operationKey}:cell` });
        showMessage(t("capture.saved").replace("${module}", t(`module.${moduleId}`)), 3000, "info");
        // 常用语/书签/地址无提醒规则——写入不触发扫描（PF06：无相关变更不重扫）
    } catch (e) {
        captureDedupe.delete(dedupeKey);
        const { coalescedNotify } = await import("@/libs/notify-queue");
        coalescedNotify("capture-failed", () =>
            showMessage(t("capture.failed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error"));
    }
}
