/**
 * 台账录入模态框视图数据计算与校验引擎（ledger-record-view-model）：
 * 集中解耦表单输入有效性判断、证件扩展标量与资产列推导、分类切换草稿保护与字段级错误提示。
 */
import { getCertificateReminderField, type ColumnDef } from "@/core/schema";
import { validateCaptureInput } from "@/core/capture";

/** 推导证件类型下的扩展标量字段清单 */
export function getCertificateScalarCols(
    schemaColsLocal: any[] | undefined,
    certificateProfile: { category: string; fieldKeys: readonly string[] } | null,
): { key: string; type: string; options?: string[] }[] {
    if (!certificateProfile) return [];
    const cols = schemaColsLocal ?? [];
    const keys = new Set([
        "x_cert_holder_name",
        "holder_no",
        "x_cert_id_number",
        "issue_date",
        "x_cert_valid_from",
        "issuance_rule",
        "store_place",
        "location",
        "copy_location",
        "note",
        ...certificateProfile.fieldKeys,
    ]);
    if (!getCertificateReminderField(certificateProfile.category)) keys.add("due");
    if (certificateProfile.category === "id") keys.delete("holder_no");
    return cols
        .filter((col: any) => keys.has(col.key) && col.type !== "mAsset")
        .map((col: any) => ({ key: col.key, type: col.type, options: col.options }));
}

/** 推导快速附件/证件照上传插槽列清单 */
export function getQuickAssetCols(
    schemaCols: ColumnDef[] | undefined,
    certificateProfile: { columns: readonly ColumnDef[] } | null,
    active: string,
): { key: string; type: string; labelKey?: string }[] {
    const cols = schemaCols ?? [];
    const certAssetCols = active === "certs"
        ? [
            ...cols.filter((col) => col.key === "attachments" && col.type === "mAsset"),
            ...(certificateProfile?.columns.filter((col) => col.type === "mAsset") ?? []),
        ]
        : [];
    const seen = new Set<string>();
    const out: { key: string; type: string; labelKey?: string }[] = [];
    const genericAssetCols = cols.filter((entry) => entry.type === "mAsset" && !entry.key.startsWith("x_cert_"));
    for (const col of [...genericAssetCols, ...certAssetCols]) {
        if (seen.has(col.key)) continue;
        seen.add(col.key);
        out.push({ key: col.key, type: "mAsset", labelKey: col.labelKey });
    }
    return out;
}

/** 检查表单是否存在用户已录入内容 */
export function hasAnyFormInput(
    supportableCols: ColumnDef[],
    certificateScalarCols: { key: string }[],
    quickAssetCols: { key: string }[],
    form: Record<string, any>,
    certificateFiles: Record<string, File[]>,
    uploadedCertificateFiles: Record<string, any[]>,
): boolean {
    const inSupportable = supportableCols.some((e) => {
        const v = form[e.key];
        return e.key === "name" ? !!(v && String(v).trim()) : v !== undefined && v !== "" && v !== false;
    });
    if (inSupportable) return true;
    const inScalar = certificateScalarCols.some((e) => form[e.key] !== undefined && form[e.key] !== "" && form[e.key] !== false);
    if (inScalar) return true;
    const inAssets = quickAssetCols.some((e) => (certificateFiles[e.key]?.length ?? 0) > 0 || (uploadedCertificateFiles[e.key]?.length ?? 0) > 0);
    return inAssets;
}

/** 提交按钮可点状态门禁校验 */
export function canSubmitRecord(
    saving: boolean,
    formName: any,
    hasInput: boolean,
    active: string,
    formCategory: any,
): boolean {
    if (saving) return false;
    const nameMissing = hasInput && !(formName && String(formName).trim());
    if (nameMissing) return false;
    if (active === "certs" && !formCategory) return false;
    return true;
}

/** 切换证件分类时的草稿拦截与保留字段重构 */
export function prepareCategoryChange(
    category: string,
    lastCategory: string,
    hasDraft: boolean,
    currentForm: Record<string, any>,
    currentFiles: Record<string, File[]>,
    currentUploaded: Record<string, any[]>,
): {
    blocked: boolean;
    newForm?: Record<string, any>;
    newFiles?: Record<string, File[]>;
    newUploaded?: Record<string, any[]>;
} {
    if (lastCategory && category !== lastCategory && hasDraft) {
        return { blocked: true };
    }
    const keep = new Set([
        "name", "member", "expiry", "status",
        "x_cert_holder_name", "holder_no", "issue_date",
        "x_cert_valid_from", "issuance_rule", "store_place",
        "location", "copy_location", "note",
    ]);
    const newForm = {
        ...Object.fromEntries(Object.entries(currentForm).filter(([key]) => keep.has(key))),
        category,
    };
    const newFiles = Object.fromEntries(Object.entries(currentFiles).filter(([key]) => key === "attachments"));
    const newUploaded = Object.fromEntries(Object.entries(currentUploaded).filter(([key]) => key === "attachments"));
    return { blocked: false, newForm, newFiles, newUploaded };
}

/** 字段级数据输入校验 */
export function validateFieldInput(
    field: ColumnDef,
    val: any,
    members: any[] | undefined,
    t: (k: string) => string,
): string {
    const issue = validateCaptureInput(field, val);
    if (issue) {
        const fieldName = t(`field.${field.key}`) !== `field.${field.key}` ? t(`field.${field.key}`) : field.key;
        return t(`capture.validation.${issue}`)
            .replace("${field}", fieldName)
            .replace("${min}", String(field.min ?? ""))
            .replace("${max}", String(field.max ?? ""));
    }
    if (field.type === "relation") {
        const relationIDs: string[] = Array.isArray(val)
            ? val.map(String)
            : typeof val === "string" && val
                ? (val.includes(",") ? val.split(",") : [val])
                : [];
        const hasStale = relationIDs.some((id) => id.trim() && !(members ?? []).some((m) => m.avItemId === id.trim() || m.id === id.trim()));
        if (hasStale) {
            return t("members.notLinked");
        }
    }
    return "";
}
