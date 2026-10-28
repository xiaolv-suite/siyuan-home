<script lang="ts">
    import { showMessage, Dialog } from "siyuan";
    import { confirm } from "@/libs/dialog";
    import { listNotebooks } from "@/core/siyuan";
    import { MODULE_GROUPS, modulesByGroup, BUILT_IN_MODULES } from "@/core/modules";
    import { newMember, saveSettings, normalizeCheckinBindings } from "@/core/settings";
    import type { ProvisioningReport } from "@/core/provisioner";
    import type { HomeSettings, MemberRole, FamilyMember, CheckinBinding, ModuleGroupId } from "@/types";
    import { formatLocalDateTime } from "@/core/date-display";
    import SettingsRemindersTab from "@/panels/settings-reminders-tab.svelte";
    import SettingsAboutTab from "@/panels/settings-about-tab.svelte";
    import UiIcon from "@/ui/icon.svelte";

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

    let { plugin, settings }: {
        plugin: IHomePluginLike;
        settings: HomeSettings;
    } = $props();

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
    let area: SettingsArea = $state("modules");
    let moduleGroup: ModuleGroupId = $state("people");
    let moduleSearch = $state("");
    const currentModules = $derived(
        moduleSearch.trim()
            ? BUILT_IN_MODULES.filter((m) => (t(`module.${m.id}`) + m.id).toLowerCase().includes(moduleSearch.trim().toLowerCase()))
            : modulesByGroup(moduleGroup)
    );
    let dataSection: "migration" | "demo" | "ecosystem" | "shortcuts" = $state("migration");
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

    const ROLES: MemberRole[] = ["self", "spouse", "partner", "child", "elder", "kin", "other"];
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

    // C8b：禁用模块需确认（数据保留语义：只隐藏入口与提醒，台账行不动）
    function toggleModule(id: string, alwaysOn?: boolean) {
        if (alwaysOn) return;
        if (enabledIds.has(id)) {
            confirm(t("settings.disableTitle"), t("settings.disableBody").replace("${name}", t(`module.${id}`)), () => {
                draftEnabled = draftEnabled.filter((x) => x !== id);
            });
        } else {
            draftEnabled = [...draftEnabled, id];
            const mod = modulesByGroup("kids").find((m) => m.id === id);
            if (mod?.suggestRoles?.length) {
                const has = draftMembers.some((m) => mod.suggestRoles!.includes(m.role));
                if (!has) showMessage(t("members.suggestOn"), 3200, "info");
            }
        }
    }

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
    let importInput: HTMLInputElement | undefined = $state();
    // UG03/DL07：导入前自动备份当前设置，可一键恢复（导入链的数据安全闭环）
    let preImportBackupExists = $state(false);
    let migrationBusy = $state(false);
    let migrationAction = $state<"import" | "restore" | null>(null);
    $effect(() => {
        // 面板打开时探测一次（备份文件是否存在）
        plugin.loadData?.("settings.pre-import.json").then((v: unknown) => { preImportBackupExists = !!v; }).catch(() => undefined);
    });

    const exportSettings = () => import("@/core/settings-maintenance").then((m) => m.exportSettingsJson(plugin, t));
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
        diagnosticsBusy = "rebuild";
        try {
            const { executeRebuildAllLedgers } = await import("@/core/settings-maintenance");
            await executeRebuildAllLedgers(plugin, t, showMessage);
        } finally {
            diagnosticsBusy = null;
        }
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

