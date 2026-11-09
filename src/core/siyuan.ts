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
    KernelError,
    isWriteResultUnknown,
    type RequestOptions,
} from "./siyuan-transport";

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

// ── 块与数据库（av）─────────────────────────────────────────

export function getBlockKramdown(id: string, options?: RequestOptions): Promise<{ id: string; kramdown: string }> {
    return post("/api/block/getBlockKramdown", { id }, options);
}

export function setBlockAttrs(id: string, attrs: Record<string, string>, options?: RequestOptions): Promise<void> {
    return post("/api/attr/setBlockAttrs", { id, attrs }, options);
}

/**
 * Spike 定案（2026-10-01，docs/testing/spike-R1R2.md 已回填结论）：
 * - av 块形态：<div data-type="NodeAttributeView" data-av-id="X" data-av-type="table"></div>
 * - 建库：插入 div（自造 avIdSeed）→ SQL 找块 → renderAttributeView{createIfNotExist:true}，avID = 块 ID
 * - 加列：addAttributeViewKey{avID, keyID(自造), keyIcon:"", keyName, keyType, previousKeyID:""}
 * - 加行：addAttributeViewBlocks{avID, srcs:[{content, isDetached:true}]}（绑定真实块 isDetached:false 静默失败——
 *   非绑定行路径待后续 transactions 端点探索，TODO 记录）
 * - 写值：batchSetAttributeViewBlockAttrs{avID, values:[{keyID, itemID, value}]}（rowID 已废弃，issue #15727）
 * - 读：renderAttributeView → data.view.{columns, rows, rowCount}；行主键：getAttributeViewPrimaryKeyValues
 * - detached 行不在 blocks 表：SQL 不可查、不可块定位 → 行定位降级为打开台账文档（B4e 定案）
 */

function extractBlockOpId(d: any): string {
    const ops: any[] = Array.isArray(d) ? (d[0]?.doOperations ?? []) : (d?.doOperations ?? d?.data?.doOperations ?? []);
    for (const op of ops) {
        if (typeof op?.id === "string" && op.id) return op.id;
        const m = String(op?.data ?? "").match(/data-node-id="(\d{14}-[a-z0-9]+)"/);
        if (m) return m[1];
    }
    return String(d?.id ?? d?.blockID ?? d?.data?.id ?? "");
}

/** 插入 markdown 块，返回新块 ID（E9/182 波：insertBlock 响应 doOperations[].data 带 data-node-id，可同步提取；取不到回空串由调用方兜底） */
export async function insertBlock(parentID: string, markdown: string, options?: RequestOptions): Promise<string> {
    const d = await post<any>("/api/block/insertBlock", { dataType: "markdown", parentID, data: markdown }, { ...options, retries: 0 });
    return extractBlockOpId(d);
}

/** 在文档末尾追加 markdown 块，返回新块 ID */
export async function appendBlock(parentID: string, markdown: string, options?: RequestOptions): Promise<string> {
    const d = await post<any>("/api/block/appendBlock", { dataType: "markdown", parentID, data: markdown }, { ...options, retries: 0 });
    return extractBlockOpId(d);
}

