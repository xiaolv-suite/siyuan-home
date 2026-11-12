/**
 * 全景生活全局检索（Spotlight Search）：
 * 跨所有已启用台账聚合生活数据（名称、分类、存放位置、家庭成员、金额、到期日与备注），
 * 支持中文直匹、拼音全拼与首字母缩写秒级检索与多维打分排序。
 * 纯函数，无网络/DOM 强依赖，100% 可单元测试。
 */
import { searchMatch } from "./pinyin";

export interface SpotlightItem {
    rowId: string;
    moduleId: string;
    title: string;
    location?: string;
    category?: string;
    memberName?: string;
    dueDate?: string;
    amount?: number;
    note?: string;
}

export interface SpotlightResult {
    item: SpotlightItem;
    score: number;
}

export interface ParsedSpotlightQuery {
    raw: string;
    text: string;
    tag?: string;
    urgentOnly: boolean;
}

/**
 * 解析全景检索输入（提取 #标签 与 !紧急 / !urgent 过滤器）
 */
export function parseSpotlightQuery(query: string): ParsedSpotlightQuery {
    const raw = (query ?? "").trim();
    let text = raw;
    let tag: string | undefined;
    let urgentOnly = false;

    // 匹配 #xxx 标签语法
    const tagMatch = text.match(/#([^\s#]+)/);
    if (tagMatch) {
        tag = tagMatch[1].toLowerCase();
        text = text.replace(tagMatch[0], " ").trim();
    }

    // 匹配 !紧急 / !urgent / !overdue / !高优 语法
    const urgentMatch = text.match(/!(?:紧急|urgent|overdue|高优)/i);
    if (urgentMatch) {
        urgentOnly = true;
        text = text.replace(urgentMatch[0], " ").trim();
    }

    text = text.replace(/\s+/g, " ").trim();
    return { raw, text, tag, urgentOnly };
}

/**
 * 判断全景检索条目是否属于临期/紧急事项
 */
export function isSpotlightItemUrgent(item: SpotlightItem, now = new Date()): boolean {
    if (item.dueDate) {
        const [y, m, d] = item.dueDate.slice(0, 10).split("-").map(Number);
        if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
            const dueDt = new Date(y, m - 1, d);
            const diffDays = Math.ceil((dueDt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 3) return true;
        }
    }
    const combined = `${item.title} ${item.note ?? ""} ${item.category ?? ""}`;
    return /(?:紧急|加急|过敏|高危|急救)/i.test(combined);
}

/**
 * 判断全景检索条目是否匹配标签
 */
export function matchesSpotlightTag(item: SpotlightItem, tag: string): boolean {
    const t = tag.toLowerCase();
    if (item.category && (item.category.toLowerCase().includes(t) || searchMatch(item.category, t))) return true;
    if (item.note && (item.note.toLowerCase().includes(t) || searchMatch(item.note, t))) return true;
    if (item.title && (item.title.toLowerCase().includes(t) || searchMatch(item.title, t))) return true;
    return false;
}

/**
 * 跨模块全景搜索过滤与相关度排序
 */
export function searchSpotlight(items: SpotlightItem[], query: string, limit = 40): SpotlightItem[] {
    const { text, tag, urgentOnly } = parseSpotlightQuery(query);
    const q = text.toLowerCase();

    // 先做硬性条件过滤（标签、紧急）
    let pool = items;
    if (urgentOnly) {
        pool = pool.filter((item) => isSpotlightItemUrgent(item));
    }
    if (tag) {
        pool = pool.filter((item) => matchesSpotlightTag(item, tag));
    }

    // 若无额外文本过滤，按临近度或原序展示
    if (!q) {
        return [...pool].sort((a, b) => {
            if (a.dueDate && !b.dueDate) return -1;
            if (!a.dueDate && b.dueDate) return 1;
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            return 0;
        }).slice(0, limit);
    }

    const scored: SpotlightResult[] = [];

    for (const item of pool) {
        let score = 0;
        const titleLower = item.title.toLowerCase();

        // 1. 标题直接包含或拼音匹配（最高权重）
        if (titleLower === q) score += 100;
        else if (titleLower.startsWith(q)) score += 60;
        else if (titleLower.includes(q)) score += 40;
        else if (searchMatch(item.title, q)) score += 30;

        // 2. 存放位置匹配（极高生活查询价值）
        if (item.location) {
            const locLower = item.location.toLowerCase();
            if (locLower.includes(q)) score += 25;
            else if (searchMatch(item.location, q)) score += 20;
        }

        // 3. 关联成员匹配
        if (item.memberName) {
            const memLower = item.memberName.toLowerCase();
            if (memLower.includes(q)) score += 20;
            else if (searchMatch(item.memberName, q)) score += 15;
        }

        // 4. 类别匹配
        if (item.category && searchMatch(item.category, q)) {
            score += 15;
        }

        // 5. 备注匹配
        if (item.note && searchMatch(item.note, q)) {
            score += 10;
        }

        // 6. 模块 ID 匹配（例如搜 medicine 或 certs）
        if (item.moduleId.toLowerCase().includes(q)) {
            score += 10;
        }

        if (score > 0) {
            scored.push({ item, score });
        }
    }

    // 按得分降序排列
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.item);
}

