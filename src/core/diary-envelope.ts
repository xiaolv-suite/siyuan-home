/**
 * 小驴管家 · 思源 v3.8.12 日记原子写与分片同步自愈引擎 (diary-envelope.ts)
 *
 * 对齐 doc#20 v4 & lv-diary-envelope.ts：
 * 1. dataType: "dom" 单次原子 NodeListItem 写入 + blockial.go:499 全小写连字符 custom-lv-* 合法性校验；
 * 2. 两步兼容路径缺失持久 committedBlockId 严格 Fail-Closed（不认领同文手写块、不自动删、不重插）；
 * 3. 双日期口径（custom-lv-biz-date vs custom-lv-recorded-at）及历史补记策略；
 * 4. 按写入月（recordedAt）分片 events/<deviceId>-YYYY-MM.json + (deviceId, shardMonth) 水位与缺口追踪；
 * 5. 显式 tombstone + (eventId, revision, managedTextHash) 三指纹核验与冲突审查队列；
 * 6. 显式 LIMIT Keyset 分页 SQL 查询 + 实时 .sy getBlockDOM 存活性核验；
 * 7. 7 大现实复杂场景（退款/互转/AA分摊/固定账单/多币种/票据附件/证件换证链）标量契约。
 */

import {
    appendBlockDom,
    updateBlockDom,
    deleteBlock,
    getBlockDOM,
    getBlockAttrs,
    setBlockAttrs,
    sql,
    getFileText,
    putFileText,
    newSiYuanId,
    listNotebooks,
    createDocWithMd,
    KernelError,
} from "./siyuan";
import { ensureXiaolvDiaryZone } from "@/libs/lv-notice-kit";

export const CUSTOM_IAL_NAME_REGEX = /^custom-[a-z][a-z0-9-]*$/;
export const DEFAULT_SQL_PAGE_SIZE = 100;
export const HOME_STORAGE_PREFIX = "/data/storage/petal/siyuan-home";

export class DiaryAttributeValidationError extends Error {
    constructor(message: string) {
        super(`[DIARY-ATTR-INVALID] ${message}`);
        this.name = "DiaryAttributeValidationError";
    }
}

export class DiaryReadbackVerificationError extends Error {
    constructor(message: string) {
        super(`[DIARY-READBACK-FAILED] ${message}`);
        this.name = "DiaryReadbackVerificationError";
    }
}

export class DiaryShardWriteError extends Error {
    readonly blockId?: string;
    readonly eventId?: string;
    readonly docId?: string;
    readonly op: "upsert" | "tombstone";
    readonly cause?: unknown;

    constructor(
        message: string,
        meta: { blockId?: string; eventId?: string; docId?: string; op: "upsert" | "tombstone"; cause?: unknown },
    ) {
        super(message);
        this.name = "DiaryShardWriteError";
        this.blockId = meta.blockId;
        this.eventId = meta.eventId;
        this.docId = meta.docId;
        this.op = meta.op;
        this.cause = meta.cause;
    }
}

export interface BlockDomResult {
    id: string;
    dom: string;
}

export interface AppendOperationItem {
    id?: string;
    data?: string;
    action?: string;
}

export interface AppendTransactionResult {
    doOperations?: AppendOperationItem[];
}

export interface SiyuanDiaryTransport {
    appendBlock: (
        parentID: string,
        data: string,
        dataType: "dom" | "markdown",
    ) => Promise<AppendTransactionResult[] | unknown>;
    insertBlock?: (
        previousID: string,
        data: string,
        dataType: "dom" | "markdown",
        parentID?: string,
    ) => Promise<AppendTransactionResult[] | unknown>;
    getChildBlocks?: (
        id: string,
    ) => Promise<Array<{ id: string; type?: string; subType?: string; subtype?: string; content?: string; markdown?: string; ial?: string }>>;
    updateBlock: (id: string, data: string, dataType: "dom") => Promise<unknown>;
    deleteBlock: (id: string) => Promise<unknown>;
    getBlockDOM: (id: string) => Promise<BlockDomResult | null>;
    getBlockAttrs: (id: string) => Promise<Record<string, string> | null>;
    setBlockAttrs: (id: string, attrs: Record<string, string | null>) => Promise<unknown>;
    sql: (stmt: string) => Promise<Array<Record<string, unknown>>>;
    getFileText: (filePath: string) => Promise<string>;
    putFile: (filePath: string, contentString: string) => Promise<unknown>;
}

export interface TwoStepIntentRecord {
    op: "intent";
    eventId: string;
    expectedDocId: string;
    text: string;
    attrs: Record<string, string>;
    committedBlockId: string | null;
    settled: boolean;
}

export interface PendingConfirmItem {
    eventId: string;
    expectedDocId: string;
    reason: string;
    committedBlockId?: string | null;
}

export interface ShardEventRecord {
    eventId: string;
    revision: number;
    seq: number;
    op: "upsert" | "patch" | "tombstone";
    bizDate: string;
    recordedAt?: string;
    deletedAt?: string;
    updatedAt: string;
    module: string;
    action: string;
    target: string;
    avId?: string;
    amount?: string;
    blockId: string;
    managedText?: string;
    managedTextHash: string;
    extraAttrs?: Record<string, string>;
}

export interface SyncCursorState {
    ackedSeq: number;
    gaps: number[];
    seenSeqs: number[];
    fileHash: string | null;
}

export interface AppliedRevisionEntry {
    revision: number;
    updatedAt: string;
    deviceId: string;
    op: "upsert" | "patch" | "tombstone";
    blockId: string | null;
    managedTextHash: string;
    projectedBefore: boolean;
}

export interface DiaryConflictItem {
    kind:
        | "missing_projected_block_without_tombstone"
        | "tombstone_user_edited_block_protected";
    eventId: string;
    deviceId?: string;
    shardMonth?: string;
    blockId?: string;
    reason?: string;
    expectedHash?: string;
    actualHash?: string;
    actualContent?: string;
}

export interface ReconcileEngineState {
    autoBackfillOnMissing: boolean;
    syncCursors: Record<string, Record<string, SyncCursorState>>;
    appliedRevisions: Map<string, AppliedRevisionEntry>;
    conflictQueue: DiaryConflictItem[];
}

export function createReconcileEngineState(options?: {
    autoBackfillOnMissing?: boolean;
}): ReconcileEngineState {
    return {
        autoBackfillOnMissing: options?.autoBackfillOnMissing === true,
        syncCursors: {},
        appliedRevisions: new Map(),
        conflictQueue: [],
    };
}

// Pure TypeScript FIPS 180-4 SHA-256 (UTF-8, zero node:crypto dependency)
const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(str: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(str);
    }
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 0x80) {
            bytes.push(c);
        } else if (c < 0x800) {
            bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const c2 = str.charCodeAt(++i);
            const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
            bytes.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f),
            );
        } else {
            bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    return new Uint8Array(bytes);
}

