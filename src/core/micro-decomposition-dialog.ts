/**
 * 顽固事项微拆解弹窗（全屏 Dialog 手机端 / 居中 Dialog 桌面端）
 * 包含：手动 3 步输入、AI 帮拆自动填充、AI 降级提示、Esc+✕ 安全关闭
 */

import { Dialog } from "siyuan";
import type { Reminder } from "@/types";
import { bindDialogA11y } from "./dialog-a11y";
import { uiIcon } from "@/ui/icons";
import {
    isAiConfigured,
    requestAiDecomposition,
    executeMicroDecomposition,
} from "./micro-decomposition";

export interface OpenMicroDecompositionDialogOptions {
    plugin: any;
    reminder: Reminder;
    t: (k: string) => string;
    DialogCls?: any;
    showMessageFn?: (msg: string, time?: number, type?: string) => void;
    onSuccess?: () => void;
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function openMicroDecompositionDialog(options: OpenMicroDecompositionDialogOptions): any {
    const { plugin, reminder, t, DialogCls = Dialog, showMessageFn = (msg, time, type) => plugin.showMessage?.(msg, time, type), onSuccess } = options;

    const isMobile = Boolean(
        (typeof window !== "undefined" && (window as any)?.siyuan?.config?.system?.isMobile) ||
        (typeof document !== "undefined" && document.body?.classList?.contains("body--mobile")) ||
        (typeof window !== "undefined" && window.innerWidth <= 640)
    );

    const postponeCount = reminder.postponeCount ?? reminder.snoozeCount ?? 3;
    const aiReady = isAiConfigured();

    const titleText = t("stale.dialogTitle") || "5 分钟微步骤拆解";
    const postponeHint = (t("stale.dialogHint") || "该事项已顺延 ${n} 次，继续顺延容易陷入拖延泥潭。把它拆成 5 分钟内能做完的微步骤，今天就能轻松启动！").replace("${n}", String(postponeCount));

    const contentHtml = `
        <div class="b3-dialog__content lv-dialog-col lv-stale-dialog-body" style="padding: 16px 20px; gap: 14px;">
            <div class="lv-stale-intro lv-card" style="padding: 12px 14px; background: var(--b3-theme-surface-lighter, var(--lv-surface-2)); border: 1px solid var(--lv-line); border-radius: var(--lv-r-2, 8px);">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <b style="font-size: 14px; color: var(--b3-theme-on-background); line-height: 1.4; word-break: break-all;">
                        🧩 ${esc(reminder.title)}
                    </b>
                    <span class="lv-badge orange" style="flex-shrink: 0; font-size: 11px;">
                        顺延 ${postponeCount} 次
                    </span>
                </div>
                <div class="lv-caption" style="margin-top: 6px; color: var(--b3-theme-on-surface); line-height: 1.5; font-size: 12px;">
                    ${esc(postponeHint)}
                </div>
            </div>

            <div class="lv-stale-ai-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                <button type="button" id="lv-stale-ai-btn" class="b3-button b3-button--outline lv-btn-ai-decompose" ${aiReady ? "" : "disabled"} style="display: inline-flex; align-items: center; gap: 6px;">
                    <span>🤖</span>
                    <span id="lv-stale-ai-label">${esc(t("stale.aiDecompose") || "AI 帮我拆解")}</span>
                </button>
                <span id="lv-stale-ai-tip" class="lv-caption" style="font-size: 11.5px; color: var(--lv-tx-3);">
                    ${aiReady ? (t("stale.aiReadyHint") || "小驴 AI 专家一键解析为 3 条极小微行动") : (t("stale.aiNotConfigured") || "未配置小驴共享 AI，可在设置中配置（手动拆解随时可用）")}
                </span>
            </div>

            <div class="lv-stale-inputs" style="display: flex; flex-direction: column; gap: 10px;">
                <label class="lv-stale-step-row" style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="lv-caption" style="font-weight: 600; color: var(--b3-theme-on-background);">第 1 步（5 分钟破冰）*</span>
                    <input type="text" id="lv-stale-step-1" class="b3-text-field" maxlength="30" placeholder="${esc(t("stale.stepPlaceholder1") || "例如：打开网页 / 找出发票拍张照")}" style="width: 100%;" />
                </label>
                <label class="lv-stale-step-row" style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="lv-caption" style="font-weight: 600; color: var(--b3-theme-on-background);">第 2 步（顺势推进）</span>
                    <input type="text" id="lv-stale-step-2" class="b3-text-field" maxlength="30" placeholder="${esc(t("stale.stepPlaceholder2") || "例如：写出提纲或前两句话")}" style="width: 100%;" />
                </label>
                <label class="lv-stale-step-row" style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="lv-caption" style="font-weight: 600; color: var(--b3-theme-on-background);">第 3 步（即时收尾）</span>
                    <input type="text" id="lv-stale-step-3" class="b3-text-field" maxlength="30" placeholder="${esc(t("stale.stepPlaceholder3") || "例如：发送消息或提交确认")}" style="width: 100%;" />
                </label>
            </div>
            <div id="lv-stale-err" class="lv-caption lv-tx-danger" role="alert" style="min-height: 16px;"></div>
        </div>
        <div class="b3-dialog__action" style="padding: 12px 20px; display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
            <button type="button" class="b3-button b3-button--cancel" id="lv-stale-cancel">${esc(t("cancel") || "取消")}</button>
            <button type="button" class="b3-button" id="lv-stale-submit" style="display: inline-flex; align-items: center; gap: 5px;">
                ${uiIcon("check", "", 13)}
                <span>${esc(t("stale.confirmAndSchedule") || "确认拆解并排入今日")}</span>
            </button>
        </div>
    `;

    const dlg = new DialogCls({
        title: titleText,
        content: contentHtml,
        width: isMobile ? "100vw" : "520px",
        height: isMobile ? "100dvh" : undefined,
    });

    if (!dlg.element) return dlg;

    if (isMobile && dlg.element?.classList) {
        dlg.element.classList.add("b3-dialog--fullscreen", "lv-dialog-mobile-fullscreen");
    }

    const step1Inp = dlg.element.querySelector("#lv-stale-step-1") as HTMLInputElement;
    const step2Inp = dlg.element.querySelector("#lv-stale-step-2") as HTMLInputElement;
    const step3Inp = dlg.element.querySelector("#lv-stale-step-3") as HTMLInputElement;
    const aiBtn = dlg.element.querySelector("#lv-stale-ai-btn") as HTMLButtonElement;
    const aiLabel = dlg.element.querySelector("#lv-stale-ai-label") as HTMLElement;
    const aiTip = dlg.element.querySelector("#lv-stale-ai-tip") as HTMLElement;
    const errEl = dlg.element.querySelector("#lv-stale-err") as HTMLElement;
    const cancelBtn = dlg.element.querySelector("#lv-stale-cancel") as HTMLButtonElement;
    const submitBtn = dlg.element.querySelector("#lv-stale-submit") as HTMLButtonElement;

    // 绑定 a11y 焦点与 Esc/移动端 ✕ 支持
    bindDialogA11y({
        dlg,
        defaultFocus: step1Inp,
    });

    cancelBtn.onclick = () => dlg.destroy();

    // AI 帮拆逻辑
    if (aiBtn && aiReady) {
        aiBtn.onclick = async () => {
            if (aiBtn.disabled) return;
            aiBtn.disabled = true;
            aiLabel.textContent = t("stale.aiDecomposing") || "AI 正在敏捷拆解中...";
            errEl.textContent = "";

            try {
                const steps = await requestAiDecomposition({ reminder });
                if (steps.length > 0) {
                    if (steps[0]) step1Inp.value = steps[0];
                    if (steps[1]) step2Inp.value = steps[1];
                    if (steps[2]) step3Inp.value = steps[2];
                    aiTip.textContent = t("stale.aiSuccessTip") || "✨ AI 已完成拆解，你可以直接微调编辑";
                    step1Inp.focus();
                } else {
                    errEl.textContent = t("stale.aiEmptyTip") || "AI 未返回有效步骤，可直接在下方手动输入";
                }
            } catch (err) {
                const isNoCfg = err instanceof Error && err.message.includes("AI_NOT_CONFIGURED");
                errEl.textContent = isNoCfg
                    ? (t("stale.aiNotConfigured") || "未配置 AI 凭据")
                    : (t("stale.aiFailed") || `AI 请求失败: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                aiBtn.disabled = false;
                aiLabel.textContent = t("stale.aiDecompose") || "AI 帮我拆解";
            }
        };
    }

    // 确认拆解并排入今日
    submitBtn.onclick = async () => {
        if (submitBtn.disabled) return;
        errEl.textContent = "";

        const rawSteps = [step1Inp.value, step2Inp.value, step3Inp.value]
            .map((s) => s.trim())
            .filter(Boolean);

        if (rawSteps.length === 0) {
            errEl.textContent = t("stale.atLeastOneStep") || "请至少输入第 1 步破冰小事（5 分钟能做完）";
            step1Inp.focus();
            return;
        }

        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        try {
            await executeMicroDecomposition({
                plugin,
                reminder,
                steps: rawSteps,
            });
            showMessageFn(t("stale.decomposedDone") || `已完成微拆解，${rawSteps.length} 项微步骤已排入今日！`, 3500, "info");
            dlg.destroy();
            onSuccess?.();
        } catch (err) {
            errEl.textContent = err instanceof Error ? err.message : String(err);
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    };

    return dlg;
}
