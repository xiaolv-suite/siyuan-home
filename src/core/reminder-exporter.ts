/**
 * 提醒中枢摘要周报与日历 ICS 导出引擎
 * 解耦自 reminder-dialogs.ts，封装周报摘要 Markdown 生成、差值记录、日历 ICS 导出与隐私二次确认
 */

import type { Reminder } from "@/types";
import { saveRuntime } from "./hub/runtime";
import { escapeHtml, openModalShell } from "./modal-shell";

export interface OpenReminderDigestDialogOptions {
    filtered: Reminder[];
    plugin: any;
    DialogCls: any;
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
}

/** 提醒中枢周报/月报摘要弹窗（含差值对比与剪贴板复制） */
export async function openReminderDigestDialog(options: OpenReminderDigestDialogOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { filtered, plugin, DialogCls, t, showMessageFn } = options;
    try {
        const { buildReminderDigest, formatDigestMarkdown } = await import("./reminder-digest");
        const input = filtered.map((r) => ({
            id: r.id,
            moduleId: r.moduleId,
            title: r.title,
            dueDate: r.dueDate,
            daysLeft: r.daysLeft,
            level: r.level,
        }));
        const history = plugin.runtime?.digestHistory;
        const digest = buildReminderDigest(input, {
            periodLabel: t("hub.digestThisWeek"),
            previousOverdue: typeof history?.overdue === "number" ? history.overdue : null,
        });
        const markdown = formatDigestMarkdown(digest, (id) => (t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id));

        const shell = openModalShell({
            DialogCls,
            title: t("hub.digestTitle"),
            bodyId: "lv-digest-body",
            body: `<pre class="lv-report-pre">${escapeHtml(markdown)}</pre>`,
            width: "600px",
            actions: [
                { id: "close", label: escapeHtml(t("close")), kind: "cancel" },
                { id: "copy", label: escapeHtml(t("hub.digestCopy")), kind: "primary" },
            ],
        });
        const copyBtn = shell.button("copy");
        if (copyBtn) {
            copyBtn.onclick = () => void shell.runBusy("copy", async () => {
                try {
                    await navigator.clipboard.writeText(markdown);
                    showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
                } catch {
                    showMessageFn(t("hub.digestCopyFailed"), 4000, "error");
                }
            });
        }

        // 记录本次快照，供下期生成对比差值
        if (!plugin.runtime) plugin.runtime = {};
        plugin.runtime.digestHistory = { overdue: digest.counts.overdue, at: digest.generatedAt };
        await saveRuntime(plugin, plugin.runtime);
    } catch (e) {
        showMessageFn(t("hub.digestFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
    }
}

const HIGH_CONSEQUENCE_MODULES = new Set([
    "health", "parenting", "certs", "insurance", "assets-real", "assets-virtual", "contracts", "medicine", "schooling"
]);

export interface ExportReminderIcsOptions {
    list: Reminder[];
    t: (k: string) => string;
    showMessageFn: (m: string, timeout?: number, type?: string) => void;
    confirmFn: (title: string, body: string, onConfirm: () => void) => void;
}

/** 提醒中枢日历 ICS 导出（含敏感模块二次确认） */
export async function exportReminderIcs(options: ExportReminderIcsOptions): Promise<void> {
    const { list, t, showMessageFn, confirmFn } = options;
    if (list.length === 0) {
        showMessageFn(t("hub.icsEmpty"), 3000, "error");
        return;
    }
    const download = async () => {
        if (typeof document === "undefined") return;
        try {
            const { buildIcs } = await import("./ics");
            const events = list.map((r: Reminder) => ({
                uid: `${r.id}@lvhome.local`,
                date: r.dueDate,
                summary: r.title,
                description: r.moduleId === "adhoc" ? t("adhoc.name") : (t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId),
            }));
            const ics = buildIcs(t("hub.title"), events);
            const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lvhome-reminders-${new Date().toISOString().slice(0, 10)}.ics`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 0);
            showMessageFn(t("hub.icsDone").replace("${n}", String(list.length)), 3000, "info");
        } catch (e) {
            showMessageFn(t("hub.icsFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 5000, "error");
        }
    };
    if (list.some((r: Reminder) => HIGH_CONSEQUENCE_MODULES.has(r.moduleId))) {
        confirmFn(t("hub.icsTitle"), t("hub.icsBody").replace("${n}", String(list.length)), () => { void download(); });
        return;
    }
    await download();
}
