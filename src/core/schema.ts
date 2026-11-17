/**
 * 字段字典与模块 Schema（docs/design/02 §2/§4）。
 * 字段字典列 key 一经发布即冻结：只增不改；模块私有列前缀 x_。
 */
import type { ReminderRuleSpec } from "@/types";

/** 思源数据库列类型（3.8.x） */
export type ColumnType =
    | "text" | "block" | "number" | "date"
    | "select" | "mSelect"
    | "url" | "email" | "phone"
    | "checkbox" | "asset" | "mAsset"
    | "relation" | "rollup"
    | "createdTime" | "updatedTime" | "line" | "template";

export interface ColumnDef {
    /** 字段字典 key（冻结）；思源列名用 i18n 渲染 */
    key: string;
    type: ColumnType;
    /** i18n 键：field.<key> */
    labelKey?: string;
    /** select 枚举（i18n 键：field.<key>.opt.<value>） */
    options?: string[];
    /** select 默认值（D11：显式声明，调整枚举顺序不改变新行状态；缺省 = options[0]） */
    default?: string;
    required?: boolean;
    /** 表单提示的 i18n 键；只在字段语义需要额外说明时配置。 */
    placeholderKey?: string;
    helpKey?: string;
    /** 数值字段的单位 i18n 键，例如元、公里、件。 */
    unitKey?: string;
    /** 表单数值边界；约束由业务字段显式声明，不对未知数字字段臆测范围。 */
    min?: number;
    max?: number;
    step?: number | "any";
    /** 视图默认宽度占比（相对） */
    width?: number;
}

export interface ViewDef {
    key: string;
    /** i18n 键：view.<module>.<key> */
    type: "table" | "gallery";
    /** 按 key 过滤/分组的声明式描述（provisioner 建视图用） */
    groupBy?: string;
    sortBy?: { key: string; asc: boolean };
}

export interface DocTemplate {
    key: string;
    /** 生成的文档名 i18n 键 */
    nameKey: string;
    /** 模板文件 public/templates/<module>/<key>.tpl */
    file: string;
}

export interface ModuleSchema {
    /** 台账数据库列（首列 name 自动） */
    columns: ColumnDef[];
    /** 快速录入列集（≤5，按序；docs/design/02 §4.1） */
    capture: string[];
    views?: ViewDef[];
    templates?: DocTemplate[];
    /** 参与提醒中枢的日期列声明（docs/design/03 §2） */
    reminders?: ReminderRuleSpec[];
    /** 活动时间线中的事项日期声明。禁止使用到期日、提醒日或其他预计日期。 */
    activity?: { dateField: string; detailFields?: string[] };
    /** 数值阈值规则（H15）：值列 ≤ 阈值列时生成即时提醒（如药品/囤货低库存）。
     * 语义定案：值 ≤ 阈值触发（降到阈值即提醒）；值或阈值缺列/缺值不提醒（0 算有值）；
     * 补货到阈值之上自动解除（每次扫描重算）；忽略/恢复由运行态 mute/restore 管理。 */
    numericRules?: NumericRuleSpec[];
}

/** 数值阈值规则声明（H15）：field=数量列，thresholdField=逐行阈值列 */
export interface NumericRuleSpec {
    key: string;
    field: string;
    thresholdField: string;
}

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
