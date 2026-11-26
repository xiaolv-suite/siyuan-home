/**
 * 字段字典与模块 Schema（docs/design/02 §2/§4）。
 * 字段字典列 key 一经发布即冻结：只增不改；模块私有列前缀 x_。
 */
import type { ModuleSchema } from "./schema-types";
export * from "./schema-types";

export * from "./schema-catalog";

/**
 * 证件分类与细分画像档案（解耦至 certificate-profiles.ts）
 */
export {
    CERTIFICATE_CATEGORY_OPTIONS,
    type CertificateCategory,
    type CertificateProfile,
    CERTIFICATE_PROFILES,
    getCertificateProfile,
    getCertificateReminderField,
} from "./certificate-profiles";

// ── schema 契约校验（33.2 门禁）─────────────────────────────

/** 契约：capture/views/reminders 引用的列必须都在 columns 中；违规时开发期抛错。 */
export function validateSchema(id: string, schema: ModuleSchema): string[] {
    const keys = new Set(schema.columns.map((c) => c.key));
    const errors: string[] = [];
    // D11：重复列 key（建列映射会互相覆盖）
    const seen = new Set<string>();
    for (const c of schema.columns) {
        if (seen.has(c.key)) errors.push(`[${id}] 重复列 key "${c.key}"`);
        seen.add(c.key);
    }
    // D11：capture ≤5（02 §4.1 快速录入上限）
    if ((schema.capture ?? []).length > 5) errors.push(`[${id}] capture 超过 5 列（02 §4.1）`);
    if (!schema.capture?.length) errors.push(`[${id}] 必须明确声明快速录入字段`);
    if (schema.capture?.[0] !== "name") errors.push(`[${id}] 快速录入首字段必须是 name`);
    const captureSeen = new Set<string>();
    for (const k of schema.capture ?? []) {
        if (!keys.has(k)) errors.push(`[${id}] capture 引用未知列 "${k}"`);
        if (captureSeen.has(k)) errors.push(`[${id}] capture 重复字段 "${k}"`);
        captureSeen.add(k);
    }
    for (const v of schema.views ?? []) {
        if (v.groupBy && !keys.has(v.groupBy)) errors.push(`[${id}] view ${v.key} groupBy 未知列 "${v.groupBy}"`);
        if (v.sortBy && !keys.has(v.sortBy.key)) errors.push(`[${id}] view ${v.key} sortBy 未知列 "${v.sortBy.key}"`);
    }
    for (const r of schema.reminders ?? []) {
        if (!keys.has(r.field)) errors.push(`[${id}] reminder ${r.key} field 未知列 "${r.field}"`);
        if (r.cycleField && !keys.has(r.cycleField)) errors.push(`[${id}] reminder ${r.key} cycleField 未知列`);
        if (r.lunarField && !keys.has(r.lunarField)) errors.push(`[${id}] reminder ${r.key} lunarField 未知列`);
    }
    const byKey = new Map(schema.columns.map((c) => [c.key, c]));
    if (schema.activity) {
        const activityDate = byKey.get(schema.activity.dateField);
        if (!activityDate) errors.push(`[${id}] activity.dateField 未知列 "${schema.activity.dateField}"`);
        else if (activityDate.type !== "date") errors.push(`[${id}] activity.dateField "${schema.activity.dateField}" 必须是 date 列`);
        for (const key of schema.activity.detailFields ?? []) {
            if (!keys.has(key)) errors.push(`[${id}] activity.detailFields 引用未知列 "${key}"`);
        }
    }
    // D11：数值阈值规则的两列必须存在且为 number 类型（阈值语义依赖数值比较）
    for (const n of schema.numericRules ?? []) {
        const f = byKey.get(n.field);
        const th = byKey.get(n.thresholdField);
        if (!f) errors.push(`[${id}] numericRule ${n.key} field 未知列 "${n.field}"`);
        else if (f.type !== "number") errors.push(`[${id}] numericRule ${n.key} field "${n.field}" 非number列`);
        if (!th) errors.push(`[${id}] numericRule ${n.key} thresholdField 未知列 "${n.thresholdField}"`);
        else if (th.type !== "number") errors.push(`[${id}] numericRule ${n.key} thresholdField "${n.thresholdField}" 非number列`);
    }
    // D11：select 默认值必须命中枚举（显式声明的默认不随枚举顺序漂移）
    for (const c of schema.columns) {
        if (c.default !== undefined && !(c.options ?? []).includes(c.default)) {
            errors.push(`[${id}] 列 "${c.key}" default "${c.default}" 不在 options 内`);
        }
        if (c.type !== "number" && (c.min !== undefined || c.max !== undefined || c.step !== undefined)) {
            errors.push(`[${id}] 非数值列 "${c.key}" 不能声明数值边界`);
        }
        if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
            errors.push(`[${id}] 列 "${c.key}" min 大于 max`);
        }
        if (typeof c.step === "number" && c.step <= 0) {
            errors.push(`[${id}] 列 "${c.key}" step 必须大于 0`);
        }
    }
    return errors;
}


/** 列类型白名单（192 波 E14 教训：内核不支持的类型会让该模块建库失败）。
 * 活体 IT-12 以真机核验本清单；schema 声明新类型前必须先入白名单并过 IT-12。
 * mSelect（FIELD_DICT.tags）193 波 IT-12 真机核验通过。 */
export const KERNEL_COLUMN_TYPES: ReadonlySet<string> = new Set([
    "text", "number", "date", "select", "mSelect", "checkbox", "url", "relation", "mAsset",
]);