export function sha256Hex(input: string): string {
    const msg = utf8Bytes(input);
    const bitLen = msg.length * 8;
    const padLen = ((msg.length + 8) >> 6) + 1;
    const padded = new Uint8Array(padLen * 64);
    padded.set(msg);
    padded[msg.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padded.length - 4, bitLen >>> 0, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 =
                ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
                ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
                (w[i - 15] >>> 3);
            const s1 =
                ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
                ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
                (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

export function escapeXmlAttr(value: string): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function escapeSqlLiteral(value: string): string {
    return String(value).replace(/'/g, "''");
}

export function validateCustomAttrName(name: string): string {
    if (typeof name !== "string" || !CUSTOM_IAL_NAME_REGEX.test(name)) {
        throw new DiaryAttributeValidationError(
            `Illegal custom attribute name "${name}"; must match ${CUSTOM_IAL_NAME_REGEX.source} (lowercase + hyphens only)`,
        );
    }
    return name;
}

export function validateCustomAttrs(attrs: Record<string, string>): Record<string, string> {
    if (!attrs || typeof attrs !== "object") {
        throw new DiaryAttributeValidationError("attrs must be a non-null object");
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
        validateCustomAttrName(k);
        if (v === undefined || v === null) {
            throw new DiaryAttributeValidationError(`Attribute "${k}" value cannot be null/undefined in DOM write`);
        }
        clean[k] = String(v);
    }
    return clean;
}

export function buildDiaryListItemDom(params: {
    blockId: string;
    text: string;
    attrs: Record<string, string>;
}): string {
    if (!params.blockId || !/^[a-zA-Z0-9-]+$/.test(params.blockId)) {
        throw new DiaryAttributeValidationError(`Invalid blockId: "${params.blockId}"`);
    }
    const validAttrs = validateCustomAttrs(params.attrs);
    const attrStr = Object.entries(validAttrs)
        .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
        .join(" ");
    const attrsPart = attrStr ? ` ${attrStr}` : "";
    return `<div data-type="NodeListItem" data-subtype="u" data-node-id="${escapeXmlAttr(params.blockId)}"${attrsPart}><div data-type="NodeParagraph"><div contenteditable="true">${escapeXmlAttr(params.text)}</div></div></div>`;
}

export function buildDiaryListDom(params: {
    blockId: string;
    text: string;
    attrs: Record<string, string>;
}): string {
    return `<div data-type="NodeList" data-subtype="u">${buildDiaryListItemDom(params)}</div>`;
}

export function extractListItemIdFromOpData(op: AppendOperationItem | undefined | null): string | null {
    const data = op?.data || "";
    const m =
        data.match(/data-node-id="([^"]+)"[^>]*data-type="NodeListItem"/i) ||
        data.match(/data-type="NodeListItem"[^>]*data-node-id="([^"]+)"/i);
    return m ? m[1] : op?.id || null;
}

export function extractLiveTextFromDom(domHtml: string | undefined | null): string {
    if (!domHtml) return "";
    const matches = [...domHtml.matchAll(/<div[^>]*contenteditable="true"[^>]*>([\s\S]*?)<\/div>/gi)];
    const raw = matches.map((m) => m[1].replace(/<[^>]+>/g, "")).join("\n");
    return raw
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\u200b/g, "")
        .trim();
}

export function parseIalAttributes(ial: string | undefined | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (!ial) return out;
    const rx = /([a-z0-9-]+)="((?:\\"|[^"])*)"/gi;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(ial)) !== null) {
        out[m[1]] = m[2].replace(/\\"/g, '"').replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    }
    return out;
}

export function createSiyuanDiaryTransport(plugin?: { data?: Record<string, unknown> }): SiyuanDiaryTransport {
    return {
        appendBlock: (parentID, data, dataType) =>
            dataType === "dom"
                ? appendBlockDom(parentID, data)
                : import("./siyuan-transport").then((m) =>
                      m.post<any>("/api/block/appendBlock", { dataType: "markdown", parentID, data }, { retries: 0 }),
                  ),
        insertBlock: (previousID, data, dataType, parentID) =>
            import("./siyuan-transport").then((m) =>
                m.post<any>(
                    "/api/block/insertBlock",
                    {
                        dataType: dataType === "dom" ? "dom" : "markdown",
                        previousID,
                        ...(parentID ? { parentID } : {}),
                        data,
                    },
                    { retries: 0 },
                ),
            ),
        getChildBlocks: (id) =>
            import("./siyuan-transport").then((m) =>
                m.post<any>("/api/block/getChildBlocks", { id }, { retries: 0 }).then((d) => (Array.isArray(d) ? d : [])),
            ),
        updateBlock: (id, data) => updateBlockDom(id, data),
        deleteBlock: (id) => deleteBlock(id),
        getBlockDOM: (id) => getBlockDOM(id),
        getBlockAttrs: (id) => getBlockAttrs(id),
        setBlockAttrs: (id, attrs) => setBlockAttrs(id, attrs),
        sql: (stmt) => sql(stmt),
        getFileText: async (filePath) => {
            // B4：读取前主动清 this.data[key]，规避思源删除/同步后内存旧值
            if (plugin?.data) {
                const base = filePath.split("/").pop();
                if (base) delete plugin.data[base];
                const rel = filePath.replace(`${HOME_STORAGE_PREFIX}/`, "");
                delete plugin.data[rel];
            }
            return getFileText(filePath);
        },
        putFile: (filePath, contentString) => putFileText(filePath, contentString),
    };
}

function buildDiaryZonePostFn(transport: SiyuanDiaryTransport) {
    return async (endpoint: string, payload: Record<string, unknown>): Promise<{ code: number; msg?: string; data?: any }> => {
        try {
            if (endpoint === "/api/block/getChildBlocks") {
                const data = transport.getChildBlocks ? await transport.getChildBlocks(String(payload.id || "")) : [];
                return { code: 0, data };
            }
            if (endpoint === "/api/query/sql") {
                const data = await transport.sql(String(payload.stmt || ""));
                return { code: 0, data };
            }
            if (endpoint === "/api/block/getBlockDOM") {
                const data = await transport.getBlockDOM(String(payload.id || ""));
                return { code: 0, data };
            }
            if (endpoint === "/api/attr/getBlockAttrs") {
                const data = await transport.getBlockAttrs(String(payload.id || ""));
                return { code: 0, data };
            }
            if (endpoint === "/api/attr/setBlockAttrs") {
                await transport.setBlockAttrs(String(payload.id || ""), (payload.attrs || {}) as Record<string, string | null>);
                return { code: 0, data: null };
            }
            if (endpoint === "/api/block/appendBlock") {
                const raw = await transport.appendBlock(
                    String(payload.parentID || ""),
                    String(payload.data || ""),
                    payload.dataType === "dom" ? "dom" : "markdown",
                );
                const data = typeof raw === "string" && raw ? [{ doOperations: [{ id: raw }] }] : raw;
                return { code: 0, data };
            }
            return { code: -1, msg: `unsupported endpoint ${endpoint}` };
        } catch (err) {
            return { code: -1, msg: err instanceof Error ? err.message : String(err) };
        }
    };
}

async function listDiaryZoneChildren(
    transport: SiyuanDiaryTransport,
    docId: string,
    zoneHeadingId: string,
    headingLevel: number,
): Promise<Array<{ id: string; type?: string; subType?: string; subtype?: string; content?: string; markdown?: string; ial?: string }>> {
    if (typeof transport.getChildBlocks !== "function") return [];
    const children = (await transport.getChildBlocks(docId)) || [];
    const zoneIdx = children.findIndex((c) => c?.id === zoneHeadingId);
    if (zoneIdx < 0) return [];
    const inZone: Array<{ id: string; type?: string; subType?: string; subtype?: string; content?: string; markdown?: string; ial?: string }> = [];
    for (let i = zoneIdx + 1; i < children.length; i++) {
        const ch = children[i];
        if (!ch) continue;
        const sub = String(ch.subType || ch.subtype || "");
        if (ch.type === "h" || /^h[1-6]$/i.test(sub)) {
            const m = sub.match(/^h([1-6])$/i);
            const lvl = m ? Number(m[1]) : 6;
            if (lvl <= headingLevel) break;
        }
        inZone.push(ch);
    }
    return inZone;
}

async function findConfirmedBlockInDiaryZone(
    transport: SiyuanDiaryTransport,
    docId: string,
    zone: { zoneHeadingId: string; headingLevel: number },
    opts: { receiptId?: string; blockId?: string; eventId?: string },
): Promise<{ confirmed: boolean; zoneChildId?: string; matchedBlockId?: string }> {
    const zoneChildren = await listDiaryZoneChildren(transport, docId, zone.zoneHeadingId, zone.headingLevel);
    if (zoneChildren.length === 0) return { confirmed: false };
    const zoneIds = new Set(zoneChildren.map((c) => String(c.id || "")).filter(Boolean));

    if (opts.receiptId) {
        if (zoneIds.has(opts.receiptId)) {
            return { confirmed: true, zoneChildId: opts.receiptId, matchedBlockId: opts.blockId || opts.receiptId };
        }
        return { confirmed: false };
    }

    for (const ch of zoneChildren) {
        const chId = String(ch.id || "");
        if (!chId) continue;
        if (opts.blockId && chId === opts.blockId) {
            return { confirmed: true, zoneChildId: chId, matchedBlockId: chId };
        }
        if (opts.eventId) {
            const ialAttrs = parseIalAttributes(ch.ial);
            if (ialAttrs["custom-lv-event-id"] === opts.eventId) {
                return { confirmed: true, zoneChildId: chId, matchedBlockId: chId };
            }
        }
    }

    // 真实 SiYuan 内核下 NodeList 包裹 NodeListItem：检查列表子块或父块是否在折叠区内
    if (opts.blockId) {
        const liveDom = await transport.getBlockDOM(opts.blockId).catch(() => null);
        if (liveDom && liveDom.id === opts.blockId) {
            const rows = await transport
                .sql(`SELECT id, parent_id, root_id FROM blocks WHERE id = '${escapeSqlLiteral(opts.blockId)}' LIMIT 1`)
                .catch(() => []);
            const parentId = rows?.[0]?.parent_id ? String(rows[0].parent_id) : "";
            if (parentId && zoneIds.has(parentId)) {
                return { confirmed: true, zoneChildId: parentId, matchedBlockId: opts.blockId };
            }
            for (let i = zoneChildren.length - 1; i >= 0; i--) {
                const chId = String(zoneChildren[i].id || "");
                if (!chId) continue;
                const chDom = await transport.getBlockDOM(chId).catch(() => null);
                if (chDom?.dom && chDom.dom.includes(`data-node-id="${opts.blockId}"`)) {
                    return { confirmed: true, zoneChildId: chId, matchedBlockId: opts.blockId };
                }
            }
        }
    }

    if (opts.eventId) {
        const liveByEvent = await findLiveBlocksByEventId(transport, opts.eventId).catch(() => []);
        for (const row of liveByEvent) {
            if (zoneIds.has(row.id)) {
                return { confirmed: true, zoneChildId: row.id, matchedBlockId: row.id };
            }
            const rows = await transport
                .sql(`SELECT parent_id FROM blocks WHERE id = '${escapeSqlLiteral(row.id)}' LIMIT 1`)
                .catch(() => []);
            const parentId = rows?.[0]?.parent_id ? String(rows[0].parent_id) : "";
            if (parentId && zoneIds.has(parentId)) {
                return { confirmed: true, zoneChildId: parentId, matchedBlockId: row.id };
            }
            for (let i = zoneChildren.length - 1; i >= 0; i--) {
                const chId = String(zoneChildren[i].id || "");
                if (!chId) continue;
                const chDom = await transport.getBlockDOM(chId).catch(() => null);
                if (chDom?.dom && (chDom.dom.includes(`data-node-id="${row.id}"`) || chDom.dom.includes(`custom-lv-event-id="${opts.eventId}"`))) {
                    return { confirmed: true, zoneChildId: chId, matchedBlockId: row.id };
                }
            }
        }
    }

    return { confirmed: false };
}

async function appendDomInDiaryZone(
    transport: SiyuanDiaryTransport,
    docId: string,
    dom: string,
    useDiaryZone = true,
    meta?: { blockId?: string; eventId?: string },
): Promise<{ txRes?: AppendTransactionResult[]; zoneHeadingId?: string }> {
    if (!useDiaryZone) {
        const txRes = (await transport.appendBlock(docId, dom, "dom")) as AppendTransactionResult[] | undefined;
        return { txRes, zoneHeadingId: undefined };
    }

    // 极简内存单测传输层未实现 insertBlock/getChildBlocks 时保留传统路径
    if (typeof transport.insertBlock !== "function" || typeof transport.getChildBlocks !== "function") {
        const txRes = (await transport.appendBlock(docId, dom, "dom")) as AppendTransactionResult[] | undefined;
        return { txRes, zoneHeadingId: undefined };
    }

    const targetBlockId =
        meta?.blockId ||
        dom.match(/data-node-id="([^"]+)"[^>]*data-type="NodeListItem"/i)?.[1] ||
        dom.match(/data-type="NodeListItem"[^>]*data-node-id="([^"]+)"/i)?.[1] ||
        dom.match(/data-node-id="([^"]+)"/i)?.[1];
    const targetEventId = meta?.eventId || dom.match(/custom-lv-event-id="([^"]*)"/)?.[1];

    const zone = await ensureXiaolvDiaryZone(docId, { postFn: buildDiaryZonePostFn(transport) });
    const zoneHeadingId = zone.zoneHeadingId;

    // 幂等预检：若该事件/块已确认落于折叠区内（如上次重试回执丢失），直接复用，严禁双写
    if (targetEventId || targetBlockId) {
        const existingInZone = await findConfirmedBlockInDiaryZone(transport, docId, zone, {
            blockId: targetBlockId,
            eventId: targetEventId,
        });
        if (existingInZone.confirmed && existingInZone.zoneChildId) {
            return {
                txRes: [{ doOperations: [{ id: existingInZone.zoneChildId, data: dom }] }],
                zoneHeadingId,
            };
        }
    }

    let inserted: unknown;
    let insertErr: unknown = null;
    try {
        inserted = await transport.insertBlock(zone.anchorBlockId, dom, "dom", docId);
    } catch (err) {
        insertErr = err;
    }

    if (!insertErr && inserted && typeof inserted === "object" && !Array.isArray(inserted)) {
        const code = (inserted as { code?: unknown }).code;
        if (typeof code === "number" && code !== 0) {
            insertErr = new DiaryReadbackVerificationError(
                `insertBlock into diary zone ${zoneHeadingId} rejected with code=${code}`,
            );
        }
    }

    const firstOp = Array.isArray(inserted) ? (inserted as AppendTransactionResult[])[0]?.doOperations?.[0] : undefined;
    const receiptId = firstOp?.id ? String(firstOp.id) : undefined;

    if (!insertErr && receiptId) {
        const verified = await findConfirmedBlockInDiaryZone(transport, docId, zone, {
            receiptId,
            blockId: targetBlockId,
            eventId: targetEventId,
        });
        if (verified.confirmed) {
            return {
                txRes: inserted as AppendTransactionResult[],
                zoneHeadingId,
            };
        }
        throw new DiaryReadbackVerificationError(
            `insertBlock returned ${receiptId}, but block is not inside diary zone ${zoneHeadingId} of ${docId}; refusing root fallback`,
        );
    }

    // 回执缺 ID 或异常不明时先核对是否已实际落入折叠区内（防双写）；无法确认则显式失败抛出，绝不回落根末尾 appendBlock
    const recovered = await findConfirmedBlockInDiaryZone(transport, docId, zone, {
        blockId: targetBlockId,
        eventId: targetEventId,
    });
    if (recovered.confirmed && recovered.zoneChildId) {
        return {
            txRes: [{ doOperations: [{ id: recovered.zoneChildId, data: dom }] }],
            zoneHeadingId,
        };
    }

    const reason = insertErr instanceof Error
        ? insertErr.message
        : receiptId
          ? `unconfirmed zone placement for ${receiptId}`
          : "insertBlock receipt missing block ID and block not found in diary zone";
    throw new DiaryReadbackVerificationError(
        `Diary zone insert failed/unconfirmed in ${docId} (zone=${zoneHeadingId}): ${reason}; refusing root appendBlock fallback`,
    );
}

