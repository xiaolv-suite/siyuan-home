/**
 * 建库器（provisioner）：模块启用 → 幂等创建台账文档与数据库。
 * 落点：专用笔记本（默认 "🏠 小驴管家"，可配）。幂等：已启用再启用 = 跳过；
 * 版本升级补列不删不改。文档/av ID 记入 settings.dbRefs（01 ADR-3/5/7）。
 *
 * Spike 定案后走真实建库路径（siyuan.ts）：div 插入 → createIfNotExist → 加列。
 * members 库是 relation 列（member 列）的目标，先建 members 再建其他模块。
 *
 * D07/D08（2026-10-02）：
 * - 笔记本登记值兼容 ID 与历史名称；ID 查不到不把 ID 当名称建新笔记本；
 *   笔记本被关闭 → openNotebook 恢复而非新建。
 * - dbRef 文档检查区分瞬态错误（网络/响应异常 → 记录后原样返回，不重建）
 *   与内核明确报错（文档不存在 → 重建路径）。
 * - 复用原库时补列续跑（缺列只增不改），成功后清除旧 provisionError；
 *   补登记路径尝试按 root_id 找回 av 块，找回即复用原库。
 */
import type { HomeSettings, DbRef } from "@/types";
import type { ModuleSchema } from "./schema";
import { errText } from "./settings";
import {
    listNotebooks, createNotebook, openNotebook, createDocWithMd, getHPathByID, sql, newSiYuanId,
    createAttributeView, addAttributeViewColumn, renderLedger, KernelError, isWriteResultUnknown,
} from "./siyuan";

export const DEFAULT_NOTEBOOK_NAME = "🏠 小驴管家";
export const DEFAULT_HUB_ROOT_PATH = "/02-小驴管家";
export const DOC_TITLE_PREFIX = "台账 · ";

/** 31 个模块在「一树八脉」统一小驴空间下的 5 大领域分类目录映射 */
export const MODULE_CATEGORY_FOLDER: Record<string, string> = {
    members: "01-家庭与健康",
    certs: "01-家庭与健康",
    health: "01-家庭与健康",
    medicine: "01-家庭与健康",
    social: "01-家庭与健康",
    pets: "01-家庭与健康",
    insurance: "02-财务与保障",
    "assets-real": "02-财务与保障",
    "assets-virtual": "02-财务与保障",
    contracts: "02-财务与保障",
    memberships: "02-财务与保障",
    shopping: "02-财务与保障",
    allowance: "02-财务与保障",
    stock: "03-空间与物品",
    house: "03-空间与物品",
    chores: "03-空间与物品",
    food: "03-空间与物品",
    address: "03-空间与物品",
    bookmarks: "03-空间与物品",
    snippets: "03-空间与物品",
    vehicles: "04-出行与生活",
    transit: "04-出行与生活",
    "travel-plan": "04-出行与生活",
    "travel-booking": "04-出行与生活",
    "travel-packing": "04-出行与生活",
    "travel-log": "04-出行与生活",
    favors: "04-出行与生活",
    parenting: "05-成长与其它",
    schooling: "05-成长与其它",
    exams: "05-成长与其它",
    media: "05-成长与其它",
};

export function getModuleCategoryFolder(moduleId?: string): string {
    return (moduleId && MODULE_CATEGORY_FOLDER[moduleId]) || "05-成长与其它";
}

export function isXiaoLvHubNotebookName(name: string | undefined): boolean {
    if (!name) return false;
    return (
        name.includes("小驴空间") ||
        name.includes("小驴笔记本") ||
        name.includes("小驴生态统一测试空间")
    );
}

export {
    type DuplicateFinding,
    findDuplicateLedgers,
    bindExistingDoc,
    type AdoptionReport,
    discoverAndAdoptAllLedgers,
    healColumnMapping,
} from "./provision-adoption";

/**
 * 历史版本模块中文标题别名表（老版本平滑升级兼容与自动找回引擎）：
 * 兼容各历史版本中可能使用的台账文档命名，避免升级后被当作未建库或重复创建。
 */
