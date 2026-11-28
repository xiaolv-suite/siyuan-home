/**
 * 罗盘与生态互联集成控制器 (LaunchpadController)
 * 从 index.ts 上帝类中剥离的罗盘动作、全局万物检索、数据灾备快照与向导初始化逻辑。
 */

import { Dialog } from "siyuan";
import { lvLaunchpad, mountLvAiThinkingCard, type LvAiThinkingCardHandle, type LvSearchResultItem } from "@/libs/lv-notice-kit";
import { bindDialogA11y } from "@/core/dialog-a11y";
import { homeNotify } from "@/libs/notice";
import { searchMatch } from "@/core/pinyin";
import { saveSettings } from "@/core/settings";
import { exportHomeSnapshot, restoreHomeSnapshotMerge } from "@/core/vault-adapter";

const PLUGIN_VERSION = typeof __PLUGIN_VERSION__ !== "undefined" ? __PLUGIN_VERSION__ : "0.5.202";

export class LaunchpadController {
    private readonly plugin: any;
    private lifeHealthAuditRunning = false;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    openDashboard(): void {
        this.plugin.showTab();
    }

    getExpiringCount(): number {
        if (!this.plugin.scan?.reminders) return 0;
        return this.plugin.scan.reminders.filter(
            (r: any) => typeof r.daysLeft === "number" && r.daysLeft <= 7,
        ).length;
    }

