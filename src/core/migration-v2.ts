/**
 * 小驴管家 · 老用户 8 态无损迁移状态机与三层脱敏 DR 引擎 (migration-v2.ts)
 *
 * 对齐 doc#20 v4 & lv-migration-dr.ts：
 * 1. migration-manifest.json 8 态持久化与跨进程断点续传：
 *    IDLE → PREFLIGHT_LOCK_CHECK → BACKUP_CREATED → DRY_RUN_PREVIEWED → MIGRATING_CHUNK → VERIFIED → COMMITTED_SCHEMA_V2 / ROLLBACK_RESTORED
 * 2. 50/批写入 + pendingCursor 确定性 legacy-${sha256_16} ID + 实时 getBlockDOM / 显式 LIMIT 分页 SQL 幂等防重；
 * 3. 30 天 *.migrated.bak SHA-256 校验回滚（损坏即 ROLLBACK-FAIL-CLOSED，100% 保护提交后用户手工编辑块并仅剥离 custom-lv-idempotency）；
 * 4. lvBackup v2 三层脱敏 DR 导出（await flush() + 0 明文密钥硬断言，仅导出 configuredSecretSlots[]）+ SHA-256 校验 + Dry-Run 预览 + pre-restore-*.json 保护快照。
 */

import {
    appendBlockDom,
    batchSetBlockAttrs,
    createDocWithMd,
    deleteBlock,
    getBlockDOM,
    getFileText,
    KernelError,
    putFileText,
    sql,
} from "./siyuan";
import {
    escapeSqlLiteral,
    escapeXmlAttr,
    extractLiveTextFromDom,
    getOrCreateDeviceId,
    HOME_STORAGE_PREFIX,
    isConfirmedFileNotFoundError,
    resolveTargetDailyNoteDoc,
    sha256Hex,
} from "./diary-envelope";
import type { HomeSettings } from "@/types";
import type { RowLogs } from "./rowlog";
import type { HubRuntime } from "./hub/runtime-types";

export const MIGRATION_BATCH_SIZE = 50;
export const DEFAULT_ROLLBACK_RETENTION_DAYS = 30;
export const DR_BUNDLE_SCHEMA_VERSION = 2;

export type MigrationState =
    | "IDLE"
    | "PREFLIGHT_LOCK_CHECK"
    | "BACKUP_CREATED"
    | "DRY_RUN_PREVIEWED"
    | "MIGRATING_CHUNK"
    | "VERIFIED"
    | "COMMITTED_SCHEMA_V2"
    | "ROLLBACK_RESTORED";

export interface MigrationRowInput {
    avId: string;
    rowId: string;
    kind: string;
    bizDate: string;
    recordedAt: string;
    idx: number;
    amount: number;
    note: string;
    module?: string;
    action?: string;
    blockId?: string;
    extraAttrs?: Record<string, string>;
}

export interface MigrationManifest {
    schemaVersion: 1 | 2;
    state: MigrationState;
    lockOwnerDeviceId: string | null;
    lockOwnerToken?: string | null;
    lockLeaseExpiresAt: number;
    cursor: number;
    pendingCursor?: {
        start: number;
        end: number;
        deterministicIds: string[];
        candidates?: Array<{ eventId: string; blockId: string; textHash: string }>;
    } | null;
    migratedBlockIds: Record<string, string>;
    migratedBlockHashes: Record<string, string>;
    checksums: Record<string, string>;
    expectedTotals: {
        count: number;
        totalAmount: number;
    };
    committedByDeviceId?: string;
    committedAt?: string;
    rolledBackAt?: string;
}

export interface SiyuanMigrationTransport {
    getFileText: (filePath: string) => Promise<string>;
    putFile: (filePath: string, contentString: string) => Promise<unknown>;
    sql: (stmt: string) => Promise<Array<Record<string, unknown>>>;
    appendBlock: (parentID: string, data: string, dataType: "dom") => Promise<unknown>;
    deleteBlock: (id: string) => Promise<unknown>;
    getBlockDOM: (id: string) => Promise<{ id: string; dom: string } | null>;
    batchSetBlockAttrs: (
        blockAttrs: Array<{ id: string; attrs: Record<string, string | null> }>,
    ) => Promise<unknown>;
    createDocWithMd?: (notebook: string, docPath: string, markdown: string) => Promise<string>;
}

export interface DrBundleV2 {
    schemaVersion: 2;
    exportedAt: string;
    configuredSecretSlots: string[];
    pluginChecksums: Record<string, string>;
    refMapDigest: string;
    plugins: Record<string, unknown>;
    bundleSha256: string;
}

export interface DrDryRunPreview {
    valid: true;
    schemaVersion: 2;
    exportedAt: string;
    configuredSecretSlots: string[];
    pluginCount: number;
    pluginStats: Array<{
        pluginId: string;
        bundleRowCount: number | null;
        currentRowCount: number | null;
        rowCountDelta: number | null;
    }>;
    brokenRefs: Array<{
        pluginId: string;
        refType: "docId" | "avId" | "blockId";
        refId: string;
        reason: string;
    }>;
}

export class MigrationLockError extends Error {
    constructor(message: string) {
        super(`[MIGRATION-LOCK-BUSY] ${message}`);
        this.name = "MigrationLockError";
    }
}

export class MigrationManifestError extends Error {
    constructor(message: string) {
        super(`[MIGRATION-MANIFEST-FAIL-CLOSED] ${message}`);
        this.name = "MigrationManifestError";
    }
}

const ACTIVE_MIGRATION_STATES = new Set<MigrationState>([
    "PREFLIGHT_LOCK_CHECK",
    "BACKUP_CREATED",
    "DRY_RUN_PREVIEWED",
    "MIGRATING_CHUNK",
    "VERIFIED",
]);

const MIGRATION_WEB_LOCK_NAME = "xiaolv-home-migration-v2";
const activeInProcessMigrationPrefixes = new Set<string>();

