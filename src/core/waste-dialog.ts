/**
 * 市政与垃圾分类回收日程弹窗（§16/§17 316波，调研缺口 G7）：
 * 展示未来两周垃圾清运节点（按日期排布、今天/明天突出徽章），
 * 支持一键复制清运时间表。
 * 独立模块，按需延迟加载以减轻主包负担。
 */

import { nextWastePickups, formatWasteScheduleText, DEFAULT_WASTE_RULES, type WasteRule } from "./waste-schedule";
import { uiIcon } from "@/ui/icons";
import { escapeHtml, openModalShell } from "./modal-shell";

export interface WasteDialogOptions {
    t: (k: string) => string;
    rules?: WasteRule[];
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
}

export function openWasteScheduleDialog(opts: WasteDialogOptions): void {
    if (typeof document === "undefined") return;
    const { t, rules = DEFAULT_WASTE_RULES, DialogCls, showMessageFn } = opts;

    const pickups = nextWastePickups(rules);
    const reportText = formatWasteScheduleText(pickups);

    const shell = openModalShell({
        DialogCls,
        title: t("ledger.wasteTitle"),
        bodyId: "lv-waste-body",
        body: `<div class="lv-card lv-notice-card fn__text-left"><span class="lv-caption font-weight-600">${escapeHtml(t("ledger.wasteIntro"))}</span></div><div id="lv-waste-list" class="lv-ecard-list"></div>`,
        width: "560px",
        actions: [
            { id: "close", label: escapeHtml(t("close")), kind: "cancel" },
            { id: "copy", label: `${uiIcon("copy", "", 13)} ${escapeHtml(t("ledger.copyWasteSchedule") || "复制清运计划")}`, kind: "primary" },
        ],
    });
    const listEl = shell.body.querySelector("#lv-waste-list") as HTMLElement;

    // 按日期聚类渲染条目
    const byDate = new Map<string, typeof pickups>();
    for (const p of pickups) {
        const list = byDate.get(p.date) ?? [];
        list.push(p);
        byDate.set(p.date, list);
    }

    listEl.innerHTML = [...byDate.entries()].map(([date, items]) => {
        const first = items[0];
        const badgeCls = first.isToday ? "red" : first.isTomorrow ? "orange" : "gray";
        const badgeTxt = first.isToday ? t("ledger.wasteToday") : first.isTomorrow ? t("ledger.wasteTomorrow") : `${first.daysLeft} ${t("days.unit")}`;
        const types = items.map((it) => it.label).join("、");
        return `<div class="lv-metric-item lv-favor-person-row"><div class="lv-broken-link-row__left"><span class="lv-badge ${badgeCls}">${badgeTxt}</span><b class="lv-dialog-name">${date}</b><span class="lv-caption">${types}</span></div></div>`;
    }).join("");

    const copyBtn = shell.button("copy");
    if (copyBtn) {
        copyBtn.onclick = () => void shell.runBusy("copy", async () => {
            try {
                await navigator.clipboard.writeText(reportText);
                showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
            } catch {
                showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
            }
        });
    }
}
