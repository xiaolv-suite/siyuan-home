/**
 * 囤货采购建议（16 组/188 波）：低库存行汇总为可编辑采购清单。
 * 纯逻辑，无思源依赖，可单测。评估口径与 H15 数值阈值规则一致：
 * qty 与阈值均有值且 qty ≤ 阈值才入清单（缺列/缺值不评估，不误报）。
 */
import type { AvRow } from "./siyuan";
import { bindDialogA11y } from "./dialog-a11y";
import type { AvCellLike } from "./avcell";

export interface ShoppingItem {
    name: string;
    qty: number;
    threshold: number;
    /** 建议购买量 = 补回阈值（至少 1）——对话框可改，复制清单按此值 */
    suggest: number;
}

function num(v: AvCellLike | null | undefined): number | undefined {
    return v?.number?.isNotEmpty && typeof v.number.content === "number" ? v.number.content : undefined;
}

function nameOf(v: AvCellLike | null | undefined): string {
    return String(v?.text?.content ?? v?.block?.content ?? "").trim();
}

export function buildShoppingList(
    rows: AvRow[],
    keys: { nameKey: string; qtyKey: string; thresholdKey: string },
): ShoppingItem[] {
    const out: ShoppingItem[] = [];
    for (const r of rows) {
        const name = nameOf(keys.nameKey ? r.cells[keys.nameKey] : undefined);
        const qty = num(keys.qtyKey ? r.cells[keys.qtyKey] : undefined);
        const threshold = num(keys.thresholdKey ? r.cells[keys.thresholdKey] : undefined);
        if (!name || qty === undefined || threshold === undefined) continue;
        if (qty > threshold) continue;
        out.push({ name, qty, threshold, suggest: Math.max(1, threshold - qty) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── 卡券模式（G3，312 波）────────────────────────────────────────
// 调研印证：OpenFamily 的 aisle-by-aisle store mode、KitchenOwl 的触屏快捷勾选。
// 核心不是新数据模型，而是把已有的 shopping 行按“超市动线”分组并允许就地勾选。

export interface StoreModeItem {
    /** 台账行 id（勾选回写用） */
    itemID: string;
    name: string;
    category: string;
    qty?: number;
    note?: string;
}

export interface StoreModeGroup {
    /** 分类 key（select 值）；空串表示“未分类” */
    category: string;
    items: StoreModeItem[];
}

/** 分类展示顺序：与超市动线一致（日用 → 数码 → 服饰 → 食品 → 愿望 → 其他） */
export const STORE_CATEGORY_ORDER = ["daily", "digital", "apparel", "food_sh", "wish", "other_sh"];

/**
 * 把 shopping 行按分类分组，并按动线顺序排列；组内按名称排序。
 * 只保留有名称的行（空名称不参与扫货）。
 */
export function groupShoppingByCategory(
    rows: Array<{ itemID: string; cells: Record<string, AvCellLike> }>,
    cols: { nameKey: string; categoryKey?: string; qtyKey?: string; noteKey?: string },
): StoreModeGroup[] {
    const buckets = new Map<string, StoreModeItem[]>();
    for (const r of rows ?? []) {
        const name = nameOf(cols.nameKey ? r.cells[cols.nameKey] : undefined);
        if (!name) continue;
        const category = String(
            cols.categoryKey ? r.cells[cols.categoryKey]?.mSelect?.[0]?.content ?? r.cells[cols.categoryKey]?.select?.content ?? "" : "",
        );
        const qty = num(cols.qtyKey ? r.cells[cols.qtyKey] : undefined);
        const note = String(cols.noteKey ? r.cells[cols.noteKey]?.text?.content ?? r.cells[cols.noteKey]?.block?.content ?? "" : "").trim();
        const item: StoreModeItem = { itemID: r.itemID, name, category };
        if (qty !== undefined) item.qty = qty;
        if (note) item.note = note;
        const list = buckets.get(category) ?? [];
        list.push(item);
        buckets.set(category, list);
    }

    const rank = (c: string) => {
        const i = STORE_CATEGORY_ORDER.indexOf(c);
        return i === -1 ? STORE_CATEGORY_ORDER.length : i;
    };
    return [...buckets.entries()]
        .map(([category, items]) => ({ category, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category));
}

/**
 * 扫货进度：已勾选 / 总数 / 分组进度
 */
export function storeModeProgress(
    groups: StoreModeGroup[],
    checked: ReadonlySet<string>,
): { checked: number; total: number; byGroup: Array<{ category: string; checked: number; total: number }> } {
    let done = 0;
    let total = 0;
    const byGroup: Array<{ category: string; checked: number; total: number }> = [];
    for (const g of groups) {
        let gChecked = 0;
        for (const it of g.items) {
            total++;
            if (checked.has(it.itemID)) gChecked++;
        }
        done += gChecked;
        byGroup.push({ category: g.category, checked: gChecked, total: g.items.length });
    }
    return { checked: done, total, byGroup };
}

/** 切换勾选状态（不修改入参） */
export function toggleStoreItem(checked: ReadonlySet<string>, itemID: string): Set<string> {
    const next = new Set(checked);
    if (next.has(itemID)) next.delete(itemID);
    else next.add(itemID);
    return next;
}

/** 扫货清单文本（按分组，已勾选的标 ✔） */
export function formatStoreModeText(
    groups: StoreModeGroup[],
    checked: ReadonlySet<string>,
    label: (category: string) => string = (c) => c || "未分类",
): string {
    const lines: string[] = [];
    for (const g of groups) {
        lines.push(`【${label(g.category)}】`);
        for (const it of g.items) {
            const mark = checked.has(it.itemID) ? "☑" : "☐";
            lines.push(`  ${mark} ${it.name}${it.qty !== undefined ? ` ×${it.qty}` : ""}`);
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

export interface LowStockShoppingDialogOptions {
    ref: { avId?: string; columns?: Record<string, string> };
    allRows: any[];
    t: (k: string) => string;
    plugin: any;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

export function openLowStockShoppingDialog(options: LowStockShoppingDialogOptions): void {
    if (typeof document === "undefined") return;
    const { ref, allRows, t, plugin, DialogCls, showMessageFn } = options;
    if (!ref.columns?.name || !ref.columns.qty || !ref.columns.low_stock_at) return;

    const items = buildShoppingList(allRows, {
        nameKey: ref.columns.name,
        qtyKey: ref.columns.qty,
        thresholdKey: ref.columns.low_stock_at,
    });

    const dlg = new DialogCls({
        title: t("ledger.shoppingList"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-shop-body"></div>
<div class="b3-dialog__action"><span class="lv-caption fn__flex-1" id="lv-shop-total"></span><button class="b3-button b3-button--cancel" id="lv-shop-close">${t("cancel")}</button><button class="b3-button b3-button--text" id="lv-shop-copy" ${items.length === 0 ? "disabled" : ""}>${t("ledger.shopCopy")}</button><button class="b3-button" id="lv-shop-write" ${items.length === 0 ? "disabled" : ""}>${t("ledger.shopWriteToLedger")}</button></div>`,
        width: "560px",
    });

    bindDialogA11y({ dlg });
    const body = dlg.element.querySelector("#lv-shop-body") as HTMLElement;
    if (items.length === 0) {
        const none = document.createElement("div");
        none.className = "ft__on-surface fn__text-center";
        none.textContent = t("ledger.shopEmpty");
        body.appendChild(none);
    }

    const qtyInputs: HTMLInputElement[] = [];
    for (const it of items) {
        const line = document.createElement("div");
        line.className = "lv-dialog-row";
        line.style.borderBottom = "1px solid var(--lv-line)";
        const label = document.createElement("span");
        label.className = "lv-word-break lv-dialog-name";
        label.textContent = it.name;
        const meta = document.createElement("span");
        meta.className = "lv-caption";
        meta.style.flexShrink = "0";
        meta.textContent = t("ledger.shopExisting").replace("${q}", String(it.qty)).replace("${t2}", String(it.threshold));
        const input = document.createElement("input");
        input.type = "number";
        input.inputMode = "numeric";
        input.className = "b3-text-field lv-input-time-sm";
        input.min = "1";
        input.value = String(it.suggest);
        input.title = t("ledger.shopBuy");
        qtyInputs.push(input);
        line.append(label, meta, input);
        body.appendChild(line);
    }

    const total = dlg.element.querySelector("#lv-shop-total") as HTMLElement;
    if (total) total.textContent = t("ledger.shopTotal").replace("${n}", String(items.length));

    const closeBtn = dlg.element.querySelector("#lv-shop-close") as HTMLButtonElement | null;
    if (closeBtn) closeBtn.onclick = () => dlg.destroy();

    const copyBtn = dlg.element.querySelector("#lv-shop-copy") as HTMLButtonElement | null;
    if (copyBtn) {
        copyBtn.onclick = async () => {
            const lines = items
                .map((it, i) => `${it.name} ×${Math.max(1, Math.floor(Number(qtyInputs[i]?.value) || 1))}`)
                .join("\n");
            const text = `${t("ledger.shoppingList")} · ${new Date().toISOString().slice(0, 10)}\n${lines}`;
            try {
                await navigator.clipboard.writeText(text);
                showMessageFn(t("ledger.shopCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.shopCopyFailed"), 4000, "error");
            }
        };
    }

    const writeBtn = dlg.element.querySelector("#lv-shop-write") as HTMLButtonElement | null;
    if (writeBtn) {
        writeBtn.onclick = async () => {
            const shoppingRef = plugin.settings?.dbRefs?.["shopping"];
            if (!shoppingRef?.avId || !shoppingRef.columns?.name) {
                showMessageFn(t("capture.ledgerUnavailable").replace("${module}", t("module.shopping")), 5000, "info");
                return;
            }
            writeBtn.disabled = true;
            try {
                const { addDetachedRow, setCell } = await import("./siyuan");
                for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    const buyQty = Math.max(1, Math.floor(Number(qtyInputs[i]?.value) || 1));
                    const rowId = await addDetachedRow(shoppingRef.avId, it.name, { idempotencyKey: `stock:to-shop:${it.name}:${Date.now()}` });
                    if (shoppingRef.columns.qty) {
                        await setCell(shoppingRef.avId, shoppingRef.columns.qty, rowId, { type: "number", number: { content: buyQty } });
                    }
                }
                dlg.destroy();
                showMessageFn(t("ledger.shopWritten"), 3000, "info");
            } catch (e) {
                writeBtn.disabled = false;
                showMessageFn(String(e), 5000, "error");
            }
        };
    }
}

export interface ShoppingBatchStockInDraft {
    name: string;
    qty: number;
    price?: number;
    channel?: string;
    category?: string;
    sourceRowId: string;
}

/**
 * 从选定的 shopping 台账行构建批量转入 stock 囤货库的草稿数据（shopping → stock 全闭环）
 */
export function buildBatchStockInFromShopping(
    selectedRows: readonly any[],
    shoppingCols: Record<string, string>
): ShoppingBatchStockInDraft[] {
    const drafts: ShoppingBatchStockInDraft[] = [];
    for (const r of selectedRows) {
        const nameCell = shoppingCols.name ? r.cells?.[shoppingCols.name] : undefined;
        const name = String(nameCell?.text?.content || nameCell?.block?.content || "").trim();
        if (!name) continue;

        const qtyCell = shoppingCols.qty ? r.cells?.[shoppingCols.qty] : undefined;
        const qty = typeof qtyCell?.number?.content === "number" && qtyCell.number.content > 0
            ? qtyCell.number.content
            : 1;

        const priceCol = shoppingCols.price || shoppingCols.amount;
        const priceCell = priceCol ? r.cells?.[priceCol] : undefined;
        const price = typeof priceCell?.number?.content === "number" ? priceCell.number.content : undefined;

        const channelCell = shoppingCols.channel ? r.cells?.[shoppingCols.channel] : undefined;
        const channel = String(channelCell?.text?.content || "").trim() || undefined;

        const catCell = shoppingCols.category ? r.cells?.[shoppingCols.category] : undefined;
        const cat = String(catCell?.select?.content || "").trim() || undefined;

        drafts.push({
            name,
            qty,
            price,
            channel,
            category: cat,
            sourceRowId: r.itemID,
        });
    }
    return drafts;
}


