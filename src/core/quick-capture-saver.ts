import { showMessage } from "siyuan";
import { addDetachedRow, setCell, RowIdentityPendingError, type DetachedRowIdentity } from "@/core/siyuan";
import { saveRuntime } from "@/core/hub/runtime";
import { captureCellValue, validateCaptureInput } from "@/core/capture";
import type { ColumnDef } from "@/core/schema";

export interface ExecuteQuickCaptureSaveOptions {
    plugin: any;
    moduleId: string;
    values: Record<string, any>;
    captureFields: ColumnDef[];
    pendingRowId?: string;
    pendingModuleId?: string;
    hadIdentityPending?: boolean;
    saveOperationKey: string;
    rowIdentity?: DetachedRowIdentity;
    t: (k: string) => string;
    fieldLabel: (field: ColumnDef) => string;
    modLabel: (mod: string) => string;
    ensureTargetRef: (mod: string) => Promise<any>;
}

export interface QuickCaptureSaveResult {
    success: boolean;
    pendingRowId?: string;
    pendingModuleId?: string;
    identityPending?: boolean;
    fieldErrors?: Record<string, string>;
    error?: string;
    focusFieldKey?: string;
}

function validationMessage(field: ColumnDef, issue: string, t: (k: string) => string, fieldLabel: (f: ColumnDef) => string): string {
    const key = `capture.validation.${issue}`;
    return t(key)
        .replace("${field}", fieldLabel(field))
        .replace("${min}", String(field.min ?? ""))
        .replace("${max}", String(field.max ?? ""));
}

/**
 * 快速记录提交事务保存引擎
 * 封装字段校验、属性视图建行、幽灵列自愈、重试落盘与运行态刷新
 */
