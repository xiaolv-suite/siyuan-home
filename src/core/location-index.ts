/**
 * 存放位置索引（313 波，G4）：
 * 聚合各模块的 location / copy_location 列，回答"东西到底放哪了"。
 * 典型问法："护照复印件在哪""降压药放哪了""房产证在哪个柜子"。
 * 纯函数，无网络，100% 可单元测试。
 */

export interface LocationRowInput {
    /** 台账行块 id */
    rowId: string;
    moduleId: string;
    /** 物品/记录名称 */
    name: string;
    /** 存放位置（location 或 copy_location 的值） */
    location: string;
    /** 位置来源列：location | copy_location */
    source?: "location" | "copy_location";
    memberName?: string;
    /** 额外线索（备注/编号等） */
    hint?: string;
}

export interface LocationEntry {
    rowId: string;
    moduleId: string;
    name: string;
    location: string;
    source: "location" | "copy_location";
    memberName?: string;
    hint?: string;
}

export interface LocationGroup {
    location: string;
    entries: LocationEntry[];
}

export interface LocationIndex {
    groups: LocationGroup[];
    total: number;
    /** 出现次数最多的位置 Top N */
    topLocations: Array<{ location: string; count: number }>;
    /** 没有填写位置的行数（用于提示补齐） */
    missing: number;
}

function norm(s: string | undefined): string {
    return (s ?? "").trim();
}

/**
 * 构建位置索引：按位置分组，组内按模块+名称排序，组按条目数降序
 */
export function buildLocationIndex(
    rows: LocationRowInput[],
    options: { topN?: number; limitPerGroup?: number } = {},
): LocationIndex {
    const { topN = 5, limitPerGroup = 50 } = options;
    const bucket = new Map<string, LocationEntry[]>();
    let total = 0;
    let missing = 0;

    for (const r of rows ?? []) {
        if (!r) continue;
        const location = norm(r.location);
        const name = norm(r.name);
        if (!name) continue;
        if (!location) {
            missing++;
            continue;
        }
        total++;
        const entry: LocationEntry = {
            rowId: r.rowId,
            moduleId: r.moduleId,
            name,
            location,
            source: r.source ?? "location",
        };
        if (r.memberName) entry.memberName = r.memberName;
        if (r.hint) entry.hint = r.hint;
        const list = bucket.get(location) ?? [];
        list.push(entry);
        bucket.set(location, list);
    }

    const groups: LocationGroup[] = [...bucket.entries()]
        .map(([location, entries]) => ({
            location,
            entries: entries
                .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.name.localeCompare(b.name))
                .slice(0, limitPerGroup),
        }))
        .sort((a, b) => b.entries.length - a.entries.length || a.location.localeCompare(b.location));

    const counts = [...bucket.entries()].map(([location, entries]) => ({ location, count: entries.length }));
    const topLocations = counts.sort((a, b) => b.count - a.count || a.location.localeCompare(b.location)).slice(0, topN);

    return { groups, total, topLocations, missing };
}

/**
 * 关键词检索：按名称 / 位置 / 备注模糊匹配（大小写不敏感）
 */
