<script lang="ts">
    import { Dialog } from "siyuan";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { confirm } from "@/libs/dialog";
    import { listNotebooks } from "@/core/siyuan";
    import { MODULE_GROUPS, modulesByGroup } from "@/core/modules";
    import { newMember, saveSettings, normalizeCheckinBindings } from "@/core/settings";
    import type { ProvisioningReport } from "@/core/provisioner";
    import type { HomeSettings, FamilyMember, CheckinBinding } from "@/types";
    import { formatLocalDateTime } from "@/core/date-display";
    import SettingsModulesTab from "@/panels/settings-modules-tab.svelte";
    import SettingsMembersTab from "@/panels/settings-members-tab.svelte";
    import SettingsRemindersTab from "@/panels/settings-reminders-tab.svelte";
    import SettingsDataTab from "@/panels/settings-data-tab.svelte";
    import SettingsAboutTab from "@/panels/settings-about-tab.svelte";
    import UiIcon from "@/ui/icon.svelte";
    import type { UiIconName } from "@/ui/icons";

    interface IHomePluginLike {
        i18n: Record<string, unknown>;
        settings: HomeSettings;
        runtime?: { favorSyncs?: Record<string, Record<string, { docId: string; at: string }>> };
        getDiagnostics?: () => any;
        /** moduleId → schema 目录（D12 深度健康检查 / C8c leadOverrides 枚举用） */
        schemaCatalog?: Record<string, { columns?: { key: string }[]; reminders?: { key: string; field: string; kind: string; leadDays: number }[] }>;
        /** 保存后广播到全部页签（H02）；force=设置变更不受去抖限制 */
        refreshHub?: (only?: string | string[], force?: boolean) => Promise<unknown>;
        /** C8b：新启用模块立即建库 */
        ensureCoreLedgers?: () => Promise<ProvisioningReport>;
        /** 智能找回并接管思源中已有历史台账 */
        adoptHistoryLedgers?: () => Promise<any>;
        /** UG03/DL07：导入前备份探测与恢复 */
        loadData?: (name: string) => Promise<unknown>;
        saveData?: (name: string, data: unknown) => Promise<void>;
    }

    let { plugin, settings, onClose }: {
        plugin: IHomePluginLike;
        settings: HomeSettings;
        onClose?: () => void;
    } = $props();

    let settingsRootEl: HTMLElement | undefined = $state();
    function handleCloseSettings() {
        if (onClose) {
            onClose();
            return;
        }
        const dlg = settingsRootEl?.closest(".b3-dialog");
        const closeBtn = dlg?.querySelector<HTMLElement>(".b3-dialog__close, .lv-dialog-mobile-close-btn, [data-type='cancel']");
        if (closeBtn) closeBtn.click();
        else dlg?.remove();
    }

    let notebookList = $state<Array<{ id: string; name: string }>>([]);
    $effect(() => {
        void listNotebooks().then((list) => {
            notebookList = (list ?? []).filter((nb) => !nb.closed);
        }).catch(() => undefined);
    });

    // i18n 取值统一转 string（1.2.8 起 JSONValue）
    const t = (key: string) => String(plugin.i18n[key] ?? key);
    function describeProvisioningIssues(report?: ProvisioningReport): string {
        const issues = report?.issues ?? [];
        if (issues.length === 0) return "";
        const modules = issues.map(({ moduleId }) => t(`module.${moduleId}`)).join("、");
        return t("settings.provisionPartial").replace("${modules}", modules);
    }

    type SettingsArea = "modules" | "members" | "reminders" | "data" | "about";
    const areas: { id: SettingsArea; labelKey: string; icon: UiIconName }[] = [
        { id: "modules", labelKey: "tabModules", icon: "archive" },
        { id: "members", labelKey: "tabMembers", icon: "users" },
        { id: "reminders", labelKey: "tabReminders", icon: "bell" },
        { id: "data", labelKey: "settings.dataTitle", icon: "bank" },
        { id: "about", labelKey: "tabAbout", icon: "info" },
    ];

    function onNavKeydown(e: KeyboardEvent, index: number) {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? areas.length - 1
            : (index + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + areas.length) % areas.length;
        area = areas[next].id;
        requestAnimationFrame(() => {
            const btn = document.querySelector<HTMLButtonElement>(`.lv-setnav__item[aria-current="true"]`);
            btn?.focus();
        });
    }

    let area: SettingsArea = $state("modules");
    let saving = $state(false);
    // 33.4 编辑事务：draft 副本，保存才落盘（取消/关闭不污染 settings）。
    // 此处捕获初始快照是设计意图，抑制 svelte 的 locally-referenced 提示。
    // svelte-ignore state_referenced_locally
    let draftEnabled: string[] = $state([...settings.enabledModules]);
    // svelte-ignore state_referenced_locally
    let draftMembers: FamilyMember[] = $state(settings.members.map((m: FamilyMember) => ({ ...m })));
    // C8c 提醒分区 draft：摘要时段/静默时段 + 提前量覆盖（key → 空串=用默认）
    // svelte-ignore state_referenced_locally
    let draftNotifyHour = $state(settings.notifyHour);
    // svelte-ignore state_referenced_locally
    let draftSilentFrom = $state(settings.silentFrom);
    // svelte-ignore state_referenced_locally
    let draftSilentTo = $state(settings.silentTo);
    // svelte-ignore state_referenced_locally
    let draftLeads = $state<Record<string, string>>(
        Object.fromEntries(Object.entries(settings.leadOverrides ?? {}).map(([k, v]) => [k, String(v)])),
    );
    // 229 波：Webhook 推送 draft（Bark / ntfy；发送测试用 draft 值，无需先保存）
    // svelte-ignore state_referenced_locally
    let draftWebhookEnabled = $state(settings.webhookEnabled ?? false);
    // svelte-ignore state_referenced_locally
    let draftWebhookMode = $state<"bark" | "ntfy">(settings.webhookMode === "ntfy" ? "ntfy" : "bark");
    // svelte-ignore state_referenced_locally
    let draftWebhookUrl = $state(settings.webhookUrl ?? "");
    let rerunBusy = $state(false);
    let diagnosticsBusy = $state<"backfill" | "duplicates" | "health" | "rebuild" | "adopt" | null>(null);
    let exportingDiagnostics = $state(false);
    let demoBusy = $state(false);
    let demoAction = $state<"generate" | "clear" | null>(null);
    /** C8c：枚举所有模块的提醒规则（leadOverrides 编辑行） */
    const leadRules = $derived.by(() => {
        const catalog = plugin.schemaCatalog ?? {};
        const rows: { key: string; moduleId: string; ruleKey: string; def: number }[] = [];
        for (const [moduleId, schema] of Object.entries(catalog) as [string, any][]) {
            for (const rule of schema?.reminders ?? []) {
                rows.push({ key: `${moduleId}.${rule.key}`, moduleId, ruleKey: rule.key, def: rule.leadDays });
            }
        }
        return rows.sort((a, b) => a.key.localeCompare(b.key));
    });

    const enabledIds = $derived(new Set(draftEnabled));

    // EC09（D20）：打卡绑定 draft——习惯→成员指标映射，只读消费不写打卡数据
    // svelte-ignore state_referenced_locally
    let draftBindings: CheckinBinding[] = $state((settings.checkinBindings ?? []).map((b) => ({ ...b })));

    // 263 波（脏检查）：归一化 helper 与 save() 共用同一份实现——判断口径=落盘口径，永不漂移
    const clampHour = (v: number, fallback: number) => (Number.isFinite(v) ? Math.min(23, Math.max(0, Math.round(v))) : fallback);
    const normWebhookUrl = (u: string) => u.trim().replace(/\/+$/, "");
    const normLeads = (d: Record<string, string>) => Object.fromEntries(
        Object.entries(d)
            .map(([k, v]) => [k, v.trim() === "" ? null : Number(v)] as [string, number | null])
            .filter(([, v]) => v !== null && Number.isFinite(v as number) && (v as number) >= 0)
            .map(([k, v]) => [k, Math.min(3650, v as number)]),
    );
    const memberKey = (m: FamilyMember) => JSON.stringify([m.id, m.name.trim() || "?", m.role, m.birthday ?? "", m.sex ?? "", m.lunarBirthday === true]);

    // settings 是普通对象（属性写不触发响应）——保存落盘后 bump 一次，强迫 dirty 重评
    let savedTick = $state(0);
    const settingHint = (zh: string, en: string) => /[\u3400-\u9fff]/.test(t("settings.importDone")) ? zh : en;

    function cloneSettings(source: HomeSettings): HomeSettings {
        return JSON.parse(JSON.stringify(source)) as HomeSettings;
    }

    function syncDraftFromSettings(source: HomeSettings) {
        draftEnabled = [...source.enabledModules];
        draftMembers = source.members.map((m) => ({ ...m }));
        draftNotifyHour = source.notifyHour;
        draftSilentFrom = source.silentFrom;
        draftSilentTo = source.silentTo;
        draftLeads = Object.fromEntries(Object.entries(source.leadOverrides ?? {}).map(([k, v]) => [k, String(v)]));
        draftWebhookEnabled = source.webhookEnabled ?? false;
        draftWebhookMode = source.webhookMode === "ntfy" ? "ntfy" : "bark";
        draftWebhookUrl = source.webhookUrl ?? "";
        draftBindings = (source.checkinBindings ?? []).map((b) => ({ ...b }));
    }

    function revertDraft() {
        syncDraftFromSettings(plugin.settings ?? settings);
        showMessage(t("cancel"), 1500, "info");
    }

    async function persistReplacement(next: HomeSettings): Promise<void> {
        const previous = cloneSettings(plugin.settings);
        plugin.settings = next;
        try {
            await saveSettings(plugin as any, next);
        } catch (error) {
            plugin.settings = previous;
            savedTick += 1;
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), { settingsPersistFailed: true });
        }
        syncDraftFromSettings(next);
        savedTick += 1;
        window.dispatchEvent(new CustomEvent("siyuan-home:settings-replaced", { detail: { plugin, settings: next } }));
    }

    /** 草稿是否偏离已保存设置（footer 徽章；四种生效参数全部覆盖） */
    const dirty = $derived.by(() => {
        void savedTick;
        const s = plugin.settings ?? settings;
        const normModules = (ids: string[]) => [...new Set(ids)].sort();
        if (JSON.stringify(normModules(draftEnabled)) !== JSON.stringify(normModules(s.enabledModules))) return true;
        if (draftMembers.map(memberKey).join("|") !== s.members.map(memberKey).join("|")) return true;
        if (clampHour(draftNotifyHour, 8) !== s.notifyHour) return true;
        if (clampHour(draftSilentFrom, 22) !== s.silentFrom || clampHour(draftSilentTo, 8) !== s.silentTo) return true;
        if (draftWebhookMode !== (s.webhookMode === "ntfy" ? "ntfy" : "bark")) return true;
        if (normWebhookUrl(draftWebhookUrl) !== (s.webhookUrl ?? "")) return true;
        if ((draftWebhookEnabled && normWebhookUrl(draftWebhookUrl) !== "") !== (s.webhookEnabled ?? false)) return true;
        if (JSON.stringify(normLeads(draftLeads)) !== JSON.stringify(s.leadOverrides ?? {})) return true;
        if (JSON.stringify(normalizeCheckinBindings(draftBindings)) !== JSON.stringify(s.checkinBindings ?? [])) return true;
        return false;
    });

    function enableAll() {
        draftEnabled = MODULE_GROUPS.flatMap((g) => modulesByGroup(g).map((m) => m.id));
    }

    function coreOnly() {
        draftEnabled = MODULE_GROUPS.flatMap((g) => modulesByGroup(g))
            .filter((m) => m.defaultEnabled || m.alwaysOn)
            .map((m) => m.id);
    }

    function addMember() {
        draftMembers = [...draftMembers, newMember(" ", "other")];
    }

    function removeMember(id: string) {
        const member = draftMembers.find((item) => item.id === id);
        if (!member) return;
        confirm(t("members.deleteTitle"), t("members.deleteBody").replace("${name}", member.name.trim() || t("members.name")), () => {
            draftMembers = draftMembers.filter((m) => m.id !== id);
        });
    }

    // 24 组：设置导出/导入（跨设备/重装迁移辅助）
    // UG03/DL07：导入前自动备份当前设置，可一键恢复（导入链的数据安全闭环）
    let preImportBackupExists = $state(false);
    let migrationBusy = $state(false);
    let migrationAction = $state<"import" | "restore" | null>(null);
    $effect(() => {
        // 面板打开时探测一次（备份文件是否存在）
        plugin.loadData?.("settings.pre-import.json").then((v: unknown) => { preImportBackupExists = !!v; }).catch(() => undefined);
    });

    const exportSettings = () => import("@/core/settings-maintenance").then((m) => m.exportSettingsJson(plugin, t));
    const exportHtmlManual = () => import("@/core/offline-manual-exporter").then((m) => m.exportOfflineHtmlManual(plugin, t, showMessage));
    const exportDiagnostics = () => {
        if (exportingDiagnostics) return;
        exportingDiagnostics = true;
        import("@/core/settings-maintenance").then((m) => m.exportDiagnosticsPackage(plugin, t, showMessage)).finally(() => { exportingDiagnostics = false; });
    };
    const previewDiagnostics = () => {
        import("@/core/settings-maintenance").then((m) => m.openDiagnosticsPreviewDialog(plugin, t, Dialog, showMessage));
    };
    const runBackfillMemberLinks = async () => {
        if (diagnosticsBusy) return;
        diagnosticsBusy = "backfill";
        try {
            const { executeBackfillMemberLinks } = await import("@/core/settings-maintenance");
            await executeBackfillMemberLinks(plugin, t, Dialog, showMessage);
        } finally {
            diagnosticsBusy = null;
        }
    };
    const runDuplicateCheck = async () => {
        if (diagnosticsBusy) return;
        diagnosticsBusy = "duplicates";
        try {
            const { executeDuplicateLedgerCheck } = await import("@/core/settings-maintenance");
            await executeDuplicateLedgerCheck(plugin, t, showMessage);
        } finally {
            diagnosticsBusy = null;
        }
    };
    const runDeepHealthCheck = async () => {
        if (diagnosticsBusy) return;
        diagnosticsBusy = "health";
        try {
            const { executeDeepHealthCheck } = await import("@/core/settings-maintenance");
            await executeDeepHealthCheck(plugin, t, showMessage);
        } finally {
            diagnosticsBusy = null;
        }
    };
    const rebuildAllLedgers = async () => {
        if (diagnosticsBusy) return;
        const { confirm } = await import("@/libs/dialog");
        confirm(
            t("diag.rebuildAll"),
            t("diag.rebuildConfirm") || "将重新检查并补齐所有已启用模块的台账文档、属性视图与缺失字段（不会删除已有生活数据）。确定继续吗？",
            async () => {
                diagnosticsBusy = "rebuild";
                try {
                    const { executeRebuildAllLedgers } = await import("@/core/settings-maintenance");
                    await executeRebuildAllLedgers(plugin, t, showMessage);
                } finally {
                    diagnosticsBusy = null;
                }
            }
        );
    };
    const runAdoptHistoryLedgers = async () => {
        if (diagnosticsBusy) return;
        diagnosticsBusy = "adopt";
        try {
            const { executeAdoptHistoryLedgers } = await import("@/core/settings-maintenance");
            await executeAdoptHistoryLedgers(plugin, t, showMessage);
        } finally {
            diagnosticsBusy = null;
        }
    };
    const rerunOnboarding = async () => {
        if (rerunBusy || saving || migrationBusy || demoBusy) return;
        rerunBusy = true;
        try {
            const { executeRerunOnboarding } = await import("@/core/settings-maintenance");
            await executeRerunOnboarding(plugin, t, showMessage, persistReplacement);
        } finally {
            rerunBusy = false;
        }
    };
    const restorePreImport = async () => {
        if (migrationBusy || saving) return;
        const { executeRestorePreImport } = await import("@/core/settings-maintenance");
        await executeRestorePreImport(plugin, t, showMessage, persistReplacement);
    };
    const importSettings = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (!file) return;
        const { executeImportSettings } = await import("@/core/settings-maintenance");
        await executeImportSettings(file, plugin, t, showMessage, persistReplacement);
    };

    async function save() {
        if (saving || migrationBusy) return;
        saving = true;
        let persisted = false;
        let provisioningWarning = "";
        try {
            const previous = cloneSettings(plugin.settings);
            const prevMembers = previous.members;
            const prevModules = new Set(previous.enabledModules);
            const normalizedBindings = normalizeCheckinBindings(draftBindings);
            const droppedBindingCount = Math.max(0, draftBindings.length - normalizedBindings.length);
            const modulesChanged = draftEnabled.length !== prevModules.size || draftEnabled.some((id) => !prevModules.has(id));
            const next: HomeSettings = {
                ...previous,
                enabledModules: [...draftEnabled],
                members: draftMembers.map((m) => ({ ...m, name: m.name.trim() || "?", sex: m.sex || undefined })),
                // C8c：提醒设置落盘（无效时段值忽略，保持 0-23 界内）；263 波起与脏检查共用 clampHour
                notifyHour: clampHour(draftNotifyHour, 8),
                silentFrom: clampHour(draftSilentFrom, 22),
                silentTo: clampHour(draftSilentTo, 8),
                // 229 波：Webhook 落盘（URL 归一去尾斜杠/空白；空串=不推送）；263 波起与脏检查共用 normWebhookUrl
                webhookEnabled: draftWebhookEnabled && normWebhookUrl(draftWebhookUrl) !== "",
                webhookUrl: normWebhookUrl(draftWebhookUrl),
                webhookMode: draftWebhookMode,
                // 263 波：与脏检查共用 normLeads
                leadOverrides: normLeads(draftLeads),
                // EC09：打卡绑定落盘（清洗在 normalize——缺 id/metric 非法剔除、去重）
                checkinBindings: normalizedBindings,
            };
            plugin.settings = next;
            try {
                await saveSettings(plugin as any, next);
            } catch (error) {
                plugin.settings = previous;
                savedTick += 1;
                throw error;
            }
            persisted = true;
            syncDraftFromSettings(next);
            savedTick += 1;

            // C8b：模块开关接线——新启用模块立即建库（禁用只隐藏保留数据）
            if (modulesChanged) {
                // EC15：禁用模块时清理其 favorSyncs 运行态数据
                const disabledModules = [...prevModules].filter((id) => !draftEnabled.includes(id));
                if (disabledModules.length > 0 && plugin.runtime?.favorSyncs) {
                    for (const mid of disabledModules) delete plugin.runtime.favorSyncs[mid];
                }
                provisioningWarning = describeProvisioningIssues(await plugin.ensureCoreLedgers?.());
            }
            // D05：设置页与成员页同走成员 DAL——差异同步到 members 台账行（新增建行/变更写回）
            const { syncMembersToAv } = await import("@/core/members");
            const rep = await syncMembersToAv(plugin as any, next, prevMembers);
            // H02：设置变更（模块开关/成员）广播到全部页签（强制全量重扫——设置变更不受去抖限制）
            await plugin.refreshHub?.(undefined, true);
            const warnings: string[] = [];
            if (rep.failed.length > 0) warnings.push(t("members.syncPartial").replace("${n}", String(rep.failed.length)));
            if (provisioningWarning) warnings.push(provisioningWarning);
            if (droppedBindingCount > 0) warnings.push(t("settings.checkinCleaned").replace("${n}", String(droppedBindingCount)));
            if (warnings.length > 0) {
                showMessage(warnings.join("；"), 7000, "error");
            } else {
                showMessage(t("saved"), 2000, "info");
            }
        } catch (e) {
            // 配置落盘后，建库/成员同步/刷新失败不应伪报为“保存失败”。
            const prefix = persisted
                ? settingHint("设置已保存，但后续同步失败", "Settings saved, but follow-up sync failed")
                : t("settings.saveFailed");
            showMessage(`${prefix}${e instanceof Error ? ` (${e.message})` : ""}`, 6000, "error");
        } finally {
            saving = false;
        }
    }

    const generateDemo = async () => {
        if (demoBusy || saving || migrationBusy) return;
        demoBusy = true;
        demoAction = "generate";
        try {
            const { executeGenerateDemo } = await import("@/core/settings-maintenance");
            await executeGenerateDemo(plugin, t, showMessage);
        } finally {
            demoBusy = false;
            demoAction = null;
        }
    };
    const clearDemo = () => {
        if (demoBusy || saving || migrationBusy) return;
        demoBusy = true;
        demoAction = "clear";
        import("@/core/settings-maintenance").then((m) => {
            m.executeClearDemo(plugin, t, showMessage);
        }).finally(() => {
            demoBusy = false;
            demoAction = null;
        });
    };