<div class="lv-home lv-settings">
    <!-- 左侧主分类；模块和提醒等复杂页面在右侧继续细分。 -->
    <nav class="lv-setnav" aria-label={t("settingsTitle")} inert={saving || migrationBusy || demoBusy}>
        <div class="lv-setnav__brand"><span class="lv-setnav__brand-mark" aria-hidden="true"><UiIcon name="home" size={16} /></span><div><b>{t("butler")}</b><span>LV HOME</span></div></div>
        <button class="lv-setnav__item {area === 'modules' ? 'on' : ''}" aria-current={area === 'modules' ? 'true' : undefined} onclick={() => (area = "modules")}><span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="archive" size={15} /></span>{t("tabModules")}</button>
        <button class="lv-setnav__item {area === 'members' ? 'on' : ''}" aria-current={area === 'members' ? 'true' : undefined} onclick={() => (area = "members")}><span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="users" size={15} /></span>{t("tabMembers")}</button>
        <button class="lv-setnav__item {area === 'reminders' ? 'on' : ''}" aria-current={area === 'reminders' ? 'true' : undefined} onclick={() => (area = "reminders")}><span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="bell" size={15} /></span>{t("tabReminders")}</button>
        <button class="lv-setnav__item {area === 'data' ? 'on' : ''}" aria-current={area === 'data' ? 'true' : undefined} onclick={() => (area = "data")}><span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="bank" size={15} /></span>{t("settings.dataTitle")}</button>
        <button class="lv-setnav__item {area === 'about' ? 'on' : ''}" aria-current={area === 'about' ? 'true' : undefined} onclick={() => (area = "about")}><span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="info" size={15} /></span>{t("tabAbout")}</button>
    </nav>

    <div class="lv-setpane" aria-busy={saving || migrationBusy || demoBusy} inert={saving || migrationBusy || demoBusy}>
    {#if area === "modules"}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0">
            <div class="lv-settings__pane-title">{t("tabModules")}</div>
            <div style="position:relative;display:inline-flex;align-items:center;max-width:180px">
                <input class="b3-text-field" style="width:100%;font-size:12px;padding:3px 22px 3px 8px;min-height:28px"
                    placeholder={t("dash.moduleSearch") || "搜索模块..."}
                    bind:value={moduleSearch} />
                {#if moduleSearch}
                    <button type="button" class="b3-button b3-button--text" style="position:absolute;right:2px;padding:0 4px;font-size:11px;color:var(--lv-tx-3)" onclick={() => { moduleSearch = ""; }}>✕</button>
                {/if}
            </div>
        </div>
        {#if !moduleSearch.trim()}
            <nav class="lv-settings__subnav" aria-label={t("settings.moduleCategory")}>
                {#each MODULE_GROUPS as gid (gid)}
                    <button class="lv-setnav__item {moduleGroup === gid ? 'on' : ''}" aria-current={moduleGroup === gid ? 'true' : undefined} onclick={() => (moduleGroup = gid)}>{t(`group.${gid}`)}</button>
                {/each}
            </nav>
        {/if}
        <div class="lv-settings__scroll" aria-label={moduleSearch.trim() ? "搜索模块" : t(`group.${moduleGroup}`)}>
            <div class="lv-card lv-setcard lv-setcard--hint">{t("settings.modulesHint")}</div>
            <div class="lv-card lv-setcard">
                <div class="lv-setcard__title">{moduleSearch.trim() ? `搜索结果 · ${currentModules.length}` : t(`group.${moduleGroup}`)}</div>
                {#if currentModules.length === 0}
                    <div class="lv-caption" style="padding:12px 0;color:var(--lv-tx-3)">{t("ledger.searchEmpty")}</div>
                {:else}
                    {#each currentModules as mod (mod.id)}
                        <div class="fn__flex lv-settings__row">
                            <input
                                type="checkbox"
                                class="b3-switch"
                                aria-label={t(`module.${mod.id}`)}
                                checked={enabledIds.has(mod.id)}
                                disabled={mod.alwaysOn}
                                onchange={() => toggleModule(mod.id, mod.alwaysOn)}
                            />
                            <div class="fn__flex-1 fn__flex-column">
                                <span>
                                    {t(`module.${mod.id}`)}
                                    {#if mod.alwaysOn}<span class="lv-badge gray">{t("alwaysOn")}</span>{/if}
                                    {#if mod.devStatus === "skeleton"}<span class="lv-badge gray">{t("skeleton")}</span>{/if}
                                </span>
                                <span class="b3-card__info-meta">{t(`module.${mod.id}.desc`)}</span>
                                {#if mod.suggestRoles?.length && !enabledIds.has(mod.id)}
                                    <span class="ft__smaller ft__on-surface">
                                        {t("settings.suggestRoles")}
                                        {mod.suggestRoles.map((r) => t(`role.${r}`)).join(" / ")}
                                    </span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {:else if area === "members"}
        <div class="lv-settings__pane-title">{t("tabMembers")}</div>
        <div class="lv-settings__scroll">
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__hint">{t("settings.membersHint")}</div>
            {#if draftMembers.length === 0}
                <div class="lv-setcard__hint ft__on-surface">{t("members.empty")}</div>
            {/if}
            {#each draftMembers as m, i (m.id)}
                <section class="lv-settings-member" aria-labelledby={`lv-settings-member-${m.id}`}>
                    <div class="lv-settings-member__head">
                        <h3 id={`lv-settings-member-${m.id}`}>
                            <span class="lv-settings-member__number" aria-hidden="true">{i + 1}</span>
                            <span>{m.name.trim() || t("members.name")}</span>
                        </h3>
                        <button class="b3-button b3-button--text lv-settings-member__delete" type="button"
                            aria-label={`${t("delete")} ${m.name.trim() || t("members.name")}`} onclick={() => removeMember(m.id)}>
                            {t("delete")}
                        </button>
                    </div>
                    <div class="lv-settings-member__fields">
                        <label class="lv-settings-member__field">
                            <span>{t("members.name")}</span>
                            <input class="b3-text-field" placeholder={t("members.name")} bind:value={draftMembers[i].name} />
                        </label>
                        <label class="lv-settings-member__field">
                            <span>{t("members.role")}</span>
                            <select class="b3-select" bind:value={draftMembers[i].role}>
                                {#each ROLES as r (r)}
                                    <option value={r}>{t(`role.${r}`)}</option>
                                {/each}
                            </select>
                        </label>
                        <label class="lv-settings-member__field">
                            <span>{t("members.sex")}</span>
                            <select class="b3-select" bind:value={draftMembers[i].sex}>
                                <option value="">{t("members.sex.unknown")}</option>
                                <option value="male">{t("members.sex.male")}</option>
                                <option value="female">{t("members.sex.female")}</option>
                            </select>
                        </label>
                        <label class="lv-settings-member__field">
                            <span>{t("members.birthday")}</span>
                            <input class="b3-text-field" type="date" bind:value={draftMembers[i].birthday} />
                        </label>
                        <label class="lv-settings-member__calendar">
                            <span>{t("members.lunar")}</span>
                            <input type="checkbox" class="b3-switch" bind:checked={draftMembers[i].lunarBirthday} />
                        </label>
                    </div>
                </section>
            {/each}
            <button class="b3-button b3-button--outline lv-setcard__action lv-settings-member__add" type="button" onclick={addMember}>
                <UiIcon name="add" size={15} /> {t("add")}
            </button>
        </div>
        </div>
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
        <div class="lv-settings__pane-title">{t("settings.dataTitle")}</div>
        <nav class="lv-settings__subnav" aria-label={t("settings.dataTitle")}>
            <button class="lv-setnav__item {dataSection === 'migration' ? 'on' : ''}" aria-current={dataSection === 'migration' ? 'true' : undefined} onclick={() => (dataSection = "migration")}>{t("settings.migrateTitle")}</button>
            <button class="lv-setnav__item {dataSection === 'demo' ? 'on' : ''}" aria-current={dataSection === 'demo' ? 'true' : undefined} onclick={() => (dataSection = "demo")}>{t("settings.demoTitle")}</button>
            <button class="lv-setnav__item {dataSection === 'ecosystem' ? 'on' : ''}" aria-current={dataSection === 'ecosystem' ? 'true' : undefined} onclick={() => (dataSection = "ecosystem")}>{t("settings.ecoTitle")}</button>
            <button class="lv-setnav__item {dataSection === 'shortcuts' ? 'on' : ''}" aria-current={dataSection === 'shortcuts' ? 'true' : undefined} onclick={() => (dataSection = "shortcuts")}>{t("faq.shortcuts")}</button>
        </nav>
        <div class="lv-settings__scroll">
        {#if dataSection === "migration"}
        <!-- 设置导出/导入（跨设备/重装迁移辅助） -->
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.targetNotebook")}</div>
            <div class="lv-setcard__hint">{t("settings.targetNotebookHint")}</div>
            <div style="margin-top:8px">
                <select class="b3-select" style="max-width:360px;width:100%"
                    value={plugin.settings.targetNotebookId ?? ""}
                    onchange={async (e) => {
                        const val = (e.currentTarget as HTMLSelectElement).value;
                        plugin.settings.targetNotebookId = val || undefined;
                        await saveSettings(plugin as any, plugin.settings);
                        showMessage(t("diag.rebuildAllDone"), 2000, "info");
                    }}>
                    <option value="">🏠 默认（使用或自动创建「🏠 小驴管家」笔记本）</option>
                    {#each notebookList as nb (nb.id)}
                        <option value={nb.id}>📚 {nb.name}</option>
                    {/each}
                </select>
            </div>
        </div>
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.migrateTitle")}</div>
            <div class="lv-setcard__hint" style="color:var(--lv-warn)">⚠ {t("settings.migratePrivacy")}</div>
            <div class="lv-setcard__actions">
                <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={exportSettings}>{t("settings.export")}</button>
                <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={() => importInput?.click()}>{migrationAction === "import" ? t("ledger.saving") : t("settings.import")}</button>
                <input type="file" accept="application/json,.json" style="display:none"
                    bind:this={importInput} onchange={(e) => importSettings(e)} />
                {#if preImportBackupExists}
                    <button class="b3-button b3-button--outline" disabled={migrationBusy || saving} onclick={restorePreImport}>{migrationAction === "restore" ? t("ledger.saving") : t("settings.restoreBtn")}</button>
                {/if}
            </div>
        </div>
        {:else if dataSection === "demo"}
        <!-- 示例数据一键生成/清除 -->
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.demoTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.demoHint")}</div>
            <div class="lv-setcard__actions">
                <button class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "generate"} onclick={generateDemo}>{demoAction === "generate" ? t("ledger.saving") : t("settings.demoGenerate")}</button>
                <button class="b3-button b3-button--outline" disabled={demoBusy} aria-busy={demoBusy && demoAction === "clear"} onclick={clearDemo}>{demoAction === "clear" ? t("ledger.saving") : t("settings.demoClear")}</button>
            </div>
        </div>
        {:else if dataSection === "ecosystem"}
        <!-- 生态分区占位：明确标为规划能力，避免禁用开关被误解为故障。 -->
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">{t("settings.ecoTitle")}</div>
            <div class="lv-setcard__hint">{t("settings.ecoHint")} · {t("settings.ecoPlanned")}</div>
            {#each ["qiandao", "contacts", "glean", "exam", "flashcard", "leiqie"] as eco (eco)}
                <div class="fn__flex lv-settings__row">
                    <span class="lv-setnav__icon" aria-hidden="true"><UiIcon name="repeat" size={14} /></span>
                    <span class="fn__flex-1">{t(`eco.${eco}`)}</span>
                    <span class="lv-badge gray">{t("settings.ecoPlanned")}</span>
                </div>
            {/each}
        </div>
        {:else}
        <div class="lv-card lv-setcard">
            <div class="lv-setcard__title">⌨ {t("faq.shortcuts")}</div>
            <p class="lv-caption" style="margin:2px 0">· {t("openButler")}：{t("faq.topbarOrCommand")}</p>
            <p class="lv-caption" style="margin:2px 0">· {t("faq.quickCapture")}：{t("faq.topbarBolt")}</p>
        </div>
        {/if}
        </div>
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
            <button class="b3-button b3-button--text" disabled={saving || migrationBusy || demoBusy} onclick={enableAll}>{t("enableAll")}</button>
            <button class="b3-button b3-button--text" disabled={saving || migrationBusy || demoBusy} onclick={coreOnly}>{t("coreOnly")}</button>
        {/if}
        <span class="fn__flex-1"></span>
        <!-- 263 波：未保存更改徽章（脏检查口径=落盘口径）——设置页有两种生效心智（草稿+保存），
             让"改了但还没保存"可见，不再靠猜 -->
        {#if dirty}
            <span class="lv-badge orange" role="status">● {t("settings.unsaved")}</span>
            <button class="b3-button b3-button--text" style="font-size:12px;color:var(--lv-tx-3)" disabled={saving || migrationBusy || demoBusy} onclick={revertDraft}>{t("cancel")}</button>
        {/if}
        <!-- 256 波：保存是设置视图唯一核心动作，升为主按钮（对齐原型"主按钮每视图 ≤1 个"） -->
        <button class="lv-btn primary" disabled={saving || migrationBusy || demoBusy} onclick={save}>{saving || demoBusy ? t("ledger.saving") : t("save")}</button>
    </div>
</div>

<style>
    .lv-settings-member {
        padding: 16px;
        margin-top: 12px;
        border: 1px solid var(--lv-line);
        border-radius: 14px;
        background: var(--lv-surface);
        min-width: 0;
    }

    .lv-settings-member__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
    }

    .lv-settings-member__head h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        margin: 0;
        color: var(--lv-tx);
        font-size: 13px;
        font-weight: 600;
    }

    .lv-settings-member__head h3 > span:last-child {
        overflow-wrap: anywhere;
    }

    .lv-settings-member__number {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        border-radius: 8px;
        background: var(--lv-surface-2);
        color: var(--lv-tx-3);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .lv-settings-member__delete {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 36px;
        color: var(--lv-tx-3);
    }

    .lv-settings-member__delete:hover {
        color: var(--lv-danger);
        background: var(--lv-danger-soft);
    }

    .lv-settings-member__fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px 16px;
    }

    .lv-settings-member__field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        color: var(--lv-tx-2);
        font-size: 12px;
    }

    .lv-settings-member__field :is(input, select) {
        width: 100%;
        min-width: 0;
        min-height: 40px;
        box-sizing: border-box;
    }

    .lv-settings-member__calendar {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 40px;
        padding-top: 10px;
        border-top: 1px solid var(--lv-line);
        color: var(--lv-tx-2);
        font-size: 12px;
        cursor: pointer;
    }

    .lv-settings-member__calendar input { flex: none; }

    .lv-settings-member__add {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
    }

    @container lv-home (max-width: 480px) {
        .lv-settings-member { padding: 12px; }
        .lv-settings-member__fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .lv-settings-member__field :is(input, select),
        .lv-settings-member__delete,
        .lv-settings-member__add { min-height: 44px; }
    }

    @media (max-width: 480px) {
        .lv-settings-member { padding: 12px; }
        .lv-settings-member__fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .lv-settings-member__field :is(input, select),
        .lv-settings-member__delete,
        .lv-settings-member__add { min-height: 44px; }
    }
</style>
