/**
 * 人情往来分析与收送统计对话框（抽离自 ledger.svelte 317波减负）：
 * 按年份或全量汇总收礼/送礼总额、净人情差额、TOP 往来亲友与事件类别分布。
 */
import { buildFavorsReport, formatFavorsReportText } from "./favors";
import { formatAmount } from "./format";
import type { AvRow } from "./siyuan";
import { bindDialogA11y } from "./dialog-a11y";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};

export interface FavorsDialogOptions {
    ref: { avId?: string; columns?: Record<string, string> };
    t: (k: string) => string;
    DialogCls: new (options: { title: string; content: string; width?: string }) => { element: HTMLElement; destroy: () => void };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    loadRows: () => Promise<{ complete: boolean; rows: AvRow[] }>;
}

export async function openFavorsReportDialog(opts: FavorsDialogOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { ref, t, DialogCls, showMessageFn, loadRows } = opts;
    if (!ref?.columns) return;

    let all: { complete: boolean; rows: AvRow[] };
    try {
        all = await loadRows();
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
        return;
    }

    if (!all.complete) {
        showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
        return;
    }

    let selectedYear: number | "all" = new Date().getFullYear();

    const dlg = new DialogCls({
        title: t("ledger.favorsReport"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-favors-body"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-favors-close">${t("close")}</button><button class="b3-button" id="lv-favors-copy">${t("ledger.favorsCopyText")}</button></div>`,
        width: "560px",
    });
    const body = dlg.element.querySelector("#lv-favors-body") as HTMLElement;
    if (!body) return;

    bindDialogA11y({ dlg });

    const render = () => {
        body.replaceChildren();
        const report = buildFavorsReport(all.rows, ref.columns!, selectedYear);

        const toolbar = mk("div", "lv-dialog-topbar");
        const yearSelect = mk("select", "b3-select lv-select-sm") as HTMLSelectElement;
        const optAll = mk("option", "", t("ledger.favorsYearAll")) as HTMLOptionElement;
        optAll.value = "all";
        if (selectedYear === "all") optAll.selected = true;
        yearSelect.appendChild(optAll);

        for (const y of report.availableYears) {
            const opt = mk("option", "", `${y} 年`) as HTMLOptionElement;
            opt.value = String(y);
            if (selectedYear === y) opt.selected = true;
            yearSelect.appendChild(opt);
        }
        yearSelect.onchange = () => {
            selectedYear = yearSelect.value === "all" ? "all" : Number(yearSelect.value);
            render();
        };

        const subSummary = mk("span", "lv-caption", t("ledger.favorsCountRecords").replace("${n}", String(report.countIn + report.countOut)));
        toolbar.append(yearSelect, subSummary);
        body.appendChild(toolbar);

        if (report.countIn === 0 && report.countOut === 0) {
            body.appendChild(mk("div", "lv-caption fn__text-center", t("ledger.favorsEmpty")));
            return;
        }

        const metrics = mk("div", "lv-metric-grid-3");
        const inCard = mk("div", "lv-metric-lg");
        inCard.innerHTML = `<span class="lv-caption">${t("ledger.favorsInTotal")}</span><b class="lv-num lv-metric-val lv-tx-data-accent">¥${formatAmount(report.totalIn)}</b><span class="lv-caption">${report.countIn} 笔</span>`;

        const outCard = mk("div", "lv-metric-lg");
        outCard.innerHTML = `<span class="lv-caption">${t("ledger.favorsOutTotal")}</span><b class="lv-num lv-metric-val lv-tx-warn">¥${formatAmount(report.totalOut)}</b><span class="lv-caption">${report.countOut} 笔</span>`;

        const netCard = mk("div", "lv-metric-lg");
        const netColorClass = report.netAmount >= 0 ? "lv-tx-data-accent" : "lv-tx-danger";
        const netLabel = report.netAmount >= 0 ? t("ledger.favorsNetSurplus") : t("ledger.favorsNetDeficit");
        netCard.innerHTML = `<span class="lv-caption">${t("ledger.favorsNetAmount")}</span><b class="lv-num lv-metric-val ${netColorClass}">${report.netAmount >= 0 ? "+" : "-"}¥${formatAmount(Math.abs(report.netAmount))}</b><span class="lv-caption">${netLabel}</span>`;

        metrics.append(inCard, outCard, netCard);
        body.appendChild(metrics);

        if (report.topPersons.length > 0) {
            const sec = mk("div");
            sec.innerHTML = `<div class="ft__on-surface lv-section-title">${t("ledger.favorsTopPersons")}</div>`;
            const list = mk("div", "fn__flex-column");
            for (const p of report.topPersons) {
                const item = mk("div", "lv-favor-person-row");
                const pNetColor = p.net >= 0 ? "var(--lv-data-accent)" : "var(--lv-danger)";
                const right = mk("span");
                right.innerHTML = `收 ¥${formatAmount(p.inAmount)} · 送 ¥${formatAmount(p.outAmount)} · <b style="color:${pNetColor}">${p.net >= 0 ? "+" : "-"}¥${formatAmount(Math.abs(p.net))}</b>`;
                item.append(mk("span", "", p.person), right);
                list.appendChild(item);
            }
            sec.appendChild(list);
            body.appendChild(sec);
        }

        if (report.categoryBreakdown.length > 0) {
            const sec = mk("div");
            sec.innerHTML = `<div class="ft__on-surface lv-section-title">${t("ledger.favorsCategory")}</div>`;
            const list = mk("div", "fn__flex-column");
            for (const c of report.categoryBreakdown) {
                const item = mk("div", "lv-favor-person-row");
                const catName = t(`field.category.opt.${c.category}`) !== `field.category.opt.${c.category}` ? t(`field.category.opt.${c.category}`) : c.category;
                const right = mk("span", "lv-caption", `收 ¥${formatAmount(c.inAmount)} · 送 ¥${formatAmount(c.outAmount)} (${c.count} 笔)`);
                item.append(mk("span", "", catName), right);
                list.appendChild(item);
            }
            sec.appendChild(list);
            body.appendChild(sec);
        }
    };

    render();

    (dlg.element.querySelector("#lv-favors-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    (dlg.element.querySelector("#lv-favors-copy") as HTMLButtonElement).onclick = async () => {
        const report = buildFavorsReport(all.rows, ref.columns!, selectedYear);
        const text = formatFavorsReportText(report, (cat) => t(`field.category.opt.${cat}`) !== `field.category.opt.${cat}` ? t(`field.category.opt.${cat}`) : cat);
        try {
            await navigator.clipboard.writeText(text);
            showMessageFn(t("ledger.favorsCopyDone"), 2500, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
        }
    };
}
