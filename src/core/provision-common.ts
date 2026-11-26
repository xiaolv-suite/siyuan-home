/**
 * 台账建库与历史认领公共底座 (ProvisionCommon)
 * 下沉建库基础常量、笔记本守卫、文档定位与列结构自愈函数，彻底切断 provisioner 与 provision-adoption 循环依赖。
 */

import type { DbRef } from "@/types";
import type { ModuleSchema } from "./schema-types";
import {
    sql,
    listNotebooks,
    createNotebook,
    openNotebook,
    renderLedger,
    renderLedgerAll,
    getBlockDOM,
    parseDataAvIdFromDom,
    AvBindingMismatchError,
    addAttributeViewColumn,
    idempotentAppendDetachedRows,
    buildPrimaryBlockCell,
    isWriteResultUnknown,
} from "./siyuan";
import { errText } from "./settings";

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
    return /^(🐴\s*)?小驴(生态|空间|笔记本)/.test(name.trim());
}

/** 历史版本模块中文标题别名表（老版本平滑升级兼容与自动找回引擎） */
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
    socializing: ["人脉社交", "交往档案"],
    vehicles: ["车辆档案", "爱车档案"],
    transit: ["通勤路网", "通勤打卡"],
    "travel-plan": ["行程攻略", "旅行规划"],
    "travel-booking": ["预订单据", "机票酒店"],
    "travel-packing": ["行前清单", "行李打包"],
    "travel-log": ["旅行足迹", "旅行随记"],
    media: ["影音书库", "书影音"],
};

/** 思源 ID 形态（yyyyMMddHHmmss-xxxxxxx） */
const SIYUAN_ID_RE = /^\d{14}-[0-9a-z]{7}$/;
const NOTEBOOK_RECOVERY_ATTEMPTS = 5;
const NOTEBOOK_RECOVERY_DELAY_MS = 250;

export function isSiYuanId(v: string | undefined): boolean {
    return !!v && SIYUAN_ID_RE.test(v);
}

