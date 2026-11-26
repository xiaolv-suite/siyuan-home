/**
 * 内核 API 薄封装（ADR：所有 /api 调用集中于此，便于 mock 与 Spike 修正）。
 * 前端同源走 fetchSyncPost（siyuan 包），无需令牌。
 * 可测性（33.5/A2d）：传输函数与 av 工厂均可注入——单测用 setTransport/
 * setAttributeViewFactory 替换，生产代码零感知。
 * 端点名以 3.8.x 为准，标注 [Spike] 的调用点在实例可用时按实测修正。
 */

export * from "./siyuan-transport";
import {
    post,
    hasCustomTransport,
    KernelError,
    isWriteResultUnknown,
    type RequestOptions,
} from "./siyuan-transport";

export const MAX_AV_BATCH_SIZE = 20;
export const DEFAULT_AV_PAGE_SIZE = 100;
const CUSTOM_ATTR_NAME_REGEX = /^custom-[a-z][a-z0-9-]*$/;

export class AvBindingMismatchError extends Error {
    constructor(message: string) {
        super(`[AV-BINDING-MISMATCH] ${message}`);
        this.name = "AvBindingMismatchError";
    }
}

export class AvValidationError extends Error {
    constructor(message: string) {
        super(`[AV-VALIDATION-ERROR] ${message}`);
        this.name = "AvValidationError";
    }
}

// ── SQL（只读）──────────────────────────────────────────────

export function sql<T = Record<string, any>>(stmt: string, options?: RequestOptions): Promise<T[]> {
    return post<T[]>("/api/query/sql", { stmt }, options);
}

// ── 笔记本与文档 ────────────────────────────────────────────

export interface NotebookInfo { id: string; name: string; closed: boolean }

export function listNotebooks(options?: RequestOptions): Promise<NotebookInfo[]> {
    return post<{ notebooks?: NotebookInfo[] }>("/api/notebook/lsNotebooks", {}, options)
        .then((d) => d?.notebooks ?? []);
}

/**
 * 归一化 createNotebook 的返回值。
 * 思源 3.8.5 返回裸 ID，3.8.6+ 部分版本返回 { notebook: { id } }；
 * 同时兼容过渡版本的 { notebook: id } 与 { id }，避免对象继续流入文档 API。
 */
function notebookIdFromCreateResponse(data: unknown): string {
    if (typeof data === "string" && data) return data;
    if (!data || typeof data !== "object") {
        throw new KernelError("/api/notebook/createNotebook", -3, "invalid notebook id in response");
    }
    const response = data as { notebook?: unknown; id?: unknown };
    if (typeof response.notebook === "string" && response.notebook) return response.notebook;
    if (response.notebook && typeof response.notebook === "object") {
        const nestedId = (response.notebook as { id?: unknown }).id;
        if (typeof nestedId === "string" && nestedId) return nestedId;
    }
    if (typeof response.id === "string" && response.id) return response.id;
    throw new KernelError("/api/notebook/createNotebook", -3, "invalid notebook id in response");
}

export async function createNotebook(name: string, options?: RequestOptions): Promise<string> {
    const data = await post<unknown>("/api/notebook/createNotebook", { name }, options);
    return notebookIdFromCreateResponse(data);
}

/** 重新打开已关闭的笔记本（D07：笔记本被用户关闭 → 恢复而非新建。[待实测] payload 以 3.8.x 实例为准） */
export function openNotebook(notebookId: string, options?: RequestOptions): Promise<void> {
    return post("/api/notebook/openNotebook", { notebook: notebookId }, options).then(() => undefined);
}

/**
 * 归一化 createDocWithMd 的返回值。
 * 兼容裸 ID 字符串、外层带引号的字符串、以及部分版本返回的包含 id/rootID 的对象结构。
 */
export function docIdFromCreateResponse(data: unknown): string {
    if (typeof data === "string" && data) return data.replace(/^"|"$/g, "").trim();
    if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const id = obj.id ?? obj.rootID ?? obj.rootId ?? obj.docId ?? obj.docID ?? obj.data;
        if (typeof id === "string" && id) return id.replace(/^"|"$/g, "").trim();
    }
    return "";
}

/** path 为 hpath；返回 docID */
export async function createDocWithMd(notebook: string, hpath: string, markdown: string, options?: RequestOptions): Promise<string> {
    const data = await post<unknown>("/api/filetree/createDocWithMd", { notebook, path: hpath, markdown }, options);
    const docId = docIdFromCreateResponse(data);
    if (!docId) {
        throw new KernelError("/api/filetree/createDocWithMd", -3, "invalid doc id in response");
    }
    return docId;
}

export function getHPathByID(id: string, options?: RequestOptions): Promise<string> {
    return post<string>("/api/filetree/getHPathByID", { id }, options);
}

export function removeDoc(notebook: string, path: string, options?: RequestOptions): Promise<void> {
    return post("/api/filetree/removeDoc", { notebook, path }, options);
}

// ── 块与数据库（av）─────────────────────────────────────────

export function getBlockKramdown(id: string, options?: RequestOptions): Promise<{ id: string; kramdown: string }> {
    return post("/api/block/getBlockKramdown", { id }, options);
}

export function getBlockDOM(id: string, options?: RequestOptions): Promise<{ id: string; dom: string } | null> {
    return post<{ id: string; dom: string } | null>("/api/block/getBlockDOM", { id }, options);
}

export interface ChildBlockInfo {
    id: string;
    type?: string;
    subType?: string;
    subtype?: string;
    content?: string;
    markdown?: string;
    ial?: string;
}

export function getChildBlocks(id: string, options?: RequestOptions): Promise<ChildBlockInfo[]> {
    return post<ChildBlockInfo[]>("/api/block/getChildBlocks", { id }, options);
}