function createUniqueLockToken(prefix: string): string {
    const clean = String(prefix || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const rand =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${clean}:${rand}`;
}

/**
 * 跨窗口 Web Locks（同源浏览器多页签/多窗口互斥）+ 单进程防重入守卫。
 * 注：跨物理机无服务端 CAS 时，受限于 SiYuan `/api/file/putFile` 语义，采用同源 Web Locks + 唯一 `lockToken` + fresh-read 双重防线。
 */
async function withMigrationExclusiveLock<T>(
    storagePrefix: string,
    mode: "migration" | "rollback",
    fn: () => Promise<T>,
): Promise<T> {
    const key = storagePrefix.replace(/\/+$/, "");
    const makeBusyError = (msg: string) =>
        mode === "rollback"
            ? new RollbackFailClosedError(`[MIGRATION-LOCK-BUSY] ${msg}`)
            : new MigrationLockError(msg);

    const runWithInProcessGuard = async (): Promise<T> => {
        if (activeInProcessMigrationPrefixes.has(key)) {
            throw makeBusyError("Another migration/rollback operation is already running in this JS context");
        }
        activeInProcessMigrationPrefixes.add(key);
        try {
            return await fn();
        } finally {
            activeInProcessMigrationPrefixes.delete(key);
        }
    };

    const navLocks =
        typeof navigator !== "undefined"
            ? (navigator as Navigator & {
                  locks?: {
                      request: <R>(
                          name: string,
                          options: { ifAvailable?: boolean },
                          cb: (lock: unknown | null) => Promise<R> | R,
                      ) => Promise<R>;
                  };
              }).locks
            : undefined;

    if (navLocks && typeof navLocks.request === "function") {
        return navLocks.request(MIGRATION_WEB_LOCK_NAME, { ifAvailable: true }, async (lock) => {
            if (!lock) {
                throw makeBusyError(
                    "Same-origin Web Lock (xiaolv-home-migration-v2) held by another window/instance",
                );
            }
            return runWithInProcessGuard();
        });
    }
    return runWithInProcessGuard();
}

export class MigrationReconcileError extends Error {
    constructor(message: string) {
        super(`[MIGRATION-RECONCILE-FAILED] ${message}`);
        this.name = "MigrationReconcileError";
    }
}

export class RollbackFailClosedError extends Error {
    constructor(message: string) {
        super(`[ROLLBACK-FAIL-CLOSED] ${message}`);
        this.name = "RollbackFailClosedError";
    }
}

export class DrFailClosedError extends Error {
    constructor(message: string) {
        super(`[DR-FAIL-CLOSED] ${message}`);
        this.name = "DrFailClosedError";
    }
}

export class DrSecretLeakError extends Error {
    constructor(message: string) {
        super(`[DR-SECURITY-LEAK] ${message}`);
        this.name = "DrSecretLeakError";
    }
}

export function createSiyuanMigrationTransport(plugin?: { data?: Record<string, unknown> }): SiyuanMigrationTransport {
    return {
        getFileText: async (filePath) => {
            if (plugin?.data) {
                const base = filePath.split("/").pop();
                if (base) delete plugin.data[base];
                const rel = filePath.replace(`${HOME_STORAGE_PREFIX}/`, "");
                delete plugin.data[rel];
            }
            return getFileText(filePath);
        },
        putFile: (filePath, contentString) => putFileText(filePath, contentString),
        sql: (stmt) => sql(stmt),
        appendBlock: (parentID, data) => appendBlockDom(parentID, data),
        deleteBlock: (id) => deleteBlock(id),
        getBlockDOM: (id) => getBlockDOM(id),
        batchSetBlockAttrs: (blockAttrs) => batchSetBlockAttrs(blockAttrs),
        createDocWithMd: (notebook, docPath, markdown) => createDocWithMd(notebook, docPath, markdown),
    };
}

export function deterministicLegacyEventId(row: MigrationRowInput): string {
    const sig = `${row.avId}|${row.rowId}|${row.kind}|${row.bizDate}|${row.recordedAt}|${row.idx}`;
    return `legacy-${sha256Hex(sig).slice(0, 16)}`;
}

export function deterministicMigrationBlockId(row: MigrationRowInput, tsPrefix = "20261124160000"): string {
    if (row.blockId) return row.blockId;
    const suffix = sha256Hex(deterministicLegacyEventId(row)).slice(0, 7);
    return `${tsPrefix}-${suffix}`;
}

function escapeHtmlTextNode(value: string): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * 保守计算块内容规范化结构指纹：
 * - 仅剥离 SiYuan 自动附加的节点级元数据包装（NodeList / NodeListItem / 单层 NodeParagraph + contenteditable / .protyle-attr / \u200b）；
 * - 完整保留所有行内格式标签（<strong>、<em>、<span>、<code>、<mark> 等）及多段/子块结构；
 * - 任何可见文本不变但格式/结构被用户修改的块，指纹必然不一致并受保护不被删除！
 */
export function computeCanonicalDomFingerprint(domHtml: string): {
    canonicalBody: string;
    hash: string;
    displayText: string;
} {
    const raw = String(domHtml || "").replace(/\u200b/g, "");
    const displayText = extractLiveTextFromDom(raw);

    // 剥离 protyle-attr 元数据徽章
    let inner = raw.replace(/<div\b[^>]*class="[^"]*protyle-attr[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "").trim();

    // 剥离可选的外层 NodeList 包装
    const listMatch = inner.match(/^<div\b[^>]*data-type="NodeList"[^>]*>([\s\S]*)<\/div>$/i);
    if (listMatch) inner = listMatch[1].trim();

    // 剥离 NodeListItem 包装
    const itemMatch = inner.match(/^<div\b[^>]*data-type="NodeListItem"[^>]*>([\s\S]*)<\/div>$/i);
    if (itemMatch) inner = itemMatch[1].trim();

    // 剥离单层 NodeParagraph 包装
    const paraMatch = inner.match(/^<div\b[^>]*data-type="NodeParagraph"[^>]*>([\s\S]*)<\/div>$/i);
    if (paraMatch && !/<div\b[^>]*data-type="Node/i.test(paraMatch[1])) {
        inner = paraMatch[1].trim();
    }

    // 剥离单个 contenteditable="true" 容器（仅当内部没有任何子标签且只有 1 个 contenteditable 块时视为纯文本）
    const ceMatches = [...inner.matchAll(/<div\b[^>]*contenteditable="true"[^>]*>([\s\S]*?)<\/div>/gi)];
    let canonicalBody = inner;
    if (ceMatches.length === 1 && ceMatches[0][0].trim() === inner.trim()) {
        const ceInner = ceMatches[0][1].trim();
        if (!/<[a-z!/]/i.test(ceInner)) {
            canonicalBody = ceInner
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();
        } else {
            // 包含 <strong> / <em> / <span> 等格式标签：绝不剥标签，保留完整内层 HTML 结构！
            canonicalBody = `__RICH__:${ceInner}`;
        }
    } else if (ceMatches.length > 0) {
        canonicalBody = `__STRUCT__:${inner}`;
    }

    return {
        canonicalBody,
        hash: sha256Hex(canonicalBody),
        displayText,
    };
}

export function buildMigratedDiaryItemDom(params: {
    blockId: string;
    eventId: string;
    row: MigrationRowInput;
    text?: string;
}): { text: string; textHash: string; dom: string } {
    const { blockId, eventId, row } = params;
    const text = params.text ?? `${row.bizDate} [${row.kind}] ${row.note} ¥${row.amount.toFixed(2)}`;
    const attrs: Record<string, string> = {
        "custom-lv-source": "siyuan-home",
        "custom-lv-schema": "home-event-v2",
        "custom-lv-idempotency": eventId,
        "custom-lv-event-id": eventId,
        "custom-lv-type": "event-log",
        ...(row.module ? { "custom-lv-module": row.module } : {}),
        ...(row.action ? { "custom-lv-action": row.action } : {}),
        "custom-lv-biz-date": row.bizDate,
        "custom-lv-recorded-at": row.recordedAt,
        "custom-lv-amount": row.amount.toFixed(2),
        "custom-lv-target": row.rowId,
        ...(row.extraAttrs || {}),
    };
    const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
        .join(" ");
    const dom = `<div data-type="NodeList" data-subtype="u"><div data-type="NodeListItem" data-subtype="u" data-node-id="${escapeXmlAttr(blockId)}" ${attrStr}><div data-type="NodeParagraph"><div contenteditable="true">${escapeHtmlTextNode(text)}</div></div></div></div>`;
    return {
        text,
        textHash: computeCanonicalDomFingerprint(dom).hash,
        dom,
    };
}

export class MigrationStorageStore {
    private transport: SiyuanMigrationTransport;
    private storagePrefix: string;
    private cache: Map<string, unknown>;

    constructor(transport: SiyuanMigrationTransport, storagePrefix = HOME_STORAGE_PREFIX) {
        this.transport = transport;
        this.storagePrefix = storagePrefix.replace(/\/+$/, "");
        this.cache = new Map();
    }

    async putJson(relPath: string, obj: unknown): Promise<{ str: string; sha256: string }> {
        const str = JSON.stringify(obj, null, 2);
        await this.transport.putFile(`${this.storagePrefix}/${relPath}`, str);
        this.cache.set(relPath, obj);
        return { str, sha256: sha256Hex(str) };
    }

    /** 遵守 B4：每次 loadData 前主动清缓存，强制从内核拉最新盘面 */
    async getJsonFresh<T = unknown>(relPath: string): Promise<{ obj: T; raw: string; sha256: string }> {
        this.cache.delete(relPath);
        const raw = await this.transport.getFileText(`${this.storagePrefix}/${relPath}`);
        const parsed = JSON.parse(raw) as T & { code?: number };
        if (parsed && typeof parsed === "object" && (parsed as { code?: number }).code === 404) {
            throw new Error(`File not found: ${relPath}`);
        }
        this.cache.set(relPath, parsed);
        return { obj: parsed as T, raw, sha256: sha256Hex(raw) };
    }
}

async function existsIdempotencyBlock(
    transport: SiyuanMigrationTransport,
    eventId: string,
    expectedBlockId: string,
): Promise<string | null> {
    if (expectedBlockId) {
        try {
            const dom = await transport.getBlockDOM(expectedBlockId);
            if (dom && dom.id === expectedBlockId) return expectedBlockId;
        } catch {}
    }
    const rows = await transport.sql(
        `SELECT b.id FROM attributes a JOIN blocks b ON b.id=a.block_id WHERE a.name='custom-lv-idempotency' AND a.value='${escapeSqlLiteral(eventId)}' LIMIT 1`,
    );
    if (!rows || rows.length === 0) return null;
    const candidateId = String(rows[0].id || "");
    if (!candidateId) return null;
    try {
        const dom = await transport.getBlockDOM(candidateId);
        if (dom && dom.id === candidateId) return candidateId;
    } catch {}
    return null;
}

/**
 * 显式 LIMIT Keyset 分页对账（规避 v3.8.12 /api/query/sql 默认 64 行截断）
 */
export async function reconcileMigratedBlocksPaginated(
    transport: SiyuanMigrationTransport,
    pageSize = 100,
): Promise<{ actualCount: number; actualTotalAmount: number; rows: Array<{ id: string; eventId: string; amount: string }> }> {
    const safeLimit = Math.max(1, Math.min(500, pageSize));
    const collected: Array<{ id: string; eventId: string; amount: string }> = [];
    let lastId = "";
    while (true) {
        const page = await transport.sql(
            `SELECT b.id, a_id.value AS eventId, a_amt.value AS amount
FROM attributes a_id
JOIN blocks b ON b.id=a_id.block_id
JOIN attributes a_amt ON a_amt.block_id=b.id AND a_amt.name='custom-lv-amount'
WHERE a_id.name='custom-lv-idempotency' AND b.id > '${escapeSqlLiteral(lastId)}'
ORDER BY b.id ASC
LIMIT ${safeLimit}`,
        );
        if (!page || page.length === 0) break;
        for (const r of page) {
            collected.push({
                id: String(r.id || ""),
                eventId: String(r.eventId || ""),
                amount: String(r.amount || "0"),
            });
        }
        const nextId = String(page[page.length - 1].id || "");
        if (!nextId || nextId === lastId || page.length < safeLimit) break;
        lastId = nextId;
    }
    const actualTotalAmount = Number(
        collected.reduce((s, r) => s + parseFloat(r.amount || "0"), 0).toFixed(2),
    );
    return { actualCount: collected.length, actualTotalAmount, rows: collected };
}

export async function runEightStateMigration(
    transport: SiyuanMigrationTransport,
    options: {
        storagePrefix?: string;
        deviceId: string;
        ensureDiaryDoc: (bizDate: string) => Promise<string>;
        backupFiles: Record<string, unknown>;
        rows: MigrationRowInput[];
        dryRunOnly?: boolean;
        leaseDurationMs?: number;
        nowMs?: number;
        reconcileMaxAttempts?: number;
        reconcilePollIntervalMs?: number;
        onBeforeChunkRow?: (info: { index: number; cursor: number; manifest: MigrationManifest }) => Promise<void> | void;
        onBeforeCursorPersist?: (info: { batchNum: number; endCursor: number; manifest: MigrationManifest }) => Promise<void> | void;
    },
): Promise<{
    action: "SKIP_ALREADY_V2" | "DRY_RUN_PREVIEWED" | "COMMITTED_SCHEMA_V2";
    manifest: MigrationManifest;
    skippedExistingCount: number;
    newlyWrittenCount: number;
    reconcile?: {
        expectedCount: number;
        actualCount: number;
        expectedTotalAmount: number;
        actualTotalAmount: number;
    };
}> {
    const resolvedPrefix = options.storagePrefix ?? HOME_STORAGE_PREFIX;
    return withMigrationExclusiveLock(resolvedPrefix, "migration", async () => {
    const store = new MigrationStorageStore(transport, options.storagePrefix);
    const currentNow = () => options.nowMs ?? Date.now();
    const now = currentNow();
    const leaseMs = options.leaseDurationMs ?? 120_000;
    const runToken = createUniqueLockToken(options.deviceId);

    let manifest: MigrationManifest;
    try {
        const fresh = await store.getJsonFresh<MigrationManifest>("migration-manifest.json");
        if (!fresh.obj || typeof fresh.obj !== "object" || Array.isArray(fresh.obj)) {
            throw new MigrationManifestError("migration-manifest.json is not a valid JSON object");
        }
        manifest = fresh.obj;
    } catch (err) {
        if (!isConfirmedFileNotFoundError(err)) {
            throw err instanceof MigrationManifestError
                ? err
                : new MigrationManifestError(
                    `Failed to read migration-manifest.json: ${err instanceof Error ? err.message : String(err)}`,
                );
        }
        manifest = {
            schemaVersion: 1,
            state: "IDLE",
            lockOwnerDeviceId: null,
            lockOwnerToken: null,
            lockLeaseExpiresAt: 0,
            cursor: 0,
            pendingCursor: null,
            migratedBlockIds: {},
            migratedBlockHashes: {},
            checksums: {},
            expectedTotals: {
                count: options.rows.length,
                totalAmount: Number(options.rows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
            },
        };
    }

    const hasForeignOrActiveLease = (m: MigrationManifest, checkAt: number): boolean => {
        if (!Number.isFinite(m.lockLeaseExpiresAt) || m.lockLeaseExpiresAt <= checkAt) return false;
        if (m.lockOwnerToken && m.lockOwnerToken !== runToken) return true;
        if (m.lockOwnerDeviceId && (m.lockOwnerToken !== runToken) && (ACTIVE_MIGRATION_STATES.has(m.state) || m.lockOwnerDeviceId === "rollback")) {
            return true;
        }
        return false;
    };

    if (hasForeignOrActiveLease(manifest, now)) {
        throw new MigrationLockError(
            `Migration lock held by device ${manifest.lockOwnerDeviceId ?? "unknown"} (token=${manifest.lockOwnerToken ?? "legacy"}) in state ${manifest.state} until ${new Date(manifest.lockLeaseExpiresAt).toISOString()}`,
        );
    }

    if (manifest.state === "COMMITTED_SCHEMA_V2") {
        return {
            action: "SKIP_ALREADY_V2",
            manifest,
            skippedExistingCount: 0,
            newlyWrittenCount: 0,
        };
    }

    const assertOwnedLeaseFresh = async (stage: string): Promise<MigrationManifest> => {
        const fresh = await store.getJsonFresh<MigrationManifest>("migration-manifest.json");
        const obj = fresh.obj;
        const checkNow = currentNow();
        if (
            !obj ||
            typeof obj !== "object" ||
            Array.isArray(obj) ||
            obj.lockOwnerDeviceId !== options.deviceId ||
            obj.lockOwnerToken !== runToken ||
            !Number.isFinite(obj.lockLeaseExpiresAt) ||
            obj.lockLeaseExpiresAt <= checkNow
        ) {
            throw new MigrationLockError(
                `Migration lock lost or expired at ${stage} (owner=${obj?.lockOwnerDeviceId ?? "none"}, token=${obj?.lockOwnerToken ?? "none"})`,
            );
        }
        return obj;
    };

    const acquireAndVerifyLease = async (nextState?: MigrationState): Promise<void> => {
        // 认领前再次确认无其他活跃租约，防止同 deviceId 第二实例或并发者抢占
        try {
            const preCheck = (await store.getJsonFresh<MigrationManifest>("migration-manifest.json")).obj;
            if (preCheck && typeof preCheck === "object" && hasForeignOrActiveLease(preCheck, currentNow())) {
                throw new MigrationLockError(
                    `Migration lock busy before acquire (owner=${preCheck.lockOwnerDeviceId ?? "none"}, token=${preCheck.lockOwnerToken ?? "none"})`,
                );
            }
        } catch (err) {
            if (err instanceof MigrationLockError) throw err;
            if (!isConfirmedFileNotFoundError(err)) throw err;
        }
        const leaseTs = currentNow() + leaseMs;
        if (nextState) manifest.state = nextState;
        manifest.lockOwnerDeviceId = options.deviceId;
        manifest.lockOwnerToken = runToken;
        manifest.lockLeaseExpiresAt = leaseTs;
        await store.putJson("migration-manifest.json", manifest);
        const confirmed = await assertOwnedLeaseFresh(`acquire-${manifest.state}`);
        if (confirmed.lockLeaseExpiresAt !== leaseTs || confirmed.lockOwnerToken !== runToken) {
            throw new MigrationLockError(
                `Migration lock lease mismatch after write: expectedToken=${runToken}, actualToken=${confirmed.lockOwnerToken ?? "none"}`,
            );
        }
    };

    let lockAcquired = false;
    if (manifest.state === "IDLE" || manifest.state === "ROLLBACK_RESTORED") {
        await acquireAndVerifyLease("PREFLIGHT_LOCK_CHECK");
        lockAcquired = true;
    } else {
        // 断点续跑或接管已过期租约：写入唯一 lockToken 并 fresh-read 确认归属后才可推进状态机
        await acquireAndVerifyLease();
        lockAcquired = true;
    }

    try {
        if (!manifest.checksums || Object.keys(manifest.checksums).length === 0 || manifest.state === "PREFLIGHT_LOCK_CHECK") {
            await assertOwnedLeaseFresh("before-backup");
            const checksums: Record<string, string> = {};
            for (const [fileName, data] of Object.entries(options.backupFiles)) {
                const bakName = fileName.endsWith(".migrated.bak") ? fileName : `${fileName}.migrated.bak`;
                const res = await store.putJson(bakName, data);
                checksums[bakName] = res.sha256;
            }
            manifest.checksums = checksums;
            manifest.expectedTotals = {
                count: options.rows.length,
                totalAmount: Number(options.rows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
            };
            manifest.cursor = 0;
            manifest.migratedBlockIds = {};
            manifest.migratedBlockHashes = {};
            manifest.state = "BACKUP_CREATED";
            await store.putJson("migration-manifest.json", manifest);
            await assertOwnedLeaseFresh("after-backup");
        }

        if (manifest.state === "BACKUP_CREATED") {
            await assertOwnedLeaseFresh("before-dry-run-preview");
            manifest.state = "DRY_RUN_PREVIEWED";
            await store.putJson("migration-manifest.json", manifest);
        }

        if (options.dryRunOnly) {
            manifest.lockOwnerDeviceId = null;
            manifest.lockOwnerToken = null;
            manifest.lockLeaseExpiresAt = 0;
            await store.putJson("migration-manifest.json", manifest);
            lockAcquired = false;
            return {
                action: "DRY_RUN_PREVIEWED",
                manifest,
                skippedExistingCount: 0,
                newlyWrittenCount: 0,
            };
        }

        await acquireAndVerifyLease("MIGRATING_CHUNK");
        lockAcquired = true;

        let batchNum = Math.floor(manifest.cursor / MIGRATION_BATCH_SIZE);
        let skippedExistingCount = 0;
        let newlyWrittenCount = 0;

        while (manifest.cursor < options.rows.length) {
            await assertOwnedLeaseFresh(`before-batch-${batchNum}`);

            const start = manifest.cursor;
            const end = Math.min(options.rows.length, start + MIGRATION_BATCH_SIZE);
            const batchRows = options.rows.slice(start, end);
            const deterministicIds = batchRows.map((r) => deterministicLegacyEventId(r));
            const candidates = batchRows.map((row, idx) => {
                const eventId = deterministicIds[idx];
                const blockId = deterministicMigrationBlockId(row);
                const built = buildMigratedDiaryItemDom({ blockId, eventId, row });
                return { eventId, blockId, textHash: built.textHash };
            });
            manifest.pendingCursor = { start, end, deterministicIds, candidates };
            await store.putJson("migration-manifest.json", manifest);
            await assertOwnedLeaseFresh(`after-pending-cursor-${batchNum}`);

            const legacyShard: Array<{ eventId: string; blockId: string; amount: number; bizDate: string }> = [];
            for (let offset = 0; offset < batchRows.length; offset++) {
                const i = start + offset;
                if (options.onBeforeChunkRow) {
                    await options.onBeforeChunkRow({ index: i, cursor: manifest.cursor, manifest });
                }
                const row = batchRows[offset];
                const eventId = deterministicIds[offset];
                const blockId = deterministicMigrationBlockId(row);
                const built = buildMigratedDiaryItemDom({ blockId, eventId, row });

                const existingId = await existsIdempotencyBlock(transport, eventId, blockId);
                if (existingId) {
                    skippedExistingCount++;
                    manifest.migratedBlockIds[eventId] = existingId;
                    manifest.migratedBlockHashes[eventId] = built.textHash;
                    legacyShard.push({ eventId, blockId: existingId, amount: row.amount, bizDate: row.bizDate });
                    continue;
                }

                const docId = await options.ensureDiaryDoc(row.bizDate);
                await transport.appendBlock(docId, built.dom, "dom");
                newlyWrittenCount++;
                manifest.migratedBlockIds[eventId] = blockId;
                manifest.migratedBlockHashes[eventId] = built.textHash;
                legacyShard.push({ eventId, blockId, amount: row.amount, bizDate: row.bizDate });
            }

            await store.putJson(`events/legacy-batch-${batchNum}.json`, legacyShard);

            if (options.onBeforeCursorPersist) {
                await options.onBeforeCursorPersist({ batchNum, endCursor: end, manifest });
            }

            await assertOwnedLeaseFresh(`before-cursor-persist-${batchNum}`);
            manifest.cursor = end;
            manifest.pendingCursor = null;
            manifest.lockLeaseExpiresAt = currentNow() + leaseMs;
            await store.putJson("migration-manifest.json", manifest);
            await assertOwnedLeaseFresh(`after-batch-${batchNum}`);
            batchNum++;
        }

        const maxAttempts = Math.max(1, options.reconcileMaxAttempts ?? 30);
        const pollIntervalMs = Math.max(10, options.reconcilePollIntervalMs ?? 200);
        let reconcile = await reconcileMigratedBlocksPaginated(transport, 100);
        for (let attempt = 1; attempt < maxAttempts; attempt++) {
            if (
                reconcile.actualCount >= manifest.expectedTotals.count &&
                reconcile.actualTotalAmount === manifest.expectedTotals.totalAmount
            ) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            reconcile = await reconcileMigratedBlocksPaginated(transport, 100);
        }
        if (
            reconcile.actualCount !== manifest.expectedTotals.count ||
            reconcile.actualTotalAmount !== manifest.expectedTotals.totalAmount
        ) {
            throw new MigrationReconcileError(
                `expected=${JSON.stringify(manifest.expectedTotals)}, actual=${reconcile.actualCount}/${reconcile.actualTotalAmount}`,
            );
        }

        await assertOwnedLeaseFresh("before-verified");
        manifest.state = "VERIFIED";
        await store.putJson("migration-manifest.json", manifest);
        await assertOwnedLeaseFresh("before-commit");

        manifest.schemaVersion = 2;
        manifest.state = "COMMITTED_SCHEMA_V2";
        manifest.committedByDeviceId = options.deviceId;
        manifest.committedAt = new Date(now).toISOString();
        manifest.lockOwnerDeviceId = null;
        manifest.lockOwnerToken = null;
        manifest.lockLeaseExpiresAt = 0;
        await store.putJson("migration-manifest.json", manifest);
        lockAcquired = false;

        return {
            action: "COMMITTED_SCHEMA_V2",
            manifest,
            skippedExistingCount,
            newlyWrittenCount,
            reconcile: {
                expectedCount: manifest.expectedTotals.count,
                actualCount: reconcile.actualCount,
                expectedTotalAmount: manifest.expectedTotals.totalAmount,
                actualTotalAmount: reconcile.actualTotalAmount,
            },
        };
    } catch (err) {
        if (lockAcquired && !(err instanceof MigrationLockError)) {
            try {
                const latest = (await store.getJsonFresh<MigrationManifest>("migration-manifest.json")).obj;
                if (latest && latest.lockOwnerToken === runToken) {
                    latest.lockOwnerDeviceId = null;
                    latest.lockOwnerToken = null;
                    latest.lockLeaseExpiresAt = 0;
                    await store.putJson("migration-manifest.json", latest);
                }
            } catch { /* preserve original error */ }
        }
        throw err;
    }
    });
}

/**
 * 30 天内 SHA-256 校验回滚，100% 保护用户手工编辑块（保留正文，仅剥离 custom-lv-idempotency）
 */
export async function rollbackFromMigration(
    transport: SiyuanMigrationTransport,
    options?: {
        storagePrefix?: string;
        retentionDays?: number;
        nowMs?: number;
        leaseDurationMs?: number;
        onBeforeDestructiveRollback?: () => Promise<void> | void;
    },
): Promise<{
    state: "ROLLBACK_RESTORED";
    deletedUnmodifiedCount: number;
    preservedUserEdited: Array<{ eventId: string; blockId: string; content: string }>;
    restoredFiles: string[];
}> {
    const resolvedPrefix = options?.storagePrefix ?? HOME_STORAGE_PREFIX;
    return withMigrationExclusiveLock(resolvedPrefix, "rollback", async () => {
    const store = new MigrationStorageStore(transport, options?.storagePrefix);
    const retentionDays = options?.retentionDays ?? DEFAULT_ROLLBACK_RETENTION_DAYS;
    const currentNow = () => options?.nowMs ?? Date.now();
    const now = currentNow();
    const leaseMs = options?.leaseDurationMs ?? 120_000;
    const rollbackToken = createUniqueLockToken("rollback");

    let manifest: MigrationManifest;
    try {
        const freshManifest = await store.getJsonFresh<MigrationManifest>("migration-manifest.json");
        if (!freshManifest.obj || typeof freshManifest.obj !== "object" || Array.isArray(freshManifest.obj)) {
            throw new RollbackFailClosedError("Invalid migration-manifest.json format");
        }
        manifest = freshManifest.obj;
    } catch (err) {
        if (err instanceof RollbackFailClosedError) throw err;
        throw new RollbackFailClosedError(`Missing or unreadable migration-manifest.json: ${(err as Error).message}`);
    }

    const assertNoActiveMigrationLease = (m: MigrationManifest, checkAt: number) => {
        if (!Number.isFinite(m.lockLeaseExpiresAt) || m.lockLeaseExpiresAt <= checkAt) return;
        if (m.lockOwnerToken && m.lockOwnerToken !== rollbackToken) {
            throw new RollbackFailClosedError(
                `[MIGRATION-LOCK-BUSY] Active migration/rollback lease held by ${m.lockOwnerDeviceId ?? "unknown"} (token=${m.lockOwnerToken}) in state ${m.state} until ${new Date(m.lockLeaseExpiresAt).toISOString()}`,
            );
        }
        if (m.lockOwnerDeviceId && m.lockOwnerToken !== rollbackToken && ACTIVE_MIGRATION_STATES.has(m.state)) {
            throw new RollbackFailClosedError(
                `[MIGRATION-LOCK-BUSY] Active migration lease held by device ${m.lockOwnerDeviceId} in state ${m.state} until ${new Date(m.lockLeaseExpiresAt).toISOString()}`,
            );
        }
    };
    assertNoActiveMigrationLease(manifest, now);

    if (manifest.committedAt) {
        const committedMs = Date.parse(manifest.committedAt);
        const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
        if (Number.isFinite(committedMs) && now - committedMs > maxAgeMs) {
            throw new RollbackFailClosedError(
                `Rollback window expired (> ${retentionDays} days since ${manifest.committedAt})`,
            );
        }
    }

    const checksumEntries = Object.entries(manifest.checksums || {});
    if (checksumEntries.length === 0) {
        throw new RollbackFailClosedError("No backup checksums recorded in manifest");
    }

    // 回滚自身认领互斥 lockToken 并 fresh-read 确认归属（保持原 state 不变直到校验全通过才提交 ROLLBACK_RESTORED）
    let rollbackLockAcquired = false;
    const rollbackLeaseTs = currentNow() + leaseMs;
    manifest.lockOwnerDeviceId = "rollback";
    manifest.lockOwnerToken = rollbackToken;
    manifest.lockLeaseExpiresAt = rollbackLeaseTs;
    await store.putJson("migration-manifest.json", manifest);
    const confirmedRollbackLock = (await store.getJsonFresh<MigrationManifest>("migration-manifest.json")).obj;
    if (
        !confirmedRollbackLock ||
        confirmedRollbackLock.lockOwnerToken !== rollbackToken ||
        confirmedRollbackLock.lockLeaseExpiresAt !== rollbackLeaseTs
    ) {
        throw new RollbackFailClosedError(
            `[MIGRATION-LOCK-BUSY] Rollback lock ownership verification failed (actualToken=${confirmedRollbackLock?.lockOwnerToken ?? "none"})`,
        );
    }
    rollbackLockAcquired = true;

    try {
    const assertOwnedRollbackLeaseFresh = async (stage: string) => {
        const recheck = (await store.getJsonFresh<MigrationManifest>("migration-manifest.json")).obj;
        const checkAt = currentNow();
        if (!recheck || typeof recheck !== "object") {
            throw new RollbackFailClosedError(`Missing manifest at rollback ${stage}`);
        }
        assertNoActiveMigrationLease(recheck, checkAt);
        if (
            recheck.lockOwnerToken !== rollbackToken ||
            !Number.isFinite(recheck.lockLeaseExpiresAt) ||
            recheck.lockLeaseExpiresAt <= checkAt
        ) {
            throw new RollbackFailClosedError(
                `[MIGRATION-LOCK-BUSY] Rollback lock lost or expired at ${stage} (actualToken=${recheck.lockOwnerToken ?? "none"})`,
            );
        }
    };

    const restoredPayloads: Record<string, unknown> = {};
    for (const [bakName, expectedSha] of checksumEntries) {
        let fresh: { obj: unknown; sha256: string };
        try {
            fresh = await store.getJsonFresh(bakName);
        } catch (err) {
            throw new RollbackFailClosedError(`Backup file missing (${bakName}): ${(err as Error).message}`);
        }
        if (fresh.sha256 !== expectedSha) {
            throw new RollbackFailClosedError(
                `Checksum mismatch for ${bakName}: expected ${expectedSha}, got ${fresh.sha256}`,
            );
        }
        restoredPayloads[bakName.replace(/\.migrated\.bak$/, "")] = fresh.obj;
    }

    let deletedUnmodifiedCount = 0;
    const preservedUserEdited: Array<{ eventId: string; blockId: string; content: string }> = [];
    const attrsToStrip: Array<{ id: string; attrs: Record<string, string | null> }> = [];

    const isConfirmedAbsentError = (err: unknown): boolean => {
        if (err instanceof KernelError) {
            return err.code === 404 || /not found|不存在/i.test(err.kernelMsg);
        }
        return false;
    };

    // 汇集所有待回滚候选块：1) manifest.migratedBlockIds；2) 未完成批次 pendingCursor.candidates/deterministicIds；3) SQL 中残留的 custom-lv-idempotency 块
    const candidateMap = new Map<string, { eventId: string; blockId: string; expectedHash?: string }>();
    for (const [eventId, blockId] of Object.entries(manifest.migratedBlockIds || {})) {
        if (!blockId) continue;
        candidateMap.set(blockId, {
            eventId,
            blockId,
            expectedHash: manifest.migratedBlockHashes?.[eventId],
        });
    }
    if (manifest.pendingCursor) {
        for (const cand of manifest.pendingCursor.candidates ?? []) {
            if (!cand.blockId || candidateMap.has(cand.blockId)) continue;
            candidateMap.set(cand.blockId, {
                eventId: cand.eventId,
                blockId: cand.blockId,
                expectedHash: cand.textHash,
            });
        }
        for (const eventId of manifest.pendingCursor.deterministicIds ?? []) {
            const alreadyMapped = [...candidateMap.values()].some((c) => c.eventId === eventId);
            if (alreadyMapped) continue;
            let sqlRows: Array<Record<string, unknown>>;
            try {
                sqlRows = await transport.sql(
                    `SELECT b.id FROM attributes a JOIN blocks b ON b.id=a.block_id WHERE a.name='custom-lv-idempotency' AND a.value='${escapeSqlLiteral(eventId)}' LIMIT 10`,
                );
            } catch (err) {
                throw new RollbackFailClosedError(
                    `SQL lookup failed for pending migration event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            for (const row of sqlRows ?? []) {
                const bid = String(row.id || "");
                if (bid && !candidateMap.has(bid)) {
                    candidateMap.set(bid, {
                        eventId,
                        blockId: bid,
                        expectedHash: manifest.migratedBlockHashes?.[eventId],
                    });
                }
            }
        }
    }
    let allIdempotencyRows: { rows: Array<{ id: string; eventId: string; amount: string }> };
    try {
        allIdempotencyRows = await reconcileMigratedBlocksPaginated(transport, 100);
    } catch (err) {
        throw new RollbackFailClosedError(
            `Failed to audit migrated blocks via SQL during rollback: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    for (const row of allIdempotencyRows.rows) {
        if (row.id && !candidateMap.has(row.id)) {
            candidateMap.set(row.id, {
                eventId: row.eventId,
                blockId: row.id,
                expectedHash: manifest.migratedBlockHashes?.[row.eventId],
            });
        }
    }

    if (options?.onBeforeDestructiveRollback) {
        await options.onBeforeDestructiveRollback();
    }

    // 执行破坏性回滚删块前再次 fresh-read 核验我方回滚 lockToken 仍有效
    await assertOwnedRollbackLeaseFresh("before-delete");

    for (const { eventId, blockId, expectedHash } of candidateMap.values()) {
        let domRes: { id: string; dom: string } | null = null;
        try {
            domRes = await transport.getBlockDOM(blockId);
        } catch (err) {
            if (!isConfirmedAbsentError(err)) {
                throw new RollbackFailClosedError(
                    `Live block DOM check failed for ${blockId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            domRes = null;
        }
        if (domRes === null || domRes === undefined) continue;
        if (
            typeof domRes !== "object" ||
            typeof domRes.id !== "string" ||
            !domRes.id ||
            domRes.id !== blockId ||
            typeof domRes.dom !== "string" ||
            !domRes.dom.trim()
        ) {
            throw new RollbackFailClosedError(
                `Live block DOM ID/payload mismatch: expected=${blockId}, actual=${String((domRes as any)?.id ?? "")}`,
            );
        }

        const { hash: currentHash, displayText: liveText } = computeCanonicalDomFingerprint(domRes.dom);

        if (expectedHash && currentHash === expectedHash) {
            await transport.deleteBlock(blockId);
            deletedUnmodifiedCount++;
        } else {
            attrsToStrip.push({
                id: blockId,
                attrs: { "custom-lv-idempotency": null },
            });
            preservedUserEdited.push({
                eventId,
                blockId,
                content: liveText,
            });
        }
    }

    if (attrsToStrip.length > 0) {
        await transport.batchSetBlockAttrs(attrsToStrip);
    }

    const restoredFiles: string[] = [];
    for (const [origName, data] of Object.entries(restoredPayloads)) {
        await store.putJson(origName, data);
        restoredFiles.push(origName);
    }

    await assertOwnedRollbackLeaseFresh("before-commit");
    manifest.schemaVersion = 1;
    manifest.state = "ROLLBACK_RESTORED";
    manifest.lockOwnerDeviceId = null;
    manifest.lockOwnerToken = null;
    manifest.lockLeaseExpiresAt = 0;
    manifest.pendingCursor = null;
    manifest.migratedBlockIds = {};
    manifest.migratedBlockHashes = {};
    manifest.rolledBackAt = new Date(now).toISOString();
    await store.putJson("migration-manifest.json", manifest);
    rollbackLockAcquired = false;

    return {
        state: "ROLLBACK_RESTORED",
        deletedUnmodifiedCount,
        preservedUserEdited,
        restoredFiles,
    };
    } catch (err) {
        if (rollbackLockAcquired) {
            try {
                const latest = (await store.getJsonFresh<MigrationManifest>("migration-manifest.json")).obj;
                if (latest && latest.lockOwnerToken === rollbackToken) {
                    latest.lockOwnerDeviceId = null;
                    latest.lockOwnerToken = null;
                    latest.lockLeaseExpiresAt = 0;
                    await store.putJson("migration-manifest.json", latest);
                }
            } catch { /* preserve original error */ }
        }
        throw err;
    }
    });
}