function newSiYuanId(): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${ts}-${rand}`;
}

async function createNotebookWithRecovery(name: string): Promise<string> {
    try {
        return await createNotebook(name, { idempotencyKey: `provision:notebook:create:${name}`, retries: 0 });
    } catch (error) {
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
 * 确保专用笔记本可用，返回笔记本 ID（D07）
 */
export async function ensureNotebook(preferred?: string, defaultNotebookId?: string): Promise<string> {
    const notebooks = await listNotebooks();
    const byId = (id: string) => notebooks.find((nb) => nb.id === id);
    const byName = (name: string) => notebooks.find((nb) => nb.name === name);

    // 1. 最高优先级：用户在设置中显式指定的自选目标笔记本
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

    // 3. 第三优先级：优先复用统一生态大本营笔记本，其次为默认笔记本名称
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
        const openNb = notebooks.find((n) => !n.closed) || notebooks[0];
        if (openNb) {
            if (openNb.closed) await openNotebook(openNb.id, { idempotencyKey: `provision:notebook:open:${openNb.id}`, retries: 1 });
            return openNb.id;
        }
        throw e;
    }
}

/** 台账文档 hpath */
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

export interface FoundAvBlockRef {
    avId: string;
    avBlockId: string;
    fromLiveDom: boolean;
}

function isConflictDocRow(r: { hpath?: string; content?: string }): boolean {
    return /[（(]冲突/.test(String(r.hpath ?? "")) || /[（(]冲突/.test(String(r.content ?? ""));
}

const CONFLICT_SQL_FILTER = "AND hpath NOT LIKE '%(冲突%' AND hpath NOT LIKE '%（冲突%' AND (content IS NULL OR (content NOT LIKE '%(冲突%' AND content NOT LIKE '%（冲突%'))";

/**
 * 健壮找回台账文档（严格排除多端同步冲突副本）：
 * 1. 优先在指定的 notebookId 找精确 hpath；
 * 2. 如果同一笔记本内有多份同名文档，优先选取包含已有 av 块的文档，次选最新修改的文档；
 * 3. 如果指定笔记本没有找到，按模块历史别名扩展查找；
 * 4. 如果仍未找到，全局跨所有笔记本搜寻带有该模块台账特征的文档。
 */
export async function findLedgerDoc(notebookId: string, hpath: string, moduleId?: string): Promise<FoundLedgerDoc | null> {
    try {
        const escapedHpath = hpath.replace(/'/g, "''");
        const leafSegment = `/${hpath.split("/").filter(Boolean).pop() || ""}`.replace(/'/g, "''");
        const escapedBox = notebookId.replace(/'/g, "''");
        const rawRows = await sql<{ id: string; box: string; updated: string; hpath?: string; content?: string }>(
            `SELECT id, box, updated, hpath, content FROM blocks WHERE type='d' AND box='${escapedBox}' ${CONFLICT_SQL_FILTER} AND (hpath='${escapedHpath}' OR hpath LIKE '%${escapedHpath}' OR hpath='${leafSegment}' OR hpath LIKE '%${leafSegment}') ORDER BY updated DESC LIMIT 8`,
        );
        const rows = rawRows.filter((r) => !isConflictDocRow(r));
        if (rows.length === 1) return { id: rows[0].id, box: rows[0].box || notebookId };
        if (rows.length > 1) {
            for (const r of rows) {
                const av = await findAvBlockInDoc(r.id);
                if (av) return { id: r.id, box: r.box || notebookId };
            }
            return { id: rows[0].id, box: rows[0].box || notebookId };
        }

        if (moduleId && MODULE_TITLE_ALIASES[moduleId]) {
            for (const alias of MODULE_TITLE_ALIASES[moduleId]) {
                const aliasHpath = `/${DOC_TITLE_PREFIX}${alias}`.replace(/'/g, "''");
                const rawAlias = await sql<{ id: string; box: string; hpath?: string; content?: string }>(
                    `SELECT id, box, hpath, content FROM blocks WHERE type='d' AND box='${escapedBox}' ${CONFLICT_SQL_FILTER} AND (hpath='${aliasHpath}' OR hpath LIKE '%${aliasHpath}') ORDER BY updated DESC LIMIT 4`,
                );
                const aliasRows = rawAlias.filter((r) => !isConflictDocRow(r));
                if (aliasRows.length > 0) return { id: aliasRows[0].id, box: aliasRows[0].box || notebookId };
            }
        }

        const rawGlobal = await sql<{ id: string; box: string; hpath?: string; content?: string }>(
            `SELECT id, box, hpath, content FROM blocks WHERE type='d' ${CONFLICT_SQL_FILTER} AND (hpath='${escapedHpath}' OR hpath LIKE '%${escapedHpath}') ORDER BY updated DESC LIMIT 8`,
        );
        const globalRows = rawGlobal.filter((r) => !isConflictDocRow(r));
        if (globalRows.length > 0) {
            for (const r of globalRows) {
                const av = await findAvBlockInDoc(r.id);
                if (av) return { id: r.id, box: r.box };
            }
            return { id: globalRows[0].id, box: globalRows[0].box };
        }

        if (moduleId && MODULE_TITLE_ALIASES[moduleId]) {
            for (const alias of MODULE_TITLE_ALIASES[moduleId]) {
                const rawGlobalAlias = await sql<{ id: string; box: string; hpath?: string; content?: string }>(
                    `SELECT id, box, hpath, content FROM blocks WHERE type='d' ${CONFLICT_SQL_FILTER} AND hpath LIKE '%${alias.replace(/'/g, "''")}%' ORDER BY updated DESC LIMIT 5`,
                );
                const globalAliasRows = rawGlobalAlias.filter((r) => !isConflictDocRow(r));
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

/**
 * 在文档内解析 NodeAttributeView 块及其真实 data-av-id（绝不把 blocks.id 误当 avId）。
 */
