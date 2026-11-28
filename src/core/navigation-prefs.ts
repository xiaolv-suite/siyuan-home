import type { HomeModule, HomeSettings, ModuleGroupId } from "@/types";
import { BUILT_IN_MODULES, MODULE_GROUPS, getModule } from "./modules";

/** 默认推荐置顶的常用高频台账（对齐「风格 A · 石墨清雾」三层减负规范） */
export const DEFAULT_PINNED_MODULES: readonly string[] = [
    "certs",
    "insurance",
    "assets-real",
    "memberships",
    "vehicles",
];

/** 当默认置顶模块未全部启用时的替补顺序 */
const FALLBACK_PINNED_PRIORITY: readonly string[] = [
    "medicine",
    "house",
    "contracts",
    "health",
    "chores",
    "stock",
    "shopping",
    "favors",
    "parenting",
    "schooling",
];

/**
 * 解析当前应显示在「我的常用」区域的台账 ID 列表：
 * - 若用户已显式自定义（settings.pinnedLedgers 为数组），严格按其配置并过滤掉已关闭模块；
 * - 若尚未自定义（undefined），优先按 DEFAULT_PINNED_MODULES 取已启用项，不足 4 项时从替补高优中补齐（最多 5 项）。
 */
export function resolvePinnedLedgers(
    settings: Pick<HomeSettings, "pinnedLedgers" | "enabledModules">,
    visibleEnabledIds?: readonly string[],
): string[] {
    const enabledSource = visibleEnabledIds ?? settings.enabledModules ?? [];
    const enabledSet = new Set(
        enabledSource.filter((id) => id !== "members" && id !== "adhoc" && !!getModule(id)),
    );

    if (Array.isArray(settings.pinnedLedgers)) {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of settings.pinnedLedgers) {
            if (enabledSet.has(id) && !seen.has(id)) {
                seen.add(id);
                out.push(id);
            }
        }
        return out;
    }

    const picked: string[] = [];
    const seen = new Set<string>();
    for (const id of DEFAULT_PINNED_MODULES) {
        if (enabledSet.has(id) && !seen.has(id)) {
            seen.add(id);
            picked.push(id);
        }
    }
    if (picked.length < 4) {
        for (const id of [...FALLBACK_PINNED_PRIORITY, ...enabledSet]) {
            if (picked.length >= 5) break;
            if (enabledSet.has(id) && !seen.has(id)) {
                seen.add(id);
                picked.push(id);
            }
        }
    }
    return picked;
}

export function isLedgerPinned(
    settings: Pick<HomeSettings, "pinnedLedgers" | "enabledModules">,
    moduleId: string,
    visibleEnabledIds?: readonly string[],
): boolean {
    return resolvePinnedLedgers(settings, visibleEnabledIds).includes(moduleId);
}

/**
 * 切换台账的「我的常用」置顶状态（幂等初始化 pinnedLedgers 后增删）。
 */
export function togglePinnedLedger(settings: HomeSettings, moduleId: string): string[] {
    const mod = getModule(moduleId);
    if (!mod || mod.alwaysOn || moduleId === "members") {
        return resolvePinnedLedgers(settings);
    }
    const base = Array.isArray(settings.pinnedLedgers)
        ? [...settings.pinnedLedgers]
        : resolvePinnedLedgers(settings);
    const exists = base.includes(moduleId);
    const next = exists ? base.filter((id) => id !== moduleId) : [...base, moduleId];
    settings.pinnedLedgers = next;
    return resolvePinnedLedgers(settings);
}

/**
 * 切换台账的「按需开启 / 收起隐藏」状态：
 * - alwaysOn 模块（家庭成员）受保护不可关闭；
 * - 关闭台账仅将其从 enabledModules 与 pinnedLedgers 移除，100% 保留 settings.dbRefs 与思源 AV 底层数据！
 */
export function toggleModuleEnabled(
    settings: HomeSettings,
    moduleId: string,
): { enabled: boolean; changed: boolean } {
    const mod = getModule(moduleId);
    if (!mod) return { enabled: false, changed: false };
    if (mod.alwaysOn) return { enabled: true, changed: false };

    const current = Array.isArray(settings.enabledModules) ? [...settings.enabledModules] : [];
    const currentlyEnabled = current.includes(moduleId);
    if (currentlyEnabled) {
        settings.enabledModules = current.filter((id) => id !== moduleId);
        if (Array.isArray(settings.pinnedLedgers)) {
            settings.pinnedLedgers = settings.pinnedLedgers.filter((id) => id !== moduleId);
        }
        return { enabled: false, changed: true };
    }
    settings.enabledModules = [...new Set([...current, moduleId])];
    return { enabled: true, changed: true };
}

export interface LibrarySceneGroup {
    groupId: ModuleGroupId;
    modules: HomeModule[];
    enabledCount: number;
    totalCount: number;
}

/**
 * 构建「台账库 · 按需开启」的 6 大生活场景分组（支持搜索词与全部/已开启/按需备选筛选）。
 */
export function computeLibraryGroups(options: {
    enabledModules: readonly string[];
    query?: string;
    filter?: "all" | "enabled" | "disabled";
    t: (k: string) => string;
}): LibrarySceneGroup[] {
    const enabledSet = new Set(options.enabledModules);
    const query = (options.query ?? "").trim().toLowerCase();
    const filter = options.filter ?? "all";

    const groups: LibrarySceneGroup[] = [];
    for (const gid of MODULE_GROUPS) {
        const allInGroup = BUILT_IN_MODULES.filter((m) => m.group === gid);
        const filtered = allInGroup.filter((m) => {
            const isOn = enabledSet.has(m.id);
            if (filter === "enabled" && !isOn) return false;
            if (filter === "disabled" && isOn) return false;
            if (query) {
                const name = options.t(`module.${m.id}`).toLowerCase();
                const desc = options.t(`module.${m.id}.desc`).toLowerCase();
                if (!name.includes(query) && !desc.includes(query) && !m.id.toLowerCase().includes(query)) {
                    return false;
                }
            }
            return true;
        });
        if (filtered.length > 0) {
            groups.push({
                groupId: gid,
                modules: filtered,
                enabledCount: allInGroup.filter((m) => enabledSet.has(m.id)).length,
                totalCount: allInGroup.length,
            });
        }
    }
    return groups;
}