/** 原地更新指定块 ID 的 markdown 内容 */
export async function updateBlock(id: string, markdown: string, options?: RequestOptions): Promise<void> {
    await post("/api/block/updateBlock", { dataType: "markdown", id, data: markdown }, options);
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

/** 在文档内插入 av 容器 div 并触发内核建库，返回真实 avID（= av 块 ID）。
 * 优先同步取 insertBlock 响应里的新块 ID（E9）；SQL 索引异步重建仅作回退（轮询 ~3s——
 * 182 波活体套件首跑实证：忙实例上 400ms 固定等待会落空）。
 * 关键：附带 Kramdown IAL `{: id="${avIdSeed}"}` 让思源块的 data-node-id 与 data-av-id 严格一致，
 * 确保用户在思源笔记树中点开台账文档时原生表格直接显示已落盘的全部列与行！ */
export async function createAttributeView(docId: string, avIdSeed: string, options?: RequestOptions): Promise<string> {
    const div = `<div data-type="NodeAttributeView" data-av-id="${avIdSeed}" data-av-type="table"></div>\n{: id="${avIdSeed}"}`;
    const readOptions: RequestOptions = { timeoutMs: options?.timeoutMs, signal: options?.signal, retries: 1 };
    const findBySeed = async () => {
        try {
            const rows = await sql<{ id: string; markdown?: string }>(
                `SELECT id, markdown FROM blocks WHERE type='av' AND root_id='${docId.replace(/'/g, "''")}' LIMIT 5`,
                readOptions,
            );
            if (rows.length === 0) return "";
            const matched = rows.find((r) => r.markdown && r.markdown.includes(avIdSeed));
            // 若匹配到 seed，或该文档仅有唯一一个 AV 块，安全返回；多块且无匹配时不抢占 rows[0]
            return matched?.id ?? (rows.length === 1 ? rows[0].id : "");
        } catch {
            return "";
        }
    };
    // A prior attempt may have inserted the block but lost its response.
    let blockId = await findBySeed();
    if (!blockId) {
        try {
            blockId = await insertBlock(docId, div, options);
            if (!blockId) blockId = await findBySeed();
        } catch (error) {
            if (!isWriteResultUnknown(error)) throw error;
        }
    }
    for (let i = 0; !blockId && i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        blockId = await findBySeed();
    }
    if (!blockId) throw new KernelError("av.createAttributeView", -3, "av block not found after insert");
    await post("/api/av/renderAttributeView", { id: blockId, createIfNotExist: true }, options);
    return blockId;
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

/** 从 addAttributeViewBlocks 响应收集可能的行 ID（响应形态随版本变化，仅认已知键） */
function rowIDsFromAddResponse(d: any): string[] {
    const out: string[] = [];
    const push = (v: any) => {
        if (typeof v === "string" && v) out.push(v);
        else if (v && typeof v === "object") {
            const id = v.rowID || v.blockID || v.id || v.itemID;
            if (typeof id === "string" && id) out.push(id);
        }
    };
    if (typeof d === "string" && d) push(d);
    if (Array.isArray(d)) d.forEach(push);
    if (d && typeof d === "object" && !Array.isArray(d)) {
        push(d);
        for (const k of ["rowIDs", "blockIDs", "ids", "blocks", "operations", "doOperations", "rows", "srcs"] as const) {
            if (Array.isArray(d[k])) d[k].forEach(push);
        }
    }
    return out;
}

/**
 * 加 detached 行，返回新行 itemID（D02）：
 * 1) 显式注入客户端自造 itemID（F4 端点候选强化，杜绝无脑猜 ID）；
 * 2) 响应直接携带且不在加行前集合中的 ID 唯一 → 确认；
 * 3) 短轮询对比加行前后 render row 集合（退避等待内核 SQLite 异步事务写入）；
 * 4) 确认到目标行或唯一新增行即刻返回，消除假性待确认死锁。
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
    const findHit = (list: string[]) => list.includes(desiredItemID) ? desiredItemID : !identity && list.length === 1 ? list[0] : "";
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
            if (hit) return hit;
            throw new RowIdentityPendingError(Array.from(new Set(recovered)));
        } catch (recoveryError) {
            if (recoveryError instanceof RowIdentityPendingError) throw recoveryError;
            throw new RowIdentityPendingError([]);
        }
    }
    const fromResponse = rowIDsFromAddResponse(d).filter((id) => !before.has(id));
    // A unique ID in this add request's own response is direct identity
    // evidence, including kernels that allocate their own row ID.
    const hitResp = findHit(fromResponse) || (fromResponse.length === 1 ? fromResponse[0] : "");
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
            if (hit) return hit;
            if (added.length > 1) break; // 多候选时立即退出轮询交由人工确认
        } catch { /* soft retry */ }
    }

    throw new RowIdentityPendingError(added.length ? Array.from(new Set(added)) : fromResponse);
}

/**
 * 从 renderAttributeView 获取行 ID 列表（D01/D02 真机修正）：
 * batchSetAttributeViewBlockAttrs 期望 renderAttributeView 返回的 row.id，
 * 而非 getAttributeViewPrimaryKeyValues 返回的 PK value ID（两者是不同 ID 空间）。
 */
