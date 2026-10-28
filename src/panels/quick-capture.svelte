<script lang="ts">
    // 267 波：快速记录弹层（原型 .sheet 生产化）——480px 中央弹层，schema.capture 列集驱动，
    // 未建库自动建库（triage 同链路）。常驻挂载：关闭仅收起弹层，草稿保留到下次打开（对齐原型）。
    import { showMessage } from "siyuan";
    import { tick } from "svelte";
    import { getCaptureFields, getFieldPlaceholder } from "@/core/capture";
    import { getGroupedModules, moduleIcon } from "@/core/modules";
    import { localDateKey } from "@/core/hub/rule";
    import { getQuickTemplates, type QuickRecordTemplate } from "@/core/quick-templates";
    import QuickEventFlow from "./quick-event-flow.svelte";
    import QuickSmartBar from "./quick-smart-bar.svelte";
    import type { ColumnDef, ModuleSchema } from "@/core/schema";
    import type { HomeSettings } from "@/types";
    import UiIcon from "@/ui/icon.svelte";
    import { smartExtractFieldsFromTitle, type ParsedCaptureResult } from "@/core/block-capture";

    interface ICapturePluginLike {
        i18n: Record<string, unknown>;
        settings: HomeSettings;
        schemaCatalog?: Record<string, ModuleSchema>;
        runtime?: { hubQuickModule?: string };
        openSetting: () => void;
        refreshHub?: (only?: string | string[], force?: boolean) => Promise<unknown>;
        repairModule?: (moduleId: string) => Promise<unknown>;
        showTabDocs?: (docId?: string) => void;
    }

    let { plugin, t, version, open = $bindable(false), onClose }: {
        plugin: ICapturePluginLike;
        t: (k: string) => string;
        version?: number;
        open?: boolean;
        onClose?: () => void;
    } = $props();

    const modLabel = (id: string) => (t(`module.${id}`) !== `module.${id}` ? t(`module.${id}`) : id);

    const modules = $derived.by(() => {
        void version;
        return (plugin.settings.enabledModules ?? []).filter((id) => id !== "members" && id !== "adhoc");
    });

    // 模式切换：日常高频流水 vs 台账实体建档
    type CaptureTab = "event" | "ledger";
    let captureTab = $state<CaptureTab>("event");

    let eventFlowRef: any = $state();
    let lastMemberId = $state("");

    async function ensureTargetRef(mod: string) {
        let r = plugin.settings.dbRefs?.[mod];
        if (!r?.avId) {
            await plugin.repairModule?.(mod);
            r = plugin.settings.dbRefs?.[mod];
        }
        if (!r?.avId) throw new Error(t("triage.noTarget"));
        return r;
    }

    // 打开时恢复上次模块；后台模块列表刷新时只在当前模块失效后回退。
    let moduleId = $state("");
    let identityPending = $state(false);
    /** Stable per submission.  Retries after a timeout reuse the same key so
     * the kernel's idempotency cache cannot create a second detached row. */
    let saveOperationKey = $state<string | undefined>();

    function nextSaveOperationKey(): string {
        try { return `capture:${crypto.randomUUID()}`; }
        catch { return `capture:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
    }
    let pendingModuleId = $state<string | undefined>();
    let pendingRowId = $state<string | undefined>();
    let wasOpen = false;
    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true;
            const last = identityPending || pendingRowId ? pendingModuleId : plugin.runtime?.hubQuickModule;
            moduleId = last && (modules.includes(last) || ((identityPending || pendingRowId) && last === pendingModuleId))
                ? last
                : (modules[0] ?? "");
        } else if (!open) {
            wasOpen = false;
        } else if (!identityPending && !pendingRowId && moduleId && !modules.includes(moduleId)) {
            const last = plugin.runtime?.hubQuickModule;
            moduleId = last && modules.includes(last) ? last : (modules[0] ?? "");
        }
    });

    const captureFields = $derived.by(() => {
        return getCaptureFields(plugin.schemaCatalog?.[moduleId]);
    });

    function fieldLabel(field: ColumnDef): string {
        const key = field.labelKey ?? `field.${field.key}`;
        return t(key) !== key ? t(key) : field.key;
    }
    function fieldPlaceholder(field: ColumnDef): string {
        return getFieldPlaceholder(field, moduleId, t);
    }
    function fieldDetail(key: string | undefined): string {
        if (!key) return "";
        const value = t(key);
        return value === key ? "" : value;
    }
    function fieldRequired(field: ColumnDef): boolean {
        return field.required === true;
    }

    let values: Record<string, string | number | boolean | undefined> = $state({});
    // Keep one small draft per module. Switching the destination is common
    // during batch entry; silently clearing the previous form makes it easy
    // to lose a name or a date.
    let valuesByModule: Record<string, Record<string, string | number | boolean | undefined>> = $state({});
    let currentModuleId = "";
    $effect(() => {
        void moduleId;
        if (!moduleId) return;
        if (!currentModuleId) {
            currentModuleId = moduleId;
            values = { ...(valuesByModule[moduleId] ?? {}) };
            initSmartDefaults();
            saveError = "";
            fieldErrors = {};
            return;
        }
        if (currentModuleId !== moduleId) {
            valuesByModule = { ...valuesByModule, [currentModuleId]: { ...values } };
            currentModuleId = moduleId;
            values = { ...(valuesByModule[moduleId] ?? {}) };
            initSmartDefaults();
            saveError = "";
            fieldErrors = {};
        }
    });

    function initSmartDefaults() {
        for (const f of captureFields) {
            if (values[f.key] === undefined || values[f.key] === "") {
                if (f.type === "date" && (f.key === "date" || f.key === "issue_date")) {
                    values[f.key] = localDateKey(new Date());
                } else if (f.type === "number" && (f.key === "qty" || f.key === "stock_qty")) {
                    values[f.key] = 1;
                } else if (f.type === "relation" && f.key === "member" && lastMemberId) {
                    values[f.key] = lastMemberId;
                }
            }
        }
    }

    let saving = $state(false);
    let saveError = $state("");
    let fieldErrors: Record<string, string> = $state({});
    let nameEl: HTMLInputElement | undefined = $state();

    // 301波：智能速记与思源块文本结构化预填
    let smartInputText = $state("");
    let smartParsed = $state<ParsedCaptureResult | null>(null);

    function applySmartParse() {
        if (!smartParsed) return;
        const p = smartParsed;
        const has = (k: string) => captureFields.some((f) => f.key === k);
        if (p.suggestedModule && modules.includes(p.suggestedModule) && !pendingRowId) {
            moduleId = p.suggestedModule;
        }
        if (p.title) values["name"] = p.title;
        if (p.amount !== undefined) {
            if (has("amount")) values["amount"] = p.amount;
            else if (has("deposit")) values["deposit"] = p.amount;
        }
        if (p.date) {
            for (const k of ["expiry", "date", "due"]) {
                if (has(k)) { values[k] = p.date; break; }
            }
        }
        if (p.note && has("note")) values["note"] = p.note;
        smartInputText = "";
        smartParsed = null;
        showMessage(t("capture.smartConfidence").replace("${n}", String(Math.round(p.confidence * 100))), 2500, "info");
    }

    function close() {
        if (saving) return;
        open = false;
        onClose?.();
    }
    function onWindowKeydown(e: KeyboardEvent) {
        if (!open) return;
        if (e.key === "Tab" && saving) {
            // All form fields are disabled during save; retain focus in the modal.
            e.preventDefault();
            document.querySelector<HTMLElement>(".lv-modal.open[aria-labelledby='lv-capture-title']")?.focus();
            return;
        }
        if (saving) return;
        if (e.key === "Escape") { e.preventDefault(); close(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (captureTab === "event") {
                eventFlowRef?.submitCurrentSubAction();
            } else if (modules.length > 0 && captureFields.length > 0) {
                void save(e.altKey);
            }
            return;
        }
        if (e.altKey && (e.key === "k" || e.key === "K")) {
            e.preventDefault();
            keepContext = !keepContext;
            showMessage(keepContext ? `${t("capture.keepContext")} ON` : `${t("capture.keepContext")} OFF`, 1500, "info");
            return;
        }
        // 268 波：焦点圈——Tab 循环限制在弹层内（背景虽 inert 不可点，键盘焦点路径仍需自锁）
        if (e.key === "Tab") {
            const sheet = document.querySelector(".lv-modal.open .lv-sheet");
            if (!sheet) return;
            const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])'))
                .filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }
    let triggerElement: HTMLElement | null = null;
    let focusWasOpen = false;
    $effect(() => {
        if (open && !focusWasOpen) {
            focusWasOpen = true;
            triggerElement = document.activeElement as HTMLElement | null;
            void tick().then(() => {
                if (nameEl) nameEl.focus();
                else {
                    const first = document.querySelector<HTMLElement>(".lv-modal.open .lv-sheet button, .lv-modal.open .lv-sheet select");
                    first?.focus();
                }
            });
        } else if (!open) {
            if (focusWasOpen && triggerElement && typeof triggerElement.focus === "function") {
                triggerElement.focus();
                triggerElement = null;
            }
            focusWasOpen = false;
        }
    });

    let keyboardOffset = $state(0);
    $effect(() => {
        if (!open || typeof window === "undefined" || !window.visualViewport) {
            keyboardOffset = 0;
            return;
        }
        const vv = window.visualViewport;
        const onResize = () => {
            const heightDiff = window.innerHeight - vv.height;
            keyboardOffset = heightDiff > 120 ? Math.max(0, heightDiff - 20) : 0;
        };
        vv.addEventListener("resize", onResize);
        vv.addEventListener("scroll", onResize);
        onResize();
        return () => {
            vv.removeEventListener("resize", onResize);
            vv.removeEventListener("scroll", onResize);
            keyboardOffset = 0;
        };
    });

    const groupedMods = $derived(getGroupedModules(modules));
    const FREQUENT_MODULE_CANDIDATES = ["medicine", "stock", "certs", "shopping", "chores", "contracts", "vehicles", "food", "house", "schooling"];
    const frequentModules = $derived(FREQUENT_MODULE_CANDIDATES.filter((id) => modules.includes(id)).slice(0, 7));

    let keepContext = $state(false);
    const COMMON_LOCATIONS = ["主卧抽屉", "客厅药箱", "玄关柜", "书房书架", "储藏室", "冰箱冷藏", "厨房吊柜"];

    function applyDatePreset(key: string, daysAhead: number) {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        values[key] = localDateKey(d);
        clearFieldError(key);
    }

    function applyLocationPreset(key: string, loc: string) {
        values[key] = loc;
        clearFieldError(key);
    }

    const activeTarget = $derived(plugin.settings.dbRefs?.[moduleId]);
    const currentTemplates = $derived(getQuickTemplates(moduleId));

    function applyTemplate(template: QuickRecordTemplate) {
        for (const [k, v] of Object.entries(template.values)) {
            values[k] = v;
            clearFieldError(k);
        }
    }

    function handleNameBlur() {
        if (!values.name || typeof values.name !== "string") return;
        const res = smartExtractFieldsFromTitle(values.name);
        if (res.cleanTitle !== values.name) {
            values.name = res.cleanTitle;
            const dateField = captureFields.find((f) => f.type === "date");
            if (dateField && res.extractedDate && !values[dateField.key]) {
                values[dateField.key] = res.extractedDate;
                clearFieldError(dateField.key);
            }
            const numField = captureFields.find((f) => f.type === "number" && ["amount", "price", "cost"].includes(f.key));
            if (numField && res.extractedAmount !== undefined && !values[numField.key]) {
                values[numField.key] = res.extractedAmount;
                clearFieldError(numField.key);
            }
        }
    }
    const filledCaptureCount = $derived.by(() => captureFields.filter((field: any) => {
        const value = values[field.key];
        return value !== undefined && value !== null && value !== "" && value !== false;
    }).length);

    function fieldDescriptionIds(field: ColumnDef): string | undefined {
        const ids = new Set<string>();
        if ((field.helpKey && fieldDetail(field.helpKey)) || (field.unitKey && fieldDetail(field.unitKey))) ids.add(`lv-cap-help-${field.key}`);
        if (fieldErrors[field.key]) ids.add(`lv-cap-error-${field.key}`);
        return ids.size ? [...ids].join(" ") : undefined;
    }

    function clearFieldError(key: string) {
        if (!fieldErrors[key]) return;
        const next = { ...fieldErrors };
        delete next[key];
        fieldErrors = next;
        saveError = "";
    }

    async function save(continueAfter = false) {
        if (saving) return;
        const hadIdentityPending = identityPending;
        identityPending = false;
        saveError = "";
        fieldErrors = {};
        saving = true;
        if (!saveOperationKey) saveOperationKey = nextSaveOperationKey();
        let refocusName = false;

        try {
            const { executeQuickCaptureSave } = await import("@/core/quick-capture-saver");
            const result = await executeQuickCaptureSave({
                plugin,
                moduleId,
                values,
                captureFields,
                pendingRowId,
                pendingModuleId,
                hadIdentityPending,
                saveOperationKey,
                t,
                fieldLabel,
                modLabel,
                ensureTargetRef,
            });

            if (!result.success) {
                if (result.fieldErrors) fieldErrors = result.fieldErrors;
                if (result.error) saveError = result.error;
                if (result.identityPending) identityPending = true;
                if (result.focusFieldKey) {
                    await tick();
                    document.getElementById(`lv-cap-${result.focusFieldKey}`)?.focus();
                }
                return;
            }

            if (values.member && typeof values.member === "string") {
                lastMemberId = values.member;
            }
            if (continueAfter) {
                if (keepContext) {
                    const retained: Record<string, string | number | boolean | undefined> = {};
                    for (const k of ["member", "date", "expiry", "due", "location", "store_place", "category", "energy_type", "status"]) {
                        if (values[k] !== undefined) retained[k] = values[k];
                    }
                    values = retained;
                    valuesByModule = { ...valuesByModule, [moduleId]: { ...retained } };
                } else {
                    values = {};
                    valuesByModule = { ...valuesByModule, [moduleId]: {} };
                }
                refocusName = true;
            } else {
                values = {};
                valuesByModule = { ...valuesByModule, [moduleId]: {} };
                open = false;
            }
            pendingRowId = undefined;
            pendingModuleId = undefined;
            saveOperationKey = undefined;
        } catch (e) {
            const messageKey = pendingRowId ? "capture.partialFailed" : "capture.failed";
            saveError = t(messageKey).replace("${msg}", e instanceof Error ? e.message : String(e));
        } finally {
            saving = false;
        }
        if (refocusName) await tick().then(() => nameEl?.focus());
    }
    function openPendingLedger() {
        const targetModule = pendingModuleId ?? moduleId;
        const docId = plugin.settings.dbRefs[targetModule]?.docId;
        if (!docId || !plugin.showTabDocs) {
            showMessage(t("capture.ledgerUnavailable").replace("${module}", modLabel(targetModule)), 5000, "error");
            return;
        }
        close();
        plugin.showTabDocs(docId);
    }

    let showDiscardConfirm = $state(false);

    function discardUncertainDraft() {
        if (saving) return;
        showDiscardConfirm = true;
    }

    function confirmDiscardUncertain() {
        values = {};
        pendingRowId = undefined;
        pendingModuleId = undefined;
        saveOperationKey = undefined;
        identityPending = false;
        saveError = "";
        showDiscardConfirm = false;
        showMessage(t("capture.uncertainDraftDiscarded"), 6000, "info");
    }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- 267 波：.lv-mask/.lv-modal（07 §10）首次投产；常驻挂载 + .open 切换保住出入场过渡与草稿 -->
<div class="lv-mask" class:open aria-hidden="true" onclick={close}></div>
<div class="lv-modal" class:open role="dialog" aria-modal="true" aria-labelledby="lv-capture-title" aria-busy={saving} tabindex="-1" inert={!open}>
    <div class="lv-sheet" style={keyboardOffset > 0 ? `transform:translateY(-${Math.min(keyboardOffset, 200)}px)` : undefined}>
        {#if showDiscardConfirm}
            <div class="lv-sheet-confirm-mask" role="dialog" aria-modal="true">
                <div class="lv-sheet-confirm-card">
                    <b style="font-size:14px;color:var(--lv-tx);display:flex;align-items:center;gap:6px">
                        <UiIcon name="alert" size={16} /> {t("capture.discardUncertain")}
                    </b>
                    <p class="lv-caption" style="margin:10px 0 16px;color:var(--lv-tx-2);line-height:1.5">
                        {t("capture.discardUncertainConfirm").replace("${module}", modLabel(pendingModuleId ?? moduleId))}
                    </p>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button type="button" class="b3-button b3-button--cancel" onclick={() => { showDiscardConfirm = false; }}>
                            {t("cancel")}
                        </button>
                        <button type="button" class="b3-button b3-button--text" style="color:var(--lv-danger);font-weight:600" onclick={confirmDiscardUncertain}>
                            {t("capture.discardUncertain")}
                        </button>
                    </div>
                </div>
            </div>
        {/if}
        <div class="lv-sheet-head">
            <b id="lv-capture-title" style="font-size:14px;display:inline-flex;align-items:center;gap:6px"><UiIcon name="bolt" size={15} /> {t("capture.title")}</b>
            {#if captureTab === "ledger"}
                <select class="b3-select" style="margin-left:auto;max-width:200px" bind:value={moduleId} aria-label={t("capture.moduleSelect")} disabled={saving || identityPending || !!pendingRowId}>
                    {#each groupedMods as g (g.groupId)}
                        <optgroup label={g.groupLabel}>
                            {#each g.modules as m (m.id)}
                                <option value={m.id}>{modLabel(m.id)}{plugin.settings.dbRefs?.[m.id]?.avId ? "" : t("triage.needProvision")}</option>
                            {/each}
                        </optgroup>
                    {/each}
                </select>
            {:else}
                <span class="fn__flex-1"></span>
            {/if}
            <button class="lv-iconbtn" aria-label={t("capture.closeKeepDraft")} title={t("capture.closeKeepDraft")} onclick={close} disabled={saving}><UiIcon name="close" size={16} /></button>
        </div>
        <div class="lv-sheet-body lv-cap-body">
            <div class="lv-capture-mode-bar">
                <button type="button" class="lv-capture-mode-btn" class:active={captureTab === "event"} onclick={() => { captureTab = "event"; }}>
                    <span>{t("capture.tabEvent")}</span>
                </button>
                <button type="button" class="lv-capture-mode-btn" class:active={captureTab === "ledger"} onclick={() => { captureTab = "ledger"; }}>
                    <span>{t("capture.tabLedger")}</span>
                </button>
            </div>

            {#if captureTab === "event"}
                <QuickEventFlow
                    bind:this={eventFlowRef}
                    {plugin}
                    {t}
                    bind:saving
                    bind:saveError
                    onClose={close}
                    onSwitchToLedger={(mod) => { captureTab = "ledger"; moduleId = mod; }}
                />
            {:else}
                <!-- 实体台账建档模式 -->
                {#if modules.length === 0}
                    <div class="lv-capture-empty">
                        <span class="lv-caption">{t("capture.noModules")}</span>
                        <button class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
                    </div>
                {:else if captureFields.length === 0}
                <div class="lv-capture-empty">
                    <span class="lv-caption">{t("capture.noFields")}</span>
                    <button class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
                </div>
            {:else}
                <QuickSmartBar
                    bind:moduleId
                    bind:smartInputText
                    bind:smartParsed
                    {frequentModules}
                    {currentTemplates}
                    {saving}
                    {identityPending}
                    {t}
                    {modLabel}
                    {moduleIcon}
                    onApplySmartParse={applySmartParse}
                    onApplyTemplate={applyTemplate}
                />

                <div class="lv-capture-context" role="status" aria-live="polite">
                    <div class="lv-capture-context__main">
                        <span class="lv-capture-context__eyebrow">{t("capture.contextTitle")}</span>
                        <strong>{modLabel(moduleId)}</strong>
                    </div>
                    <span class="lv-capture-context__count">{t("capture.fieldCount").replace("${filled}", String(filledCaptureCount)).replace("${total}", String(captureFields.length))}</span>
                    <span class="lv-capture-context__hint">
                        {activeTarget?.avId
                            ? t("capture.contextHint").replace("${module}", modLabel(moduleId))
                            : t("capture.noTarget").replace("${module}", modLabel(moduleId))}
                    </span>
                </div>
                {#each captureFields as f (f.key)}
                    <div class="lv-frow">
                        {#if f.key === "name"}
                            <label for="lv-cap-name">{fieldLabel(f)} <small class="lv-capture-required">{t("capture.required")}</small></label>
                            <input bind:this={nameEl} id="lv-cap-name" class="b3-text-field" type="text"
                                placeholder={fieldPlaceholder(f)} bind:value={values.name} disabled={saving} required={fieldRequired(f)}
                                aria-invalid={fieldErrors.name ? "true" : undefined}
                                aria-describedby={fieldDescriptionIds(f)}
                                oninput={() => clearFieldError(f.key)}
                                onblur={handleNameBlur}
                                onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) save(false); }} />
                        {:else}
                            <label for="lv-cap-{f.key}">{fieldLabel(f)}{#if fieldRequired(f)} <small class="lv-capture-required">{t("capture.required")}</small>{/if}</label>
                        {/if}
                        {#if f.key !== "name" && f.type === "select"}
                            <select id="lv-cap-{f.key}" class="b3-select" bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} onchange={() => clearFieldError(f.key)}>
                                <option value="">{t("capture.selectOptional")}</option>
                                {#each f.options ?? [] as opt (opt)}
                                    <option value={opt}>{t(`field.${f.key}.opt.${opt}`) !== `field.${f.key}.opt.${opt}` ? t(`field.${f.key}.opt.${opt}`) : opt}</option>
                                {/each}
                            </select>
                        {:else if f.key !== "name" && f.type === "relation"}
                            <select id="lv-cap-{f.key}" class="b3-select" bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} onchange={() => clearFieldError(f.key)}>
                                <option value="">{t("capture.selectOptional")}</option>
                                {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                                    <option value={m.avItemId ?? ""} disabled={!m.avItemId}>
                                        {m.name}{m.avItemId ? "" : ` · ${t("members.notLinked")}`}
                                    </option>
                                {/each}
                            </select>
                        {:else if f.key !== "name" && f.type === "date"}
                            <input id="lv-cap-{f.key}" class="b3-text-field" type="date" bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => clearFieldError(f.key)} />
                            <div class="lv-preset-tags">
                                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 0)}>{t("capture.presetToday")}</button>
                                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 1)}>{t("capture.presetTomorrow")}</button>
                                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 7)}>{t("capture.presetNextWeek")}</button>
                                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 30)}>{t("capture.presetNextMonth")}</button>
                                <button type="button" class="lv-preset-tag" onclick={() => applyDatePreset(f.key, 365)}>{t("capture.presetNextYear")}</button>
                            </div>
                        {:else if f.key !== "name" && f.type === "number"}
                            <input id="lv-cap-{f.key}" class="b3-text-field" type="number" min={f.min} max={f.max} step={f.step ?? "any"} placeholder={fieldPlaceholder(f)} bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => clearFieldError(f.key)} />
                        {:else if f.key !== "name" && f.type === "checkbox"}
                            <input id="lv-cap-{f.key}" class="b3-switch" type="checkbox" checked={values[f.key] === true} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} onchange={(event) => { values[f.key] = event.currentTarget.checked; clearFieldError(f.key); }} />
                        {:else if f.key !== "name"}
                            <input id="lv-cap-{f.key}" class="b3-text-field" type={f.type === "url" ? "url" : "text"} placeholder={fieldPlaceholder(f)} bind:value={values[f.key]} disabled={saving} required={fieldRequired(f)} aria-invalid={fieldErrors[f.key] ? "true" : undefined} aria-describedby={fieldDescriptionIds(f)} oninput={() => clearFieldError(f.key)} />
                            {#if f.key === "location" || f.key === "store_place"}
                                <div class="lv-preset-tags">
                                    {#each COMMON_LOCATIONS as loc (loc)}
                                        <button type="button" class="lv-preset-tag" onclick={() => applyLocationPreset(f.key, loc)}>{loc}</button>
                                    {/each}
                                </div>
                            {/if}
                        {/if}
                        {#if f.key !== "name" && (fieldDetail(f.helpKey) || fieldDetail(f.unitKey))}
                            <small id="lv-cap-help-{f.key}" class="lv-capture-field-hint">
                                {fieldDetail(f.helpKey)}{#if fieldDetail(f.helpKey) && fieldDetail(f.unitKey)} · {/if}{#if fieldDetail(f.unitKey)}{t("capture.unitLabel")}：{fieldDetail(f.unitKey)}{/if}
                            </small>
                        {/if}
                        {#if fieldErrors[f.key]}<small id="lv-cap-error-{f.key}" class="lv-capture-field-error">{fieldErrors[f.key]}</small>{/if}
                    </div>
                {/each}
                {#if saving}<span class="lv-caption lv-capture-saving" role="status" aria-live="polite">{t("ledger.saving")}</span>{/if}
                {#if saveError}
                    <span class="lv-caption lv-capture-error-summary" role="alert" aria-live="assertive"><UiIcon name="alert" size={13} /> {saveError}</span>
                {/if}
                <div class="lv-keep-context-wrap" style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px dashed var(--lv-line)">
                    <label class="lv-keep-context-label" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--lv-tx-2);user-select:none" title={`${t("capture.keepContext")} (Alt+K)`}>
                        <input type="checkbox" class="b3-switch" style="transform:scale(0.85);transform-origin:left center;flex-shrink:0" bind:checked={keepContext} />
                        <span class="lv-caption" style="white-space:nowrap">{t("capture.keepContext")} <span style="opacity:0.6;font-size:10.5px">(Alt+K)</span></span>
                    </label>
                    {#if identityPending}
                        <button type="button" class="b3-button b3-button--text" style="font-size:11.5px;color:var(--lv-danger)" onclick={discardUncertainDraft}>{t("capture.discardUncertain")}</button>
                    {/if}
                </div>
            {/if}
            {/if}
        </div>
        <div class="lv-sheet-foot">
            <button class="b3-button b3-button--cancel" onclick={close} disabled={saving}>{t("cancel")}</button>
            <span class="fn__flex-1"></span>
            {#if captureTab === "event"}
                <button class="lv-btn primary" title="Ctrl+Enter" onclick={() => {
                    eventFlowRef?.submitCurrentSubAction();
                }} disabled={saving}>
                    {saving ? t("ledger.saving") : t("save")}
                </button>
            {:else}
                {#if identityPending}
                    <button class="lv-btn ghost" onclick={openPendingLedger} disabled={saving}>{t("capture.checkLedger")}</button>
                {/if}
                <!-- 268 波：连续录入（家庭数据常成批）——保存后清空字段保留弹层，焦点回名称 -->
                <button class="lv-btn" onclick={() => save(true)} disabled={saving || modules.length === 0 || captureFields.length === 0}>
                    {saving ? t("ledger.saving") : (pendingRowId || identityPending) ? t("capture.retryContinue") : t("capture.saveContinue")}
                </button>
                <button class="lv-btn primary" title="Ctrl+Enter" onclick={() => save(false)} disabled={saving || modules.length === 0 || captureFields.length === 0}>
                    {saving ? t("ledger.saving") : (pendingRowId || identityPending) ? t("capture.retryClose") : t("capture.saveClose")}
                </button>
            {/if}
        </div>
    </div>
</div>
