/**
 * 台账新增记录保存事务引擎
 * 封装列自愈、跨列字段转换、附件上传、身份悬决恢复与幂等创建
 * 解耦自 ledger-record-modal.svelte，实现表现层与事务持久化彻底分离
 */

import { addDetachedRow, setCell, RowIdentityPendingError, type DetachedRowIdentity } from "./siyuan";
import { selectCellValue } from "./avcell";
import { smartExtractFieldsFromTitle } from "./block-capture";

export function fileFingerprint(file: { name: string; size: number; lastModified?: number }): string {
    return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
}

export function convertFormCellValue(type: string, v: any, members?: any[]): unknown | null {
    switch (type) {
        case "select": return selectCellValue(v);
        case "relation": {
            const rawList: string[] = Array.isArray(v)
                ? v.map(String)
                : typeof v === "string" && v.includes(",")
                    ? v.split(",")
                    : typeof v === "string" && v.trim()
                        ? [v.trim()]
                        : [];
            const linkedIds = rawList
                .map((s) => s.trim())
                .filter((id) => id && (members ?? []).some((m) => m.avItemId === id || m.id === id))
                .map((id) => {
                    const m = (members ?? []).find((mem) => mem.avItemId === id || mem.id === id);
                    return m?.avItemId || id;
                });
            return linkedIds.length > 0 ? { type: "relation", relation: { blockIDs: linkedIds, contents: null } } : null;
        }
        case "date": return v === "" ? { type: "date", date: { isNotEmpty: false } } : { type: "date", date: { content: new Date(`${v}T00:00:00`).getTime(), isNotEmpty: true, isNotTime: true } };
        case "number": return v === "" || v === null ? { type: "number", number: { isNotEmpty: false } } : { type: "number", number: { content: Number(v), isNotEmpty: true } };
        case "url": return { type: "url", url: { content: v } };
        case "checkbox": return { type: "checkbox", checkbox: { checked: !!v } };
        default: return { type: "text", text: { content: String(v) } };
    }
}

export function smartExtractTitleFields(title: string, schemaCols: any[]): {
    cleanTitle: string;
    extractedDate?: string;
    extractedAmount?: number;
    dateColKey?: string;
    numColKey?: string;
} {
    if (!title || typeof title !== "string") return { cleanTitle: title };
    const res = smartExtractFieldsFromTitle(title);
    if (res.cleanTitle === title) return { cleanTitle: title };
    const dateCol = schemaCols.find((c) => c.type === "date" && ["expiry", "due", "date"].includes(c.key));
    const numCol = schemaCols.find((c) => c.type === "number" && ["amount", "price", "deposit"].includes(c.key));
    return {
        cleanTitle: res.cleanTitle,
        extractedDate: res.extractedDate,
        extractedAmount: res.extractedAmount,
        dateColKey: dateCol?.key,
        numColKey: numCol?.key,
    };
}

export interface SaveLedgerRecordOptions {
    plugin: any;
    active: string;
    ref: { avId: string; docId?: string; columns?: Record<string, string> };
    form: Record<string, any>;
    supportableCols: { key: string; type: string }[];
    certificateScalarCols?: { key: string; type: string }[];
    quickAssetCols?: { key: string; type: string; labelKey?: string }[];
    certificateFiles?: Record<string, File[]>;
    uploadedCertificateFiles?: Record<string, { name: string; content: string }[]>;
    missingSchemaCols?: any[];
    pendingItemID?: string | null;
    hadIdentityPending?: boolean;
    recordOperationKey?: string | null;
    rowIdentity?: DetachedRowIdentity;
    t: (k: string) => string;
}

export interface SaveLedgerRecordResult {
    success: boolean;
    itemID?: string;
    savedName: string;
    failedFields: string[];
    recordOperationKey: string;
    remainingFiles?: Record<string, File[]>;
    uploadedFiles?: Record<string, { name: string; content: string }[]>;
}

