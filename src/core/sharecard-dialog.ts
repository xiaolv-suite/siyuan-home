/**
 * 家庭生活年度回顾与里程碑长图弹窗（320波）：
 * 聚合生活指数评分、大事记时间轴、家务与书影音成就，
 * 本地 Canvas 绘制并提供高清图片预览、下载 PNG 或复制到剪贴板。
 * 独立模块，按需延迟加载以保持主包轻量。
 */

import {
    buildFamilyYearlyCardData,
    formatYearlyCardText,
    renderYearlyReportCardPng,
    copyPngToClipboard,
    downloadPng,
    type FamilyYearlyReportCardData,
} from "./sharecard";
import { bindDialogA11y } from "./dialog-a11y";
import { createReadTracker, modalWarningHtml } from "./modal-shell";
import { aggregateFamilyMilestones, type MilestoneSourceRow } from "./milestones";
import type { AvRow } from "./siyuan";
import type { AvCellLike } from "./avcell";
import type { Reminder } from "@/types";

export interface ShareCardDialogOptions {
    t: (k: string) => string;
    plugin: {
        settings: {
            members?: Array<{ id: string; name: string; avItemId?: string }>;
            dbRefs: Record<string, { avId?: string; columns?: Record<string, string> }>;
        };
    };
    allReminders: Reminder[];
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: AvRow[] }>;
    cellTextFn: (v: AvCellLike | null | undefined, k?: string) => string;
}

export async function openYearlyShareCardDialog(opts: ShareCardDialogOptions): Promise<void> {
    const { t, plugin, allReminders, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = opts;

    showMessageFn(t("overview.shareCardGenerating"), 3000, "info");

    const currentYear = new Date().getFullYear();
    const { collectFamilyLifeContext, calculateFamilyLifeIndex } = await import("./life-index");
    const { loadRowLogs, getEntries } = await import("./rowlog");

    // 1. 收集生活指数与高光亮点
    const ctx = await collectFamilyLifeContext(plugin, allReminders, new Date().toISOString().slice(0, 10));
    const lifeIndexReport = calculateFamilyLifeIndex(ctx);

    // 2. 收集家务完成数
    let choresCompleted = 0;
    // 读取失败或不完整的模块记下来，卡片上方如实提示，不再把读不到当成“0”
    const reads = createReadTracker();
    for (const fm of ctx.failedModules ?? []) {
        if (!reads.failed.includes(fm)) reads.failed.push(fm);
    }
    const choresRef = plugin.settings.dbRefs?.chores;
    if (choresRef?.avId) {
        const logs = await loadRowLogs(plugin as never);
        const choresRes = await reads.read("chores", () => renderLedgerAllFn(choresRef.avId!));
        for (const r of choresRes?.rows ?? []) {
            choresCompleted += getEntries(logs, choresRef.avId, r.itemID, "chexecs").length;
        }
    }

    // 3. 收集大事记
    const milestoneSourceRows: MilestoneSourceRow[] = [];
    // relation 列存的是成员台账行 avItemId，不是 settings 成员 id
    const memberMap = new Map((plugin.settings.members ?? []).flatMap((m) => [[m.id, m.name], ...(m.avItemId ? [[m.avItemId, m.name]] : [])] as Array<[string, string]>));

    const checkModules = ["parenting", "schooling", "certs", "contracts", "assets-real"] as const;
    await Promise.all(
        checkModules.map(async (mod) => {
            const ref = plugin.settings.dbRefs?.[mod];
            if (!ref?.avId || !ref.columns?.name) return;
            {
                const res = await reads.read(mod, () => renderLedgerAllFn(ref.avId!));
                if (!res) return;
                const nameKey = ref.columns.name;
                const dateKey = ref.columns.date || ref.columns.expiry || ref.columns.exam_date || ref.columns.purchase_date;
                if (!dateKey) return;
                for (const r of res.rows) {
                    const title = cellTextFn(r.cells[nameKey]);
                    const date = cellTextFn(r.cells[dateKey]);
                    if (!title || !date) continue;
                    const memId = ref.columns.member ? String(r.cells[ref.columns.member]?.relation?.blockIDs?.[0] ?? "") : undefined;
                    const memName = memId ? memberMap.get(memId) : undefined;
                    milestoneSourceRows.push({
                        moduleId: mod,
                        rowId: r.itemID,
                        title,
                        date,
                        memberId: memId,
                        memberName: memName,
                    });
                }
            }
        }),
    );

    const milestones = aggregateFamilyMilestones(milestoneSourceRows, { year: currentYear, topN: 8 });

    // 4. 组装卡片数据
    const cardData: FamilyYearlyReportCardData = buildFamilyYearlyCardData({
        year: currentYear,
        familyScore: lifeIndexReport.overallScore,
        levelLabel: lifeIndexReport.levelLabel,
        memberCount: plugin.settings.members?.length ?? 0,
        choresCompleted,
        mediaFinished: ctx.mediaCompletedCount,
        milestones,
        highlights: lifeIndexReport.topHighlights,
    });

    const plainText = formatYearlyCardText(cardData);

    const dlg = new DialogCls({
        title: t("overview.shareCardTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body fn__text-center" id="lv-sharecard-body">
  ${modalWarningHtml(reads.failed.length ? [t("modal.readIncomplete").replace("${modules}", reads.failed.map((m) => t(`module.${m}`)).join("、"))] : [])}
  <div id="lv-sharecard-preview" class="lv-loading-center">
    <span class="lv-caption">${t("activity.loading")}...</span>
  </div>
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("close")}</button>
  <button class="b3-button b3-button--outline" id="lv-sc-copy-text">${t("overview.shareCardCopyText")}</button>
  <button class="b3-button b3-button--outline" id="lv-sc-copy-img" disabled>${t("overview.shareCardCopyImage")}</button>
  <button class="b3-button" id="lv-sc-download" disabled>${t("overview.shareCardDownload")}</button>
</div>`,
        width: "620px",
    });

    const previewEl = dlg.element.querySelector("#lv-sharecard-preview") as HTMLElement;
    const copyTextBtn = dlg.element.querySelector("#lv-sc-copy-text") as HTMLButtonElement;
    const copyImgBtn = dlg.element.querySelector("#lv-sc-copy-img") as HTMLButtonElement;
    const downloadBtn = dlg.element.querySelector("#lv-sc-download") as HTMLButtonElement;
    (dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });

    copyTextBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(plainText);
            showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
        }
    };

    let pngBlob: Blob | null = null;
    try {
        pngBlob = await renderYearlyReportCardPng(cardData);
        const img = document.createElement("img");
        img.src = URL.createObjectURL(pngBlob);
        img.className = "lv-sharecard-img";
        img.alt = t("overview.shareCardTitle");
        previewEl.replaceChildren(img);
        copyImgBtn.disabled = false;
        downloadBtn.disabled = false;

        copyImgBtn.onclick = async () => {
            if (!pngBlob) return;
            const ok = await copyPngToClipboard(pngBlob);
            if (ok) {
                showMessageFn(t("overview.shareCardImageCopied"), 3000, "info");
            } else {
                showMessageFn(t("overview.shareCardCopyImageFailed"), 4000, "error");
            }
        };

        downloadBtn.onclick = () => {
            if (!pngBlob) return;
            downloadPng(pngBlob, `lv-family-recap-${currentYear}.png`);
            showMessageFn(t("overview.shareCardDownloaded"), 3000, "info");
        };
    } catch {
        previewEl.innerHTML = "";
        const pre = document.createElement("pre");
        pre.className = "lv-report-pre";
        pre.textContent = plainText;
        previewEl.appendChild(pre);
    }
}
