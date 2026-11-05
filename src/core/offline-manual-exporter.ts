/**
 * 离线静态 HTML 全景手册导出器（POOL-FEAT-09 / CAND-11）
 * 生成零外部外链、内嵌自包含样式的单文件 HTML 手册，供无网应急或换机随时查阅。
 */
import type { Reminder, FamilyMember } from "@/types";

export interface ManualExportData {
    title: string;
    generatedAt: string;
    version: string;
    members: FamilyMember[];
    reminders: Reminder[];
    enabledModules: string[];
    t: (k: string) => string;
}

function escapeHtml(str: string | undefined | null): string {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function generateOfflineHtmlManual(data: ManualExportData): string {
    const { title, generatedAt, version, members, reminders, enabledModules, t } = data;

    const memberRows = members.map((m) => {
        const roleText = t(`role.${m.role}`) !== `role.${m.role}` ? t(`role.${m.role}`) : m.role;
        const bday = m.birthday ? `${m.birthday}${m.lunarBirthday ? " (🌙 农历)" : ""}` : "-";
        return `<tr>
            <td style="font-weight:600;">${escapeHtml(m.name)}</td>
            <td><span class="badge badge-accent">${escapeHtml(roleText)}</span></td>
            <td>${escapeHtml(m.sex === "male" ? "男" : m.sex === "female" ? "女" : "-")}</td>
            <td>${escapeHtml(bday)}</td>
            <td>${escapeHtml(m.notes || "-")}</td>
        </tr>`;
    }).join("\n");

    const reminderRows = reminders.slice(0, 100).map((r) => {
        const modTitle = t(`module.${r.moduleId}`) !== `module.${r.moduleId}` ? t(`module.${r.moduleId}`) : r.moduleId;
        const badgeCls = r.level === "overdue" ? "badge-danger" : r.level === "soon" ? "badge-warn" : "badge-gray";
        const levelText = r.daysLeft < 0 ? `逾期 ${-r.daysLeft} 天` : r.daysLeft === 0 ? "今天到期" : `${r.daysLeft} 天后`;
        return `<tr>
            <td style="font-weight:600;">${escapeHtml(r.title)}</td>
            <td><span class="badge badge-gray">${escapeHtml(modTitle)}</span></td>
            <td>${escapeHtml(r.dueDate)}</td>
            <td><span class="badge ${badgeCls}">${escapeHtml(levelText)}</span></td>
            <td>${escapeHtml(r.priority ? (r.priority === "high" ? "高" : r.priority === "medium" ? "中" : "低") : "-")}</td>
        </tr>`;
    }).join("\n");

    const moduleChips = enabledModules.map((mid) => {
        const label = t(`module.${mid}`) !== `module.${mid}` ? t(`module.${mid}`) : mid;
        return `<span class="chip">${escapeHtml(label)}</span>`;
    }).join(" ");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #f8fafc; --surface: #ffffff; --text: #0f172a; --muted: #64748b;
    --border: #e2e8f0; --primary: #3b82f6; --primary-soft: #eff6ff;
    --danger: #ef4444; --danger-soft: #fef2f2; --warn: #f59e0b; --warn-soft: #fffbeb;
    --ok: #10b981; --ok-soft: #ecfdf5; --radius: 8px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --surface: #1e293b; --text: #f8fafc; --muted: #94a3b8;
      --border: #334155; --primary: #60a5fa; --primary-soft: #1e3a8a;
      --danger: #f87171; --danger-soft: #450a0a; --warn: #fbbf24; --warn-soft: #451a03;
      --ok: #34d399; --ok-soft: #064e3b;
    }
  }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; line-height: 1.5; font-size: 14px; }
  .container { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
  .header { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .header h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: var(--text); }
  .header p { margin: 0; color: var(--muted); font-size: 13px; }
  .btn-print { background: var(--primary); color: #ffffff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-print:hover { opacity: 0.9; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
  .card-title { font-size: 16px; font-weight: 700; margin: 0 0 14px 0; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
  th { background: var(--primary-soft); color: var(--text); padding: 8px 10px; font-weight: 600; border-bottom: 1px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-accent { background: var(--primary-soft); color: var(--primary); }
  .badge-gray { background: var(--bg); color: var(--muted); border: 1px solid var(--border); }
  .badge-danger { background: var(--danger-soft); color: var(--danger); }
  .badge-warn { background: var(--warn-soft); color: var(--warn); }
  .badge-ok { background: var(--ok-soft); color: var(--ok); }
  .chip { display: inline-block; padding: 4px 10px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 12px; margin: 3px; color: var(--text); }
  .footer { text-align: center; color: var(--muted); font-size: 12px; padding: 16px 0; }
  @media print {
    body { background: #fff; color: #000; padding: 0; }
    .btn-print { display: none; }
    .card { border: 1px solid #ccc; break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(data.t("manual.subtitle"))} · 导出时间：${escapeHtml(generatedAt)} · v${escapeHtml(version)}</p>
    </div>
    <button class="btn-print" onclick="window.print()">🖨️ 打印 / 另存为 PDF</button>
  </div>

  <div class="card">
    <div class="card-title">👥 ${escapeHtml(data.t("manual.familyMembers"))} (${members.length})</div>
    <table>
      <thead>
        <tr><th>姓名</th><th>关系角色</th><th>性别</th><th>出生日期</th><th>备注</th></tr>
      </thead>
      <tbody>
        ${memberRows || `<tr><td colspan="5" style="text-align:center;color:var(--muted);">暂无成员档案记录</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="card">
    <div class="card-title">⏰ ${escapeHtml(data.t("manual.upcomingTasks"))} (${reminders.length})</div>
    <table>
      <thead>
        <tr><th>待办事项</th><th>所属模块</th><th>计划/到期日</th><th>状态</th><th>优先级</th></tr>
      </thead>
      <tbody>
        ${reminderRows || `<tr><td colspan="5" style="text-align:center;color:var(--muted);">暂无临近到期待办</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="card">
    <div class="card-title">📁 ${escapeHtml(data.t("manual.activeModules"))} (${enabledModules.length})</div>
    <div>${moduleChips || "未启用模块"}</div>
  </div>

  <div class="footer">
    <p>${escapeHtml(data.t("manual.securityNote"))}</p>
  </div>
</div>
</body>
</html>`;
}

export function exportOfflineHtmlManual(plugin: any, t: (k: string) => string, showMessageFn?: any): void {
    if (typeof document === "undefined") return;

    const members = plugin.settings?.members ?? [];
    const reminders = plugin.scan?.reminders ?? [];
    const enabledModules = plugin.settings?.enabledModules ?? [];
    const version = typeof (plugin as any).version === "string" ? (plugin as any).version : "0.5.191";

    const html = generateOfflineHtmlManual({
        title: t("manual.title"),
        generatedAt: new Date().toLocaleString(),
        version,
        members,
        reminders,
        enabledModules,
        t,
    });

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `siyuan-home-manual-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    if (showMessageFn) {
        showMessageFn(t("settings.exportHtmlManualDone"), 3000, "info");
    }
}
