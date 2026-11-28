/**
 * 设置面板维护、迁移、诊断与数据包分发中枢（解耦抽取自 settings.svelte，促进大文件瘦身）
 * 涵盖：配置导入/导出、回滚恢复、深度体检、重复检测、成员回填、示例数据管理与诊断包预览
 */

import { confirm } from "@/libs/dialog";
import { bindDialogA11y } from "./dialog-a11y";
import { escapeHtml } from "./modal-shell";
import { localDateKey } from "./hub/rule";
import { sanitizeHomeSettingsForBackup } from "./vault-adapter";
import { uiIcon } from "@/ui/icons";
import type { HomeSettings } from "@/types";

const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errParen = (e: unknown) => (e ? ` (${errStr(e)})` : "");

export function settingHintText(t: (k: string) => string, zh: string, en: string): string {
    return /[\u3400-\u9fff]/.test(t("settings.importDone")) ? zh : en;
}

export function cloneSettings(source: HomeSettings): HomeSettings {
    return JSON.parse(JSON.stringify(source)) as HomeSettings;
}

export function exportSettingsJson(plugin: any, t: (k: string) => string): void {
    if (typeof document === "undefined") return;
    confirm(t("settings.exportWarningTitle"), t("settings.exportWarningBody"), () => {
        const sanitized = sanitizeHomeSettingsForBackup(plugin.settings);
        const payload = JSON.stringify(sanitized, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `siyuan-home-settings-${localDateKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
}

async function buildDiagnosticsPayload(plugin: any) {
    const diag = plugin.getDiagnostics?.();
    if (!diag) return null;
    const { buildDiagnosticPackage } = await import("./diagnostics");
    return buildDiagnosticPackage({
        diag,
        enabledModules: [...(plugin.settings.enabledModules ?? [])],
        platform: typeof navigator !== "undefined" ? navigator.userAgent : "node",
        generatedAt: new Date().toISOString(),
    });
}

export async function openDiagnosticsPreviewDialog(
    plugin: any,
    t: (k: string) => string,
    DialogCls: any,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    if (typeof document === "undefined") return;
    const payload = await buildDiagnosticsPayload(plugin);
    if (!payload) {
        showMessageFn(t("settings.diagExportNone"), 3000, "error");
        return;
    }

    const provisionedCount = payload.ledgers?.filter((l: any) => l.provisioned)?.length ?? 0;
    const totalCount = payload.ledgers?.length ?? 0;
    const errorCount = payload.scanErrors?.length ?? 0;

    const dlg = new DialogCls({
        title: "🔍 " + (t("settings.diagPreviewTitle") !== "settings.diagPreviewTitle" ? t("settings.diagPreviewTitle") : "管家健康诊断预览"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body">
            <div class="lv-diag-grid">
                <div class="lv-diag-stat-card">
                    <span class="lv-caption">插件版本</span>
                    <b style="color:var(--lv-tx)">v${escapeHtml(payload.plugin || "0.5.x")}</b>
                </div>
                <div class="lv-diag-stat-card">
                    <span class="lv-caption">已启用模块</span>
                    <b style="color:var(--lv-accent)">${payload.enabledModules?.length ?? 0} 个</b>
                </div>
                <div class="lv-diag-stat-card">
                    <span class="lv-caption">台账库就绪</span>
                    <b style="color:${provisionedCount === totalCount ? "var(--lv-accent)" : "var(--lv-warn)"}">${provisionedCount} / ${totalCount}</b>
                </div>
                <div class="lv-diag-stat-card">
                    <span class="lv-caption">扫描异常数</span>
                    <b style="color:${errorCount > 0 ? "var(--lv-danger)" : "var(--lv-tx)"}">${errorCount} 项</b>
                </div>
            </div>
            ${errorCount > 0 ? `
                <div class="lv-diag-error-card">
                    <b>异常摘要：</b>
                    ${payload.scanErrors.map((e: any) => `<div>· ${escapeHtml(e.moduleId)}: ${escapeHtml(e.message)}</div>`).join("")}
                </div>
            ` : ""}
            <div class="lv-caption ft__on-surface">
                <div>· 运行平台：${escapeHtml(payload.platform)}</div>
                <div>· 最近扫描：${escapeHtml(payload.scannedAt ? new Date(payload.scannedAt).toLocaleString() : "尚未完成扫描")}</div>
                <div>· 诊断生成时间：${escapeHtml(payload.generatedAt)}</div>
            </div>
        </div>
        <div class="b3-dialog__action">
            <button type="button" class="b3-button b3-button--outline" id="lv-diag-deep-health">${uiIcon("search", "", 13)} ${t("diag.health") !== "diag.health" ? t("diag.health") : "31 台账深度体检"}</button>
            <button type="button" class="b3-button b3-button--cancel" id="lv-diag-copy-summary">${uiIcon("copy", "", 13)} 复制脱敏摘要</button>
            <span class="fn__flex-1"></span>
            <button type="button" class="b3-button b3-button--cancel" id="lv-diag-close">${t("close")}</button>
        </div>`,
        width: "min(560px, 94vw)",
    });

    const closeEl = dlg.element?.querySelector?.("#lv-diag-close") as HTMLButtonElement | null;
    if (closeEl) closeEl.onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });
    const deepHealthBtn = dlg.element?.querySelector?.("#lv-diag-deep-health") as HTMLButtonElement | null;
    if (deepHealthBtn) {
        deepHealthBtn.onclick = () => {
            dlg.destroy();
            void executeDeepHealthCheck(plugin, t, showMessageFn, DialogCls);
        };
    }
    const copyEl = dlg.element?.querySelector?.("#lv-diag-copy-summary") as HTMLButtonElement | null;
    if (copyEl) {
        copyEl.onclick = async () => {
            try {
                const summaryText = `【小驴管家健康诊断摘要】\n- 版本：v${payload.plugin}\n- 启用模块：${payload.enabledModules?.join("、")}\n- 台账就绪：${provisionedCount}/${totalCount}\n- 扫描异常：${errorCount}\n- 生成时间：${payload.generatedAt}`;
                await navigator.clipboard.writeText(summaryText);
                showMessageFn(t("copied") !== "copied" ? t("copied") : "已复制", 2000, "info");
            } catch {
                showMessageFn(t("ledger.copyAsImageFail"), 3000, "error");
            }
        };
    }
}