export const MODULE_TITLE_ALIASES: Record<string, string[]> = {
    members: ["家庭成员", "成员档案"],
    certs: ["证件管理", "重要证件"],
    health: ["病历与健康", "健康档案"],
    social: ["社保医保", "社保公积金"],
    insurance: ["保险管理", "保单管理"],
    exams: ["考证管理", "考试管理"],
    pets: ["宠物档案", "毛孩子档案"],
    "assets-real": ["实物资产", "家庭资产"],
    "assets-virtual": ["虚拟资产", "数字资产"],
    shopping: ["购物记录", "待买清单"],
    memberships: ["会员与订阅", "订阅管理"],
    contracts: ["合同与文件", "重要合同"],
    medicine: ["家庭药箱", "药品管理"],
    stock: ["囤货与库存", "家庭囤货"],
    favors: ["礼尚往来", "人情账本"],
    chores: ["家务与周期", "日常家务"],
    food: ["餐饮美食", "美食菜谱"],
    address: ["地址管理", "常用地址"],
    bookmarks: ["网址管理", "常用书签"],
    snippets: ["随手便签", "备忘随手记"],
    house: ["房屋与日程", "房产档案"],
    parenting: ["育儿管理", "宝宝成长"],
    schooling: ["上学管理", "学业档案"],
    allowance: ["零花钱与压岁钱", "零花钱账本"],
    vehicles: ["车辆档案", "爱车档案"],
    transit: ["交通卡证", "公交卡"],
    "travel-plan": ["旅行计划", "行程规划"],
    "travel-booking": ["预订单据", "机票酒店"],
    "travel-packing": ["行前清单", "行李打包"],
    "travel-log": ["旅行足迹", "旅行随记"],
    media: ["影音书库", "书影音"],
};

/** 思源 ID 形态（yyyyMMddHHmmss-xxxxxxx）：区分 dbRefs.notebook 里的 ID 与历史名称值（D07） */
const SIYUAN_ID_RE = /^\d{14}-[0-9a-z]{7}$/;
// The kernel may commit a notebook before its list endpoint/index observes it.
// Keep the recovery window bounded and never replay an unknown create request.
const NOTEBOOK_RECOVERY_ATTEMPTS = 5;
const NOTEBOOK_RECOVERY_DELAY_MS = 250;

export function isSiYuanId(v: string | undefined): boolean {
    return !!v && SIYUAN_ID_RE.test(v);
}

async function createNotebookWithRecovery(name: string): Promise<string> {
    try {
        return await createNotebook(name, { idempotencyKey: `provision:notebook:create:${name}`, retries: 0 });
    } catch (error) {
        // The create request may have committed before its response was lost,
        // or a notebook with this name already exists.
        let matches: Awaited<ReturnType<typeof listNotebooks>> = [];
        for (let attempt = 0; attempt < NOTEBOOK_RECOVERY_ATTEMPTS; attempt++) {
            if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, NOTEBOOK_RECOVERY_DELAY_MS));
            matches = (await listNotebooks()).filter((notebook) => notebook.name === name);
            if (matches.length > 0) break;
        }
        if (matches.length > 0) {
            const chosen = matches.find((n) => !n.closed) || matches[0];
            return chosen.id;
        }
        throw error;
    }
}

/**
 * 确保专用笔记本可用，返回笔记本 ID（D07）：
 * - 登记值为 ID → 按 ID 匹配；查不到（笔记本被删除）→ 落回默认名，绝不把 ID 当名称新建；
 * - 登记值为名称（历史值）→ 按名称匹配；
 * - 命中但已关闭 → openNotebook 恢复；未命中 → createNotebook。
 * - 若受限无法创建根笔记本，自动优雅降级到当前思源工作区已打开的首个笔记本，保障建库绝对不卡死。
 */