/**
 * 原子写入单条日记信封（dataType: "dom" NodeListItem），自动落入「#### 🐴 小驴记录」折叠区，并读回 live .sy 与属性核验 100% 一致
 */
export async function writeDiaryEnvelopeDom(
    transport: SiyuanDiaryTransport,
    params: {
        docId: string;
        blockId: string;
        text: string;
        attrs: Record<string, string>;
        useDiaryZone?: boolean;
    },
): Promise<{ blockId: string; listBlockId: string | null; verifiedAttrs: Record<string, string>; zoneHeadingId?: string }> {
    const validAttrs = validateCustomAttrs(params.attrs);
    const dom = buildDiaryListDom({
        blockId: params.blockId,
        text: params.text,
        attrs: validAttrs,
    });
    const { txRes, zoneHeadingId } = await appendDomInDiaryZone(
        transport,
        params.docId,
        dom,
        params.useDiaryZone !== false,
        { blockId: params.blockId, eventId: validAttrs["custom-lv-event-id"] },
    );
    const firstOp = Array.isArray(txRes) ? txRes?.[0]?.doOperations?.[0] : undefined;
    const listBlockId = firstOp?.id || null;
    const itemBlockId = extractListItemIdFromOpData(firstOp) || params.blockId;

    // 必须走实时 .sy getBlockDOM 验证存活性（getBlockAttrs 对已删块不报错！）
    const liveDom = await transport.getBlockDOM(itemBlockId);
    if (!liveDom || liveDom.id !== itemBlockId) {
        throw new DiaryReadbackVerificationError(`Live getBlockDOM missing for ${itemBlockId}`);
    }
    const actualAttrs = (await transport.getBlockAttrs(itemBlockId)) || {};
    for (const [k, v] of Object.entries(validAttrs)) {
        if (actualAttrs[k] !== v) {
            throw new DiaryReadbackVerificationError(
                `Attribute mismatch on ${itemBlockId} for ${k}: expected="${v}", actual="${actualAttrs[k] ?? ""}"`,
            );
        }
    }
    return { blockId: itemBlockId, listBlockId, verifiedAttrs: actualAttrs, zoneHeadingId };
}