/** 将存量 rowlogs.json + hub-runtime.renewHistory 展平为确定性迁移行输入 */
export function extractLegacyMigrationRows(input: {
    rowlogs: RowLogs;
    settings?: HomeSettings;
    runtime?: HubRuntime;
}): MigrationRowInput[] {
    const out: MigrationRowInput[] = [];
    const dbRefs = input.settings?.dbRefs ?? {};
    const moduleByAvId = new Map<string, string>();
    for (const [modId, ref] of Object.entries(dbRefs)) {
        if (ref?.avId) moduleByAvId.set(ref.avId, modId);
    }

    for (const [key, grouped] of Object.entries(input.rowlogs ?? {})) {
        const sep = key.indexOf("|");
        if (sep <= 0 || !grouped || typeof grouped !== "object") continue;
        const avId = key.slice(0, sep);
        const rowId = key.slice(sep + 1);
        const modId = moduleByAvId.get(avId) || "general";

        for (const [kind, rawList] of Object.entries(grouped)) {
            if (!Array.isArray(rawList)) continue;
            rawList.forEach((raw: any, idx: number) => {
                if (!raw || typeof raw !== "object") return;
                if (raw.diaryEventId) return; // 已直接走 v2 日记信封的条目无需重复迁写
                const bizDate = String(raw.date || raw.at || "").slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return;
                const recordedAt = String(raw.at || `${bizDate}T00:00:00.000Z`);
                const rawAmount = Number(raw.totalCost ?? raw.cost ?? raw.amount ?? raw.price ?? 0);
                const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
                const note = String(raw.note ?? raw.title ?? raw.shop ?? raw.category ?? kind);
                out.push({
                    avId,
                    rowId,
                    kind,
                    bizDate,
                    recordedAt,
                    idx,
                    amount,
                    note,
                    module: modId,
                    action: kind,
                });
            });
        }
    }

    // 迁移 runtime.renewHistory -> certs renew 事件
    const certsAvId = dbRefs.certs?.avId ?? "certs";
    for (const [rowId, list] of Object.entries(input.runtime?.renewHistory ?? {})) {
        if (!Array.isArray(list)) continue;
        list.forEach((item, idx) => {
            const bizDate = String(item.at || item.to || "").slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return;
            out.push({
                avId: certsAvId,
                rowId,
                kind: "renew",
                bizDate,
                recordedAt: String(item.at || `${bizDate}T00:00:00.000Z`),
                idx,
                amount: 0,
                note: `证件续期 ${item.from} -> ${item.to}`,
                module: "certs",
                action: "renew",
                extraAttrs: {
                    "custom-lv-from-date": String(item.from || ""),
                    "custom-lv-to-date": String(item.to || ""),
                },
            });
        });
    }

    return out;
}