export function getBlockAttrs(id: string, options?: RequestOptions): Promise<Record<string, string> | null> {
    return post<Record<string, string> | null>("/api/attr/getBlockAttrs", { id }, options);
}

export function setBlockAttrs(id: string, attrs: Record<string, string | null>, options?: RequestOptions): Promise<void> {
    return post("/api/attr/setBlockAttrs", { id, attrs }, options);
}

export function batchSetBlockAttrs(
    blockAttrs: Array<{ id: string; attrs: Record<string, string | null> }>,
    options?: RequestOptions,
): Promise<void> {
    return post("/api/attr/batchSetBlockAttrs", { blockAttrs }, options);
}

export function deleteBlock(id: string, options?: RequestOptions): Promise<unknown> {
    return post("/api/block/deleteBlock", { id }, { ...options, retries: 0 });
}

export async function getFileText(filePath: string, options?: RequestOptions): Promise<string> {
    if (hasCustomTransport()) {
        const data = await post<unknown>("/api/file/getFile", { path: filePath }, options);
        if (typeof data === "string") return data;
        if (data === null || data === undefined) throw new KernelError("/api/file/getFile", 404, "file not found");
        return JSON.stringify(data);
    }
    const res = await fetch("/api/file/getFile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
        signal: options?.signal ?? AbortSignal.timeout(options?.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new KernelError("/api/file/getFile", res.status, `HTTP ${res.status}`);
    const text = await res.text();
    try {
        const maybeErr = JSON.parse(text) as { code?: number; msg?: string };
        if (maybeErr && typeof maybeErr === "object" && typeof maybeErr.code === "number" && maybeErr.code !== 0) {
            throw new KernelError("/api/file/getFile", maybeErr.code, maybeErr.msg || "file not found");
        }
    } catch (err) {
        if (err instanceof KernelError) throw err;
    }
    return text;
}

export async function putFileText(filePath: string, contentString: string, options?: RequestOptions): Promise<unknown> {
    if (hasCustomTransport()) {
        return post("/api/file/putFile", { path: filePath, isDir: false, content: contentString }, options);
    }
    const form = new FormData();
    form.append("path", filePath);
    form.append("isDir", "false");
    form.append("modTime", String(Math.floor(Date.now() / 1000)));
    const fileName = filePath.split("/").pop() || "data.json";
    form.append("file", new Blob([contentString], { type: "application/json" }), fileName);
    const res = await fetch("/api/file/putFile", {
        method: "POST",
        body: form,
        signal: options?.signal ?? AbortSignal.timeout(options?.timeoutMs ?? 15_000),
    });
    const json = await res.json();
    if (json && typeof json.code === "number" && json.code !== 0) {
        throw new KernelError("/api/file/putFile", json.code, json.msg || "putFile failed");
    }
    return json?.data;
}

/**
 * 思源 v3.8.12 AV Format 17 定案：
 * - 建库：dataType:"dom" 插入 <div data-type="NodeAttributeView" data-av-id="X" data-av-type="table" data-node-id="Y" custom-lv-schema="home-ledger-v2"></div>
 * - 绑定校验：通过 getBlockDOM 解析真实 data-av-id，强校验 dbRefs.avId === data-av-id
 * - 加列：addAttributeViewKey
 * - 主键：KeyTypeBlock 强制 { type: "block", block: { id: itemID, content }, rich: null }
 * - 批写：appendAttributeViewDetachedBlocksWithValues（外部主键去重 + <=20 行/批）
 * - 写值：setAttributeViewBlockAttr 传 itemID（非废弃 rowID）
 * - 读：renderAttributeView 传 { id: avID, blockID }，严禁 pageSize: -1
 */

function escapeXmlAttr(value: string): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function buildAttributeViewDom(params: {
    avId: string;
    avBlockId: string;
    avType?: "table" | "gallery" | "kanban";
    schema?: string;
    extraAttrs?: Record<string, string>;
}): string {
    if (!params.avId || !params.avBlockId) {
        throw new AvValidationError("avId and avBlockId are required");
    }
    const schema = params.schema || "home-ledger-v2";
    const attrs: Record<string, string> = {
        "custom-lv-schema": schema,
        ...(params.extraAttrs || {}),
    };
    for (const k of Object.keys(attrs)) {
        if (!CUSTOM_ATTR_NAME_REGEX.test(k)) {
            throw new AvValidationError(`Illegal custom attribute name "${k}"`);
        }
    }
    const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
        .join(" ");
    return `<div data-type="NodeAttributeView" data-av-id="${escapeXmlAttr(params.avId)}" data-av-type="${escapeXmlAttr(params.avType || "table")}" data-node-id="${escapeXmlAttr(params.avBlockId)}" ${attrStr}></div>`;
}

export function parseDataAvIdFromDom(domHtml: string | undefined | null): string | null {
    if (!domHtml) return null;
    const m = domHtml.match(/data-av-id="([^"]+)"/i);
    return m ? m[1] : null;
}

export function parseAvBlockIdFromDom(domHtml: string | undefined | null): string | null {
    if (!domHtml) return null;
    const m =
        domHtml.match(/data-type="NodeAttributeView"[^>]*data-node-id="([^"]+)"/i) ||
        domHtml.match(/data-node-id="([^"]+)"[^>]*data-type="NodeAttributeView"/i);
    return m ? m[1] : null;
}