/**
 * 两步兼容路径中断恢复：
 * - 若有持久 committedBlockId 且实时 .sy getBlockDOM 证实存在：补写属性并 settle；
 * - 若缺失持久 committedBlockId（或 live .sy 不存在）：严格 Fail-Closed！
 *   严禁按文本搜索认领手写块、严禁自动删除、严禁自动重插！
 */
export async function recoverTwoStepIntent(
    transport: SiyuanDiaryTransport,
    intent: TwoStepIntentRecord,
    pendingConfirmQueue: PendingConfirmItem[],
): Promise<{
    status: "already_settled" | "recovered" | "fail_closed_queued";
    blockId: string | null;
}> {
    if (intent.settled) {
        return { status: "already_settled", blockId: intent.committedBlockId };
    }
    if (!intent.committedBlockId) {
        pendingConfirmQueue.push({
            eventId: intent.eventId,
            expectedDocId: intent.expectedDocId,
            reason: "missing_committed_block_id_fail_closed",
            committedBlockId: null,
        });
        return { status: "fail_closed_queued", blockId: null };
    }

    const validAttrs = validateCustomAttrs(intent.attrs);
    let liveDom: BlockDomResult | null = null;
    try {
        liveDom = await transport.getBlockDOM(intent.committedBlockId);
    } catch {
        liveDom = null;
    }
    if (!liveDom || liveDom.id !== intent.committedBlockId) {
        pendingConfirmQueue.push({
            eventId: intent.eventId,
            expectedDocId: intent.expectedDocId,
            reason: "committed_block_not_found_in_live_sy_fail_closed",
            committedBlockId: intent.committedBlockId,
        });
        return { status: "fail_closed_queued", blockId: null };
    }

    await transport.setBlockAttrs(intent.committedBlockId, validAttrs);
    intent.settled = true;
    return { status: "recovered", blockId: intent.committedBlockId };
}

/**
 * 写入月分片：YYYY-MM 严格取 recordedAt（写入月），绝不取 bizDate（业务发生月）
 */
export function getWriteShardMonth(recordedAt: string): string {
    const raw = String(recordedAt || "").trim();
    const m = raw.match(/^(\d{4}-\d{2})-/);
    if (!m) {
        throw new Error(`[DIARY-SHARD-INVALID-DATE] Invalid recordedAt timestamp: "${recordedAt}"`);
    }
    return m[1];
}

const shardWriteLocks = new Map<string, Promise<unknown>>();
const MAX_SHARD_APPEND_ATTEMPTS = 3;

function withShardWriteLock<T>(shardPath: string, fn: () => Promise<T>): Promise<T> {
    const runInModuleQueue = (): Promise<T> => {
        const prev = shardWriteLocks.get(shardPath) ?? Promise.resolve();
        const next = prev.catch(() => undefined).then(fn);
        const marker = next.catch(() => undefined);
        shardWriteLocks.set(shardPath, marker);
        void marker.finally(() => {
            if (shardWriteLocks.get(shardPath) === marker) {
                shardWriteLocks.delete(shardPath);
            }
        });
        return next;
    };

    const navLocks =
        typeof navigator !== "undefined"
            ? (navigator as Navigator & {
                  locks?: {
                      request: <R>(name: string, cb: (lock: unknown) => Promise<R> | R) => Promise<R>;
                  };
              }).locks
            : undefined;
    if (navLocks && typeof navLocks.request === "function") {
        return navLocks.request(`xiaolv-home-diary:${shardPath}`, () => runInModuleQueue());
    }
    return runInModuleQueue();
}

export function isConfirmedFileNotFoundError(err: unknown): boolean {
    if (err instanceof KernelError) {
        return (
            err.code === 404 ||
            /\b(?:404|ENOENT)\b|file\s+not\s+found|no\s+such\s+file|does\s+not\s+exist|not\s+exist|not\s*found|不存在|找不到/i.test(
                err.kernelMsg,
            )
        );
    }
    if (err && typeof err === "object") {
        const rec = err as { code?: unknown; status?: unknown };
        if (rec.code === "ENOENT" || rec.code === 404 || rec.status === 404) {
            return true;
        }
    }
    if (err instanceof Error && !(err instanceof SyntaxError)) {
        return /^(?:404|ENOENT)$|\bHTTP\s*404\b|\bENOENT\b|file\s+not\s+found|no\s+such\s+file|does\s+not\s+exist|not\s+exist|不存在|找不到/i.test(
            err.message,
        );
    }
    return false;
}