/** 一键在插件内执行完整 8 态迁移或 Dry-Run 预览 */
export async function executeHomeV2Migration(
    plugin: any,
    options?: { dryRunOnly?: boolean },
) {
    const transport = createSiyuanMigrationTransport(plugin);
    const { loadRowLogs } = await import("./rowlog");
    const rowlogs = await loadRowLogs(plugin);
    const rows = extractLegacyMigrationRows({
        rowlogs,
        settings: plugin.settings,
        runtime: plugin.runtime,
    });
    const deviceId = getOrCreateDeviceId();
    return runEightStateMigration(transport, {
        storagePrefix: HOME_STORAGE_PREFIX,
        deviceId,
        ensureDiaryDoc: async (bizDate) => {
            const { docId } = await resolveTargetDailyNoteDoc(bizDate, { createHistoryDiaryDoc: false });
            return docId;
        },
        backupFiles: {
            "rowlogs.json": rowlogs,
            "settings.json": plugin.settings ?? {},
            "hub-runtime.json": plugin.runtime ?? {},
        },
        rows,
        dryRunOnly: options?.dryRunOnly,
    });
}

/** 一键在 30 天内执行 SHA-256 校验回滚 */
export async function executeHomeV2Rollback(plugin: any) {
    const transport = createSiyuanMigrationTransport(plugin);
    return rollbackFromMigration(transport, { storagePrefix: HOME_STORAGE_PREFIX });
}