export async function findAvBlockRefInDoc(docId: string): Promise<FoundAvBlockRef | null> {
    try {
        const escapedDocId = docId.replace(/'/g, "''");
        const rows = await sql<{ id: string; markdown?: string }>(
            `SELECT id, markdown FROM blocks WHERE (type='av' OR markdown LIKE '%data-type="NodeAttributeView"%') AND root_id='${escapedDocId}' LIMIT 5`,
        );
        if (!Array.isArray(rows) || rows.length === 0) return null;

        const candidates: FoundAvBlockRef[] = [];
        for (const r of rows) {
            let liveDomAvId: string | null = null;
            let gotDom = false;
            try {
                const domRes = await getBlockDOM(r.id);
                if (domRes && typeof domRes.dom === "string" && domRes.dom.trim().length > 0) {
                    gotDom = true;
                    liveDomAvId = parseDataAvIdFromDom(domRes.dom);
                }
            } catch { /* fallback to markdown/mock */ }

            if (gotDom) {
                if (liveDomAvId) {
                    candidates.push({ avId: liveDomAvId, avBlockId: r.id, fromLiveDom: true });
                }
                continue;
            }
            const mdAvId = parseDataAvIdFromDom(r.markdown);
            candidates.push({ avId: mdAvId || r.id, avBlockId: r.id, fromLiveDom: Boolean(mdAvId) });
        }

        if (candidates.length === 1) return candidates[0];
        if (candidates.length > 1) {
            for (const c of candidates) {
                try {
                    const view = await renderLedger(c.avId, undefined, undefined, { blockID: c.avBlockId });
                    if (view && view.columns && view.columns.length > 0) return c;
                } catch { /* soft */ }
            }
            return candidates[0];
        }
    } catch { /* soft */ }
    return null;
}

export async function findAvBlockInDoc(docId: string): Promise<string | null> {
    const found = await findAvBlockRefInDoc(docId);
    return found ? found.avId : null;
}

/**
 * 强校验 dbRef.avId === 文档内真实 data-av-id；
 * 若发现撕裂（dbRefs.avId !== data-av-id），立即抛出 AvBindingMismatchError 阻断盲写。
 * 若原 ref 缺 avBlockId 但 data-av-id 校验一致，自动补全 avBlockId。
 */
export async function verifyAvRefBound(ref: DbRef | undefined): Promise<void> {
    if (!ref?.avId) return;
    if (ref.avBlockId) {
        let domRes: { id: string; dom: string } | null = null;
        try {
            domRes = await getBlockDOM(ref.avBlockId);
        } catch {
            return; // 网络或最小 mock 无此端点时不误杀；有返回才严格校验
        }
        if (domRes && typeof domRes.dom === "string" && domRes.dom.trim().length > 0) {
            const actualDataAvId = parseDataAvIdFromDom(domRes.dom);
            if (!actualDataAvId) {
                throw new AvBindingMismatchError(
                    `AV container block ${ref.avBlockId} has no data-av-id attribute`,
                );
            }
            if (actualDataAvId !== ref.avId) {
                throw new AvBindingMismatchError(
                    `dbRefs.avId (${ref.avId}) !== live data-av-id (${actualDataAvId}) on block ${ref.avBlockId}`,
                );
            }
            ref.schema = ref.schema || "home-ledger-v2";
            ref.schemaVersion = ref.schemaVersion || 2;
        }
        return;
    }

    if (ref.docId) {
        const live = await findAvBlockRefInDoc(ref.docId);
        if (live && live.fromLiveDom) {
            if (live.avId !== ref.avId) {
                throw new AvBindingMismatchError(
                    `dbRefs.avId (${ref.avId}) !== doc(${ref.docId}) live data-av-id (${live.avId})`,
                );
            }
            ref.avBlockId = live.avBlockId;
            ref.schema = ref.schema || "home-ledger-v2";
            ref.schemaVersion = ref.schemaVersion || 2;
        }
    }
}

/**
 * 撕裂恢复/合并路径：当旧 dbRef.avId 指向孤立 AV 而文档可见块为 live data-av-id 时，
 * 将孤立 AV 中尚未存在于文档可见 AV 的行通过 appendAttributeViewDetachedBlocksWithValues 迁入可见 AV，
 * 并重绑 dbRef 到文档真实 data-av-id 与 avBlockId。
 */
export async function reconcileTornAvRef(ref: DbRef): Promise<{ migratedRows: number; newAvId: string; newAvBlockId: string } | null> {
    if (!ref.docId || !ref.avId) return null;
    const live = await findAvBlockRefInDoc(ref.docId);
    if (!live || live.avId === ref.avId) return null;

    let migratedRows = 0;
    try {
        const orphan = await renderLedgerAll(ref.avId, 100);
        const visible = await renderLedgerAll(live.avId, 100, { blockID: live.avBlockId });
        const pkCol = visible.columns.find((c: any) => c.type === "block") || visible.columns[0];
        const visibleIds = new Set(visible.rows.map((r) => r.itemID));

        const colIdMap = new Map<string, string>();
        for (const oCol of orphan.columns) {
            const match = visible.columns.find((vCol: any) => vCol.id === oCol.id || (vCol.name && vCol.name === oCol.name));
            if (match?.id) colIdMap.set(oCol.id, match.id);
        }

        const orphanItems: Array<{ extKey: string; cells: Array<Record<string, unknown>> }> = [];
        for (const oRow of orphan.rows) {
            if (visibleIds.has(oRow.itemID)) continue;
            const rowCells: Array<Record<string, unknown>> = [];
            let rowName = "";
            for (const [oldColId, cell] of Object.entries(oRow.cells)) {
                const targetKeyId = colIdMap.get(oldColId) ?? (pkCol?.id && cell?.type === "block" ? pkCol.id : undefined);
                if (!targetKeyId || !cell) continue;
                if (pkCol && targetKeyId === pkCol.id) {
                    rowName = String(cell?.block?.content ?? cell?.text?.content ?? "").trim() || "未命名";
                    rowCells.push(buildPrimaryBlockCell({ keyID: pkCol.id, itemID: oRow.itemID, content: rowName, includeRichNull: true }));
                } else {
                    rowCells.push({ ...cell, keyID: targetKeyId, itemID: oRow.itemID });
                }
            }
            if (pkCol?.id && !rowCells.some((c) => c.keyID === pkCol.id)) {
                rowName = rowName || "未命名";
                rowCells.unshift(buildPrimaryBlockCell({ keyID: pkCol.id, itemID: oRow.itemID, content: rowName, includeRichNull: true }));
            }
            if (rowCells.length > 0 && pkCol?.id) {
                orphanItems.push({ extKey: rowName || oRow.itemID, cells: rowCells });
            }
        }

        if (orphanItems.length > 0 && pkCol?.id) {
            const batchRes = await idempotentAppendDetachedRows({
                dbRef: { avId: live.avId, avBlockId: live.avBlockId, docId: ref.docId },
                extKeyID: pkCol.id,
                primaryKeyID: pkCol.id,
                rows: orphanItems,
                getExternalKey: (item) => item.extKey,
                toCells: (item) => item.cells,
            });
            migratedRows = batchRes.inserted;
        }
    } catch { /* 如果孤立表已不可读，仍重绑到文档可见 AV */ }

    ref.avId = live.avId;
    ref.avBlockId = live.avBlockId;
    ref.schema = "home-ledger-v2";
    ref.schemaVersion = 2;
    ref.provisionError = undefined;
    return { migratedRows, newAvId: live.avId, newAvBlockId: live.avBlockId };
}

export interface ProvisionResult {
    dbRef: DbRef;
    created: boolean;
}

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
    last_fuel_date: ["最近补能日", "最近加油日", "last_fuel_date"],
    total_fuel_cost: ["累计油电费", "累计油费/电费", "累计油费", "total_fuel_cost"],
    yearly_fuel_cost: ["本年油电费", "本年油费/电费", "本年油费", "yearly_fuel_cost"],
    avg_consumption: ["综合油耗/能耗", "综合油耗", "平均油耗", "avg_consumption"],
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
            const match = knownColumns.find((c: any) => colAliases.has(c?.name) || colAliases.has(c?.keyName) || (col.key === "name" && c?.type === "block"));
            if (match?.id) {
                columns[col.key] = String(match.id);
                lastKeyID = columns[col.key];
                continue;
            }
            delete columns[col.key];
        }
        const keyID = newSiYuanId();
        const usedColIds = new Set(Object.values(columns).filter(Boolean));
        const currentMatches = knownColumns.filter((c: any) => !usedColIds.has(String(c?.id)) && (c?.id === keyID || colAliases.has(c?.name) || colAliases.has(c?.keyName) || (col.key === "name" && c?.type === "block")));
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
            let recovered: any;
            for (let attempt = 0; attempt < (isWriteResultUnknown(e) ? 4 : 1); attempt++) {
                if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
                try {
                    const recoveredView = await renderLedger(avId);
                    const matches = (recoveredView.columns ?? []).filter((candidate: any) =>
                        candidate?.id === keyID || colAliases.has(candidate?.name) || colAliases.has(candidate?.keyName) || (col.key === "name" && candidate?.type === "block"),
                    );
                    if (matches.length >= 1) {
                        recovered = matches[0];
                        knownColumns = recoveredView.columns ?? [];
                        break;
                    }
                } catch { /* soft */ }
            }
            if (recovered?.id) {
                columns[col.key] = String(recovered.id);
                continue;
            }
            error = `column "${col.key}": ${errText(e)}`;
            console.warn(`[LvHome] column "${col.key}" on "${moduleId}" deferred:`, error);
        }
    }
    return { columns, error };
}
