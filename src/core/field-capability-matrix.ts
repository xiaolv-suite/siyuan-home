/**
 * 全生态 31 模块字段编辑与读写能力矩阵（Field Capability Matrix）
 * 明确区分：
 * - generic-form：通用详情编辑抽屉 / 快速表单可直接编辑（text / number / date / checkbox / select / mSelect / url）
 * - specialized：由专用业务交互面板处理（mAsset 附件拍照与OCR、member 成员关联芯片、certs.renewed_to 换证链）
 * - native-only：仅通过思源原生属性视图表格编辑
 */

import type { ColumnDef, ColumnType, ModuleSchema } from "./schema-types";
import { SCHEMA_CATALOG } from "./schema-catalog";

export type FieldEditCapability = "generic-form" | "specialized" | "native-only";

export const GENERIC_FORM_COLUMN_TYPES: ReadonlySet<string> = new Set([
    "text",
    "number",
    "date",
    "checkbox",
    "select",
    "mSelect",
    "url",
]);

const QUICK_CAPTURE_COLUMN_TYPES: ReadonlySet<string> = new Set([
    "text",
    "number",
    "date",
    "select",
    "relation",
    "url",
    "checkbox",
]);

const INLINE_EDIT_COLUMN_TYPES: ReadonlySet<string> = new Set([
    "text",
    "number",
    "date",
    "checkbox",
    "select",
    "url",
    "block",
]);

const CSV_IMPORT_COLUMN_TYPES: ReadonlySet<string> = new Set([
    "text",
    "number",
    "date",
    "checkbox",
    "select",
]);

export interface FieldCapabilityEntry {
    moduleId: string;
    colKey: string;
    type: ColumnType;
    editSurface: FieldEditCapability;
    specializedHandler?: string;
    supportsQuickCapture: boolean;
    supportsInlineEdit: boolean;
    supportsCsvImport: boolean;
    hasSelectOptions: boolean;
}

export interface ModuleFieldCapabilitySummary {
    moduleId: string;
    totalFields: number;
    genericFormCount: number;
    specializedCount: number;
    nativeOnlyCount: number;
    genericFormFields: string[];
    specializedFields: Array<{ key: string; type: ColumnType; handler: string }>;
    nativeOnlyFields: string[];
    fields: FieldCapabilityEntry[];
}

export function getFieldCapability(
    moduleId: string,
    col: Pick<ColumnDef, "key" | "type" | "options">,
): FieldCapabilityEntry {
    let editSurface: FieldEditCapability = "native-only";
    let specializedHandler: string | undefined;

    if (GENERIC_FORM_COLUMN_TYPES.has(col.type)) {
        editSurface = "generic-form";
    } else if (col.type === "mAsset") {
        editSurface = "specialized";
        specializedHandler = moduleId === "members" && col.key === "avatar"
            ? "members-avatar-picker"
            : "attachment-drawer";
    } else if (col.type === "relation" && col.key === "member") {
        editSurface = "specialized";
        specializedHandler = "member-relation-picker";
    } else if (col.type === "relation" && moduleId === "certs" && col.key === "renewed_to") {
        editSurface = "specialized";
        specializedHandler = "certs-renew-chain";
    } else {
        editSurface = "native-only";
        specializedHandler = "siyuan-native-av";
    }

    return {
        moduleId,
        colKey: col.key,
        type: col.type,
        editSurface,
        ...(specializedHandler ? { specializedHandler } : {}),
        supportsQuickCapture: QUICK_CAPTURE_COLUMN_TYPES.has(col.type) && !(col.type === "relation" && col.key !== "member"),
        supportsInlineEdit: INLINE_EDIT_COLUMN_TYPES.has(col.type),
        supportsCsvImport: CSV_IMPORT_COLUMN_TYPES.has(col.type),
        hasSelectOptions: (col.type === "select" || col.type === "mSelect") && Boolean(col.options?.length),
    };
}

export function summarizeModuleFieldCapabilities(
    moduleId: string,
    schema: Pick<ModuleSchema, "columns">,
): ModuleFieldCapabilitySummary {
    const fields = (schema.columns ?? []).map((col) => getFieldCapability(moduleId, col));
    const genericFormFields = fields.filter((f) => f.editSurface === "generic-form").map((f) => f.colKey);
    const specializedFields = fields
        .filter((f) => f.editSurface === "specialized")
        .map((f) => ({ key: f.colKey, type: f.type, handler: f.specializedHandler ?? "specialized" }));
    const nativeOnlyFields = fields.filter((f) => f.editSurface === "native-only").map((f) => f.colKey);

    return {
        moduleId,
        totalFields: fields.length,
        genericFormCount: genericFormFields.length,
        specializedCount: specializedFields.length,
        nativeOnlyCount: nativeOnlyFields.length,
        genericFormFields,
        specializedFields,
        nativeOnlyFields,
        fields,
    };
}

export function buildModuleFieldCapabilityMatrix(
    schemaCatalog: Record<string, Pick<ModuleSchema, "columns">> = SCHEMA_CATALOG,
): Record<string, ModuleFieldCapabilitySummary> {
    const out: Record<string, ModuleFieldCapabilitySummary> = {};
    for (const [moduleId, schema] of Object.entries(schemaCatalog)) {
        out[moduleId] = summarizeModuleFieldCapabilities(moduleId, schema);
    }
    return out;
}