export async function appendShardRecord(
    transport: SiyuanDiaryTransport,
    storagePrefix: string,
    deviceId: string,
    record: Omit<ShardEventRecord, "seq"> & { seq?: number },
): Promise<{ shardPath: string; shardMonth: string; fileHash: string; count: number; seq: number }> {
    const timestamp = record.recordedAt || record.deletedAt || record.updatedAt;
    const shardMonth = getWriteShardMonth(timestamp);
    const shardPath = `${storagePrefix}/events/${deviceId}-${shardMonth}.json`;
    const eventKeyOf = (r: { eventId?: string; revision?: number; op?: string }) =>
        `${String(r.eventId || "")}::${Number(r.revision || 0)}::${String(r.op || "")}`;

    return withShardWriteLock(shardPath, async () => {
        for (let attempt = 1; attempt <= MAX_SHARD_APPEND_ATTEMPTS; attempt++) {
            let records: ShardEventRecord[] = [];
            try {
                const txt = await transport.getFileText(shardPath);
                const parsed = JSON.parse(txt);
                if (!Array.isArray(parsed)) {
                    throw new Error(`[DIARY-SHARD-CORRUPT] Shard ${shardPath} is not a JSON array`);
                }
                records = parsed as ShardEventRecord[];
            } catch (err) {
                if (!isConfirmedFileNotFoundError(err)) {
                    throw err instanceof Error ? err : new Error(String(err));
                }
                // 仅确认 404 / ENOENT / 不存在时视作新空分片，其余瞬时 I/O、权限或 JSON 损坏一律 Fail-Closed 抛错保留原文件
                records = [];
            }

            const prevCount = records.length;
            const prevKeys = new Set(records.map((r) => eventKeyOf(r)));
            const targetKey = eventKeyOf(record);

            let fullRecord: ShardEventRecord | undefined = records.find((r) => eventKeyOf(r) === targetKey);
            let seq: number;
            if (fullRecord) {
                seq = Number(fullRecord.seq || 0);
            } else {
                const maxSeq = records.reduce((m, r) => Math.max(m, Number(r.seq || 0)), 0);
                seq = record.seq && record.seq > 0 ? record.seq : maxSeq + 1;
                fullRecord = { ...record, seq } as ShardEventRecord;
                records.push(fullRecord);
            }

            const serialized = JSON.stringify(records, null, 2);
            const expectedHash = sha256Hex(serialized);
            await transport.putFile(shardPath, serialized);

            // 写后读回校验：确保分片真实落盘；若检测到跨 realm 并发覆写冲突，有界重读合并重试（最多 3 次）
            const readBack = await transport.getFileText(shardPath);
            if (sha256Hex(readBack) === expectedHash) {
                return {
                    shardPath,
                    shardMonth,
                    fileHash: expectedHash,
                    count: records.length,
                    seq,
                };
            }

            let readBackRecords: ShardEventRecord[] | null = null;
            try {
                const parsedRb = JSON.parse(readBack);
                if (Array.isArray(parsedRb)) readBackRecords = parsedRb as ShardEventRecord[];
            } catch {
                readBackRecords = null;
            }

            const hasConcurrentExternalWrite =
                readBackRecords !== null &&
                readBackRecords.length >= prevCount &&
                readBackRecords.some((r) => {
                    const k = eventKeyOf(r);
                    return !prevKeys.has(k) && k !== targetKey;
                });

            if (!hasConcurrentExternalWrite || attempt >= MAX_SHARD_APPEND_ATTEMPTS) {
                throw new DiaryReadbackVerificationError(`Shard readback hash mismatch for ${shardPath}`);
            }
        }
        throw new DiaryReadbackVerificationError(`Shard append exceeded max conflict retries (${MAX_SHARD_APPEND_ATTEMPTS}) for ${shardPath}`);
    });
}

export async function readShardFresh(
    transport: SiyuanDiaryTransport,
    storagePrefix: string,
    deviceId: string,
    shardMonth: string,
): Promise<{ shardPath: string; records: ShardEventRecord[]; fileHash: string }> {
    const shardPath = `${storagePrefix}/events/${deviceId}-${shardMonth}.json`;
    const txt = await transport.getFileText(shardPath);
    const parsed = JSON.parse(txt);
    if (!Array.isArray(parsed)) {
        throw new Error(`[DIARY-SHARD-CORRUPT] Shard ${shardPath} is not a JSON array`);
    }
    return { shardPath, records: parsed as ShardEventRecord[], fileHash: sha256Hex(txt) };
}

export function compareRecordVersion(
    a: { revision: number; updatedAt: string; deviceId: string },
    b: { revision: number; updatedAt: string; deviceId: string },
): number {
    if (a.revision !== b.revision) return a.revision - b.revision;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
    if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? 1 : -1;
    return 0;
}

/**
 * 强制显式 LIMIT Keyset 分页 SQL 查询，彻底规避 SiYuan v3.8.12 /api/query/sql 默认 64 行截断，禁前导 LIKE
 */
export async function queryBlocksByAttrKeyset(
    transport: Pick<SiyuanDiaryTransport, "sql">,
    options: {
        attrName: string;
        attrValue?: string;
        extraSelect?: string;
        extraJoin?: string;
        extraWhere?: string;
        pageSize?: number;
    },
): Promise<Array<Record<string, unknown>>> {
    const pageSize = Math.max(1, Math.min(500, Number(options.pageSize || DEFAULT_SQL_PAGE_SIZE)));
    const attrNameEsc = escapeSqlLiteral(options.attrName);
    const valCond =
        options.attrValue !== undefined ? ` AND a.value='${escapeSqlLiteral(options.attrValue)}'` : "";
    const extraSel = options.extraSelect ? `, ${options.extraSelect}` : "";
    const extraJoin = options.extraJoin ? ` ${options.extraJoin}` : "";
    const extraWhere = options.extraWhere ? ` AND (${options.extraWhere})` : "";

    const collected: Array<Record<string, unknown>> = [];
    let lastId = "";
    while (true) {
        const stmt = `SELECT b.id, b.content, b.root_id, b.ial${extraSel}
FROM attributes a
JOIN blocks b ON b.id=a.block_id${extraJoin}
WHERE a.name='${attrNameEsc}'${valCond}${extraWhere} AND b.id > '${escapeSqlLiteral(lastId)}'
ORDER BY b.id ASC
LIMIT ${pageSize}`;
        const page = (await transport.sql(stmt)) || [];
        if (page.length === 0) break;
        collected.push(...page);
        const nextId = String(page[page.length - 1].id || "");
        if (!nextId || nextId === lastId || page.length < pageSize) break;
        lastId = nextId;
    }
    return collected;
}

/**
 * 按 eventId 查实时存活块：SQL 显式 LIMIT 定位候选 + 必须过实时 .sy getBlockDOM 验证（过滤已删幽灵索引）
 */
export async function findLiveBlocksByEventId(
    transport: SiyuanDiaryTransport,
    eventId: string,
): Promise<Array<{ id: string; content: string; dom: string; rootId?: string }>> {
    const candidates = await queryBlocksByAttrKeyset(transport, {
        attrName: "custom-lv-event-id",
        attrValue: eventId,
        pageSize: 50,
    });
    const live: Array<{ id: string; content: string; dom: string; rootId?: string }> = [];
    for (const row of candidates) {
        const blockId = String(row.id || "");
        if (!blockId) continue;
        try {
            const domRes = await transport.getBlockDOM(blockId);
            if (domRes && domRes.id === blockId) {
                live.push({
                    id: blockId,
                    content: extractLiveTextFromDom(domRes.dom) || String(row.content || ""),
                    dom: domRes.dom,
                    rootId: row.root_id ? String(row.root_id) : undefined,
                });
            }
        } catch {
            // 实时 .sy 不存在：忽略 SQLite 异步索引延迟残留行
        }
    }
    return live;
}

export function buildRecordAttrs(rec: {
    eventId: string;
    revision: number;
    module: string;
    action: string;
    target: string;
    avId?: string;
    bizDate: string;
    recordedAt?: string;
    updatedAt: string;
    amount?: string;
    extraAttrs?: Record<string, string>;
}): Record<string, string> {
    const attrs: Record<string, string> = {
        "custom-lv-source": "siyuan-home",
        "custom-lv-schema": "home-event-v2",
        "custom-lv-lifelog": "1",
        "custom-lifelog-type": (rec.extraAttrs?.["custom-lifelog-type"] || rec.action || "日常记录").replace(/[：:]/g, "-").trim() || "日常记录",
        "custom-lv-event-id": rec.eventId,
        "custom-lv-revision": String(rec.revision),
        "custom-lv-type": "event-log",
        "custom-lv-module": rec.module,
        "custom-lv-action": rec.action,
        "custom-lv-target": rec.target,
        "custom-lv-biz-date": rec.bizDate,
        "custom-lv-recorded-at": rec.recordedAt || rec.updatedAt,
    };
    if (rec.avId) attrs["custom-lv-avid"] = rec.avId;
    if (rec.amount !== undefined) attrs["custom-lv-amount"] = rec.amount;
    if (rec.extraAttrs) {
        for (const [k, v] of Object.entries(rec.extraAttrs)) {
            if (v !== undefined && v !== null && v !== "") {
                attrs[k] = String(v);
            }
        }
    }
    return validateCustomAttrs(attrs);
}