export async function exportDiagnosticsPackage(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    if (typeof document === "undefined") return;
    const diag = plugin.getDiagnostics?.();
    if (!diag) {
        showMessageFn(t("settings.diagExportNone"), 3000, "error");
        return;
    }
    confirm(t("settings.diagExport"), t("settings.diagExportBody"), async () => {
        try {
            const payload = await buildDiagnosticsPayload(plugin);
            if (!payload) {
                showMessageFn(t("settings.diagExportNone"), 3000, "error");
                return;
            }
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `siyuan-home-diagnostics-${localDateKey()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 0);
            showMessageFn(t("settings.diagExportDone"), 3000, "info");
        } catch (error) {
            showMessageFn(
                `${settingHintText(t, "诊断包导出失败", "Diagnostics export failed")}${errParen(error)}`,
                5000,
                "error",
            );
        }
    });
}

export async function openAmbiguityDialog(
    ambiguous: { memberId: string; member: string; candidates: { id: string; summary: string }[] }[],
    plugin: any,
    t: (k: string) => string,
    DialogCls: any,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    if (typeof document === "undefined") return;
    const picks: Record<number, string> = {};
    const dlg = new DialogCls({
        title: t("diag.ambigTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-ambig-body"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-ambig-cancel">${t("cancel")}</button><button class="b3-button" id="lv-ambig-ok">${t("save")}</button></div>`,
        width: "min(520px, 94vw)",
    });
    bindDialogA11y({ dlg });
    const body = dlg.element.querySelector("#lv-ambig-body") as HTMLElement;
    let applyingAmbiguity = false;
    ambiguous.forEach((a, ai) => {
        const head = document.createElement("div");
        head.className = "ft__on-surface lv-caption";
        head.textContent = a.member;
        body.appendChild(head);
        for (const c of a.candidates) {
            const line = document.createElement("label");
            line.className = "lv-row-field";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = `lv-ambig-${ai}`;
            radio.value = c.id;
            radio.onchange = () => { picks[ai] = c.id; };
            const sp = document.createElement("span");
            sp.textContent = c.summary || t("diag.ambigNoInfo");
            line.append(radio, sp);
            body.appendChild(line);
        }
    });
    (dlg.element.querySelector("#lv-ambig-cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    const ambiguityOk = dlg.element.querySelector("#lv-ambig-ok") as HTMLButtonElement;
    ambiguityOk.onclick = async () => {
        if (applyingAmbiguity) return;
        applyingAmbiguity = true;
        ambiguityOk.disabled = true;
        const previous = cloneSettings(plugin.settings);
        let applied = 0;
        try {
            ambiguous.forEach((a, ai) => {
                const pick = picks[ai];
                if (!pick) return;
                const m = plugin.settings.members.find((x: any) => x.id === a.memberId);
                if (m) {
                    m.avItemId = pick;
                    m.avRowCreatePending = undefined;
                    m.syncError = undefined;
                    applied++;
                }
            });
            dlg.destroy();
            if (applied > 0) {
                const { saveSettings } = await import("./settings");
                await saveSettings(plugin, plugin.settings);
                try {
                    await plugin.refreshHub?.(undefined, true);
                } catch (error) {
                    showMessageFn(`${t("diag.ambigDone").replace("${n}", String(applied))} (${settingHintText(t, "刷新失败", "refresh failed")}: ${errStr(error)})`, 6000, "error");
                    return;
                }
            }
            showMessageFn(t("diag.ambigDone").replace("${n}", String(applied)), 3000, "info");
        } catch (error) {
            plugin.settings = previous;
            showMessageFn(`${t("settings.saveFailed")}${errParen(error)}`, 6000, "error");
            dlg.destroy();
        } finally {
            applyingAmbiguity = false;
        }
    };
}

export async function executeBackfillMemberLinks(
    plugin: any,
    t: (k: string) => string,
    DialogCls: any,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    const previous = cloneSettings(plugin.settings);
    try {
        const { backfillMemberLinks } = await import("./members");
        const res = await backfillMemberLinks(plugin, plugin.settings);
        showMessageFn(t("diag.backfillResult")
            .replace("${n}", String(res.linked.length))
            .replace("${amb}", String(res.ambiguous.length))
            .replace("${stale}", String(res.stale.length)), 6000, "info");
        if (res.linked.length > 0 || res.stale.length > 0) {
            try {
                await plugin.refreshHub?.(undefined, true);
            } catch (refreshError) {
                showMessageFn(`${settingHintText(t, "关联已保存，但提醒刷新失败", "Links saved, but reminder refresh failed")}${errParen(refreshError)}`, 6000, "error");
            }
        }
        if (res.ambiguous.length > 0) {
            await openAmbiguityDialog(res.ambiguous, plugin, t, DialogCls, showMessageFn);
        }
    } catch (error) {
        plugin.settings = previous;
        showMessageFn(`${settingHintText(t, "成员关联回填失败", "Member link backfill failed")}${errParen(error)}`, 6000, "error");
    }
}

export async function executeDuplicateLedgerCheck(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    try {
        const { findDuplicateLedgers } = await import("./provision-adoption");
        const dups = await findDuplicateLedgers(plugin.settings);
        showMessageFn(dups.length === 0 ? t("diag.dupNone") : t("diag.dupFound").replace("${n}", String(dups.length)) + ": " + dups.map((d: any) => d.hpath).join(", "), 6000, dups.length ? "error" : "info");
    } catch (error) {
        showMessageFn(`${settingHintText(t, "重复台账检测失败", "Duplicate ledger check failed")}${errParen(error)}`, 6000, "error");
    }
}

function fieldDisplayName(t: (k: string) => string, colKey: string): string {
    const label = t(`field.${colKey}`);
    return label && label !== `field.${colKey}` ? label : colKey;
}

function moduleDisplayName(t: (k: string) => string, moduleId: string): string {
    const label = t(`module.${moduleId}`);
    return label && label !== `module.${moduleId}` ? label : moduleId;
}

export interface ModuleHealthGuidance {
    moduleId: string;
    moduleName: string;
    ok: boolean;
    canAdditiveRepair: boolean;
    hasTypeDrift: boolean;
    headline: string;
    hint: string;
    rows?: number;
}

export function buildModuleHealthGuidance(mod: any, t: (k: string) => string): ModuleHealthGuidance {
    const moduleName = moduleDisplayName(t, mod.moduleId);
    const missingCols: string[] = Array.isArray(mod.missingColumns) ? mod.missingColumns : [];
    const typeDrifts: Array<{ colKey: string; expectedType?: string; actualType?: string }> = Array.isArray(mod.typeDrifts)
        ? mod.typeDrifts
        : [];
    const errTextVal = String(mod.error || "");
    const notProvisioned = errTextVal === "not provisioned";
    const docMissing = errTextVal.includes("ledger document missing");

    if (mod.ok) {
        return {
            moduleId: mod.moduleId,
            moduleName,
            ok: true,
            canAdditiveRepair: false,
            hasTypeDrift: false,
            headline: settingHintText(t, `正常（${mod.rows ?? 0} 条记录）`, `Healthy (${mod.rows ?? 0} rows)`),
            hint: "",
            rows: mod.rows,
        };
    }

    const parts: string[] = [];
    const hints: string[] = [];
    let canAdditiveRepair = false;

    if (notProvisioned) {
        parts.push(settingHintText(t, "尚未建立台账", "Ledger not initialized"));
        hints.push(settingHintText(t, "可一键初始化对应台账文档与字段，不会影响其他模块。", "You can initialize this ledger safely without affecting other modules."));
        canAdditiveRepair = true;
    } else if (docMissing) {
        parts.push(settingHintText(t, "台账文档未找到（可能已移入回收站）", "Ledger document not found (possibly deleted or in trash)"));
        hints.push(settingHintText(t, "请先检查回收站，或一键重新建库找回。", "Check the trash first, or rebuild the ledger cleanly."));
        canAdditiveRepair = true;
    }

    if (missingCols.length > 0) {
        const names = missingCols.slice(0, 4).map((c) => fieldDisplayName(t, c)).join("、");
        const suffix = missingCols.length > 4 ? ` 等 ${missingCols.length} 项` : "";
        parts.push(settingHintText(t, `缺少 ${missingCols.length} 个推荐字段（${names}${suffix}）`, `Missing ${missingCols.length} field(s)`));
        hints.push(settingHintText(t, "补充缺失字段仅追加新列，绝不覆盖您已有的台账行与数据。", "Adding missing columns only appends new fields and never overwrites existing rows."));
        canAdditiveRepair = true;
    }

    if (typeDrifts.length > 0) {
        const driftNames = typeDrifts.slice(0, 3).map((d) => fieldDisplayName(t, d.colKey)).join("、");
        parts.push(settingHintText(t, `字段格式有调整（${driftNames}）`, `Field format adjusted (${driftNames})`));
        hints.push(settingHintText(t, "已完整保留您的原有字段与数据，绝不静默覆盖；如需整理可前往台账核对。", "Your original column and data are preserved untouched; open the ledger to review if needed."));
    }

    if (mod.complete === false) {
        parts.push(settingHintText(t, "数据读取未完整", "Incomplete read"));
        hints.push(settingHintText(t, "建议前往台账页刷新或检查思源索引状态。", "Open the ledger to refresh or verify indexing."));
    }

    if (parts.length === 0 && errTextVal) {
        parts.push(errTextVal);
        hints.push(settingHintText(t, "可先定位到对应台账查看详情。", "Open the corresponding ledger to inspect."));
    }

    return {
        moduleId: mod.moduleId,
        moduleName,
        ok: false,
        canAdditiveRepair,
        hasTypeDrift: typeDrifts.length > 0,
        headline: parts.join(" · "),
        hint: hints.join(" "),
        rows: mod.rows,
    };
}

export function openHealthCheckReportDialog(
    report: { at: string; modules: any[] },
    plugin: any,
    t: (k: string) => string,
    DialogCls: any,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): void {
    if (typeof document === "undefined") return;
    const items = report.modules.map((m) => buildModuleHealthGuidance(m, t));
    const okCount = items.filter((it) => it.ok).length;
    const issues = items.filter((it) => !it.ok);
    const healthy = items.filter((it) => it.ok);

    const issuesHtml =
        issues.length === 0
            ? `<div class="lv-diag-stat-card" style="padding:14px; text-align:center;">
                <b style="color:var(--lv-accent);">✅ ${escapeHtml(settingHintText(t, `全部 ${items.length} 个已启用台账结构健康`, `All ${items.length} enabled ledgers are healthy`))}</b>
                <div class="lv-caption" style="margin-top:4px;">${escapeHtml(settingHintText(t, "只读巡检完成，未对您的任何文档或数据做修改。", "Read-only inspection completed with zero data modifications."))}</div>
               </div>`
            : issues
                  .map(
                      (it) => `<div class="lv-diag-error-card" data-health-module="${escapeHtml(it.moduleId)}" style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                            <b>${escapeHtml(it.moduleName)}</b>
                            <span class="lv-caption lv-tx-danger">${escapeHtml(it.headline)}</span>
                        </div>
                        ${it.hint ? `<div class="lv-caption ft__on-surface">${escapeHtml(it.hint)}</div>` : ""}
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                            ${
                                it.canAdditiveRepair && typeof plugin?.repairModule === "function"
                                    ? `<button type="button" class="b3-button b3-button--outline lv-btn-xs lv-health-repair-btn" data-module-id="${escapeHtml(it.moduleId)}">${escapeHtml(settingHintText(t, "一键安全补齐", "Safe repair"))}</button>`
                                    : ""
                            }
                            ${
                                typeof plugin?.openModuleTab === "function"
                                    ? `<button type="button" class="b3-button b3-button--outline lv-btn-xs lv-health-locate-btn" data-module-id="${escapeHtml(it.moduleId)}">${escapeHtml(settingHintText(t, "前往定位", "Open ledger"))}</button>`
                                    : ""
                            }
                        </div>
                      </div>`,
                  )
                  .join("");

    const healthyHtml =
        healthy.length > 0
            ? `<div class="lv-caption ft__on-surface" style="margin-top:10px;line-height:1.7;">
                <b>${escapeHtml(settingHintText(t, `状态正常的台账（${healthy.length}）：`, `Healthy ledgers (${healthy.length}):`))}</b>
                ${healthy.map((h) => `${escapeHtml(h.moduleName)}(${h.rows ?? 0})`).join(" · ")}
               </div>`
            : "";

    const dlg = new DialogCls({
        title: `🩺 ${escapeHtml(t("diag.health") !== "diag.health" ? t("diag.health") : "台账只读健康体检")}`,
        content: `<div class="b3-dialog__content lv-dialog-scroll-body">
            <div class="lv-caption ft__on-surface" style="margin-bottom:10px;">
                ${escapeHtml(settingHintText(t, `已检查 ${items.length} 个台账：${okCount} 个正常，${issues.length} 个需关注（只读诊断，绝不覆盖用户原数据）`, `Checked ${items.length} ledgers: ${okCount} healthy, ${issues.length} need attention (read-only)`))}
            </div>
            ${issuesHtml}
            ${healthyHtml}
        </div>
        <div class="b3-dialog__action">
            <button type="button" class="b3-button b3-button--cancel" id="lv-health-report-close">${escapeHtml(t("close") !== "close" ? t("close") : "关闭")}</button>
        </div>`,
        width: "min(580px, 94vw)",
    });

    const closeBtn = dlg.element?.querySelector?.("#lv-health-report-close") as HTMLButtonElement | null;
    if (closeBtn) closeBtn.onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });

    const repairBtns = dlg.element?.querySelectorAll?.(".lv-health-repair-btn") as NodeListOf<HTMLButtonElement> | undefined;
    repairBtns?.forEach((btn) => {
        btn.onclick = async () => {
            const moduleId = btn.getAttribute("data-module-id");
            if (!moduleId || typeof plugin?.repairModule !== "function") return;
            btn.disabled = true;
            btn.setAttribute("aria-busy", "true");
            try {
                await plugin.repairModule(moduleId);
                await plugin.refreshHub?.([moduleId], true);
                showMessageFn(settingHintText(t, `「${moduleDisplayName(t, moduleId)}」已完成安全补齐`, `"${moduleDisplayName(t, moduleId)}" repaired safely`), 3000, "info");
                dlg.destroy();
            } catch (err) {
                btn.disabled = false;
                btn.removeAttribute("aria-busy");
                showMessageFn(`${settingHintText(t, "补齐失败", "Repair failed")}${errParen(err)}`, 5000, "error");
            }
        };
    });

    const locateBtns = dlg.element?.querySelectorAll?.(".lv-health-locate-btn") as NodeListOf<HTMLButtonElement> | undefined;
    locateBtns?.forEach((btn) => {
        btn.onclick = () => {
            const moduleId = btn.getAttribute("data-module-id");
            dlg.destroy();
            if (moduleId) plugin?.openModuleTab?.(moduleId);
        };
    });
}

export async function executeDeepHealthCheck(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
    DialogCls?: any,
): Promise<void> {
    try {
        const { runHealthCheck } = await import("./health");
        const report = await runHealthCheck(plugin.settings, plugin.schemaCatalog ?? {});
        if (DialogCls && typeof document !== "undefined") {
            openHealthCheckReportDialog(report, plugin, t, DialogCls, showMessageFn);
            return;
        }
        const bad = report.modules.filter((m: any) => !m.ok);
        const detail = bad.map((m: any) => `${moduleDisplayName(t, m.moduleId)}: ${buildModuleHealthGuidance(m, t).headline}`).join("；");
        showMessageFn(
            (detail
                ? t("diag.healthSummaryBad").replace("${ok}", String(report.modules.length - bad.length)).replace("${total}", String(report.modules.length)).replace("${detail}", detail)
                : t("diag.healthSummary").replace("${total}", String(report.modules.length))),
            7000, bad.length ? "error" : "info");
    } catch (error) {
        showMessageFn(`${settingHintText(t, "健康检查失败", "Health check failed")}${errParen(error)}`, 6000, "error");
    }
}

export async function executeRebuildAllLedgers(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    try {
        await plugin.adoptHistoryLedgers?.();
        const report = await plugin.ensureCoreLedgers();
        try {
            await plugin.refreshHub?.(undefined, true);
        } catch (error) {
            showMessageFn(`${t("ledger.rebuildRefreshFailed").replace("${msg}", errStr(error))}`, 6000, "error");
            return;
        }
        if (report?.issues?.length > 0) {
            const modules = report.issues.map(({ moduleId }: any) => t(`module.${moduleId}`)).join(", ");
            showMessageFn(t("ledger.rebuildPartial").replace("${modules}", modules), 7000, "error");
        } else {
            showMessageFn(t("diag.rebuildAllDone"), 3000, "info");
        }
    } catch (error) {
        showMessageFn(`${t("ledger.rebuildFailed").replace("${msg}", errStr(error))}`, 6000, "error");
    }
}

export async function executeAdoptHistoryLedgers(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    try {
        const report = await plugin.adoptHistoryLedgers?.();
        try {
            await plugin.refreshHub?.(undefined, true);
        } catch { /* ignore */ }
        if (report && report.adoptedCount > 0) {
            showMessageFn(t("diag.adoptHistoryDone").replace("${n}", String(report.adoptedCount)).replace("${modules}", report.adoptedModules.join("、")), 7000, "info");
        } else {
            showMessageFn(t("diag.adoptHistoryNone"), 4000, "info");
        }
    } catch (e) {
        showMessageFn(errStr(e), 5000, "error");
    }
}

export async function executeRestorePreImport(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
    persistReplacement: (next: HomeSettings) => Promise<void>,
): Promise<void> {
    confirm(t("settings.restoreTitle"), t("settings.restoreBody"), async () => {
        try {
            const backup = await plugin.loadData?.("settings.pre-import.json");
            if (!backup || !Array.isArray((backup as any).enabledModules) || !Array.isArray((backup as any).members)
                || !(backup as any).dbRefs || typeof (backup as any).dbRefs !== "object") {
                throw new Error("invalid pre-import settings backup");
            }
            await persistReplacement(backup as HomeSettings);
            let followupError: unknown;
            try {
                await plugin.ensureCoreLedgers?.();
                await plugin.refreshHub?.(undefined, true);
            } catch (error) {
                followupError = error;
            }
            showMessageFn(
                followupError
                    ? `${t("settings.restoreDone")} (${settingHintText(t, "后续刷新失败", "follow-up refresh failed")})`
                    : t("settings.restoreDone"),
                followupError ? 7000 : 3000,
                followupError ? "error" : "info",
            );
        } catch (e) {
            const prefix = (e as Error & { settingsPersistFailed?: boolean }).settingsPersistFailed
                ? t("settings.saveFailed") : settingHintText(t, "恢复失败", "Restore failed");
            showMessageFn(`${prefix}${errParen(e)}`, 5000, "error");
        }
    });
}

export async function executeImportSettings(
    file: File,
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
    persistReplacement: (next: HomeSettings) => Promise<void>,
): Promise<void> {
    try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data?.enabledModules) || !Array.isArray(data?.members) || !data?.dbRefs || typeof data.dbRefs !== "object") {
            throw new Error("invalid settings shape");
        }
        confirm(t("settings.importTitle"), t("settings.importBody").replace("${file}", file.name), async () => {
            try {
                try {
                    if (plugin.saveData) {
                        await plugin.saveData("settings.pre-import.json", cloneSettings(plugin.settings));
                    }
                } catch { /* soft backup failure */ }
                const { normalizeImportedSettings } = await import("./settings");
                const norm = normalizeImportedSettings(data);
                await persistReplacement(norm.settings);
                try {
                    await plugin.ensureCoreLedgers?.();
                    await plugin.refreshHub?.(undefined, true);
                } catch { /* soft */ }
                showMessageFn(
                    norm.droppedModules.length > 0 || norm.repairedMembers > 0
                        ? t("settings.importNormalized").replace("${m}", String(norm.droppedModules.length)).replace("${r}", String(norm.repairedMembers))
                        : t("settings.importDone"),
                    norm.droppedModules.length || norm.repairedMembers ? 6000 : 3000,
                    "info",
                );
            } catch (err) {
                const prefix = (err as Error & { settingsPersistFailed?: boolean }).settingsPersistFailed
                    ? t("settings.saveFailed") : t("settings.importBad");
                showMessageFn(`${prefix}${errParen(err)}`, 6000, "error");
            }
        });
    } catch (err) {
        showMessageFn(`${t("settings.importBad")}${errParen(err)}`, 5000, "error");
    }
}

