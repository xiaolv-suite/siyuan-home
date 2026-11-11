/**
 * 台账行详情抽屉各生活模块专属扩展板块
 * 包含：资产折旧测算与估值移动、采购储蓄与比价、家政轮值、健康体征、房屋能耗与保修关联合同、
 * 食品过敏原与忌口排查、教育学段升学进度、宠物照护与年龄换算、旅行检查清单、
 * 影音追更出借、育儿辅食观察排查、家庭成员退休进度测算
 */

import { formatAmount } from "./format";
import * as rl from "./rowlog";
import type { LogKind } from "./rowlog";
import { uiIcon } from "@/ui/icons";
import {
    renderHouseWarrantySection,
    renderFoodDietarySection,
    renderSchoolingStageSection,
    renderPetCareSection,
    renderParentingFeedingSection,
    renderSocialRetirementSection,
} from "./drawer-domain-sections";

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderModuleSpecificSectionsOptions {
    body: HTMLElement;
    active: string;
    row: any;
    ref: { avId?: string; docId?: string; columns?: Record<string, string> };
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    dlg?: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    rawFromValue: (type: string, v: any) => any;
    addRowLogSection: (opts: {
        title: string;
        emptyText: string;
        addLabel: string;
        kind: LogKind;
        fields: { key: string; type: "text" | "number" | "date"; placeholder: string; width: number }[];
        load: () => Promise<any[]>;
        add: (values: Record<string, string>) => Promise<boolean>;
        remove: (entry: any) => Promise<void>;
        format: (entry: any) => string;
    }) => Promise<void>;
}