export async function ensureNotebook(preferred?: string, defaultNotebookId?: string): Promise<string> {
    const notebooks = await listNotebooks();
    const byId = (id: string) => notebooks.find((nb) => nb.id === id);
    const byName = (name: string) => notebooks.find((nb) => nb.name === name);

    // 1. 最高优先级：用户在设置中显式指定的自选目标笔记本（targetNotebookId）
    if (defaultNotebookId) {
        const custom = isSiYuanId(defaultNotebookId) ? byId(defaultNotebookId) : (byId(defaultNotebookId) || byName(defaultNotebookId));
        if (custom) {
            if (custom.closed) {
                await openNotebook(custom.id, { idempotencyKey: `provision:notebook:open:${custom.id}`, retries: 1 });
            }
            return custom.id;
        }
    }

    // 2. 第二优先级：该模块原本登记且有效的笔记本
    if (preferred) {
        const hit = isSiYuanId(preferred) ? byId(preferred) : byName(preferred);
        if (hit) {
            if (hit.closed) await openNotebook(hit.id, { idempotencyKey: `provision:notebook:open:${hit.id}`, retries: 1 });
            return hit.id;
        }
    }

    // 3. 第三优先级：优先复用统一生态笔记本（🐴 小驴空间 / 小驴生态统一测试空间），其次为默认笔记本名称 "🏠 小驴管家"
    if (!preferred || isSiYuanId(preferred)) {
        const hubHit = notebooks.find((nb) => !nb.closed && isXiaoLvHubNotebookName(nb.name));
        if (hubHit) return hubHit.id;
    }
    const name = isSiYuanId(preferred) || !preferred ? DEFAULT_NOTEBOOK_NAME : preferred;
    const hit = byName(name);
    if (hit) {
        if (hit.closed) await openNotebook(hit.id, { idempotencyKey: `provision:notebook:open:${hit.id}`, retries: 1 });
        return hit.id;
    }
    try {
        const createdId = await createNotebookWithRecovery(name);
        const nb = (await listNotebooks()).find((n) => n.id === createdId);
        if (nb?.closed) {
            await openNotebook(createdId, { idempotencyKey: `provision:notebook:open:${createdId}`, retries: 1 });
        }
        return createdId;
    } catch (e) {
        // 环境受限无法创建笔记本时的兜底自愈：复用思源当前已打开的第一个有效笔记本
        const openNb = notebooks.find((n) => !n.closed) || notebooks[0];
        if (openNb) {
            if (openNb.closed) await openNotebook(openNb.id, { idempotencyKey: `provision:notebook:open:${openNb.id}`, retries: 1 });
            return openNb.id;
        }
        throw e;
    }
}

/** 台账文档 hpath（支持一树八脉 rootPath + 5 大分类子目录，未配置 rootPath 时兼容笔记本内一级文档） */
export function ledgerHPath(
    titleI18n: string,
    opts?: { rootPath?: string; moduleId?: string; grouped?: boolean },
): string {
    const rawRoot = opts?.rootPath ? opts.rootPath.trim().replace(/\/+$/, "") : "";
    if (!rawRoot) {
        return `/${DOC_TITLE_PREFIX}${titleI18n}`;
    }
    const normalizedRoot = rawRoot.startsWith("/") ? rawRoot : `/${rawRoot}`;
    const groupSegment = opts?.grouped !== false && opts?.moduleId ? `/${getModuleCategoryFolder(opts.moduleId)}` : "";
    return `${normalizedRoot}${groupSegment}/${DOC_TITLE_PREFIX}${titleI18n}`;
}