export function buildPrimaryBlockCell(params: {
    keyID?: string;
    itemID: string;
    content: string;
    isDetached?: boolean;
    includeRichNull?: boolean;
}): {
    type: "block";
    keyID?: string;
    isDetached: boolean;
    itemID: string;
    block: { id: string; content: string };
    rich?: null;
} {
    if (!params.itemID) {
        throw new AvValidationError("itemID is required for KeyTypeBlock cell");
    }
    const cell: {
        type: "block";
        keyID?: string;
        isDetached: boolean;
        itemID: string;
        block: { id: string; content: string };
        rich?: null;
    } = {
        ...(params.keyID ? { keyID: params.keyID } : {}),
        isDetached: params.isDetached ?? true,
        itemID: params.itemID,
        type: "block",
        block: {
            id: params.itemID,
            content: String(params.content ?? ""),
        },
    };
    if (params.includeRichNull !== false) {
        cell.rich = null;
    }
    return cell;
}

export function validateAvRowCells(cells: Array<Record<string, any>>, primaryKeyID?: string): void {
    if (!Array.isArray(cells) || cells.length === 0) {
        throw new AvValidationError("AV row cells must be a non-empty array");
    }
    for (const cell of cells) {
        if (!cell?.keyID) {
            throw new AvValidationError("Every AV cell must carry keyID");
        }
        if (primaryKeyID && cell.keyID === primaryKeyID) {
            if (cell.type !== "block" || !cell.block || !cell.block.id) {
                throw new AvValidationError(
                    `Primary KeyTypeBlock (${primaryKeyID}) must use type:"block" with block.id, got type="${cell.type}"`,
                );
            }
            if (cell.itemID && cell.block.id !== cell.itemID) {
                throw new AvValidationError(
                    `Primary cell itemID (${cell.itemID}) must match block.id (${cell.block.id})`,
                );
            }
        }
    }
}

function extractBlockOpId(d: any): string {
    const ops: any[] = Array.isArray(d) ? (d[0]?.doOperations ?? []) : (d?.doOperations ?? d?.data?.doOperations ?? []);
    for (const op of ops) {
        if (typeof op?.id === "string" && op.id) return op.id;
        const m = String(op?.data ?? "").match(/data-node-id="(\d{14}-[a-z0-9]+)"/);
        if (m) return m[1];
    }
    return String(d?.id ?? d?.blockID ?? d?.data?.id ?? "");
}

/** 插入 markdown 块，返回新块 ID */
export async function insertBlock(parentID: string, markdown: string, options?: RequestOptions): Promise<string> {
    const d = await post<any>("/api/block/insertBlock", { dataType: "markdown", parentID, data: markdown }, { ...options, retries: 0 });
    return extractBlockOpId(d);
}

/** 在文档末尾追加 markdown 块，返回新块 ID */
export async function appendBlock(parentID: string, markdown: string, options?: RequestOptions): Promise<string> {
    const d = await post<any>("/api/block/appendBlock", { dataType: "markdown", parentID, data: markdown }, { ...options, retries: 0 });
    return extractBlockOpId(d);
}

/** 在文档末尾原子追加 DOM 块，返回操作结果（含真实 node id） */
export async function appendBlockDom(parentID: string, domHtml: string, options?: RequestOptions): Promise<any> {
    return post<any>("/api/block/appendBlock", { dataType: "dom", parentID, data: domHtml }, { ...options, retries: 0 });
}

/** 原地更新指定块 ID 的 markdown 内容 */
export async function updateBlock(id: string, markdown: string, options?: RequestOptions): Promise<void> {
    await post("/api/block/updateBlock", { dataType: "markdown", id, data: markdown }, options);
}

/** 原地更新指定块 ID 的 DOM 内容 */
export async function updateBlockDom(id: string, domHtml: string, options?: RequestOptions): Promise<void> {
    await post("/api/block/updateBlock", { dataType: "dom", id, data: domHtml }, options);
}

/** 折叠指定标题或容器块（思源原生标题折叠，大纲与编辑器同步生效） */
export async function foldBlock(id: string, options?: RequestOptions): Promise<void> {
    await post("/api/block/foldBlock", { id }, options);
}