    async handleQuickAction(action: string): Promise<void> {
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        switch (action) {
            case "记一笔备忘":
            case "快速记录生活备忘事项":
                if (this.plugin.isMobileView()) {
                    this.plugin.entrypointsController?.getMobileController()?.openMobilePanel("overview");
                } else {
                    this.plugin.showTab();
                }
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                }
                break;
            case "今日清单":
                this.plugin.openRemindersScreen();
                break;
            case "逾期扫描":
            case "扫描即将到期证件与药品":
                await this.plugin.refreshHub(undefined, true);
                this.plugin.runtime.hubFilter = "overdue";
                this.plugin.openRemindersScreen();
                break;
            case "证件到期速览":
                this.plugin.runtime.hubModuleId = "certs";
                this.plugin.openRemindersScreen();
                break;
            case "批量归档已完成待办项":
                homeNotify("已完成待办项状态核验", 2500, "info");
                break;
            case "AI生活效期智能体检":
            case "全生态数据健康体检与清理":
                await this.runLifeHealthAudit();
                break;
            default:
                this.plugin.showTab();
                break;
        }
    }

    async runLifeHealthAudit(): Promise<void> {
        if (this.lifeHealthAuditRunning) return;
        this.lifeHealthAuditRunning = true;

        let dlg: any = null;
        let thinkingHandle: LvAiThinkingCardHandle | null = null;
        let auditCompleted = false;
        let thinkingHost: HTMLElement | null = null;
        let pre: HTMLPreElement | null = null;
        let copyBtn: HTMLButtonElement | null = null;
        let journalBtn: HTMLButtonElement | null = null;

        try {
            try {
                dlg = new Dialog({
                    title: `🐴 ${this.plugin.i18nText("overview.aiAuditTitle")}`,
                    content: `<div class="b3-dialog__content lv-dialog-scroll-body"><div id="lv-audit-thinking-host"></div><pre class="lv-caption lv-report-pre" style="white-space:pre-wrap; line-height:1.6; font-size:12.5px; margin:0; display:none;"></pre></div>
<div class="b3-dialog__action">
  <button type="button" class="b3-button b3-button--cancel">${this.plugin.i18nText("cancel") || "关闭"}</button>
  <button type="button" class="b3-button" id="lv-audit-copy" disabled>${this.plugin.i18nText("overview.aiAuditCopyBtn")}</button>
  <button type="button" class="b3-button" id="lv-audit-journal" disabled>${this.plugin.i18nText("overview.aiAuditJournalBtn")}</button>
</div>`,
                    width: typeof window !== "undefined" && window.innerWidth < 640 ? "92vw" : "640px",
                });

                thinkingHost = dlg.element?.querySelector?.("#lv-audit-thinking-host") as HTMLElement | null;
                pre = dlg.element?.querySelector?.("pre") as HTMLPreElement | null;
                copyBtn = dlg.element?.querySelector?.("#lv-audit-copy") as HTMLButtonElement | null;
                journalBtn = dlg.element?.querySelector?.("#lv-audit-journal") as HTMLButtonElement | null;

                thinkingHandle = mountLvAiThinkingCard(thinkingHost, {
                    scenario: "doc-judge",
                    title: this.plugin.i18nText("overview.aiAuditTitle") || "AI 生活效期智能体检",
                    subtitle: "正在汇总全屋证件、药品、保单与生活待办效期…",
                    stages: [
                        { afterSec: 0, text: "正在同步全屋台账与效期扫描数据…", icon: "🔎" },
                        { afterSec: 3, text: "正在调用 AI 专家研判临期风险与续办顺序…", icon: "🏥" },
                        { afterSec: 8, text: "正在生成结构化生活效期体检洞察报告…", icon: "📋" },
                        { afterSec: 16, text: "报告内容较多，仍在深度分析中…", icon: "⏳" },
                    ],
                    cancelLabel: "⏹ 取消体检",
                    onCancel: () => {
                        dlg?.destroy?.();
                    },
                });

                bindDialogA11y({
                    dlg,
                    onClose: () => {
                        if (!auditCompleted) {
                            thinkingHandle?.cancel();
                        }
                        thinkingHandle?.done();
                    },
                });

                const cancelBtn = dlg.element?.querySelector?.(".b3-dialog__action .b3-button--cancel") as HTMLButtonElement | null;
                if (cancelBtn) cancelBtn.onclick = () => dlg.destroy();
            } catch {
                dlg = null;
                thinkingHandle = null;
            }

            await this.plugin.refreshHub(undefined, true);
            if (thinkingHandle?.aborted) return;

            const { auditLifeHealthWithAi, resolveHomeAiDestinationInfo } = await import("@/core/ai-nlp");
            const dest = resolveHomeAiDestinationInfo();
            thinkingHandle?.update({
                subtitle: `正在通过「${dest.label}」分析临期证件、药品与保单风险…`,
            });
            const audit = await auditLifeHealthWithAi(this.plugin, { signal: thinkingHandle?.signal });
            if (thinkingHandle?.aborted) return;

            auditCompleted = true;
            thinkingHandle?.done();
            if (thinkingHost) thinkingHost.style.display = "none";

            if (dlg?.element) {
                if (pre) {
                    pre.textContent = audit.reportText;
                    pre.style.display = "";
                }

                if (copyBtn) {
                    copyBtn.disabled = false;
                    copyBtn.onclick = async () => {
                        try {
                            if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
                            await navigator.clipboard.writeText(audit.reportText);
                            homeNotify(this.plugin.i18nText("overview.aiAuditCopyOk"), 2500, "info");
                        } catch (err) {
                            console.warn("[siyuan-home] audit copy failed", err);
                            homeNotify(this.plugin.i18nText("overview.aiAuditCopyFail"), 3200, "error");
                        }
                    };
                }

                if (journalBtn) {
                    journalBtn.disabled = false;
                    journalBtn.onclick = async () => {
                        try {
                            const { recordHighFrequencyDiaryEvent } = await import("@/core/diary-envelope");
                            const res = await recordHighFrequencyDiaryEvent(this.plugin, {
                                module: "health",
                                action: "ai-audit",
                                target: "household",
                                bizDate: audit.auditDate,
                                recordedAt: new Date().toISOString(),
                                text: `🏥 AI生活效期体检 (${audit.auditDate}) · 紧急 ${audit.urgentCount} 项 · 临期 ${audit.upcomingCount} 项\n${audit.reportText}`,
                                extraAttrs: {
                                    ...(audit.isAiGenerated
                                        ? { "custom-sy-ai-source": "editor" }
                                        : { "custom-lv-ai-source": "offline-rule" }),
                                    "custom-lv-ai-task": "life-health-audit",
                                    "custom-lv-ai-generated": String(audit.isAiGenerated),
                                    "custom-lv-ai-urgent": String(audit.urgentCount),
                                    "custom-lv-ai-upcoming": String(audit.upcomingCount),
                                    "custom-lv-ai-date": audit.auditDate,
                                    "custom-lv-ai-version": "v2",
                                },
                            });
                            if (res.blockId) {
                                homeNotify(this.plugin.i18nText("overview.aiAuditJournalOk"), 2500, "info");
                            } else {
                                homeNotify("写入今日日记失败", 3000, "info");
                            }
                        } catch {
                            homeNotify("写入今日日记失败", 3000, "info");
                        }
                    };
                }
            } else {
                homeNotify(audit.reportText.slice(0, 100), 5000, "info");
            }
        } catch (err) {
            if (!thinkingHandle?.aborted) {
                homeNotify(err instanceof Error ? err.message : String(err), 4000, "error");
                dlg?.destroy?.();
            }
        } finally {
            thinkingHandle?.done();
            this.lifeHealthAuditRunning = false;
        }
    }

    registerLaunchpadEntry(): void {
        try {
            this.plugin.launchpadScope?.dispose();
            this.plugin.launchpadScope = this.plugin.disposer.createChildScope();
            const expiring = this.getExpiringCount();
            const cleaner = lvLaunchpad.register({
                id: "siyuan-home",
                name: "管家",
                fullName: "小驴管家",
                svgIcon: "iconLvHome",
                color: "#10b981",
                desc: "事项归档 · 效期预警",
                digit: 3,
                badge: expiring > 0 ? `${expiring} 到期` : undefined,
                badgeType: "warn",
                badgeProvider: () => {
                    const n = this.getExpiringCount();
                    return n > 0 ? `${n} 到期` : undefined;
                },
                actions: ["记一笔备忘", "今日清单", "逾期扫描", "证件到期速览"],
                topBarElement: this.plugin.topBarElement,
                onClick: () => this.openDashboard(),
                onAction: (action) => this.handleQuickAction(action),
            });
            this.plugin.launchpadScope.add(cleaner);
        } catch {
            /* 容错降级 */
        }
    }

    searchHomeItems(keyword: string): LvSearchResultItem[] {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return [];
        const results: LvSearchResultItem[] = [];

        const memos = this.plugin.runtime?.memos ?? [];
        for (const m of memos) {
            const hit =
                m.title?.toLowerCase().includes(kw) ||
                (m.category && m.category.toLowerCase().includes(kw)) ||
                searchMatch(m.title, kw);
            if (hit) {
                const isDone = Boolean(m.doneAt);
                results.push({
                    id: `home:memo:${m.id}`,
                    source: "管家",
                    category: "待办",
                    title: m.title,
                    snippet: m.dueDate
                        ? `到期日: ${m.dueDate}${m.category ? ` · #${m.category}` : ""}`
                        : m.category
                          ? `#${m.category}`
                          : "生活备忘",
                    badge: isDone ? "已办结" : m.priority === "high" ? "高优" : undefined,
                    onClick: () => {
                        this.plugin.showTab();
                    },
                });
            }
        }

        const reminders = this.plugin.scan?.reminders ?? [];
        const categoryMap: Record<string, string> = {
            certs: "证件",
            medicine: "药品",
            insurance: "保单",
            contracts: "合同",
            vehicles: "车辆",
            adhoc: "待办",
        };

        for (const r of reminders) {
            if (r.moduleId === "adhoc" && results.some((item) => item.id.includes(r.id))) continue;
            const hit =
                r.title?.toLowerCase().includes(kw) ||
                r.moduleId?.toLowerCase().includes(kw) ||
                searchMatch(r.title, kw);
            if (hit) {
                const cat = categoryMap[r.moduleId] || "效期";
                const badge = r.daysLeft <= 0 ? "已逾期" : `剩余 ${r.daysLeft} 天`;
                results.push({
                    id: `home:rem:${r.id}`,
                    source: "管家",
                    category: cat,
                    title: r.title,
                    snippet: `到期效期: ${r.dueDate} · ${cat}`,
                    badge,
                    linkBlockId: r.rowId || r.id,
                    onClick: () => {
                        this.plugin.openRemindersScreen();
                    },
                });
            }
        }

        const members = this.plugin.settings?.members ?? [];
        for (const mem of members) {
            const hit =
                mem.name?.toLowerCase().includes(kw) ||
                (mem.role && mem.role.toLowerCase().includes(kw)) ||
                searchMatch(mem.name, kw);
            if (hit) {
                results.push({
                    id: `home:member:${mem.id}`,
                    source: "管家",
                    category: "成员",
                    title: mem.name,
                    snippet: `家庭成员 · ${mem.role || "成员"}${mem.birthday ? ` · 生日 ${mem.birthday}` : ""}`,
                    badge: "档案",
                    onClick: () => {
                        this.plugin.openModuleTab("members");
                    },
                });
            }
        }

        return results;
    }

    async dumpEcosystemBackupData(): Promise<Record<string, unknown>> {
        return exportHomeSnapshot(this.plugin);
    }

    async restoreEcosystemBackupData(data: Record<string, unknown>): Promise<boolean> {
        return restoreHomeSnapshotMerge(this.plugin, data);
    }

    async finishOnboarding(household: { roles: string[]; children: number }, moduleIds: string[]): Promise<void> {
        this.plugin.settings.household = household as any;
        this.plugin.settings.enabledModules = Array.from(new Set([...this.plugin.settings.enabledModules, ...moduleIds]));
        const shouldInitMembers = !this.plugin.settings.members || this.plugin.settings.members.length === 0;

        if (moduleIds.length > 0) {
            homeNotify(this.plugin.i18nText("wiz.provisioning").replace("${n}", String(moduleIds.length)), 4000, "info");
        } else {
            homeNotify(this.plugin.i18nText("wiz.provisioningBase"), 3000, "info");
        }
        const provisioning = await this.plugin.ensureCoreLedgers();
        if (!this.plugin.settings.dbRefs?.members?.avId) {
            try {
                await this.plugin.repairModule("members");
            } catch {
                /* soft */
            }
        }
        if (shouldInitMembers) {
            const roleLabels: Record<string, string> = {
                self: "我 (本人)",
                spouse: "配偶",
                partner: "伴侣",
                elder: "长辈",
                parent: "长辈",
                child: "孩子",
                kin: "亲属",
                relative: "亲属",
                pet: "宠物",
            };
            const initMembers: any[] = [];
            for (const r of household.roles ?? ["self"]) {
                if (r === "child" && household.children > 1) {
                    for (let c = 1; c <= household.children; c++) {
                        initMembers.push({ id: `mem-${Date.now()}-${c}`, name: `孩子${c}`, role: "child" });
                    }
                } else {
                    initMembers.push({
                        id: `mem-${Date.now()}-${initMembers.length + 1}`,
                        name: roleLabels[r] || r,
                        role: r,
                    });
                }
            }
            if (this.plugin.settings.dbRefs?.members?.avId) {
                const { addMember } = await import("@/core/members");
                for (const m of initMembers) {
                    await addMember(this.plugin, this.plugin.settings, m);
                }
            } else {
                this.plugin.settings.members = initMembers;
            }
        }
        this.plugin.settings.onboarded = true;
        await saveSettings(this.plugin, this.plugin.settings);

        const failed = provisioning.issues.map(({ moduleId }: any) => this.plugin.i18nText(`module.${moduleId}`));
        if (failed.length > 0) {
            homeNotify(
                this.plugin
                    .i18nText("wiz.provisionIssues")
                    .replace("${n}", String(failed.length))
                    .replace("${modules}", failed.join("、")),
                8000,
                "error",
            );
        } else if (moduleIds.length > 0) {
            homeNotify(this.plugin.i18nText("wiz.provisioned").replace("${n}", String(moduleIds.length)), 3000, "info");
        } else {
            homeNotify(this.plugin.i18nText("wiz.provisionedBase"), 3000, "info");
        }

        await this.plugin.refreshHub(undefined, true);
    }

    getDiagnostics(): any {
        const contracts: string[] = [];
        for (const [id, ref] of Object.entries(this.plugin.settings.dbRefs ?? {}) as Array<[string, any]>) {
            for (const issue of ref?.schemaIssues ?? []) {
                contracts.push(
                    `[${id}.${issue.colKey}] expected=${issue.expectedType} actual=${issue.actualType}: ${issue.guidance ?? "column type drift"}`,
                );
            }
        }
        return {
            version: PLUGIN_VERSION,
            scannedAt: this.plugin.runtime?.scannedAt,
            errors: this.plugin.scan?.errors ?? [],
            ledgers: Object.entries(this.plugin.settings.dbRefs).map(([id, ref]: [string, any]) => ({
                id,
                provisioned: !!ref?.docId,
                provisional: !!ref?.provisional,
                columns: Object.keys(ref?.columns ?? {}).length,
                error: ref?.provisionError,
            })),
            contracts,
        };
    }
}