export async function executeQuickCaptureSave(options: ExecuteQuickCaptureSaveOptions): Promise<QuickCaptureSaveResult> {
    const {
        plugin,
        moduleId,
        values,
        captureFields,
        pendingRowId,
        pendingModuleId,
        hadIdentityPending,
        saveOperationKey,
        rowIdentity,
        t,
        fieldLabel,
        modLabel,
        ensureTargetRef,
    } = options;

    const title = String(values.name ?? "").trim();

    // 字段格式与必填校验
    for (const field of captureFields) {
        const issue = validateCaptureInput(field, values[field.key]);
        const rawRel = values[field.key];
        const relationIDs: string[] = field.type === "relation"
            ? (Array.isArray(rawRel) ? rawRel.map(String) : typeof rawRel === "string" && rawRel ? (rawRel.includes(",") ? rawRel.split(",") : [rawRel]) : [])
            : [];
        const staleRelation = relationIDs.some((id) => id.trim() && !(plugin.settings?.members ?? []).some((m: any) => m.avItemId === id.trim() || m.id === id.trim()));
        if (!issue && !staleRelation) continue;
        const message = staleRelation ? t("members.notLinked") : validationMessage(field, issue!, t, fieldLabel);
        return {
            success: false,
            fieldErrors: { [field.key]: message },
            error: message,
            focusFieldKey: field.key,
        };
    }

    if (pendingRowId && pendingModuleId !== moduleId) {
        return {
            success: false,
            error: t("capture.pendingTarget"),
        };
    }

    let r = await ensureTargetRef(moduleId);
    let missingColumn = captureFields.find((field) => {
        const value = values[field.key];
        const hasValue = field.key === "name" || (value !== undefined && value !== null && value !== "" && value !== false);
        return field.key !== "name" && hasValue && !r.columns?.[field.key];
    });

    if (missingColumn) {
        try {
            await plugin.repairModule?.(moduleId);
            r = plugin.settings?.dbRefs?.[moduleId] ?? r;
        } catch { /* soft heal */ }
        missingColumn = captureFields.find((field) => {
            const value = values[field.key];
            const hasValue = field.key === "name" || (value !== undefined && value !== null && value !== "" && value !== false);
            return field.key !== "name" && hasValue && !r.columns?.[field.key];
        });
        if (missingColumn) {
            return {
                success: false,
                error: t("capture.missingColumn").replace("${field}", fieldLabel(missingColumn)),
            };
        }
    }

    // 成员关联校验
    for (const f of captureFields as { key: string; type: string }[]) {
        if (f.type !== "relation") continue;
        const rawRel = values[f.key];
        const relationIDs: string[] = Array.isArray(rawRel) ? rawRel.map(String) : typeof rawRel === "string" && rawRel ? (rawRel.includes(",") ? rawRel.split(",") : [rawRel]) : [];
        const hasStale = relationIDs.some((id) => id.trim() && !(plugin.settings?.members ?? []).some((m: any) => m.avItemId === id.trim() || m.id === id.trim()));
        if (hasStale) {
            const saveError = t("members.notLinked");
            return {
                success: false,
                fieldErrors: { [f.key]: saveError },
                error: saveError,
                focusFieldKey: f.key,
            };
        }
    }

    let itemID = pendingRowId;
    if (!itemID) {
        try {
            if (hadIdentityPending && !rowIdentity?.submitted) throw new RowIdentityPendingError([]);
            itemID = await addDetachedRow(r.avId, title, {
                idempotencyKey: `${saveOperationKey}:row`,
                ...(rowIdentity ? { rowIdentity } : {}),
            });
        } catch (e) {
            if (e instanceof RowIdentityPendingError) {
                return {
                    success: false,
                    identityPending: true,
                    pendingModuleId: moduleId,
                    error: t("capture.identityPending").replace("${module}", modLabel(moduleId)),
                };
            }
            throw e;
        }
    }

    const setCellSafe = async (key: string, value: unknown) => {
        let keyID = r.columns?.[key];
        if (!keyID) {
            try {
                const { healColumnMapping } = await import("@/core/provisioner");
                keyID = await healColumnMapping(plugin, moduleId, key);
            } catch { /* soft */ }
        }
        if (!keyID) throw new Error(t("capture.missingColumn").replace("${field}", fieldLabel(captureFields.find((field) => field.key === key) ?? { key, type: "text" })));
        for (let attempt = 0; ; attempt++) {
            try {
                await setCell(r.avId, keyID, itemID!, value, { idempotencyKey: `${saveOperationKey}:cell:${key}` });
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("key not found")) {
                    try {
                        const { healColumnMapping } = await import("@/core/provisioner");
                        const healedId = await healColumnMapping(plugin, moduleId, key);
                        if (healedId && healedId !== keyID) {
                            keyID = healedId;
                            continue;
                        }
                    } catch { /* soft */ }
                }
                if (attempt >= 2) throw err;
                await new Promise((res) => setTimeout(res, 400));
            }
        }
    };

    if (r.columns?.["name"]) {
        await setCellSafe("name", { type: "text", text: { content: title } });
    }
    for (const f of captureFields) {
        if (f.key === "name") continue;
        const v = values[f.key];
        if (v === undefined || v === null || (v === "" && f.type !== "checkbox")) continue;
        const cell = captureCellValue(f, v);
        if (cell !== undefined) await setCellSafe(f.key, cell);
    }

    // 运行态偏好保存
    const previousQuickModule = plugin.runtime?.hubQuickModule;
    try {
        if (plugin.runtime) {
            plugin.runtime.hubQuickModule = moduleId;
            await saveRuntime(plugin, plugin.runtime);
        }
    } catch (e) {
        if (plugin.runtime) plugin.runtime.hubQuickModule = previousQuickModule;
        showMessage(t("capture.preferenceSaveFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }

    let refreshFailed = false;
    try {
        await plugin.refreshHub?.(undefined, true);
    } catch (e) {
        refreshFailed = true;
        console.warn("[LvHome] quick capture saved but refresh failed:", e);
        showMessage(t("capture.savedRefreshFailed").replace("${module}", modLabel(moduleId)), 5000, "error");
    }

    if (!refreshFailed) {
        showMessage(t("capture.saved").replace("${module}", modLabel(moduleId)), 3000, "info");
    }

    return {
        success: true,
        pendingRowId: itemID,
    };
}
