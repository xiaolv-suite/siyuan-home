/**
 * 字段字典与模块 Schema 核心类型契约 (SchemaTypes)
 * 下沉纯类型定义，解耦 schema.ts、schema-catalog.ts 与 certificate-profiles.ts 之间的循环依赖。
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

/** 数值阈值规则声明（H15）：field=数量列，thresholdField=逐行阈值列 */
export interface NumericRuleSpec {
    key: string;
    field: string;
    thresholdField: string;
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