export function searchLocations(
    rows: LocationRowInput[],
    keyword: string,
): LocationEntry[] {
    const needle = norm(keyword).toLowerCase();
    if (!needle) return [];
    const out: LocationEntry[] = [];
    for (const r of rows ?? []) {
        if (!r) continue;
        const name = norm(r.name);
        const location = norm(r.location);
        if (!name) continue;
        const hay = `${name} ${location} ${r.moduleId} ${r.memberName ?? ""} ${r.hint ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) continue;
        out.push({
            rowId: r.rowId,
            moduleId: r.moduleId,
            name,
            location: location || "（未填写）",
            source: r.source ?? "location",
            ...(r.memberName ? { memberName: r.memberName } : {}),
            ...(r.hint ? { hint: r.hint } : {}),
        });
    }
    return out.sort((a, b) => a.location.localeCompare(b.location, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
}

/** 格式化位置索引为可复制文本 */
export function formatLocationIndexText(
    index: LocationIndex,
    label: (moduleId: string) => string = (m) => m,
): string {
    if (index.total === 0) return "暂无已填写存放位置的记录。";
    const lines: string[] = [`📦 家庭物品存放位置索引（${index.total} 条记录）`, ""];
    for (const g of index.groups) {
        lines.push(`【${g.location}】${g.entries.length} 件`);
        for (const e of g.entries) {
            const owner = e.memberName ? ` · ${e.memberName}` : "";
            const hint = e.hint ? ` · ${e.hint}` : "";
            lines.push(`  • ${e.name}（${label(e.moduleId)}${owner}）${hint}`);
        }
        lines.push("");
    }
    if (index.missing > 0) lines.push(`另有 ${index.missing} 条记录尚未填写存放位置。`);
    return lines.join("\n").trimEnd();
}

/**
 * 将层级位置字符串解析为规范面包屑路径列表（支持 /、>、-、反斜杠、全角破折号）
 */
export function parseLocationBreadcrumbs(location: string | undefined): string[] {
    const s = norm(location);
    if (!s || s === "（未填写）") return [];
    return s
        .split(/[/>\-—–\\>›»→]+/gu)
        .map((p) => p.trim())
        .filter(Boolean);
}

/**
 * 格式化为美观的层级面包屑胶囊文本（如 "主卧 › 顶层衣柜 › 02收纳箱"）
 */
export function formatLocationBreadcrumbTag(location: string | undefined): string {
    const parts = parseLocationBreadcrumbs(location);
    return parts.length > 1 ? parts.join(" › ") : (norm(location) || "（未填写）");
}

export interface LocationTreeNode {
    /** 当前层级路径段名称（如 "衣柜"） */
    segment: string;
    /** 规范化完整层级路径（如 "主卧 › 衣柜"） */
    fullPath: string;
    /** 深度层级（1 = 顶级空间，2 = 二级家具/区域，3 = 三级抽屉/收纳盒等） */
    depth: number;
    /** 该节点及其全部子孙节点包含的物品总数 */
    totalCount: number;
    /** 直接存放在当前空间层级的物品 */
    directEntries: LocationEntry[];
    /** 下级子空间节点列表 */
    children: LocationTreeNode[];
}

/**
 * 构建多层级空间拓扑树（Location Spatial Topology Tree）
 * 将各台账行的存放位置字符串按多级分隔符切分并组装为树形空间模型，支持按空间层级聚合与折叠。
 */
export function buildLocationTree(
    rows: LocationRowInput[],
    options: { defaultMissingLabel?: string } = {}
): LocationTreeNode[] {
    const missingLabel = options.defaultMissingLabel ?? "（未填写）";
    // 根映射表：第一层空间名称 -> 树节点构造辅助结构
    type MutableNode = {
        segment: string;
        fullPath: string;
        depth: number;
        directEntries: LocationEntry[];
        childMap: Map<string, MutableNode>;
    };

    const rootMap = new Map<string, MutableNode>();

    for (const r of rows ?? []) {
        if (!r) continue;
        const name = norm(r.name);
        if (!name) continue;

        const rawLoc = norm(r.location);
        const parts = parseLocationBreadcrumbs(rawLoc);
        const segments = parts.length > 0 ? parts : [missingLabel];

        const entry: LocationEntry = {
            rowId: r.rowId,
            moduleId: r.moduleId,
            name,
            location: rawLoc || missingLabel,
            source: r.source ?? "location",
            ...(r.memberName ? { memberName: r.memberName } : {}),
            ...(r.hint ? { hint: r.hint } : {}),
        };

        // 沿层级逐级下钻
        let currentMap = rootMap;
        let cumulativePath: string[] = [];

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            cumulativePath.push(seg);
            const pathStr = cumulativePath.join(" › ");
            const depth = i + 1;

            let node = currentMap.get(seg);
            if (!node) {
                node = {
                    segment: seg,
                    fullPath: pathStr,
                    depth,
                    directEntries: [],
                    childMap: new Map<string, MutableNode>(),
                };
                currentMap.set(seg, node);
            }

            // 若到达最后一段，则将物品挂载为当前节点的直接条目
            if (i === segments.length - 1) {
                node.directEntries.push(entry);
            }

            currentMap = node.childMap;
        }
    }

    // 递归转换与计算 totalCount
    function finalize(node: MutableNode): LocationTreeNode {
        const children = [...node.childMap.values()]
            .map(finalize)
            .sort((a, b) => b.totalCount - a.totalCount || a.segment.localeCompare(b.segment, "zh-CN"));

        const directCount = node.directEntries.length;
        const childrenCount = children.reduce((acc, c) => acc + c.totalCount, 0);

        // 组内直接条目按模块和名称稳定排序
        node.directEntries.sort((a, b) => a.moduleId.localeCompare(b.moduleId, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));

        return {
            segment: node.segment,
            fullPath: node.fullPath,
            depth: node.depth,
            totalCount: directCount + childrenCount,
            directEntries: node.directEntries,
            children,
        };
    }

    return [...rootMap.values()]
        .map(finalize)
        .sort((a, b) => {
            // 未填写的特殊项排在最末
            if (a.segment === missingLabel) return 1;
            if (b.segment === missingLabel) return -1;
            return b.totalCount - a.totalCount || a.segment.localeCompare(b.segment, "zh-CN");
        });
}

/**
 * 根据前缀路径在拓扑树中检索对应子树空间节点（例如 query "主卧" 或 "主卧 › 衣柜"）
 */
export function queryLocationSubtree(
    roots: LocationTreeNode[],
    targetPath: string
): LocationTreeNode | null {
    const parts = parseLocationBreadcrumbs(targetPath);
    if (parts.length === 0) return null;
    const needle = parts.join(" › ");
    const lastSeg = parts[parts.length - 1];

    function search(node: LocationTreeNode): LocationTreeNode | null {
        if (node.fullPath === needle || (parts.length === 1 && node.segment === lastSeg)) {
            return node;
        }
        for (const child of node.children) {
            const found = search(child);
            if (found) return found;
        }
        return null;
    }

    for (const r of roots) {
        const found = search(r);
        if (found) return found;
    }
    return null;
}

export interface FlatLocationItem {
    segment: string;
    fullPath: string;
    depth: number;
    totalCount: number;
    directCount: number;
}

/**
 * 将空间拓扑树展平为带缩进的大纲扁平列表，便于下拉选择器（picker）与过滤侧栏渲染
 */
export function flattenLocationTree(roots: LocationTreeNode[]): FlatLocationItem[] {
    const result: FlatLocationItem[] = [];

    function traverse(node: LocationTreeNode) {
        result.push({
            segment: node.segment,
            fullPath: node.fullPath,
            depth: node.depth,
            totalCount: node.totalCount,
            directCount: node.directEntries.length,
        });
        for (const child of node.children) {
            traverse(child);
        }
    }

    for (const root of roots) {
        traverse(root);
    }
    return result;
}

/**
 * 格式化空间拓扑树为可复制的 ASCII 树形大纲文本
 */
export function formatLocationTreeText(
    roots: LocationTreeNode[],
    label: (moduleId: string) => string = (m) => m
): string {
    if (!roots || roots.length === 0) return "暂无空间拓扑数据。";

    const lines: string[] = ["🏡 家庭物品存放位置空间拓扑树", ""];

    function renderNode(node: LocationTreeNode, prefix: string, isLast: boolean, isRoot: boolean) {
        const marker = isRoot ? "" : (isLast ? "└── " : "├── ");
        lines.push(`${prefix}${marker}${node.segment} (${node.totalCount} 件)`);

        const nextPrefix = isRoot ? "" : (prefix + (isLast ? "    " : "│   "));

        // 打印直接挂载在该位置下的物品
        for (const e of node.directEntries) {
            const owner = e.memberName ? ` · ${e.memberName}` : "";
            const hint = e.hint ? ` · ${e.hint}` : "";
            lines.push(`${nextPrefix}  • ${e.name}（${label(e.moduleId)}${owner}）${hint}`);
        }

        // 递归打印子空间
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            const childIsLast = (i === node.children.length - 1);
            renderNode(child, nextPrefix, childIsLast, false);
        }
    }

    for (let i = 0; i < roots.length; i++) {
        renderNode(roots[i], "", i === roots.length - 1, true);
    }

    return lines.join("\n").trimEnd();
}

/**
 * 将层级位置渲染为符合思源原生 Protyle 规范的空气感微胶囊 HTML 标签（Tag Pill）
 */
export function renderLocationCapsuleHtml(location: string | undefined): string {
    const parts = parseLocationBreadcrumbs(location);
    if (parts.length === 0) {
        return `<span class="b3-chip b3-chip--secondary b3-chip--small">（未填写位置）</span>`;
    }

    const segmentsHtml = parts
        .map((p, idx) => {
            const sep = idx > 0 ? `<span class="lv-chip-sep" style="opacity: 0.4; margin: 0 2px;">›</span>` : "";
            return `${sep}<span class="lv-chip-node">${escapeHtmlText(p)}</span>`;
        })
        .join("");

    return `<span class="b3-chip b3-chip--secondary b3-chip--small lv-location-pill" title="${escapeHtmlText(parts.join(" › "))}" style="display: inline-flex; align-items: center; border-radius: 9999px; padding: 2px 8px; font-size: 12px; gap: 2px;"><svg style="width: 12px; height: 12px; opacity: 0.6; margin-right: 2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>${segmentsHtml}</span>`;
}

function escapeHtmlText(str: string): string {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export interface SiblingLocationResult {
    location: string;
    breadcrumbs: string[];
    siblings: LocationEntry[];
}

/**
 * 同一空间位置关联检索器：
 * 给定目标物品 rowId，查找并聚合所有与它存放在同一具体位置（或同一储物格）的其他物品。
 * 典型应用：在物品详情抽屉中一键回答“这格抽屉里还放了什么”。
 */
export function findSiblingItemsInSameLocation(
    targetRowId: string,
    rows: LocationRowInput[]
): SiblingLocationResult | null {
    if (!targetRowId || !Array.isArray(rows) || rows.length === 0) return null;

    const targetRow = rows.find(r => r && r.rowId === targetRowId);
    if (!targetRow || !norm(targetRow.location)) return null;

    const targetLoc = norm(targetRow.location);
    const targetParts = parseLocationBreadcrumbs(targetLoc);
    const targetCanonical = targetParts.join(" › ");

    const siblings: LocationEntry[] = [];
    for (const r of rows) {
        if (!r || r.rowId === targetRowId || !norm(r.name)) continue;
        const loc = norm(r.location);
        const parts = parseLocationBreadcrumbs(loc);
        if (parts.length > 0 && parts.join(" › ") === targetCanonical) {
            siblings.push({
                rowId: r.rowId,
                moduleId: r.moduleId,
                name: norm(r.name),
                location: loc,
                source: r.source ?? "location",
                ...(r.memberName ? { memberName: r.memberName } : {}),
                ...(r.hint ? { hint: r.hint } : {}),
            });
        }
    }

    siblings.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.name.localeCompare(b.name));

    return {
        location: targetCanonical,
        breadcrumbs: targetParts,
        siblings,
    };
}