/**
 * 分片对账自愈核心：
 * - 按 (deviceId, shardMonth) 追踪连续 ackedSeq 与 gaps[]；
 * - 缺目标块级证据排除手删时一律入 conflictQueue（默认 autoBackfillOnMissing = false）；
 * - 显式 tombstone 必须 100% 校验 eventId + revision + managedTextHash（经实时 getBlockDOM 正文哈希）；
 * - 仅在投影写回并经实时 getBlockDOM + getBlockAttrs 读回核验通过后提交 checkpoint。
 */
export async function reconcileDeviceShard(
    state: ReconcileEngineState,
    transport: SiyuanDiaryTransport,
    options: {
        storagePrefix: string;
        deviceId: string;
        shardMonth: string;
        ensureDiaryDoc: (bizDate: string) => Promise<string>;
        blockLevelOverwriteProof?: ReadonlySet<string> | null;
        simulateReadbackFail?: boolean;
    },
): Promise<{
    skippedUnchanged: boolean;
    processed: number;
    cursor: SyncCursorState;
}> {
    const { storagePrefix, deviceId, shardMonth, ensureDiaryDoc, blockLevelOverwriteProof, simulateReadbackFail } = options;
    const { records, fileHash } = await readShardFresh(transport, storagePrefix, deviceId, shardMonth);

    if (!state.syncCursors[deviceId]) state.syncCursors[deviceId] = {};
    const prevCursor: SyncCursorState = state.syncCursors[deviceId][shardMonth] || {
        ackedSeq: 0,
        gaps: [],
        seenSeqs: [],
        fileHash: null,
    };

    if (prevCursor.fileHash === fileHash && prevCursor.gaps.length === 0) {
        return { skippedUnchanged: true, processed: 0, cursor: prevCursor };
    }

    const seenSet = new Set<number>(prevCursor.seenSeqs);
    const maxSeqInFile = records.reduce((m, r) => Math.max(m, r.seq), prevCursor.ackedSeq);
    let processed = 0;

    const sortedRecords = [...records].sort((a, b) => a.seq - b.seq);
    for (const rec of sortedRecords) {
        if (seenSet.has(rec.seq)) continue;

        const cur = state.appliedRevisions.get(rec.eventId);
        if (cur && compareRecordVersion({ revision: rec.revision, updatedAt: rec.updatedAt, deviceId }, cur) < 0) {
            seenSet.add(rec.seq);
            processed++;
            continue;
        }

        if (rec.op === "upsert" || rec.op === "patch") {
            const liveRows = await findLiveBlocksByEventId(transport, rec.eventId);
            if (rec.op === "upsert") {
                if (liveRows.length === 0) {
                    if (cur && cur.projectedBefore) {
                        const hasProof = Boolean(blockLevelOverwriteProof && blockLevelOverwriteProof.has(rec.eventId));
                        if (!state.autoBackfillOnMissing || !hasProof) {
                            state.conflictQueue.push({
                                kind: "missing_projected_block_without_tombstone",
                                eventId: rec.eventId,
                                deviceId,
                                shardMonth,
                                reason: hasProof
                                    ? "auto_backfill_disabled"
                                    : "no_block_level_signal_excluding_manual_delete",
                            });
                            seenSet.add(rec.seq);
                            processed++;
                            continue;
                        }
                    }

                    const docId = await ensureDiaryDoc(rec.bizDate);
                    const attrs = buildRecordAttrs(rec);
                    const dom = buildDiaryListDom({
                        blockId: rec.blockId,
                        text: rec.managedText || "",
                        attrs,
                    });
                    await appendDomInDiaryZone(transport, docId, dom, true, {
                        blockId: rec.blockId,
                        eventId: rec.eventId,
                    });

                    if (simulateReadbackFail) {
                        throw new DiaryReadbackVerificationError(
                            "Simulated readback verification failure; refusing cursor commit",
                        );
                    }
                    const liveDom = await transport.getBlockDOM(rec.blockId);
                    if (!liveDom || liveDom.id !== rec.blockId) {
                        throw new DiaryReadbackVerificationError(
                            `Readback getBlockDOM missing for ${rec.blockId}; refusing cursor commit`,
                        );
                    }
                    const verifiedAttrs = await transport.getBlockAttrs(rec.blockId);
                    if (verifiedAttrs?.["custom-lv-event-id"] !== rec.eventId) {
                        throw new DiaryReadbackVerificationError(
                            `Readback attr mismatch for ${rec.blockId}; refusing cursor commit`,
                        );
                    }

                    state.appliedRevisions.set(rec.eventId, {
                        revision: rec.revision,
                        updatedAt: rec.updatedAt,
                        deviceId,
                        op: rec.op,
                        blockId: rec.blockId,
                        managedTextHash: rec.managedTextHash,
                        projectedBefore: true,
                    });
                } else {
                    const targetId = liveRows[0].id;
                    const patchAttrs: Record<string, string> = {
                        "custom-lv-revision": String(rec.revision),
                    };
                    if (rec.amount !== undefined) patchAttrs["custom-lv-amount"] = rec.amount;
                    await transport.setBlockAttrs(targetId, patchAttrs);
                    state.appliedRevisions.set(rec.eventId, {
                        revision: rec.revision,
                        updatedAt: rec.updatedAt,
                        deviceId,
                        op: rec.op,
                        blockId: targetId,
                        managedTextHash: rec.managedTextHash,
                        projectedBefore: true,
                    });
                }
            } else {
                const targetId = liveRows[0]?.id || rec.blockId;
                const attrs = buildRecordAttrs(rec);
                if (liveRows.length > 0) {
                    const innerDom = buildDiaryListItemDom({
                        blockId: targetId,
                        text: rec.managedText || "",
                        attrs,
                    });
                    await transport.updateBlock(targetId, innerDom, "dom");
                } else {
                    const docId = await ensureDiaryDoc(rec.bizDate);
                    const listDom = buildDiaryListDom({
                        blockId: targetId,
                        text: rec.managedText || "",
                        attrs,
                    });
                    await appendDomInDiaryZone(transport, docId, listDom, true, {
                        blockId: targetId,
                        eventId: rec.eventId,
                    });
                }
                if (simulateReadbackFail) {
                    throw new DiaryReadbackVerificationError(
                        "Simulated readback verification failure on patch; refusing cursor commit",
                    );
                }
                const liveDom = await transport.getBlockDOM(targetId);
                const verifiedAttrs = await transport.getBlockAttrs(targetId);
                if (!liveDom || liveDom.id !== targetId || verifiedAttrs?.["custom-lv-revision"] !== String(rec.revision)) {
                    throw new DiaryReadbackVerificationError(`Patch readback verify failed for ${targetId}`);
                }
                state.appliedRevisions.set(rec.eventId, {
                    revision: rec.revision,
                    updatedAt: rec.updatedAt,
                    deviceId,
                    op: rec.op,
                    blockId: targetId,
                    managedTextHash: rec.managedTextHash,
                    projectedBefore: true,
                });
            }
        } else if (rec.op === "tombstone") {
            const liveRows = await findLiveBlocksByEventId(transport, rec.eventId);
            for (const row of liveRows) {
                const rowAttrs = (await transport.getBlockAttrs(row.id)) || {};
                const rowRev = Number(rowAttrs["custom-lv-revision"] || 0);
                const currentTextHash = sha256Hex(row.content.trim());
                if (
                    rowAttrs["custom-lv-event-id"] === rec.eventId &&
                    rowRev <= rec.revision &&
                    currentTextHash === rec.managedTextHash
                ) {
                    await transport.deleteBlock(row.id);
                } else {
                    state.conflictQueue.push({
                        kind: "tombstone_user_edited_block_protected",
                        eventId: rec.eventId,
                        blockId: row.id,
                        expectedHash: rec.managedTextHash,
                        actualHash: currentTextHash,
                        actualContent: row.content,
                    });
                }
            }
            state.appliedRevisions.set(rec.eventId, {
                revision: rec.revision,
                updatedAt: rec.updatedAt,
                deviceId,
                op: "tombstone",
                blockId: null,
                managedTextHash: rec.managedTextHash,
                projectedBefore: false,
            });
        }

        seenSet.add(rec.seq);
        processed++;
    }

    let ackedSeq = 0;
    while (seenSet.has(ackedSeq + 1)) ackedSeq++;
    const gaps: number[] = [];
    for (let s = ackedSeq + 1; s <= maxSeqInFile; s++) {
        if (!seenSet.has(s)) gaps.push(s);
    }

    const nextCursor: SyncCursorState = {
        ackedSeq,
        gaps,
        seenSeqs: [...seenSet].sort((a, b) => a - b),
        fileHash,
    };
    state.syncCursors[deviceId][shardMonth] = nextCursor;

    return { skippedUnchanged: false, processed, cursor: nextCursor };
}