export async function renderModuleSpecificSections(options: RenderModuleSpecificSectionsOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const {
        body,
        active,
        row,
        ref,
        plugin,
        t,
        DialogCls,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
        rawFromValue,
        addRowLogSection,
    } = options;

    const fresh = () => rl.loadRowLogs(plugin);
    const at = () => new Date().toISOString();

    if (active === "assets-real") {
        const costVal = Number(row.cells?.[ref.columns?.amount ?? ""]?.number?.content);
        const dateVal = String(rawFromValue("date", row.cells?.[ref.columns?.date ?? ""]) ?? "").slice(0, 10);
        if (Number.isFinite(costVal) && costVal > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
            const { calculateAssetDepreciation } = await import("./depreciation");
            const dep = calculateAssetDepreciation({ initialCost: costVal, purchaseDate: dateVal });
            if (dep) {
                const depCard = document.createElement("section");
                depCard.className = "lv-card lv-notice-card fn__text-left";
                depCard.innerHTML = `
                    <div class="lv-row-split" style="margin-bottom:6px">
                        <b>${uiIcon("money", "", 13)} 资产折旧与法定残值测算</b>
                        <span class="lv-badge">${dep.statusLabel}</span>
                    </div>
                    <div class="lv-diag-grid" style="font-size:11.5px;color:var(--lv-tx-2)">
                        <div>购入原值: <b class="lv-tx">¥${formatAmount(dep.initialCost)}</b></div>
                        <div>当前估算净值: <b class="lv-tx-accent">¥${formatAmount(dep.currentNetValue)}</b></div>
                        <div>已服役月数: <b class="lv-tx">${dep.usedMonths} / ${dep.lifespanMonths} 月</b></div>
                        <div>累计计提折旧: <b class="lv-tx-danger">¥${formatAmount(dep.accumulatedDepreciation)}</b></div>
                    </div>
                    <div class="lv-caption lv-tx-muted" style="margin-top:6px;display:flex;align-items:center;gap:4px">${uiIcon("sparkle", "", 12)} <span>${dep.suggestion}</span></div>
                `;
                body.appendChild(depCard);
            }
        }
        await addRowLogSection({
            title: t("ledger.valuations"), emptyText: t("ledger.noValuations"), addLabel: t("ledger.valAdd"), kind: "valuations",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "value", type: "number", placeholder: t("ledger.valValue"), width: 100 },
            ],
            load: () => fresh().then((l) => rl.getValuations(l, ref.avId!, row.itemID)),
            add: async (v) => {
                if (!Number.isFinite(Number(v.value))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendValuation(current, ref.avId!, row.itemID, v.date, Number(v.value), at()));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeValuation(current, ref.avId!, row.itemID, e.date)); },
            format: (e) => `${e.date} · ${e.value}`,
        });
        await addRowLogSection({
            title: t("ledger.moves"), emptyText: t("ledger.noMoves"), addLabel: t("ledger.valAdd"), kind: "moves",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "from", type: "text", placeholder: t("ledger.moveFrom"), width: 90 },
                { key: "to", type: "text", placeholder: t("ledger.moveTo"), width: 90 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "moves")),
            add: async (v) => {
                if (!v.from || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "moves", { date: v.date, from: v.from, to: v.to, at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "moves", e)); },
            format: (e) => `${e.date} · ${esc(e.from)} ${uiIcon("forward", "", 12)} ${esc(e.to)}`,
        });
    } else if (active === "shopping") {
        (async () => {
            const targetCell = row.cells?.[ref.columns?.target_amount ?? ""]?.number;
            const target = targetCell?.isNotEmpty && typeof targetCell.content === "number" ? targetCell.content : undefined;
            const logs = await rl.loadRowLogs(plugin);
            const entries = rl.getEntries<any>(logs, ref.avId!, row.itemID, "deposits");
            const saved = entries.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
            if (target !== undefined || entries.length > 0) {
                const head = document.createElement("div");
                head.className = "ft__on-surface lv-dialog-sec-head";
                const line = document.createElement("div");
                line.className = "lv-caption";
                line.textContent = `${t("ledger.savedOf").replace("${s}", formatAmount(saved)).replace("${t2}", target !== undefined ? formatAmount(target) : "—")}${target !== undefined && target > 0 ? ` (${Math.min(999, Math.round((saved / target) * 100))}%)` : ""}`;
                head.appendChild(line);
                if (target !== undefined && target > 0) {
                    const bar = document.createElement("div");
                    bar.className = "lv-member-retire-bar lv-mt-4";
                    const fill = document.createElement("div");
                    fill.className = "lv-member-retire-progress";
                    fill.style.width = `${Math.min(100, Math.round((saved / target) * 100))}%`;
                    bar.appendChild(fill);
                    head.appendChild(bar);
                }
                body.appendChild(head);
            }
        })().catch((e) => {
            showMessageFn(t("ledger.logReadFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        });
        await addRowLogSection({
            title: t("ledger.deposits"), emptyText: t("ledger.noDeposits"), addLabel: t("ledger.valAdd"), kind: "deposits",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "amount", type: "number", placeholder: t("ledger.depositAmt"), width: 100 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "deposits")),
            add: async (v) => {
                if (!v.date || !Number.isFinite(Number(v.amount))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "deposits", { date: v.date, amount: Number(v.amount), at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "deposits", e)); },
            format: (e) => `${e.date} · +${e.amount}`,
        });
        await addRowLogSection({
            title: t("ledger.prices"), emptyText: t("ledger.noPrices"), addLabel: t("ledger.valAdd"), kind: "prices",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "price", type: "number", placeholder: t("ledger.priceValue"), width: 90 },
                { key: "channel", type: "text", placeholder: t("ledger.priceChannel"), width: 100 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "prices")),
            add: async (v) => {
                if (!Number.isFinite(Number(v.price))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "prices", { date: v.date, price: Number(v.price), channel: v.channel, at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "prices", e)); },
            format: (e) => `${e.date} · ${formatAmount(Number(e.price))}${e.channel ? ` · ${esc(e.channel)}` : ""}`,
        });
    } else if (active === "chores") {
        const { addChoreRotationSectionImpl } = await import("./chore-dialog");
        await addChoreRotationSectionImpl({ t, plugin, avId: ref.avId!, rowId: row.itemID, body, showMessageFn });
    } else if (active === "health") {
        const { addVitalsSectionImpl } = await import("./vitals-dialog");
        await addVitalsSectionImpl({ t, plugin, avId: ref.avId!, rowId: row.itemID, body, showMessageFn });
    } else if (active === "schooling") {
        await addRowLogSection({
            title: t("ledger.transfers"), emptyText: t("ledger.noTransfers"), addLabel: t("ledger.valAdd"), kind: "transfers",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "from", type: "text", placeholder: t("ledger.transferFrom"), width: 90 },
                { key: "to", type: "text", placeholder: t("ledger.transferTo"), width: 90 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "transfers")),
            add: async (v) => {
                if (!v.from || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "transfers", { date: v.date, from: v.from, to: v.to, at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "transfers", e)); },
            format: (e) => `${e.date} · ${esc(e.from)} ${uiIcon("forward", "", 12)} ${esc(e.to)}`,
        });
        await renderSchoolingStageSection({ body, row, ref, t, cellTextFn });
    } else if (active === "house") {
        await addRowLogSection({
            title: t("ledger.meters"), emptyText: t("ledger.noMeters"), addLabel: t("ledger.valAdd"), kind: "meters",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "reading", type: "number", placeholder: t("ledger.meterReading"), width: 110 },
            ],
            load: () => fresh().then((l) => rl.getMeterReadings(l, ref.avId!, row.itemID)),
            add: async (v) => {
                if (!v.date || !Number.isFinite(Number(v.reading))) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendMeterReading(current, ref.avId!, row.itemID, v.date, Number(v.reading), at()));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeMeterReading(current, ref.avId!, row.itemID, e.date)); },
            format: (e: any) => `${e.date} · ${e.reading}${typeof e.usage === "number" ? ` (${e.usage})` : ""}`,
        });
        await renderHouseWarrantySection({ body, row, ref, plugin, t, renderLedgerAllFn, dlg: options.dlg });
    } else if (active === "food") {
        await renderFoodDietarySection({ body, row, ref, plugin, t, showMessageFn, renderLedgerAllFn, cellTextFn });
    } else if (active === "pets") {
        await renderPetCareSection({ body, row, ref, t, cellTextFn });
    } else if (active === "travel-plan") {
        await addRowLogSection({
            title: t("ledger.checks"), emptyText: t("ledger.noChecks"), addLabel: t("ledger.valAdd"), kind: "checks",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "result", type: "text", placeholder: t("ledger.checkResult"), width: 200 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "checks")),
            add: async (v) => {
                if (!v.date || !v.result) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "checks", { date: v.date, result: v.result, at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "checks", e)); },
            format: (e) => `${e.date} · ${esc(e.result)}`,
        });
    } else if (active === "media") {
        await addRowLogSection({
            title: t("ledger.loans"), emptyText: t("ledger.noLoans"), addLabel: t("ledger.valAdd"), kind: "loans",
            fields: [
                { key: "date", type: "date", placeholder: "", width: 130 },
                { key: "to", type: "text", placeholder: t("ledger.loanTo"), width: 100 },
                { key: "back", type: "date", placeholder: t("ledger.loanBack"), width: 130 },
            ],
            load: () => fresh().then((l) => rl.getEntries<any>(l, ref.avId!, row.itemID, "loans")),
            add: async (v) => {
                if (!v.date || !v.to) { showMessageFn(t("ledger.logInvalid"), 3000, "error"); return false; }
                await rl.updateRowLogs(plugin, (current) => rl.appendEntry(current, ref.avId!, row.itemID, "loans", { date: v.date, to: v.to, back: v.back || "", at: at() }));
                return true;
            },
            remove: async (e) => { await rl.updateRowLogs(plugin, (current) => rl.removeEntry(current, ref.avId!, row.itemID, "loans", e)); },
            format: (e) => `${e.date} · ${t("ledger.loanTo")} ${esc(e.to)}${e.back ? ` · ${e.back} ${t("ledger.loanReturned")}` : ` · ${t("ledger.loanOut")}`}`,
        });
    } else if (active === "parenting") {
        await renderParentingFeedingSection({ body, row, ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn });
    } else if (active === "social") {
        await renderSocialRetirementSection({ body, row, ref, plugin, t });
    }
}