/** 新思源 ID（yyyyMMddHHmmss-xxxxxxx 形态；内核对 keyID/avIdSeed 接受自造值）。crypto 随机，非加密用途但避可预测值 */
export function newSiYuanId(): string {
    const t = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    const rand = Array.from(buf).map((b) => (b % 36).toString(36)).join("").padEnd(7, "0").slice(0, 7);
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${rand}`;
}

export interface AvColumnSpec {
    keyID?: string;
    name: string;
    /** 思源列类型：text/date/select/mSelect/number/asset/mAsset/relation/checkbox/url/email/phone/block… */
    type: string;
    /** relation 列目标库 avID（R2 定案：写入接受，读取 API 不回显——schema 层自行记忆） */
    relationTargetAvID?: string;
    /** 前一列 keyID：用于将新增列按 schema 顺序排在主键/前一列之后，避免空串插到第 0 列导致思源原生表格列序倒置 */
    previousKeyID?: string;
}

export async function addAttributeViewColumn(avID: string, col: AvColumnSpec, options?: RequestOptions): Promise<string> {
    const keyID = col.keyID ?? newSiYuanId();
    const payload: Record<string, unknown> = {
        avID, keyID, keyIcon: "", keyName: col.name, keyType: col.type, previousKeyID: col.previousKeyID ?? "",
    };
    if (col.type === "relation" && col.relationTargetAvID) {
        payload.relation = { avID: col.relationTargetAvID, isTwoWay: false, backKeyID: "" };
    }
    await post("/api/av/addAttributeViewKey", payload, options);
    return keyID;
}

export function getAttributeViewKeysByAvID(avID: string, options?: RequestOptions): Promise<Array<{ id: string; name: string; type: string }>> {
    return post("/api/av/getAttributeViewKeysByAvID", { avID }, options);
}

export function appendAttributeViewDetachedBlocksWithValues(
    avID: string,
    blocksValues: Array<Array<Record<string, unknown>>>,
    options?: RequestOptions,
): Promise<unknown> {
    return post("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID, blocksValues }, { ...options, retries: 0 });
}

export function getAttributeViewItemIDsByBoundIDs(
    avID: string,
    blockIDs: string[],
    options?: RequestOptions,
): Promise<Record<string, string>> {
    return post("/api/av/getAttributeViewItemIDsByBoundIDs", { avID, blockIDs }, options);
}

export function getAttributeViewItemStatuses(
    avID: string,
    itemIDs: string[],
    options?: RequestOptions,
): Promise<Record<string, string>> {
    return post("/api/av/getAttributeViewItemStatuses", { id: avID, itemIDs }, options);
}

/** 强校验 dbRef.avId === 文档内 live DOM 真实 data-av-id */
export async function assertAvRefBound(
    dbRef: { avId?: string; avBlockId?: string; docId?: string },
    options?: RequestOptions,
): Promise<{ avId: string; avBlockId: string; dom: string }> {
    if (!dbRef?.avId || !dbRef?.avBlockId) {
        throw new AvBindingMismatchError("Missing avId or avBlockId in dbRef");
    }
    const blockDom = await getBlockDOM(dbRef.avBlockId, options);
    if (!blockDom || blockDom.id !== dbRef.avBlockId) {
        throw new AvBindingMismatchError(`AV container block ${dbRef.avBlockId} does not exist in live .sy`);
    }
    const actualDataAvId = parseDataAvIdFromDom(blockDom.dom);
    if (!actualDataAvId) {
        throw new AvBindingMismatchError(`Block ${dbRef.avBlockId} DOM has no data-av-id attribute`);
    }
    if (actualDataAvId !== dbRef.avId) {
        throw new AvBindingMismatchError(
            `dbRef.avId (${dbRef.avId}) !== live data-av-id (${actualDataAvId}) on block ${dbRef.avBlockId}`,
        );
    }
    return { avId: actualDataAvId, avBlockId: dbRef.avBlockId, dom: blockDom.dom };
}

/**
 * 通过 dataType: "dom" 在文档内创建并强绑定 NodeAttributeView，回读 getBlockDOM 解析真实 data-av-id，
 * 再以 { id: avId, blockID: avBlockId, createIfNotExist: true } 初始化内核 AV。
 */
export async function createAndBindAttributeView(
    docId: string,
    avIdSeed: string,
    options?: RequestOptions & { avBlockId?: string; schema?: string; extraAttrs?: Record<string, string> },
): Promise<{ avId: string; avBlockId: string }> {
    const readOptions: RequestOptions = { timeoutMs: options?.timeoutMs, signal: options?.signal, retries: 1 };
    const isValidBlockId = (v: string) => /^\d{14}-[0-9a-z]{7}$/i.test(v);
    const candidateBlockId = options?.avBlockId || (isValidBlockId(avIdSeed) ? avIdSeed : newSiYuanId());

    const findBySeed = async (): Promise<{ avId: string; avBlockId: string } | null> => {
        try {
            const rows = await sql<{ id: string; markdown?: string }>(
                `SELECT id, markdown FROM blocks WHERE (type='av' OR markdown LIKE '%data-type="NodeAttributeView"%') AND root_id='${docId.replace(/'/g, "''")}' LIMIT 5`,
                readOptions,
            );
            if (!Array.isArray(rows) || rows.length === 0) return null;
            for (const r of rows) {
                try {
                    const domRes = await getBlockDOM(r.id, readOptions);
                    const liveAvId = parseDataAvIdFromDom(domRes?.dom);
                    if (liveAvId && (liveAvId === avIdSeed || rows.length === 1)) {
                        return { avId: liveAvId, avBlockId: r.id };
                    }
                } catch { /* soft */ }
                if (r.markdown) {
                    const mdAvId = parseDataAvIdFromDom(r.markdown);
                    if (mdAvId && (mdAvId === avIdSeed || rows.length === 1)) {
                        return { avId: mdAvId, avBlockId: r.id };
                    }
                }
            }
            if (rows.length === 1) {
                return { avId: avIdSeed || rows[0].id, avBlockId: rows[0].id };
            }
            return null;
        } catch {
            return null;
        }
    };

    let bound = await findBySeed();
    if (!bound) {
        const domHtml = buildAttributeViewDom({
            avId: avIdSeed,
            avBlockId: candidateBlockId,
            avType: "table",
            schema: options?.schema || "home-ledger-v2",
            extraAttrs: options?.extraAttrs,
        });
        try {
            const opRes = await appendBlockDom(docId, domHtml, options);
            const opId = extractBlockOpId(opRes);
            const resolvedBlockId = opId || candidateBlockId;
            try {
                const liveDom = await getBlockDOM(resolvedBlockId, readOptions);
                if (liveDom?.dom) {
                    const actualDataAvId = parseDataAvIdFromDom(liveDom.dom);
                    if (!actualDataAvId) {
                        throw new AvBindingMismatchError(`Inserted AV block ${resolvedBlockId} DOM has no data-av-id`);
                    }
                    if (actualDataAvId !== avIdSeed) {
                        throw new AvBindingMismatchError(`Inserted data-av-id (${actualDataAvId}) !== expected (${avIdSeed})`);
                    }
                    bound = { avId: actualDataAvId, avBlockId: resolvedBlockId };
                } else {
                    bound = (await findBySeed()) ?? { avId: avIdSeed, avBlockId: resolvedBlockId };
                }
            } catch (domErr) {
                if (domErr instanceof AvBindingMismatchError) throw domErr;
                bound = (await findBySeed()) ?? { avId: avIdSeed, avBlockId: resolvedBlockId };
            }
        } catch (error) {
            if (error instanceof AvBindingMismatchError || !isWriteResultUnknown(error)) throw error;
        }
    }

    for (let i = 0; !bound && i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        bound = await findBySeed();
    }
    if (!bound) throw new KernelError("av.createAttributeView", -3, "av block not found after insert");

    await post(
        "/api/av/renderAttributeView",
        { id: bound.avId, blockID: bound.avBlockId, createIfNotExist: true },
        options,
    );
    return bound;
}