export interface SpotlightCommandItem {
    id: string;
    action: "open-capture" | "open-location" | "open-emergency" | "open-reminders" | "open-settings" | "open-life-index" | "open-store-mode";
    title: string;
    sub: string;
    keywords: string[];
}

export const SPOTLIGHT_COMMANDS: SpotlightCommandItem[] = [
    {
        id: "cmd-capture",
        action: "open-capture",
        title: "快速记录（流水与档案极速录入）",
        sub: "快捷键 N · 支持加油/体征/购物/便签与台账全模块",
        keywords: ["快速记录", "记一笔", "记账", "速记", "capture", "quick"],
    },
    {
        id: "cmd-location",
        action: "open-location",
        title: "东西放哪了（全局位置索引）",
        sub: "跨 31 模块检索证件、钥匙、药品存放房间与抽屉",
        keywords: ["东西放哪了", "找东西", "位置", "存放", "location", "where"],
    },
    {
        id: "cmd-emergency",
        action: "open-emergency",
        title: "家庭急救与防灾应急卡",
        sub: "呈现全家血型、高危过敏源、急救箱存放处与避难点",
        keywords: ["急救卡", "应急卡", "急救", "过敏", "血型", "emergency", "card"],
    },
    {
        id: "cmd-store",
        action: "open-store-mode",
        title: "超市扫货模式（采购动线核对）",
        sub: "按超市日用/食品动线逐项勾选，生成采购核对清单",
        keywords: ["扫货", "超市", "采购", "动线", "store", "shopping"],
    },
    {
        id: "cmd-life-index",
        action: "open-life-index",
        title: "家庭生活指数与幸福资产盘点",
        sub: "全景测算家庭韧性、健康覆盖与保障指数",
        keywords: ["生活指数", "幸福资产", "年度盘点", "index", "life"],
    },
    {
        id: "cmd-reminders",
        action: "open-reminders",
        title: "打开到期提醒中枢",
        sub: "查看全部逾期、即将到期与多段割点事项",
        keywords: ["提醒", "待办", "中枢", "reminders", "todo"],
    },
    {
        id: "cmd-settings",
        action: "open-settings",
        title: "打开管家设置",
        sub: "管理 31 个生活模块启用状态与提醒提前量",
        keywords: ["设置", "配置", "settings", "config"],
    },
];

export function searchSpotlightCommands(query: string): SpotlightCommandItem[] {
    const raw = (query ?? "").trim();
    const isCmdMode = raw.startsWith(">") || raw.startsWith("》");
    const keyword = (isCmdMode ? raw.slice(1) : raw).trim().toLowerCase();

    if (!keyword) {
        return isCmdMode ? [...SPOTLIGHT_COMMANDS] : [];
    }

    return SPOTLIGHT_COMMANDS.filter((cmd) => {
        if (cmd.title.toLowerCase().includes(keyword)) return true;
        if (cmd.keywords.some((k) => k.toLowerCase().includes(keyword) || searchMatch(k, keyword))) return true;
        return false;
    });
}