const SECRET_FIELD_NAME_REGEX = /api[-_]?key|fallback[-_]?key|token|secret|password|credential|private[-_]?key|webhookUrl|barkUrl/i;
const PLAINTEXT_SECRET_VALUE_REGEXES = [
    /sk-[A-Za-z0-9_-]{8,}/g,
    /Bearer\s+[A-Za-z0-9._-]{6,}/gi,
    /ghp_[A-Za-z0-9]{10,}/g,
    /xox[baprs]-[A-Za-z0-9-]{8,}/g,
    /https?:\/\/api\.day\.app\/[^\s"']+/gi,
];

export function sanitizeValueForDr(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
        let out = value;
        for (const rx of PLAINTEXT_SECRET_VALUE_REGEXES) {
            out = out.replace(rx, "[REDACTED_SECRET]");
        }
        return out;
    }
    if (Array.isArray(value)) return value.map((item) => sanitizeValueForDr(item));
    if (typeof value === "object") {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (SECRET_FIELD_NAME_REGEX.test(k)) continue;
            clean[k] = sanitizeValueForDr(v);
        }
        return clean;
    }
    return value;
}

export function scanForPlaintextSecrets(serializedJson: string, extraForbiddenPatterns: RegExp[] = []): string[] {
    const hits: string[] = [];
    for (const rx of [...PLAINTEXT_SECRET_VALUE_REGEXES, ...extraForbiddenPatterns]) {
        const cloned = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
        for (const m of serializedJson.matchAll(cloned)) {
            if (m[0]) hits.push(m[0]);
        }
    }
    return hits;
}