export function stableAvSeed(moduleId: string, docId: string): string {
    let hash = 2166136261;
    for (const char of `${moduleId}:${docId}`) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    const timestamp = docId.match(/^(\d{14})-/)?.[1] ?? "20000101000000";
    return `${timestamp}-${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export interface FoundLedgerDoc {
    id: string;
    box: string;
}

/**
 * 健壮找回台账文档（消除历史脆弱的 rows.length > 1 抛 409 异常）：
 * 1. 优先在指定的 notebookId 找精确 hpath；
 * 2. 如果同一笔记本内有多份同名文档，优先选取包含已有 av 块的文档，次选最新修改的文档；
 * 3. 如果指定笔记本没有找到，按模块历史别名扩展查找；
 * 4. 如果仍未找到，全局跨所有笔记本搜寻带有该模块台账特征的文档（自动自愈历史版本）。
 */
export async function findLedgerDoc(notebookId: string, hpath: string, moduleId?: string): Promise<FoundLedgerDoc | null> {
    try {
        const escapedHpath = hpath.replace(/'/g, "''");
        const leafSegment = `/${hpath.split("/").filter(Boolean).pop() || ""}`.replace(/'/g, "''");
        const escapedBox = notebookId.replace(/'/g, "''");
        // 1. 指定笔记本内精确匹配或子层级路径匹配（支持用户将台账放在子目录或 5 大分类夹中）
        const rows = await sql<{ id: string; box: string; updated: string }>(
            `SELECT id, box, updated FROM blocks WHERE type='d' AND box='${escapedBox}' AND (hpath='${escapedHpath}' OR hpath LIKE '%${escapedHpath}' OR hpath='${leafSegment}' OR hpath LIKE '%${leafSegment}') ORDER BY updated DESC LIMIT 5`,
        );
        if (rows.length === 1) return { id: rows[0].id, box: rows[0].box || notebookId };
        if (rows.length > 1) {
            for (const r of rows) {
                const av = await findAvBlockInDoc(r.id);
                if (av) return { id: r.id, box: r.box || notebookId };
            }
            return { id: rows[0].id, box: rows[0].box || notebookId };
        }

        // 2. 指定笔记本内历史别名匹配
        if (moduleId && MODULE_TITLE_ALIASES[moduleId]) {
            for (const alias of MODULE_TITLE_ALIASES[moduleId]) {
                const aliasHpath = `/${DOC_TITLE_PREFIX}${alias}`.replace(/'/g, "''");
                const aliasRows = await sql<{ id: string; box: string }>(
                    `SELECT id, box FROM blocks WHERE type='d' AND box='${escapedBox}' AND (hpath='${aliasHpath}' OR hpath LIKE '%${aliasHpath}') ORDER BY updated DESC LIMIT 2`,
                );
                if (aliasRows.length > 0) return { id: aliasRows[0].id, box: aliasRows[0].box || notebookId };
            }
        }

        // 3. 全局跨笔记本自愈找回（针对历史版本建在其他笔记本的情况）
        const globalRows = await sql<{ id: string; box: string }>(
            `SELECT id, box FROM blocks WHERE type='d' AND (hpath='${escapedHpath}' OR hpath LIKE '%${escapedHpath}') ORDER BY updated DESC LIMIT 5`,
        );
        if (globalRows.length > 0) {
            for (const r of globalRows) {
                const av = await findAvBlockInDoc(r.id);
                if (av) return { id: r.id, box: r.box };
            }
            return { id: globalRows[0].id, box: globalRows[0].box };
        }

        if (moduleId && MODULE_TITLE_ALIASES[moduleId]) {
            for (const alias of MODULE_TITLE_ALIASES[moduleId]) {
                const globalAliasRows = await sql<{ id: string; box: string }>(
                    `SELECT id, box FROM blocks WHERE type='d' AND hpath LIKE '%${alias.replace(/'/g, "''")}%' ORDER BY updated DESC LIMIT 3`,
                );
                if (globalAliasRows.length > 0) {
                    for (const r of globalAliasRows) {
                        const av = await findAvBlockInDoc(r.id);
                        if (av) return { id: r.id, box: r.box };
                    }
                    return { id: globalAliasRows[0].id, box: globalAliasRows[0].box };
                }
            }
        }
    } catch { /* SQL 异常回退 null */ }
    return null;
}

