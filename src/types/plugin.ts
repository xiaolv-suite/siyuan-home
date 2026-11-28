/**
 * 面板侧插件接口（32 组 props any 清零）：
 * 各屏以结构性类型引用插件能力——LvHomePlugin 类实例天然满足（多余成员不影响）。
 * 数据边界：scan/reminders 为运行态 JSON（内核派生），rows/cells 维持宽类型并由
 * 21 组"SQL 结果类型化"逐模块收紧；本接口只约束面板与插件的契约面。
 */
import type { Plugin, JSONValue } from "siyuan";
import type { IHomeUIContext } from "./ui-context";

export * from "./ui-context";

export interface HomePluginLike extends Omit<Plugin, "i18n" | "name" | "saveData">, IHomeUIContext {
    i18n: Record<string, JSONValue>;
}