// ── 高频流水业务直写引擎 ──────────────────────────────────────────────────

export function getOrCreateDeviceId(): string {
    const KEY = "lv_home_device_id_v1";
    try {
        if (typeof localStorage !== "undefined") {
            const existing = localStorage.getItem(KEY);
            if (existing && /^[a-z0-9_-]{4,}$/i.test(existing)) return existing;
            const created = `dev-${newSiYuanId().slice(-7)}`;
            localStorage.setItem(KEY, created);
            return created;
        }
    } catch { /* ignore */ }
    return "dev-local";
}

function localYmdToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 双日期策略（bizDate vs recordedAt）定位目标日记文档：
 * 1. 当日或已有对应 bizDate 日记 → 写入该 bizDate 日记；
 * 2. 补记历史日且该日无日记：
 *    - createHistoryDiaryDoc=true 时创建该日日记；
 *    - 默认写入今日日记，并在正文显式标出 [补记 YYYY-MM-DD]。
 */
export async function resolveTargetDailyNoteDoc(
    bizDate: string,
    options?: {
        createHistoryDiaryDoc?: boolean;
        transport?: Pick<SiyuanDiaryTransport, "sql">;
    },
): Promise<{ docId: string; isBackdateToToday: boolean }> {
    const today = localYmdToday();
    const targetYmd = bizDate.replace(/-/g, "");
    const sqlFn = options?.transport?.sql ?? ((stmt: string) => sql(stmt));
    const notebooks = await listNotebooks().catch(() => []);
    const openNotebookIds = new Set(notebooks.filter((nb) => !nb.closed).map((nb) => nb.id));
    const nonPluginOpenIds = new Set(
        notebooks.filter((nb) => !nb.closed && !/小驴|管家|人脉|题库|闪卡|拾遗|生态|exam|contacts|home|checkin|glean/i.test(nb.name)).map((nb) => nb.id),
    );
    const hasNbCatalog = notebooks.length > 0;
    const pickDiaryDocFromRows = (rows: unknown): string => {
        if (!Array.isArray(rows) || rows.length === 0) return "";
        const validRows = rows.filter((r: any) => {
            if (!r?.id) return false;
            if (!hasNbCatalog || !r.box) return true;
            return openNotebookIds.has(String(r.box));
        });
        if (validRows.length === 0) return "";
        const preferred = validRows.find((r: any) => !hasNbCatalog || !r.box || nonPluginOpenIds.has(String(r.box)));
        return String((preferred ?? validRows[0]).id);
    };

    // 先查目标日期是否已有思源日记（排除已关闭笔记本，按创建时间升序稳定选择）
    try {
        const existingRows = await sqlFn(
            `SELECT DISTINCT b.id, b.root_id, b.box FROM attributes a JOIN blocks b ON b.id = a.block_id WHERE a.name = 'custom-dailynote-${escapeSqlLiteral(targetYmd)}' AND b.type='d' ORDER BY b.created ASC, b.id ASC`,
        );
        const picked = pickDiaryDocFromRows(existingRows);
        if (picked) {
            return { docId: picked, isBackdateToToday: false };
        }
    } catch { /* ignore */ }

    if (bizDate !== today && options?.createHistoryDiaryDoc) {
        const nbs = hasNbCatalog ? notebooks : await listNotebooks();
        const openNb = nbs.find((nb) => !nb.closed && !/小驴/.test(nb.name)) || nbs.find((nb) => !nb.closed);
        if (openNb) {
            const [y, m] = bizDate.split("-");
            const docId = await createDocWithMd(openNb.id, `/daily note/${y}/${y}-${m}/${bizDate}`, `# ${bizDate}`);
            await setBlockAttrs(docId, { [`custom-dailynote-${targetYmd}`]: targetYmd }).catch(() => undefined);
            return { docId, isBackdateToToday: false };
        }
    }

    // 写入默认当日日记（优先复用 lv-notice-kit，但需实库核验未删除且不在已关闭/插件专属本，防删日记缓存滞留）
    let todayDocId = "";
    try {
        const { findTodayDailyNoteDocId } = await import("@/libs/lv-notice-kit");
        const candidate = (await findTodayDailyNoteDocId().catch(() => null)) || "";
        if (candidate) {
            const liveCheck = await sqlFn(
                `SELECT id, box FROM blocks WHERE id = '${escapeSqlLiteral(candidate)}' AND type='d' LIMIT 1`,
            ).catch(() => null);
            if (Array.isArray(liveCheck) && liveCheck[0]?.id) {
                const box = String(liveCheck[0].box ?? "");
                if (!hasNbCatalog || !box || openNotebookIds.has(box)) {
                    todayDocId = String(liveCheck[0].id);
                }
            } else if (!Array.isArray(liveCheck)) {
                todayDocId = candidate;
            }
        }
    } catch { /* ignore */ }

    if (!todayDocId) {
        const todayCompact = today.replace(/-/g, "");
        try {
            const rows = await sqlFn(
                `SELECT DISTINCT b.id, b.box FROM attributes a JOIN blocks b ON b.id = a.block_id WHERE a.name = 'custom-dailynote-${escapeSqlLiteral(todayCompact)}' AND b.type='d' ORDER BY b.created ASC, b.id ASC`,
            );
            todayDocId = pickDiaryDocFromRows(rows);
        } catch { /* ignore */ }
    }

    if (!todayDocId) {
        const nbs = hasNbCatalog ? notebooks : await listNotebooks().catch(() => []);
        const openNb = nbs.find((nb) => !nb.closed && !/小驴/.test(nb.name)) || nbs.find((nb) => !nb.closed);
        if (openNb) {
            const { post } = await import("./siyuan-transport");
            const created = await post<any>("/api/filetree/createDailyNote", { notebook: openNb.id }).catch(() => null);
            todayDocId = typeof created === "string" ? created : String(created?.id ?? "");
        }
    }

    if (!todayDocId) {
        throw new Error("无法定位或创建思源默认当日日记");
    }

    return {
        docId: todayDocId,
        isBackdateToToday: bizDate !== today,
    };
}

export interface RecordDiaryEventInput {
    module: string;
    action: string;
    target: string;
    avId?: string;
    bizDate: string;
    recordedAt?: string;
    text: string;
    amount?: string | number;
    quantity?: string | number;
    odometer?: string | number;
    eventId?: string;
    blockId?: string;
    createHistoryDiaryDoc?: boolean;
    extraAttrs?: Record<string, string>;
    transport?: SiyuanDiaryTransport;
}