/** 在文档内插入 av 容器 div 并触发内核建库，返回真实 data-av-id */
export async function createAttributeView(docId: string, avIdSeed: string, options?: RequestOptions): Promise<string> {
    const res = await createAndBindAttributeView(docId, avIdSeed, options);
    return res.avId;
}

/**
 * 主键行 ID 全量读取（D01）：逐页 200 行直到不足一页；
 * 扫描不得只读首页（>200 行的台账此前会静默漏提醒）。
 * 上限 100 页（2 万行）防内核异常导致的死循环。
 */
export async function primaryRowItemIDs(avID: string, pageSize = 200, options?: RequestOptions): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
        const d = await post<any>("/api/av/getAttributeViewPrimaryKeyValues", { id: avID, page, pageSize }, options);
        const batch: string[] = (d?.rows?.values ?? []).map((v: any) => v.id);
        ids.push(...batch);
        if (batch.length < pageSize) return ids;
        if (page >= 100) throw new KernelError("av.getAttributeViewPrimaryKeyValues", -4, "pagination did not converge");
    }
}

/**
 * 新行身份未确认（D02）：行已提交到内核，但无法唯一确定 itemID。
 * 调用方必须提示"已提交待确认"并避免诱导重复创建，不得静默当作成功或失败重试。
 */
export interface DetachedRowIdentity {
    avID: string;
    desiredItemID: string;
    before: string[];
    submitted: boolean;
}

export class RowIdentityPendingError extends Error {
    readonly candidates: string[];
    constructor(candidates: string[]) {
        super(candidates.length > 1
            ? `row committed, ${candidates.length} identity candidates`
            : "row committed but identity not confirmed");
        this.name = "RowIdentityPendingError";
        this.candidates = candidates;
    }
}

/** 从 addAttributeViewBlocks 响应收集可信的新行 ID（仅采信明确 rowID/itemID 字段或经核实的 insertAttrViewBlock 操作行 ID） */
function rowIDsFromAddResponse(d: any): string[] {
    const out: string[] = [];
    const pushStringId = (v: any) => {
        if (typeof v === "string" && v && !out.includes(v)) {
            if (/^\d{14}-[0-9a-z]{7}$/i.test(v) || /^[a-z0-9_-]{5,}$/i.test(v)) {
                out.push(v);
            }
        }
    };

    if (d && typeof d === "object" && !Array.isArray(d)) {
        if (typeof d.rowID === "string") pushStringId(d.rowID);
        if (typeof d.itemID === "string") pushStringId(d.itemID);
        if (Array.isArray(d.rowIDs)) d.rowIDs.forEach(pushStringId);
        if (Array.isArray(d.itemIDs)) d.itemIDs.forEach(pushStringId);
        if (Array.isArray(d.doOperations)) {
            for (const op of d.doOperations) {
                if (op && typeof op === "object") {
                    if (op.action !== "insertAttrViewBlock") continue;
                    const rowId = op.rowID || op.itemID || op.id;
                    if (typeof rowId === "string") pushStringId(rowId);
                }
            }
        }
        if (Array.isArray(d.operations)) {
            for (const op of d.operations) {
                if (op && typeof op === "object") {
                    // 严格要求 action === "insertAttrViewBlock"，缺少 action、action="" 或非插入操作一律坚决不采信
                    if (op.action !== "insertAttrViewBlock") continue;
                    const rowId = op.rowID || op.itemID;
                    if (typeof rowId === "string") pushStringId(rowId);
                }
            }
        }
    }
    return out;
}

export interface RenderedRowSnapshot {
    id: string;
    content: string;
}

function extractRowContent(r: any): string {
    const cells = Array.isArray(r?.cells) ? r.cells : Object.values(r?.cells ?? {});
    for (const c of cells) {
        const txt = c?.value?.text?.content
            ?? c?.text?.content
            ?? c?.value?.content
            ?? c?.content
            ?? c?.block?.content
            ?? "";
        if (typeof txt === "string" && txt.trim()) return txt.trim();
    }
    return "";
}

/**
 * 加 detached 行，返回新行 itemID（D02）：
 * 1) 显式注入客户端自造 itemID（F4 端点候选强化，杜绝无脑猜 ID）；
 * 2) 响应直接携带且不在加行前集合中的 ID 唯一 → 确认（本次请求专属可信响应凭据）；
 * 3) 短轮询对比加行前后 render row 集合（退避等待内核 SQLite 异步事务写入）；
 * 4) 严格基于期望 ID 或本次请求可信响应 ID 强关联确认新行（绝不以同名内容冒认他人并发新增行），否则维持待确认错误。
 */