export async function exportDrBundleV2(
    transport: SiyuanMigrationTransport,
    options: {
        storagePrefix?: string;
        configuredSecretSlots: string[];
        plugins: Record<string, unknown>;
        refIds?: string[];
        flush?: () => Promise<void> | void;
        extraForbiddenPatterns?: RegExp[];
        saveToStorage?: boolean;
        nowIso?: string;
    },
): Promise<{ bundle: DrBundleV2; bundleJson: string }> {
    if (typeof options.flush === "function") await options.flush();
    const sanitizedPlugins: Record<string, unknown> = {};
    const pluginChecksums: Record<string, string> = {};
    for (const pluginId of Object.keys(options.plugins || {}).sort()) {
        const sanitized = sanitizeValueForDr(options.plugins[pluginId]);
        sanitizedPlugins[pluginId] = sanitized;
        pluginChecksums[pluginId] = sha256Hex(JSON.stringify(sanitized));
    }
    const refMapDigest = sha256Hex(JSON.stringify([...(options.refIds || [])].sort()));
    const corePayload = {
        schemaVersion: DR_BUNDLE_SCHEMA_VERSION as 2,
        exportedAt: options.nowIso || new Date().toISOString(),
        configuredSecretSlots: [...(options.configuredSecretSlots || [])],
        pluginChecksums,
        refMapDigest,
        plugins: sanitizedPlugins,
    };
    const bundleSha256 = sha256Hex(JSON.stringify(corePayload));
    const bundle: DrBundleV2 = { ...corePayload, bundleSha256 };
    const bundleJson = JSON.stringify(bundle, null, 2);
    const secretLeaks = scanForPlaintextSecrets(bundleJson, options.extraForbiddenPatterns);
    if (secretLeaks.length > 0) {
        throw new DrSecretLeakError(`Detected ${secretLeaks.length} plaintext secret pattern(s) in DR export; aborting`);
    }
    if (options.saveToStorage !== false) {
        const store = new MigrationStorageStore(transport, options.storagePrefix);
        await store.putJson("xiaolv-dr-bundle-v2.json", bundle);
    }
    return { bundle, bundleJson };
}

