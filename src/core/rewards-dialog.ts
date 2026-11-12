/**
 * 家务积分与零花钱结算对话框（317 波，G8）：
 * 遍历 chores 台账所有行级流水（chexecs），汇总儿童与成员的劳动积分，
 * 支持查看各成员待结算明细、一键复制积分账本简报、以及一键结算写入 allowance 账本。
 * 独立模块，按需延迟加载以减轻主包负担。
 */

import * as rl from "./rowlog";
import {
    calculateMemberRewardPoints,
    formatRewardsSummaryText,
    mapPointsToAllowanceRow,
    type RewardRecordItem,
} from "./rewards-ledger";
import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";
import { localDateKey } from "./hub/rule";

export interface RewardsDialogOptions {
    t: (k: string) => string;
    plugin: {
        settings: {
            dbRefs: Record<string, { avId?: string; columns?: Record<string, string> }>;
            members?: Array<{ id: string; name: string; avItemId?: string }>;
        };
        saveData: (name: string, data: unknown) => Promise<unknown>;
    };
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: Array<{ itemID: string; cells: Record<string, any> }> }>;
    cellTextFn: (v: any) => string;
    addDetachedRowFn?: (avId: string, name: string) => Promise<string>;
    setCellFn?: (avId: string, colId: string, itemId: string, val: unknown) => Promise<unknown>;
}