export async function addDetachedRow(avID: string, content: string, options?: RequestOptions & { rowIdentity?: DetachedRowIdentity }): Promise<string> {
    const queryOptions: RequestOptions = { ...options, idempotencyKey: undefined };
    const identity = options?.rowIdentity;
    if (identity?.submitted) {
        if (identity.avID !== avID || !identity.desiredItemID) throw new RowIdentityPendingError([]);
        // A later retry must prove the original client identity. Names and a
        // newly unique row are not proof: another window may have created it.
        let current: string[];
        try { current = await renderRowIDs(avID, queryOptions); }
        catch { throw new RowIdentityPendingError([]); }
        if (current.includes(identity.desiredItemID) && !identity.before.includes(identity.desiredItemID)) return identity.desiredItemID;
        throw new RowIdentityPendingError(current.filter((id) => !identity.before.includes(id)));
    }
    const before = new Set(await renderRowIDs(avID, queryOptions));
    const desiredItemID = identity?.desiredItemID || newSiYuanId();
    if (identity) Object.assign(identity, { avID, desiredItemID, before: [...before] });
    // 无论是否显式传递 identity，底层均强制要求期望 ID 匹配（彻底消除盲认领他人唯一新增行漏洞）
    const findHit = (list: string[]) => list.includes(desiredItemID) ? desiredItemID : "";
    let d: any;
    try {
        if (identity) identity.submitted = true;
        d = await post<any>("/api/av/addAttributeViewBlocks", {
            avID, blockID: "", srcs: [{ blockID: "", content, isDetached: true, itemID: desiredItemID, id: desiredItemID }],
        }, { ...options, retries: 0 });
    } catch (error) {
        if (!isWriteResultUnknown(error)) {
            if (identity) identity.submitted = false;
            throw error;
        }
        // The add may have committed before the response was lost. Reconcile
        // against a fresh render without reusing the caller's aborted signal.
        const recoveryOptions = { timeoutMs: options?.timeoutMs, retries: 0, idempotencyKey: undefined };
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
            const recovered = (await renderRowIDs(avID, recoveryOptions)).filter((id) => !before.has(id));
            const hit = findHit(recovered);
            if (hit) {
                if (identity) identity.desiredItemID = hit;
                return hit;
            }
            throw new RowIdentityPendingError(Array.from(new Set(recovered)));
        } catch (recoveryError) {
            if (recoveryError instanceof RowIdentityPendingError) throw recoveryError;
            throw new RowIdentityPendingError([]);
        }
    }
    const fromResponse = rowIDsFromAddResponse(d).filter((id) => !before.has(id));
    // A unique ID in this add request's own response is direct identity
    // evidence, including kernels that allocate their own row ID.
    const hitResp = fromResponse.includes(desiredItemID) ? desiredItemID : (fromResponse.length === 1 ? fromResponse[0] : "");
    if (hitResp) {
        if (identity) identity.desiredItemID = hitResp;
        return hitResp;
    }

    // 块索引异步重建：梯级短轮询检测新行（应对忙碌实例或 SQLite 异步写入），直到新行出现在视图中
    let added: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 150 + attempt * 150));
        try {
            added = (await renderRowIDs(avID, queryOptions)).filter((id) => !before.has(id));
            const hit = findHit(added);
            if (hit) {
                if (identity) identity.desiredItemID = hit;
                return hit;
            }
            if (added.length > 1) break; // 多候选时立即退出轮询交由人工确认
        } catch { /* soft retry */ }
    }

    throw new RowIdentityPendingError(added.length ? Array.from(new Set(added)) : fromResponse);
}

async function renderRowSnapshots(avID: string, options?: RequestOptions): Promise<RenderedRowSnapshot[]> {
    const queryOptions: RequestOptions = { ...options, idempotencyKey: undefined };
    const first = await post<any>("/api/av/renderAttributeView", { id: avID, pageSize: 200, page: 1 }, queryOptions);
    const rawRows = first?.view?.rows ?? [];
    const rows: RenderedRowSnapshot[] = rawRows.map((r: any) => ({
        id: String(r?.id ?? ""),
        content: extractRowContent(r),
    })).filter((r: RenderedRowSnapshot) => Boolean(r.id));
    const rowCount = typeof first?.view?.rowCount === "number" ? first.view.rowCount : rows.length;
    if (rowCount <= 200) return rows;

    const all = [...rows];
    const totalPages = Math.min(50, Math.ceil(rowCount / 200));
    for (let p = 2; p <= totalPages; p++) {
        const next = await post<any>("/api/av/renderAttributeView", { id: avID, pageSize: 200, page: p }, queryOptions).catch(() => null);
        const nextRaw = next?.view?.rows ?? [];
        const nextRows: RenderedRowSnapshot[] = nextRaw.map((r: any) => ({
            id: String(r?.id ?? ""),
            content: extractRowContent(r),
        })).filter((r: RenderedRowSnapshot) => Boolean(r.id));
        all.push(...nextRows);
        if (nextRows.length < 200) break;
    }
    return all;
}

/**
 * 从 renderAttributeView 获取行 ID 列表（D01/D02 真机修正）：
 * batchSetAttributeViewBlockAttrs 期望 renderAttributeView 返回的 row.id，
 * 而非 getAttributeViewPrimaryKeyValues 返回的 PK value ID（两者是不同 ID 空间）。
 */
async function renderRowIDs(avID: string, options?: RequestOptions): Promise<string[]> {
    return (await renderRowSnapshots(avID, options)).map((r) => r.id);
}

/** 删除 av 行（detached 行删除路径；2026-10-03 真机确认参数名为 srcIDs） */
export async function removeLedgerRows(avID: string, rowIDs: string[], options?: RequestOptions): Promise<void> {
    await post("/api/av/removeAttributeViewBlocks", { avID, srcIDs: rowIDs }, options);
}

// ── 附件上传与 OCR 智能识别（A2c / OCR）───────────────────────
export {
    type UploadTransport,
    setUploadTransport,
    uploadAsset,
    type OCRConfigData,
    getOCRConfig,
    getImageOCRText,
    recognizeAsset,
} from "./siyuan-asset-ocr";

/** 单元格写值（value 按列类型：{type:"block",block:{id,content},rich:null} / {type:"text",text:{content}} / {type:"date",date:{content,isNotEmpty}} / {type:"relation",relation:{blockIDs}} …）。
 * Format 17 强制：
 * - setAttributeViewBlockAttr 严格传 itemID（非废弃 rowID）；
 * - KeyTypeBlock 主键覆写必须发 { type:"block", block:{ id, content }, rich: null }（防 attribute_view_primary_rich.go:97 拒写）。 */