export async function executeRerunOnboarding(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
    persistReplacement: (next: HomeSettings) => Promise<void>,
): Promise<void> {
    const previous = cloneSettings(plugin.settings);
    try {
        const next = { ...previous, onboarded: false };
        await persistReplacement(next);
        try {
            await plugin.refreshHub?.(undefined, true);
        } catch (error) {
            showMessageFn(`${settingHintText(t, "引导已重置，但提醒刷新失败", "Onboarding reset, but reminder refresh failed")} (${errStr(error)})`, 6000, "error");
            return;
        }
        showMessageFn(t("wiz.rerunHint"), 3000, "info");
    } catch (error) {
        plugin.settings = previous;
        showMessageFn(`${settingHintText(t, "重置引导失败", "Unable to reset onboarding")}${errParen(error)}`, 6000, "error");
    }
}

export async function executeGenerateDemo(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    try {
        const { generateDemoData } = await import("./demo");
        const res = await generateDemoData(plugin, plugin.settings, plugin.schemaCatalog ?? {});
        if (res.alreadyPresent) {
            showMessageFn(t("settings.demoExists"), 4000, "info");
            return;
        }
        let refreshError: unknown;
        try { await plugin.refreshHub?.(undefined, true); }
        catch (e) { refreshError = e; }
        const details = [...res.errors.slice(0, 3)];
        if (refreshError) details.push(`${settingHintText(t, "提醒刷新失败", "reminder refresh failed")}: ${errStr(refreshError)}`);
        const partial = res.errors.length > 0 || !!refreshError;
        const summary = res.errors.length
            ? t("settings.demoPartial").replace("${n}", String(res.errors.length))
            : t("settings.demoDone").replace("${n}", String(res.created));
        showMessageFn(details.length ? `${summary}: ${details.join("; ")}` : summary, partial ? 7000 : 5000, partial ? "error" : "info");
    } catch (e) {
        showMessageFn(t("settings.demoActionFailed").replace("${msg}", errStr(e)), 6000, "error");
    }
}

export function executeClearDemo(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): void {
    confirm(t("settings.demoClearTitle"), t("settings.demoClearBody"), async () => {
        try {
            const { clearDemoData } = await import("./demo");
            const res = await clearDemoData(plugin, plugin.settings);
            let refreshError: unknown;
            try { await plugin.refreshHub?.(undefined, true); }
            catch (e) { refreshError = e; }
            const details = [...res.errors.slice(0, 3)];
            if (refreshError) details.push(`${settingHintText(t, "提醒刷新失败", "reminder refresh failed")}: ${errStr(refreshError)}`);
            const partial = res.errors.length > 0 || !!refreshError;
            const summary = res.errors.length
                ? t("settings.demoClearPartial").replace("${n}", String(res.cleared)).replace("${m}", String(res.errors.length))
                : t("settings.demoClearDone").replace("${n}", String(res.cleared));
            showMessageFn(details.length ? `${summary}: ${details.join("; ")}` : summary, partial ? 7000 : 6000, partial ? "error" : "info");
        } catch (e) {
            showMessageFn(t("settings.demoActionFailed").replace("${msg}", errStr(e)), 6000, "error");
        }
    });
}