</script>

<div class="lv-home lv-settings" bind:this={settingsRootEl}>
    <!-- 左侧主分类；模块和提醒等复杂页面在右侧继续细分。 -->
    <nav class="lv-setnav" aria-label={t("settingsTitle")} inert={saving || migrationBusy || demoBusy}>
        <div class="lv-setnav__brand"><span class="lv-setnav__brand-mark" aria-hidden="true"><UiIcon name="home" size={16} /></span><div><b>{t("butler")}</b><span>LV HOME</span></div></div>
        {#each areas as a, i (a.id)}
            <button
                type="button"
                class="lv-setnav__item {area === a.id ? 'on' : ''}"
                aria-current={area === a.id ? 'true' : undefined}
                tabindex={area === a.id ? 0 : -1}
                onclick={() => (area = a.id)}
                onkeydown={(e) => onNavKeydown(e, i)}
            >
                <span class="lv-setnav__icon" aria-hidden="true"><UiIcon name={a.icon} size={15} /></span>{t(a.labelKey)}
            </button>
        {/each}
        <button type="button" class="lv-iconbtn lv-settings-close-btn" aria-label={t("close")} title={t("close")} onclick={handleCloseSettings}><UiIcon name="close" size={16} /></button>
    </nav>

    <div class="lv-setpane" aria-busy={saving || migrationBusy || demoBusy} inert={saving || migrationBusy || demoBusy}>
    {#if area === "modules"}
        <SettingsModulesTab
            bind:draftEnabled
            {draftMembers}
            {t}
        />
    {:else if area === "members"}
        <SettingsMembersTab
            bind:draftMembers
            {t}
            onAddMember={addMember}
            onRemoveMember={removeMember}
        />
    {:else if area === "reminders"}
        <SettingsRemindersTab
            bind:draftNotifyHour
            bind:draftSilentFrom
            bind:draftSilentTo
            bind:draftWebhookEnabled
            bind:draftWebhookMode
            bind:draftWebhookUrl
            bind:draftLeads
            bind:draftBindings
            {draftMembers}
            {leadRules}
            {enabledIds}
            {settings}
            {t}
            onSwitchArea={(a) => (area = a)}
        />
    {:else if area === "data"}
        <SettingsDataTab
            {plugin}
            {t}
            {notebookList}
            {saving}
            {migrationBusy}
            {migrationAction}
            {demoBusy}
            {demoAction}
            {preImportBackupExists}
            onExportSettings={exportSettings}
            onExportHtmlManual={exportHtmlManual}
            onImportSettings={importSettings}
            onRestorePreImport={restorePreImport}
            onGenerateDemo={generateDemo}
            onClearDemo={clearDemo}
        />
    {:else}
        <SettingsAboutTab
            {plugin}
            {t}
            {formatLocalDateTime}
            {rerunBusy}
            {saving}
            {migrationBusy}
            {demoBusy}
            {exportingDiagnostics}
            {diagnosticsBusy}
            onRerunOnboarding={rerunOnboarding}
            onPreviewDiagnostics={previewDiagnostics}
            onExportDiagnostics={exportDiagnostics}
            onRunBackfill={runBackfillMemberLinks}
            onRunDuplicateCheck={runDuplicateCheck}
            onRunDeepHealthCheck={runDeepHealthCheck}
            onRunAdoptHistory={runAdoptHistoryLedgers}
            onRebuildAll={rebuildAllLedgers}
        />
    {/if}
    </div>

    <div class="fn__flex lv-settings__footer">
        {#if area === "modules"}
            <button type="button" class="b3-button b3-button--text" disabled={saving || migrationBusy || demoBusy} onclick={enableAll}>{t("enableAll")}</button>
            <button type="button" class="b3-button b3-button--text" disabled={saving || migrationBusy || demoBusy} onclick={coreOnly}>{t("coreOnly")}</button>
        {/if}
        <span class="fn__flex-1"></span>
        <!-- 263 波：未保存更改徽章（脏检查口径=落盘口径）——设置页有两种生效心智（草稿+保存），
             让"改了但还没保存"可见，不再靠猜 -->
        {#if dirty}
            <span class="lv-badge orange" role="status"><UiIcon name="clock" size={11} /> {t("settings.unsaved")}</span>
            <button type="button" class="b3-button b3-button--text lv-tx-muted lv-btn-text-sm" disabled={saving || migrationBusy || demoBusy} onclick={revertDraft}>{t("cancel")}</button>
        {/if}
        <!-- 256 波：保存是设置视图唯一核心动作，升为主按钮（对齐原型"主按钮每视图 ≤1 个"） -->
        <button type="button" class="lv-btn primary" disabled={saving || migrationBusy || demoBusy} onclick={save}>{saving || demoBusy ? t("ledger.saving") : t("save")}</button>
    </div>
</div>
