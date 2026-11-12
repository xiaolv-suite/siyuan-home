/**
 * 设置面板维护、迁移、诊断与数据包分发中枢（解耦抽取自 settings.svelte，促进大文件瘦身）
 * 涵盖：配置导入/导出、回滚恢复、深度体检、重复检测、成员回填、示例数据管理与诊断包预览
 */

import { confirm } from "@/libs/dialog";
import { bindDialogA11y } from "./dialog-a11y";
import { uiIcon } from "@/ui/icons";
import type { HomeSettings } from "@/types";
import { homeSilent } from "@/libs/notice";

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
        const payload = JSON.stringify(plugin.settings, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `siyuan-home-settings-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
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
                    <b style="color:var(--lv-tx)">v${payload.plugin || "0.5.x"}</b>
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
                    ${payload.scanErrors.map((e: any) => `<div>· ${e.moduleId}: ${e.message}</div>`).join("")}
                </div>
            ` : ""}
            <div class="lv-caption ft__on-surface">
                <div>· 运行平台：${payload.platform}</div>
                <div>· 最近扫描：${payload.scannedAt ? new Date(payload.scannedAt).toLocaleString() : "尚未完成扫描"}</div>
                <div>· 诊断生成时间：${payload.generatedAt}</div>
            </div>
        </div>
        <div class="b3-dialog__action">
            <button class="b3-button b3-button--cancel" id="lv-diag-copy-summary">${uiIcon("copy", "", 13)} 复制脱敏摘要</button>
            <span class="fn__flex-1"></span>
            <button class="b3-button b3-button--cancel" id="lv-diag-close">${t("close")}</button>
        </div>`,
        width: "520px",
    });

    (dlg.element.querySelector("#lv-diag-close") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });
    (dlg.element.querySelector("#lv-diag-copy-summary") as HTMLButtonElement).onclick = async () => {
        try {
            const summaryText = `【小驴管家健康诊断摘要】\n- 版本：v${payload.plugin}\n- 启用模块：${payload.enabledModules?.join("、")}\n- 台账就绪：${provisionedCount}/${totalCount}\n- 扫描异常：${errorCount}\n- 生成时间：${payload.generatedAt}`;
            await navigator.clipboard.writeText(summaryText);
            showMessageFn(t("copied") !== "copied" ? t("copied") : "已复制", 2000, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 3000, "error");
        }
    };
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
            a.download = `siyuan-home-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
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
        width: "520px",
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
        const { findDuplicateLedgers } = await import("./provisioner");
        const dups = await findDuplicateLedgers(plugin.settings);
        showMessageFn(dups.length === 0 ? t("diag.dupNone") : t("diag.dupFound").replace("${n}", String(dups.length)) + ": " + dups.map((d: any) => d.hpath).join(", "), 6000, dups.length ? "error" : "info");
    } catch (error) {
        showMessageFn(`${settingHintText(t, "重复台账检测失败", "Duplicate ledger check failed")}${errParen(error)}`, 6000, "error");
    }
}

export async function executeDeepHealthCheck(
    plugin: any,
    t: (k: string) => string,
    showMessageFn: (msg: string, timeout?: number, type?: string) => void,
): Promise<void> {
    try {
        const { runHealthCheck } = await import("./health");
        const report = await runHealthCheck(plugin.settings, plugin.schemaCatalog ?? {});
        const bad = report.modules.filter((m: any) => !m.ok);
        const detail = bad.map((m: any) => `${t(`module.${m.moduleId}`)}: ${m.error ?? t("diag.healthMissingCols").replace("${n}", String(m.missingColumns?.length ?? 0))}`).join("；");
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
                        homeSilent("backup-preimport", "导入配置前已自动生成备份快照 settings.pre-import.json");
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