export function verifyDrBundleV2(rawJsonString: string): DrBundleV2 {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawJsonString) as Record<string, unknown>;
    } catch (err) {
        throw new DrFailClosedError(`Invalid DR JSON: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== DR_BUNDLE_SCHEMA_VERSION) {
        throw new DrFailClosedError("Unsupported or invalid DR bundle v2");
    }
    if (
        typeof parsed.bundleSha256 !== "string" ||
        !parsed.pluginChecksums ||
        typeof parsed.pluginChecksums !== "object" ||
        !parsed.plugins ||
        typeof parsed.plugins !== "object" ||
        !Array.isArray(parsed.configuredSecretSlots)
    ) {
        throw new DrFailClosedError("Missing required DR bundle v2 fields");
    }
    const { bundleSha256, ...coreWithoutSha } = parsed;
    const expectedOrderCore = {
        schemaVersion: coreWithoutSha.schemaVersion,
        exportedAt: coreWithoutSha.exportedAt,
        configuredSecretSlots: coreWithoutSha.configuredSecretSlots,
        pluginChecksums: coreWithoutSha.pluginChecksums,
        refMapDigest: coreWithoutSha.refMapDigest,
        plugins: coreWithoutSha.plugins,
    };
    const actualBundleSha = sha256Hex(JSON.stringify(expectedOrderCore));
    if (actualBundleSha !== bundleSha256) {
        throw new DrFailClosedError(`bundleSha256 mismatch: expected ${bundleSha256}, got ${actualBundleSha}`);
    }
    const checksums = parsed.pluginChecksums as Record<string, string>;
    const plugins = parsed.plugins as Record<string, unknown>;
    const checksumKeys = Object.keys(checksums).sort();
    const pluginKeys = Object.keys(plugins).sort();
    if (checksumKeys.length !== pluginKeys.length || checksumKeys.some((k, idx) => k !== pluginKeys[idx])) {
        throw new DrFailClosedError("Mismatch between pluginChecksums keys and plugins keys");
    }
    for (const pluginId of checksumKeys) {
        const expectedSha = checksums[pluginId];
        const actualSha = sha256Hex(JSON.stringify(plugins[pluginId]));
        if (actualSha !== expectedSha) {
            throw new DrFailClosedError(`Plugin checksum mismatch for "${pluginId}"`);
        }
    }
    return parsed as unknown as DrBundleV2;
}