export async function openRewardsDialog(opts: RewardsDialogOptions): Promise<void> {
    const { t, plugin, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, addDetachedRowFn, setCellFn } = opts;

    const choresRef = plugin.settings.dbRefs?.chores;
    if (!choresRef?.avId || !choresRef.columns?.name) {
        showMessageFn(t("ledger.choresNotProvisioned"), 4000, "info");
        return;
    }

    let choresRes: { complete: boolean; rows: Array<{ itemID: string; cells: Record<string, any> }> };
    try {
        choresRes = await renderLedgerAllFn(choresRef.avId);
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 5000, "error");
        return;
    }

    if (!choresRes.complete) {
        showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
        return;
    }

    const memberMap = new Map((plugin.settings.members ?? []).map((m) => [m.id, m.name]));
    const logs = await rl.loadRowLogs(plugin as never);

    // 收集全部家务行的完成流水
    const allRecords: RewardRecordItem[] = [];
    const recordPointers: Array<{ avId: string; rowId: string; entry: Record<string, unknown> }> = [];

    for (const r of choresRes.rows) {
        const choreName = cellTextFn(r.cells[choresRef.columns.name]) || "未命名家务";
        const entries = rl.getEntries<Record<string, unknown>>(logs, choresRef.avId, r.itemID, "chexecs");
        for (const e of entries) {
            const pts = Number(e.points);
            if (Number.isFinite(pts) && pts > 0) {
                allRecords.push({
                    choreName,
                    memberId: typeof e.memberId === "string" ? e.memberId : undefined,
                    date: String(e.date || ""),
                    points: pts,
                    settled: Boolean(e.settled),
                    note: typeof e.note === "string" ? e.note : undefined,
                });
                recordPointers.push({ avId: choresRef.avId, rowId: r.itemID, entry: e });
            }
        }
    }

    const memberIds = Array.from(memberMap.keys());
    const report = calculateMemberRewardPoints(allRecords, memberIds);
    const memberNameOf = (id: string) => memberMap.get(id) || t("members.unassigned");

    const dlg = new DialogCls({
        title: t("ledger.rewardsTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-rewards-body">
		  <div class="lv-card lv-rewards-hero-card">
		    <div class="lv-rewards-hero-left">
		      <span class="lv-caption">${t("ledger.rewardsUnsettledAll")}</span>
		      <div class="lv-rewards-score-wrap">
		        <b class="lv-num lv-rewards-score">${report.unsettledPointsAll}</b>
		        <span class="lv-caption">${t("ledger.rewardsPointsUnit")}（≈ ¥${report.settleableAmountAll}）</span>
		      </div>
		    </div>
	    <div class="fn__text-right">
	      <span class="lv-caption">${t("ledger.rewardsTotalEarned")}: ${report.totalPointsAll}</span>
	      <div class="lv-caption lv-tx-2">${report.pointsPerYuan} 积分 = 1 元</div>
	    </div>
	  </div>
	  <div id="lv-rewards-list" class="lv-ecard-list"></div>
	</div>
		<div class="b3-dialog__action">
		  <button class="b3-button b3-button--cancel" id="lv-rewards-close">${t("close")}</button>
		  <button class="b3-button b3-button--outline" id="lv-rewards-copy">${uiIcon("copy", "", 13)} ${t("ledger.copyRewardsReport") || "复制积分报告"}</button>
		  <button class="b3-button" id="lv-rewards-settle" ${report.unsettledPointsAll === 0 ? "disabled" : ""}>${t("ledger.rewardsSettleBtn")}</button>
		</div>`,
        width: "580px",
    });

    const listEl = dlg.element.querySelector("#lv-rewards-list") as HTMLElement;
    (dlg.element.querySelector("#lv-rewards-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });

    const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    if (report.members.length === 0 || report.totalPointsAll === 0) {
        listEl.innerHTML = `<div class="ft__on-surface fn__text-center">${t("ledger.rewardsEmpty")}</div>`;
    } else {
        listEl.innerHTML = report.members.map((m) => {
            const choresText = m.unsettledChores.length > 0 ? `${t("ledger.rewardsChoresPending")}: ${m.unsettledChores.map(esc).join("、")}` : t("ledger.rewardsAllSettled");
            return `<div class="lv-metric-item lv-favor-person-row"><div class="lv-broken-link-row__left"><b>${esc(memberNameOf(m.memberId))}</b><span class="lv-caption">${choresText}</span></div><div class="lv-dialog-row__right"><b class="lv-num lv-metric-val" style="color:var(--lv-data-accent);font-size:16px">${m.unsettledPoints}</b> <span class="lv-caption">分 (¥${m.settleableAmount})</span><div class="lv-caption">${t("ledger.rewardsTotalEarned")}: ${m.totalEarned}</div></div></div>`;
        }).join("");
    }

    (dlg.element.querySelector("#lv-rewards-copy") as HTMLButtonElement).onclick = async () => {
        const text = formatRewardsSummaryText(report, memberNameOf);
        try {
            await navigator.clipboard.writeText(text);
            showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
        }
    };

    // 一键结算入 allowance 账本
    const settleBtn = dlg.element.querySelector("#lv-rewards-settle") as HTMLButtonElement;
    settleBtn.onclick = async () => {
        if (report.unsettledPointsAll === 0) return;
        const allowRef = plugin.settings.dbRefs?.allowance;
        if (!allowRef?.avId || !addDetachedRowFn || !setCellFn) {
            showMessageFn(t("ledger.rewardsAllowanceMissing"), 4000, "info");
            return;
        }

        settleBtn.disabled = true;
        let settledMembers = 0;
        const settledMemberIds = new Set<string | undefined>();
        const failedMembers: string[] = [];
        try {
            const today = localDateKey(new Date());
            const { writeLedgerRow } = await import("./ledger-writer");

            for (const m of report.members) {
                if (m.unsettledPoints <= 0) continue;
                const mName = memberNameOf(m.memberId);
                const payload = mapPointsToAllowanceRow(m, mName, { date: today, pointsPerYuan: report.pointsPerYuan });
                if (!payload) continue;

                // 经写入网关建行：金额/日期按列类型包装，成员 id 换成成员台账 avItemId
                const { failed } = await writeLedgerRow({
                    moduleId: "allowance",
                    target: allowRef,
                    name: payload.name,
                    fields: {
                        amount: payload.amount,
                        category: payload.category,
                        direction: payload.direction,
                        date: payload.date,
                        member: payload.memberId,
                        note: payload.note,
                        source: payload.source,
                    },
                    members: plugin.settings.members,
                    addRowFn: addDetachedRowFn,
                    setCellFn,
                });
                // 金额没写进去就不算结算成功，保留积分待下次重试
                if (failed.includes("amount")) {
                    failedMembers.push(mName);
                    continue;
                }
                settledMemberIds.add(m.memberId);
                settledMembers++;
            }

            // 只为金额落库成功的成员标记已结算
            await rl.updateRowLogs(plugin as never, (current) => {
                for (const ptr of recordPointers) {
                    const ptrMember = typeof ptr.entry.memberId === "string" ? ptr.entry.memberId : undefined;
                    if (!settledMemberIds.has(ptrMember)) continue;
                    const key = rl.logKey(ptr.avId, ptr.rowId);
                    const log = current[key];
                    const list = (log?.chexecs as Array<Record<string, unknown>>) ?? [];
                    const found = list.find((e) => e.date === ptr.entry.date && e.at === ptr.entry.at && e.points === ptr.entry.points);
                    if (found) found.settled = true;
                }
                return current;
            });

            if (failedMembers.length > 0) {
                showMessageFn(t("ledger.rewardsSettlePartial").replace("${n}", String(settledMembers)).replace("${names}", failedMembers.join("、")), 6000, "error");
            } else {
                showMessageFn(t("ledger.rewardsSettleSuccess").replace("${n}", String(settledMembers)), 4000, "info");
                dlg.destroy();
            }
        } catch (e) {
            showMessageFn(t("capture.failed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        } finally {
            settleBtn.disabled = false;
        }
    };
}