export async function setCell(avID: string, keyID: string, itemID: string, value: unknown, options?: RequestOptions): Promise<void> {
    if (!avID || !keyID || !itemID) {
        throw new AvValidationError("avID, keyID, and itemID are required for setCell");
    }
    const requestOptions = { ...options, latestKey: options?.latestKey ?? `cell:${avID}:${keyID}:${itemID}` };
    let payloadValue: unknown = typeof value === "string" ? { type: "text", text: { content: value } }
        : typeof value === "number" ? { type: "number", number: { content: value, isNotEmpty: true } }
        : typeof value === "boolean" ? { type: "checkbox", checkbox: { checked: value } }
        : value;

    if (payloadValue && typeof payloadValue === "object" && (payloadValue as { type?: string }).type === "block") {
        const rawBlock = payloadValue as { block?: { id?: string; content?: string }; isDetached?: boolean };
        payloadValue = {
            ...rawBlock,
            type: "block",
            itemID,
            block: {
                id: rawBlock.block?.id || itemID,
                content: String(rawBlock.block?.content ?? ""),
            },
            rich: null,
        };
    }

    if (payloadValue && typeof payloadValue === "object" && (payloadValue as { type?: string }).type === "number") {
        const rawNum = (payloadValue as { number?: { content?: unknown; isNotEmpty?: boolean } }).number;
        if (rawNum && rawNum.isNotEmpty === undefined && typeof rawNum.content === "number" && Number.isFinite(rawNum.content)) {
            payloadValue = {
                ...(payloadValue as Record<string, unknown>),
                type: "number",
                number: { ...rawNum, isNotEmpty: true },
            };
        }
    }

    await post("/api/av/setAttributeViewBlockAttr", { avID, keyID, itemID, value: payloadValue }, requestOptions);
}

export interface AvRow {
    itemID: string;
    cells: Record<string, any>; // 列 keyID → value
}

export interface LedgerRead {
    columns: any[];
    rows: AvRow[];
    rowCount: number;
    /** true = 唯一行数已达到 rowCount；false = 读取不完整（D01：调用方必须进诊断/报错，不得当空成功） */
    complete: boolean;
}

/** 读取台账（表格视图）列与行。cells 以列 keyID 索引；
 * 强制禁止 pageSize: -1，传入 blockID 可兼容已解锁加密本与文档上下文。 */
export async function renderLedger(
    avID: string,
    pageSize?: number,
    page?: number,
    options?: RequestOptions & { blockID?: string; ignoreRows?: boolean },
): Promise<LedgerRead> {
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
        throw new AvValidationError(`Invalid pageSize=${pageSize}; pageSize:-1 is strictly forbidden`);
    }
    const payload: Record<string, unknown> = { id: avID };
    if (options?.blockID) payload.blockID = options.blockID;
    if (options?.ignoreRows) payload.ignoreRows = true;
    if (pageSize) payload.pageSize = pageSize;
    if (page) payload.page = page;
    const pageOptions = options?.latestKey
        ? { ...options, latestKey: `${options.latestKey}:page:${page ?? 1}` }
        : options;
    const d = await post<any>("/api/av/renderAttributeView", payload, pageOptions);
    const view = d?.view;
    const malformed = (field: string): never => {
        throw new KernelError("/api/av/renderAttributeView", -3, `malformed ledger response: ${field}`);
    };
    if (!view || !Array.isArray(view.columns) || !Array.isArray(view.rows)) malformed("view.columns/view.rows");
    const cols: any[] = view.columns;
    const rowCount = view.rowCount ?? view.rows.length;
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) malformed("view.rowCount");
    const rows: AvRow[] = [];
    const seen = new Set<string>();
    for (const r of view.rows) {
        if (!r || typeof r.id !== "string" || !r.id.trim()) malformed("row.id");
        const rawCells = r.cells ?? [];
        if (!Array.isArray(rawCells)) malformed("row.cells");
        const cells: Record<string, any> = {};
        rawCells.forEach((c: any, i: number) => {
            if (!c || typeof c !== "object") malformed("row.cells[]");
            const v = (c.value && typeof c.value === "object" && Object.keys(c.value).length > 0) ? c.value : c;
            const key = v.keyID ?? c.keyID ?? cols[i]?.id;
            if (key) cells[key] = v;
        });
        if (!seen.has(r.id)) {
            seen.add(r.id);
            rows.push({ itemID: r.id, cells });
        }
    }
    return { columns: cols, rows, rowCount, complete: rows.length >= rowCount };
}

/** 全量读取台账（N7/E13）：200/页逐页累积直到 rowCount（去重防翻页重叠），扫描派生/健康检查/CSV 导出用。
 * UI 列表维持单页 renderLedger（PF11 长列表预算）；上限 100 页（2 万行）防内核异常死循环。 */
export async function renderLedgerAll(
    avID: string,
    pageSize = 200,
    options?: RequestOptions & { blockID?: string },
): Promise<LedgerRead> {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new AvValidationError(`Invalid pageSize=${pageSize}; pageSize:-1 is strictly forbidden`);
    }
    const first = await renderLedger(avID, pageSize, undefined, options);
    const rows = [...first.rows];
    const seen = new Set(rows.map((r) => r.itemID));
    let page = 2;
    const canBatch = pageSize > 0 && first.rows.length >= pageSize && first.rowCount > pageSize;
    if (canBatch) {
        while (rows.length < first.rowCount && page <= 100) {
            const pageNumbers = Array.from({ length: Math.min(4, 101 - page) }, (_, i) => page + i);
            const batch = await Promise.all(pageNumbers.map((pageNumber) => renderLedger(avID, pageSize, pageNumber, options)));
            let stop = false;
            for (const next of batch) {
                if (next.rows.length === 0) { stop = true; break; }
                for (const r of next.rows) {
                    if (!seen.has(r.itemID)) { seen.add(r.itemID); rows.push(r); }
                }
                if (rows.length >= first.rowCount) { stop = true; break; }
            }
            page += pageNumbers.length;
            if (stop) break;
        }
        return { columns: first.columns, rows, rowCount: first.rowCount, complete: rows.length >= first.rowCount };
    }
    while (rows.length < first.rowCount && page <= 100) {
        const next = await renderLedger(avID, pageSize, page, options);
        if (next.rows.length === 0) break;
        for (const r of next.rows) {
            if (!seen.has(r.itemID)) { seen.add(r.itemID); rows.push(r); }
        }
        page++;
    }
    return { columns: first.columns, rows, rowCount: first.rowCount, complete: rows.length >= first.rowCount };
}