export async function executeLedgerRecordSave(options: SaveLedgerRecordOptions): Promise<SaveLedgerRecordResult> {
    const {
        plugin,
        active,
        ref,
        form,
        supportableCols,
        certificateScalarCols = [],
        quickAssetCols = [],
        certificateFiles = {},
        uploadedCertificateFiles = {},
        missingSchemaCols = [],
        pendingItemID: initialPendingID = null,
        hadIdentityPending = false,
        recordOperationKey: initialOpKey = null,
        rowIdentity,
        t,
    } = options;

    if (missingSchemaCols.length > 0 && ref.avId) {
        try { await plugin.repairModule?.(active); } catch { /* soft heal */ }
    }

    let recordOperationKey = initialOpKey;
    if (!recordOperationKey) {
        try { recordOperationKey = `ledger:${crypto.randomUUID()}`; }
        catch { recordOperationKey = `ledger:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    }

    let itemID = initialPendingID;
    // Legacy drafts without an operation witness cannot safely be adopted.
    if (!itemID && hadIdentityPending && !rowIdentity?.submitted) throw new RowIdentityPendingError([]);

    if (!itemID) {
        itemID = await addDetachedRow(ref.avId, String(form.name ?? "").trim() || t("ledger.unnamed"), {
            idempotencyKey: `${recordOperationKey}:row`,
            ...(rowIdentity ? { rowIdentity } : {}),
        });
    }

    const cols = plugin.settings?.dbRefs?.[active]?.columns ?? ref.columns ?? {};
    const failed: string[] = [];
    const members = plugin.settings?.members ?? [];

    const tryCell = async (label: string, colKey: string, keyId: string | undefined, value: unknown) => {
        if (value === null) { failed.push(label); return; }
        let currentKey = keyId;
        if (!currentKey) {
            try {
                const { healColumnMapping } = await import("./provisioner");
                currentKey = await healColumnMapping(plugin, active, colKey);
            } catch { /* soft */ }
        }
        if (!currentKey) { failed.push(label); return; }
        try {
            await setCell(ref.avId, currentKey, itemID!, value, {
                idempotencyKey: `${recordOperationKey}:cell:${colKey}`,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("key not found")) {
                try {
                    const { healColumnMapping } = await import("./provisioner");
                    const healedKey = await healColumnMapping(plugin, active, colKey);
                    if (healedKey && healedKey !== currentKey) {
                        try {
                            await setCell(ref.avId, healedKey, itemID!, value, {
                                idempotencyKey: `${recordOperationKey}:cell:${colKey}:healed`,
                            });
                            return;
                        } catch { /* soft */ }
                    }
                } catch { /* soft */ }
            }
            failed.push(label);
        }
    };

    for (const e of supportableCols) {
        const v = form[e.key];
        if (e.key !== "name" && (v === undefined || v === "" || v === false)) continue;
        if (e.key === "name" && !(v && String(v).trim()) && initialPendingID) continue;
        if (e.type === "number" && (v === undefined || isNaN(Number(v)))) continue;
        await tryCell(t(`field.${e.key}`), e.key, cols[e.key], convertFormCellValue(e.type, e.key === "name" ? String(v ?? "").trim() : v, members));
    }

    for (const e of certificateScalarCols) {
        const v = form[e.key];
        if (v === undefined || v === "" || v === false) continue;
        if (e.type === "number" && isNaN(Number(v))) continue;
        await tryCell(t(`field.${e.key}`), e.key, cols[e.key], convertFormCellValue(e.type, v, members));
    }

    const nextCertificateFiles = { ...certificateFiles };
    const nextUploadedFiles = { ...uploadedCertificateFiles };

    if (quickAssetCols.length > 0) {
        for (const target of quickAssetCols) {
            const previous = nextUploadedFiles[target.key] ?? [];
            const uploaded = [...previous];
            const failedFiles: File[] = [];
            if (!cols[target.key]) {
                failed.push(t(`field.${target.key}`));
                continue;
            }
            for (const file of nextCertificateFiles[target.key] ?? []) {
                try {
                    const { uploadAsset } = await import("./siyuan");
                    const { name, path } = await uploadAsset(file, "/assets/siyuan-home/", {
                        idempotencyKey: `${recordOperationKey}:asset:${target.key}:${fileFingerprint(file)}`,
                    });
                    uploaded.push({ name, content: path });
                } catch (e) {
                    failed.push(`${t(`field.${target.key}`)}: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
                    failedFiles.push(file);
                }
            }
            nextCertificateFiles[target.key] = failedFiles;
            if (uploaded.length === 0) continue;
            nextUploadedFiles[target.key] = uploaded;
            await tryCell(t(`field.${target.key}`), target.key, cols[target.key], {
                type: "mAsset",
                mAsset: uploaded.map(({ name, content }) => ({ name, content })),
            });
        }
    }

    const statusCol = (plugin.schemaCatalog?.[active]?.columns ?? []).find((c: any) => c.key === "status");
    if (statusCol?.options?.length && (form.status === undefined || form.status === "")) {
        await tryCell(t("field.status"), "status", cols.status, selectCellValue(statusCol.default ?? statusCol.options[0]));
    }

    const savedName = String(form.name ?? "").trim();
    return {
        success: failed.length === 0,
        itemID,
        savedName,
        failedFields: failed,
        recordOperationKey,
        remainingFiles: nextCertificateFiles,
        uploadedFiles: nextUploadedFiles,
    };
}