/** 在文档内找既有 av 块（D08 补登记：文档在、登记丢 → 找回原库而非重建第二套） */
export async function findAvBlockInDoc(docId: string): Promise<string | null> {
    try {
        const escapedDocId = docId.replace(/'/g, "''");
        // 兼容 type='av' 以及 markdown 中带有 NodeAttributeView 的块
        const rows = await sql<{ id: string }>(
            `SELECT id FROM blocks WHERE (type='av' OR markdown LIKE '%data-type="NodeAttributeView"%') AND root_id='${escapedDocId}' LIMIT 3`,
        );
        return rows[0]?.id ?? null;
    } catch {
        return null;
    }
}

/**
 * D07 错误分类（保守方向：宁可不重建，不误重建）：
 * - 网络层异常 / malformed envelope（TypeError、code=-1 且非"找不到"消息）→ 瞬态，不重建；
 * - 内核非 -1 错误码，或内核明确返回 "not found/不存在" → 文档缺失，走重建。
 */
export function isDocMissingError(e: unknown): boolean {
    if (!(e instanceof KernelError)) return false;
    if (e.code !== -1) return true;
    return /not found|不存在/i.test(e.kernelMsg);
}

export interface ProvisionResult {
    dbRef: DbRef;
    created: boolean;
}

export interface ProvisioningReport {
    issues: { moduleId: string; message: string }[];
}

export function getProvisioningReport(settings: Pick<HomeSettings, "enabledModules" | "dbRefs">): ProvisioningReport {
    const issues: ProvisioningReport["issues"] = [];
    for (const moduleId of settings.enabledModules) {
        const ref = settings.dbRefs[moduleId];
        const message = ref?.provisionError ?? (!ref?.avId ? "Attribute view unavailable" : "");
        if (message) issues.push({ moduleId, message });
    }
    return { issues };
}

/** 常见列定义多语言与历史别名映射库，彻底解决列名不匹配与重复建列问题 */
export const COMMON_COLUMN_ALIASES: Record<string, string[]> = {
    name: ["主键", "名称", "姓名", "标题", "物品名称", "证件名称", "合同名称", "车辆名称", "车名", "块", "主要", "主属性", "name", "title", "block"],
    qty: ["数量", "库存", "库存量", "现存数量", "qty", "stock_qty"],
    stock_qty: ["数量", "库存", "库存量", "现存数量", "qty", "stock_qty"],
    expiry: ["到期日", "有效期", "过期时间", "到期时间", "截止日期", "保质期至", "expiry", "due"],
    due: ["到期日", "有效期", "过期时间", "到期时间", "截止日期", "expiry", "due"],
    amount: ["金额", "价格", "花费", "费用", "额度", "amount", "price", "cost"],
    note: ["备注", "说明", "详情", "notes", "note", "remark"],
    category: ["分类", "类型", "类别", "分组", "category", "type"],
    date: ["日期", "记录日期", "发生日期", "业务日期", "date"],
    location: ["存放位置", "存放地点", "位置", "地点", "location", "store_place"],
    store_place: ["存放位置", "存放地点", "位置", "地点", "location", "store_place"],
    member: ["家庭成员", "成员", "归属人", "所属人", "联系人", "member", "owner"],
    person: ["联系人", "姓名", "往来对象", "对象", "person"],
    status: ["状态", "当前状态", "status"],
    plate: ["车牌", "车牌号", "号牌", "车牌号码", "plate", "license_plate"],
    brand_model: ["品牌型号", "品牌", "车型", "车辆型号", "车辆品牌", "型号", "brand_model", "model"],
    energy_type: ["能源类型", "能源", "动力类型", "燃油类型", "动力", "energy_type"],
    mileage: ["里程", "当前里程", "公里数", "总里程", "行驶里程", "mileage"],
    inspection_due: ["车检到期", "年检到期", "年审到期", "车检", "年检", "inspection_due"],
    insurance_due: ["车险到期", "保险到期", "车险", "insurance_due"],
    vehicle_tax_due: ["车船税到期", "车船税", "vehicle_tax_due"],
    battery_due: ["电池更换", "电池到期", "下次更换", "battery_due"],
    battery_capacity: ["电池容量", "容量", "battery_capacity"],
    purchase_date: ["购买日期", "购车日期", "购入日期", "买入日期", "purchase_date"],
    purchase_price: ["购买价格", "购车价格", "车价", "买入价", "purchase_price"],
    current_value: ["当前估值", "估值", "残值", "当前价值", "current_value"],
    insurance_company: ["保险公司", "承保公司", "投保公司", "insurance_company"],
    violations: ["违章记录", "违章", "违章处罚", "violations"],
    vin: ["车架号", "车辆识别代码", "vin"],
    color: ["颜色", "车身颜色", "外观颜色", "color"],
};

export interface ProvisionOptions {
    /** 列名解析（i18n）：列 key → 显示名（缺省用 key 本身） */
    resolveName?: (colKey: string) => string;
    /** 真实性对齐：强制核实思源数据库中真实列存在性，清理幽灵列映射并在思源中补齐缺失列 */
    reconcileGhostColumns?: boolean;
}

/** 补列（D08 只增不改）：跳过已登记列；返回完整 keyID 映射与首个失败摘要（undefined = 全部就绪） */
export async function ensureColumns(
    avId: string | undefined,
    schema: ModuleSchema,
    existing: Record<string, string> | undefined,
    moduleId: string,
    opts: ProvisionOptions,
    memberAvId?: string,
): Promise<{ columns: Record<string, string>; error?: string }> {
    const columns: Record<string, string> = { ...(existing ?? {}) };
    let error: string | undefined;
    if (!avId) return { columns, error: error ?? "av unavailable" };
    let knownColumns: any[];
    try {
        knownColumns = (await renderLedger(avId)).columns ?? [];
    } catch (e) {
        return { columns, error: `column preflight: ${errText(e)}` };
    }
    const knownIds = new Set(knownColumns.map((c: any) => c?.id));
    let lastKeyID = String(
        knownColumns.find((c: any) => c?.type === "block")?.id
        ?? knownColumns[knownColumns.length - 1]?.id
        ?? "",
    );
    for (const col of schema.columns) {
        const columnName = opts.resolveName?.(col.key) ?? col.key;
        const colAliases = new Set([columnName, col.key, ...(COMMON_COLUMN_ALIASES[col.key] ?? [])]);
        if (columns[col.key]) {
            if (!opts.reconcileGhostColumns || knownIds.has(columns[col.key]) || knownColumns.length === 0) {
                lastKeyID = columns[col.key];
                continue;
            }
            const match = knownColumns.find((c: any) => colAliases.has(c?.name) || colAliases.has(c?.keyName));
            if (match?.id) {
                columns[col.key] = String(match.id);
                lastKeyID = columns[col.key];
                continue;
            }
            delete columns[col.key];
        }
        const keyID = newSiYuanId();
        const usedColIds = new Set(Object.values(columns).filter(Boolean));
        const currentMatches = knownColumns.filter((c: any) => !usedColIds.has(String(c?.id)) && (c?.id === keyID || colAliases.has(c?.name) || colAliases.has(c?.keyName)));
        if (currentMatches.length >= 1 && currentMatches[0]?.id) {
            columns[col.key] = String(currentMatches[0].id);
            lastKeyID = columns[col.key];
            continue;
        }
        if (col.type === "relation" && !memberAvId) {
            error = `relation column "${col.key}" deferred: members ledger pending`;
            continue;
        }
        try {
            await addAttributeViewColumn(avId, {
                keyID,
                name: columnName,
                type: col.type,
                relationTargetAvID: col.type === "relation" ? memberAvId : undefined,
                previousKeyID: lastKeyID,
            }, { idempotencyKey: `pcol:${avId}:${col.key}:${Date.now().toString(36)}`, retries: 0 });
            columns[col.key] = keyID;
            lastKeyID = keyID;
            knownColumns.push({ id: keyID, name: columnName });
            knownIds.add(keyID);
        } catch (e) {
            // The add may have committed while its response was lost. A
            // fresh view can safely recover the key; otherwise leave the
            // mapping missing so the next run can reconcile before creating.
            let recovered: any;
            for (let attempt = 0; attempt < (isWriteResultUnknown(e) ? 4 : 1); attempt++) {
                if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
                try {
                    const recoveredView = await renderLedger(avId);
                    const matches = (recoveredView.columns ?? []).filter((candidate: any) =>
                        candidate?.id === keyID || colAliases.has(candidate?.name) || colAliases.has(candidate?.keyName),
                    );
                    if (matches.length >= 1) {
                        recovered = matches[0];
                        knownColumns = recoveredView.columns ?? [];
                        break;
                    }
                } catch { /* keep trying briefly only when the write result is unknown */ }
            }
            if (recovered?.id) {
                columns[col.key] = String(recovered.id);
                continue;
            }
            // 补列失败不阻断建库（可重跑续补，33.2）
            error = `column "${col.key}": ${errText(e)}`;
            console.warn(`[LvHome] column "${col.key}" on "${moduleId}" deferred:`, error);
        }
    }
    return { columns, error };
}

/**
 * 为模块创建台账文档 + 数据库 + 全部列。幂等：
 * ① dbRefs 有效且非 provisional → 校验文档在（瞬态错误不重建）→ 补列续跑 → 清除旧错误；
 * ② 文档已存在但未登记（重装/手删设置）→ 找回 av 块复用原库 + 补列；
 * ③ 全新 → 建文档 → 建库 → 建列。单模块失败记 provisionError，不中断其他模块。
 */
export async function provisionModule(
    settings: HomeSettings,
    moduleId: string,
    schema: ModuleSchema,
    titleI18n: string,
    opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
    const existing = settings.dbRefs[moduleId];
    if (existing?.docId && !existing.provisional) {
        let docMissing = false;
        try {
            await getHPathByID(existing.docId);
        } catch (e) {
            if (!isDocMissingError(e)) {
                // D07：网络/瞬态错误 → 记录后原样返回，不重建（防误删/重复建库）
                existing.provisionError = `doc check: ${errText(e)}`;
                return { dbRef: existing, created: false };
            }
            docMissing = true; // 内核明确报错 → 文档已被删除，落到下方重建流程
        }
        if (!docMissing) {
            // 自愈追踪：核对文档当前最新的真实笔记本所属（防止用户在思源中移动了文档导致错位）
            let actualNotebook = existing.notebook;
            try {
                const boxRows = await sql<{ box: string }>(`SELECT box FROM blocks WHERE id='${existing.docId.replace(/'/g, "''")}' LIMIT 1`);
                if (boxRows[0]?.box) {
                    actualNotebook = boxRows[0].box;
                    await openNotebook(actualNotebook, { retries: 1 });
                }
            } catch { /* soft heal */ }

            // D08：复用原库 + 补列续跑（成功后清除旧 provisionError）
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error } = await ensureColumns(existing.avId, schema, existing.columns, moduleId, opts, memberAvId);
            const dbRef: DbRef = { ...existing, notebook: actualNotebook, columns, provisionError: error };
            settings.dbRefs[moduleId] = dbRef;
            return { dbRef, created: false };
        }
    }
    try {
        const notebookId = await ensureNotebook(existing?.notebook, settings.targetNotebookId);
        let effectiveRootPath = settings.rootPath?.trim() || "";
        if (!effectiveRootPath) {
            try {
                const nbs = await listNotebooks();
                const nb = nbs.find((n) => n.id === notebookId);
                if (nb && isXiaoLvHubNotebookName(nb.name)) {
                    effectiveRootPath = DEFAULT_HUB_ROOT_PATH;
                }
            } catch { /* ignore */ }
        }
        const hpath = ledgerHPath(titleI18n, effectiveRootPath ? { rootPath: effectiveRootPath, moduleId } : undefined);
        const found = await findLedgerDoc(notebookId, hpath, moduleId);
        if (found) {
            const actualNotebookId = found.box || notebookId;
            try {
                await openNotebook(actualNotebookId, { retries: 1 });
            } catch { /* ignore */ }
            // 补登记：优先找回文档内既有 av 块（D08），找不回才建新库
            let avId = await findAvBlockInDoc(found.id);
            if (!avId) {
                try {
                    avId = await createAttributeView(found.id, stableAvSeed(moduleId, found.id), { idempotencyKey: `provision:av:${moduleId}:${found.id}` });
                } catch {
                    avId = null; // av 创建失败 → provisional 落库，诊断可见
                }
            }
            const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
            const { columns, error } = await ensureColumns(avId, schema, existing?.columns, moduleId, opts, memberAvId);
            const dbRef: DbRef = { ...existing, docId: found.id, avId: avId ?? undefined, notebook: actualNotebookId, provisional: !avId, columns, provisionError: error };
            settings.dbRefs[moduleId] = dbRef;
            return { dbRef, created: false };
        }
        let docId: string;
        const docHeaderMarkdown = `# ${titleI18n}\n\n> 🏠 **小驴管家 · ${titleI18n}台账**\n> 💡 快捷直达：按 \`Ctrl+Alt+H\` 可在任意界面随时呼出管家面板；下方为思源原生属性视图数据库（AttributeView），支持直接编辑、增减行与双向同步。\n\n`;
        try {
            docId = await createDocWithMd(notebookId, hpath, docHeaderMarkdown, {
                idempotencyKey: `provision:doc:${moduleId}:${notebookId}:${hpath}`,
                retries: 0,
            });
        } catch (error) {
            let recovered: FoundLedgerDoc | null = null;
            for (let attempt = 0; attempt < 6 && !recovered; attempt++) {
                if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
                recovered = await findLedgerDoc(notebookId, hpath, moduleId);
            }
            if (recovered) {
                docId = recovered.id;
            } else {
                // 自愈降级：若创建文档报冲突或已存在异常，生成带自愈后缀的新路径，保障建库流程绝不卡死
                const errStr = String(error);
                if (errStr.includes("409") || errStr.includes("exist") || errStr.includes("conflict")) {
                    const fallbackHPath = `${hpath}_${Date.now().toString(36)}`;
                    docId = await createDocWithMd(notebookId, fallbackHPath, docHeaderMarkdown, { retries: 1 });
                } else {
                    throw error;
                }
            }
        }
        const avIdSeed = stableAvSeed(moduleId, docId);
        let avId: string | undefined;
        let provisional = false;
        let provisionError: string | undefined;
        try {
            avId = await createAttributeView(docId, avIdSeed, { idempotencyKey: `provision:av:${moduleId}:${docId}` });
        } catch (e) {
            provisional = true;
            provisionError = errText(e);
            console.warn(`[LvHome] module "${moduleId}" provisioned provisionally:`, provisionError);
        }
        const memberAvId = moduleId === "members" ? undefined : settings.dbRefs.members?.avId;
        const { columns, error } = await ensureColumns(avId, schema, undefined, moduleId, opts, memberAvId);
        const dbRef: DbRef = { docId, avId, notebook: notebookId, provisional, columns, provisionError: provisionError ?? error };
        settings.dbRefs[moduleId] = dbRef;
        return { dbRef, created: true };
    } catch (e) {
        // D07：笔记本/文档创建失败（含瞬态）→ 记录，不向上抛（不中断其他模块建库）
        const msg = errText(e);
        console.warn(`[LvHome] provision "${moduleId}" failed:`, msg);
        const dbRef: DbRef = { ...existing, provisionError: msg };
        settings.dbRefs[moduleId] = dbRef;
        return { dbRef, created: false };
    }
}