function extractLedgerCellText(row: AvRow, keyID: string): string | null {
    const cell = row.cells?.[keyID];
    if (!cell || typeof cell !== "object") return null;
    if (cell.text && typeof cell.text.content === "string") return cell.text.content;
    if (cell.block && typeof cell.block.content === "string") return cell.block.content;
    return null;
}

/**
 * 幂等分批写入分离行（外部主键预查去重 + <=20 行/批），强校验绑定 + KeyTypeBlock 主键格式
 */
export async function idempotentAppendDetachedRows<T>(options: {
    dbRef: { avId: string; avBlockId?: string; docId?: string };
    extKeyID: string;
    primaryKeyID?: string;
    rows: T[];
    getExternalKey: (row: T) => string;
    toCells: (row: T) => Array<Record<string, any>>;
    batchSize?: number;
    pageSize?: number;
    requestOptions?: RequestOptions;
}): Promise<{
    totalRequested: number;
    skippedExisting: number;
    inserted: number;
    batches: number;
}> {
    const batchSize = Math.min(MAX_AV_BATCH_SIZE, Math.max(1, Number(options.batchSize ?? MAX_AV_BATCH_SIZE)));
    const pageSize = Number(options.pageSize ?? DEFAULT_AV_PAGE_SIZE);
    if (options.dbRef.avBlockId) {
        await assertAvRefBound(options.dbRef, options.requestOptions);
    }

    const existing = await renderLedgerAll(options.dbRef.avId, pageSize, {
        ...options.requestOptions,
        blockID: options.dbRef.avBlockId,
    });
    const existingExtKeys = new Set<string>();
    for (const r of existing.rows) {
        const val = extractLedgerCellText(r, options.extKeyID);
        if (val) existingExtKeys.add(val);
    }

    const seenInInput = new Set<string>();
    const pendingCells: Array<Array<Record<string, any>>> = [];
    for (const item of options.rows) {
        const extVal = options.getExternalKey(item);
        if (!extVal) {
            throw new AvValidationError("getExternalKey returned empty external key");
        }
        if (existingExtKeys.has(extVal) || seenInInput.has(extVal)) {
            continue;
        }
        seenInInput.add(extVal);
        const cells = options.toCells(item);
        validateAvRowCells(cells, options.primaryKeyID);
        pendingCells.push(cells);
    }

    let inserted = 0;
    let batches = 0;
    for (let i = 0; i < pendingCells.length; i += batchSize) {
        const chunk = pendingCells.slice(i, i + batchSize);
        await appendAttributeViewDetachedBlocksWithValues(options.dbRef.avId, chunk, options.requestOptions);
        inserted += chunk.length;
        batches++;
    }

    return {
        totalRequested: options.rows.length,
        skippedExisting: options.rows.length - pendingCells.length,
        inserted,
        batches,
    };
}

/** 临期/条件筛选（分页拉取后内存过滤，完全规避 v3.8.12 普通台账表 temporaryFilters code:-1） */
export async function queryAvRowsInMemory(options: {
    dbRef: { avId: string; avBlockId?: string };
    pageSize?: number;
    predicate?: (row: AvRow) => boolean;
    comparator?: (a: AvRow, b: AvRow) => number;
    requestOptions?: RequestOptions;
}): Promise<AvRow[]> {
    if (options.dbRef.avBlockId) {
        await assertAvRefBound(options.dbRef, options.requestOptions);
    }
    const read = await renderLedgerAll(options.dbRef.avId, options.pageSize ?? DEFAULT_AV_PAGE_SIZE, {
        ...options.requestOptions,
        blockID: options.dbRef.avBlockId,
    });
    let filtered = options.predicate ? read.rows.filter(options.predicate) : [...read.rows];
    if (options.comparator) {
        filtered = filtered.sort(options.comparator);
    }
    return filtered;
}

/** Gate-4 来源失效校验（区分 bound blockIDs 与 detached itemIDs） */
export async function checkBoundSourceStatuses(
    dbRef: { avId: string; avBlockId?: string },
    blockIDs: string[],
    options?: RequestOptions,
): Promise<Array<{ blockID: string; itemID: string | null; status: string; sourceInvalidated: boolean }>> {
    if (dbRef.avBlockId) {
        await assertAvRefBound(dbRef, options);
    }
    if (blockIDs.length === 0) return [];
    const boundMap = (await getAttributeViewItemIDsByBoundIDs(dbRef.avId, blockIDs, options)) || {};
    const itemIDs = Object.values(boundMap).filter(Boolean);
    const statusMap =
        itemIDs.length > 0
            ? (await getAttributeViewItemStatuses(dbRef.avId, itemIDs, options)) || {}
            : {};

    return blockIDs.map((blockID) => {
        const itemID = boundMap[blockID] || null;
        const status = itemID ? statusMap[itemID] || "itemNotFound" : "unbound";
        return {
            blockID,
            itemID,
            status,
            sourceInvalidated: status !== "visible",
        };
    });
}