export async function recordHighFrequencyDiaryEvent(
    plugin: any,
    input: RecordDiaryEventInput,
): Promise<{
    eventId: string;
    blockId: string;
    docId: string;
    shardPath: string;
    bizDate: string;
    recordedAt: string;
}> {
    const transport = input.transport ?? createSiyuanDiaryTransport(plugin);
    const recordedAt = input.recordedAt || new Date().toISOString();
    const bizDate = input.bizDate || localYmdToday();
    const eventId = input.eventId || `evt-${newSiYuanId()}`;
    const blockId = input.blockId || newSiYuanId();

    const { docId, isBackdateToToday } = await resolveTargetDailyNoteDoc(bizDate, {
        createHistoryDiaryDoc: input.createHistoryDiaryDoc,
        transport,
    });

    const finalText = isBackdateToToday && !input.text.includes(`[补记 ${bizDate}]`)
        ? `[补记 ${bizDate}] ${input.text}`
        : input.text;

    const extraAttrs: Record<string, string> = { ...(input.extraAttrs ?? {}) };
    if (input.quantity !== undefined && input.quantity !== "") extraAttrs["custom-lv-quantity"] = String(input.quantity);
    if (input.odometer !== undefined && input.odometer !== "") extraAttrs["custom-lv-odometer"] = String(input.odometer);

    const amountStr = input.amount !== undefined && input.amount !== "" ? String(input.amount) : undefined;
    const attrs = buildRecordAttrs({
        eventId,
        revision: 1,
        module: input.module,
        action: input.action,
        target: input.target,
        avId: input.avId,
        bizDate,
        recordedAt,
        updatedAt: recordedAt,
        amount: amountStr,
        extraAttrs,
    });

    const writeRes = await writeDiaryEnvelopeDom(transport, {
        docId,
        blockId,
        text: finalText,
        attrs,
    });

    const deviceId = getOrCreateDeviceId();
    let shardRes: { shardPath: string; shardMonth: string; fileHash: string; count: number; seq: number };
    try {
        shardRes = await appendShardRecord(transport, HOME_STORAGE_PREFIX, deviceId, {
            eventId,
            revision: 1,
            op: "upsert",
            bizDate,
            recordedAt,
            updatedAt: recordedAt,
            module: input.module,
            action: input.action,
            target: input.target,
            avId: input.avId,
            amount: amountStr,
            blockId: writeRes.blockId,
            managedText: finalText,
            managedTextHash: sha256Hex(finalText.trim()),
            extraAttrs,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new DiaryShardWriteError(`日记事件分片写入失败：${msg}`, {
            blockId: writeRes.blockId,
            eventId,
            docId,
            op: "upsert",
            cause: err,
        });
    }

    return {
        eventId,
        blockId: writeRes.blockId,
        docId,
        shardPath: shardRes.shardPath,
        bizDate,
        recordedAt,
    };
}

/**
 * 删除日记流水事件（先写分片 Tombstone，再校验指纹删除块；若用户手工编辑正文则保护不删）
 */
export async function deleteDiaryEventWithTombstone(
    plugin: any,
    params: {
        eventId: string;
        blockId: string;
        module: string;
        action: string;
        target: string;
        bizDate: string;
        prevRevision?: number;
        expectedText?: string;
        transport?: SiyuanDiaryTransport;
    },
): Promise<{ deleted: boolean; protectedByUserEdit: boolean }> {
    const transport = params.transport ?? createSiyuanDiaryTransport(plugin);
    const deviceId = getOrCreateDeviceId();
    const nowIso = new Date().toISOString();
    const liveDom = await transport.getBlockDOM(params.blockId).catch(() => null);
    const liveText = extractLiveTextFromDom(liveDom?.dom);
    const expectedHash = sha256Hex((params.expectedText ?? liveText).trim());

    try {
        await appendShardRecord(transport, HOME_STORAGE_PREFIX, deviceId, {
            eventId: params.eventId,
            revision: (params.prevRevision ?? 1) + 1,
            op: "tombstone",
            bizDate: params.bizDate,
            recordedAt: nowIso,
            deletedAt: nowIso,
            updatedAt: nowIso,
            module: params.module,
            action: params.action,
            target: params.target,
            blockId: params.blockId,
            managedTextHash: expectedHash,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new DiaryShardWriteError(`删除墓碑分片写入失败，已中止删块以防多端复活：${msg}`, {
            blockId: params.blockId,
            eventId: params.eventId,
            op: "tombstone",
            cause: err,
        });
    }

    if (!liveDom || liveDom.id !== params.blockId) {
        return { deleted: false, protectedByUserEdit: false };
    }
    if (params.expectedText && sha256Hex(liveText.trim()) !== sha256Hex(params.expectedText.trim())) {
        return { deleted: false, protectedByUserEdit: true };
    }
    await transport.deleteBlock(params.blockId);
    return { deleted: true, protectedByUserEdit: false };
}

export interface QueriedDiaryEvent {
    blockId: string;
    docId: string;
    content: string;
    eventId: string;
    module: string;
    action: string;
    target: string;
    avId?: string;
    bizDate: string;
    recordedAt?: string;
    amount?: number;
    sign: number;
    flowScope?: string;
    attrs: Record<string, string>;
}

/**
 * 跨层聚合 SQL 投影：
 * 单表精确查 attributes (name='custom-lv-source' AND value='siyuan-home') + blocks.ial JS 内存解析，
 * 显式 LIMIT Keyset 分页（彻底消除 64 行截断与前导通配符 LIKE '%...'）+ getBlockDOM 存活性校验。
 */
export async function queryDiaryEventsFromSql(
    transport?: Pick<SiyuanDiaryTransport, "sql" | "getBlockDOM">,
    options?: { targetId?: string; moduleId?: string; verifyLiveDom?: boolean },
): Promise<QueriedDiaryEvent[]> {
    const t = transport ?? createSiyuanDiaryTransport();
    const rows = await queryBlocksByAttrKeyset(t, {
        attrName: options?.targetId ? "custom-lv-target" : "custom-lv-source",
        attrValue: options?.targetId ? options.targetId : "siyuan-home",
        pageSize: 100,
    });

    const results: QueriedDiaryEvent[] = [];
    for (const r of rows) {
        const blockId = String(r.id ?? "");
        const docId = String(r.root_id ?? "");
        if (!blockId) continue;

        const attrs = parseIalAttributes(String(r.ial ?? ""));
        if (attrs["custom-lv-source"] !== "siyuan-home") continue;
        if (attrs["custom-lv-type"] && attrs["custom-lv-type"] !== "event-log") continue;
        if (options?.moduleId && attrs["custom-lv-module"] !== options.moduleId) continue;

        let content = String(r.content ?? "");
        if (options?.verifyLiveDom) {
            try {
                const live = await t.getBlockDOM(blockId);
                if (!live || live.id !== blockId) continue;
                const liveTxt = extractLiveTextFromDom(live.dom);
                if (liveTxt) content = liveTxt;
            } catch {
                continue;
            }
        }

        const rawAmt = attrs["custom-lv-amount"];
        const parsedAmt = rawAmt !== undefined && rawAmt !== "" ? Number(rawAmt) : undefined;
        const sign = attrs["custom-lv-sign"] === "-1" ? -1 : 1;

        results.push({
            blockId,
            docId,
            content,
            eventId: attrs["custom-lv-event-id"] || blockId,
            module: attrs["custom-lv-module"] || "",
            action: attrs["custom-lv-action"] || "",
            target: attrs["custom-lv-target"] || "",
            avId: attrs["custom-lv-avid"] || undefined,
            bizDate: attrs["custom-lv-biz-date"] || "",
            recordedAt: attrs["custom-lv-recorded-at"] || undefined,
            amount: parsedAmt !== undefined && Number.isFinite(parsedAmt) ? parsedAmt : undefined,
            sign,
            flowScope: attrs["custom-lv-flow-scope"] || undefined,
            attrs,
        });
    }
    return results;
}