async function renderRowIDs(avID: string, options?: RequestOptions): Promise<string[]> {
    const queryOptions: RequestOptions = { ...options, idempotencyKey: undefined };
    const d = await post<any>("/api/av/renderAttributeView", { id: avID, pageSize: 200 }, queryOptions);
    return (d?.view?.rows ?? []).map((r: any) => r.id);
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

/** 单元格写值（value 按列类型：{type:"text",text:{content}} / {type:"date",date:{content,isNotEmpty}} / {type:"relation",relation:{blockIDs}} …）。
 * 217 波：迁移到文档化公开端点 setAttributeViewBlockAttr（itemID=render row.id，D02 一致）——
 * 此前用的 batchSetAttributeViewBlockAttrs 是未入文档的内部路由（无兼容性保证，上游 API.md 141 行明示）。 */
export async function setCell(avID: string, keyID: string, itemID: string, value: unknown, options?: RequestOptions): Promise<void> {
    // Cell edits are last-write-wins.  A slow response from an earlier blur
    // must never be allowed to report success after a newer value was sent.
    const requestOptions = { ...options, latestKey: options?.latestKey ?? `cell:${avID}:${keyID}:${itemID}` };
    const payloadValue = typeof value === "string" ? { type: "text", text: { content: value } }
        : typeof value === "number" ? { type: "number", number: { content: value, isNotEmpty: true } }
        : typeof value === "boolean" ? { type: "checkbox", checkbox: { checked: value } }
        : value;
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

/** 读取台账（表格视图）列与行。cells 以列 keyID 索引；value 无 keyID 时按位置回退（Spike 未确认该字段）。
 * pageSize/page 可选（E13/183 波：内核 render 接受分页参数——50/页默认，page 翻页，pageSize 为单页上限）。 */
export async function renderLedger(avID: string, pageSize?: number, page?: number, options?: RequestOptions): Promise<LedgerRead> {
    const payload: Record<string, unknown> = { id: avID };
    if (pageSize) payload.pageSize = pageSize;
    if (page) payload.page = page;
    // Each page is its own resource. Qualifying latestKey by page prevents a
    // legitimate page 2 request from superseding page 1 during one full scan,
    // while still ensuring a newer refresh wins for the same page.
    const pageOptions = options?.latestKey
        ? { ...options, latestKey: `${options.latestKey}:page:${page ?? 1}` }
        : options;
    const d = await post<any>("/api/av/renderAttributeView", payload, pageOptions);
    const view = d?.view;
    const malformed = (field: string): never => {
        throw new KernelError("/api/av/renderAttributeView", -3, `malformed ledger response: ${field}`);
    };
    // A successful envelope is not proof of a successful read. In particular,
    // a missing view must not erase scan state by masquerading as an empty AV.
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
        // Count unique identities on the first page as well as later pages;
        // duplicated rows otherwise make a partial read appear complete.
        if (!seen.has(r.id)) {
            seen.add(r.id);
            rows.push({ itemID: r.id, cells });
        }
    }
    return { columns: cols, rows, rowCount, complete: rows.length >= rowCount };
}

/** 全量读取台账（N7/E13）：200/页逐页累积直到 rowCount（去重防翻页重叠），扫描派生/健康检查/CSV 导出用。
 * UI 列表维持单页 renderLedger（PF11 长列表预算）；上限 100 页（2 万行）防内核异常死循环。 */
export async function renderLedgerAll(avID: string, pageSize = 200, options?: RequestOptions): Promise<LedgerRead> {
    const first = await renderLedger(avID, pageSize, undefined, options);
    const rows = [...first.rows];
    const seen = new Set(rows.map((r) => r.itemID));
    let page = 2;
    // Small ledgers keep the original one-page-at-a-time behavior so an early
    // short/empty page still stops immediately. Once the first page is full,
    // bounded batches reduce round trips for large ledgers without changing
    // page order or dedupe semantics.
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
        if (next.rows.length === 0) break; // 翻页越界：内核已无更多行
        for (const r of next.rows) {
            if (!seen.has(r.itemID)) { seen.add(r.itemID); rows.push(r); }
        }
        page++;
    }
    return { columns: first.columns, rows, rowCount: first.rowCount, complete: rows.length >= first.rowCount };
}
