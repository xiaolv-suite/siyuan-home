<script lang="ts">
    // 267 波：快速记录弹层（原型 .sheet 生产化）——480px 中央弹层，schema.capture 列集驱动，
    // 未建库自动建库（triage 同链路）。常驻挂载：关闭仅收起弹层，草稿保留到下次打开（对齐原型）。
    import { homeNotify as showMessage, lvNotify, lvLaunchpad } from "@/libs/notice";
    import { tick } from "svelte";
    import { getCaptureFields } from "@/core/capture";
    import { getGroupedModules, moduleIcon } from "@/core/modules";
    import { localDateKey } from "@/core/hub/rule";
    import { getQuickTemplates, type QuickRecordTemplate } from "@/core/quick-templates";
    import QuickEventFlow from "./quick-event-flow.svelte";
    import QuickSmartBar from "./quick-smart-bar.svelte";
    import QuickCaptureForm from "./quick-capture-form.svelte";
    import QuickCaptureConfirm from "./quick-capture-confirm.svelte";
    import QuickCaptureFoot from "./quick-capture-foot.svelte";
    import type { ColumnDef, ModuleSchema } from "@/core/schema";
    import type { HomeSettings } from "@/types";
    import UiIcon from "@/ui/icon.svelte";
    import type { ParsedCaptureResult } from "@/core/block-capture";

    interface ICapturePluginLike {
        i18n: Record<string, unknown>;
        settings: HomeSettings;
        schemaCatalog?: Record<string, ModuleSchema>;
        runtime?: { hubQuickModule?: string; hubQuickMode?: "event" | "ledger"; hubQuickEventSub?: string };
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
    let returnToEventSub = $state<string | undefined>();

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
    let rowIdentity = $state.raw<import("@/core/siyuan").DetachedRowIdentity | undefined>();

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
            document.querySelector(".lv-home")?.classList.add("lv-scroll-locked");
            const reqMode = plugin.runtime?.hubQuickMode;
            const reqSub = plugin.runtime?.hubQuickEventSub;
            if (plugin.runtime) {
                plugin.runtime.hubQuickMode = undefined;
                plugin.runtime.hubQuickEventSub = undefined;
            }
            captureTab = reqMode === "ledger" ? "ledger" : "event";
            void tick().then(() => {
                eventFlowRef?.reloadContext?.();
                if (reqSub) eventFlowRef?.selectSubAction?.(reqSub);
            });
            const last = identityPending || pendingRowId ? pendingModuleId : plugin.runtime?.hubQuickModule;
            moduleId = last && (modules.includes(last) || ((identityPending || pendingRowId) && last === pendingModuleId))
                ? last
                : (modules[0] ?? "");
        } else if (!open) {
            wasOpen = false;
            document.querySelector(".lv-home")?.classList.remove("lv-scroll-locked");
        } else if (!identityPending && !pendingRowId && moduleId && !modules.includes(moduleId)) {
            const last = plugin.runtime?.hubQuickModule;
            moduleId = last && modules.includes(last) ? last : (modules[0] ?? "");
        }
    });

    function switchMode(tab: CaptureTab) {
        captureTab = tab;
        requestAnimationFrame(() => (document.querySelector(".lv-capture-mode-btn[aria-selected='true']") as HTMLElement)?.focus());
    }
    function onModeKey(e: KeyboardEvent) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            switchMode(captureTab === "event" ? "ledger" : "event");
        }
    }

    const captureFields = $derived.by(() => {
        return getCaptureFields(plugin.schemaCatalog?.[moduleId]);
    });

    function fieldLabel(field: ColumnDef): string {
        const key = field.labelKey ?? `field.${field.key}`;
        return t(key) !== key ? t(key) : field.key;
    }

    let values: Record<string, string | number | boolean | undefined> = $state({});
    // Keep one small draft per module. Switching destination is common during batch entry.
    let valuesByModule: Record<string, Record<string, string | number | boolean | undefined>> = $state({});
    let currentModuleId = "";
    $effect(() => {
        void moduleId;
        if (!moduleId) return;
        if (!currentModuleId || currentModuleId !== moduleId) {
            if (currentModuleId) valuesByModule = { ...valuesByModule, [currentModuleId]: { ...values } };
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
        if (showDiscardConfirm) {
            if (e.key === "Escape") { e.preventDefault(); showDiscardConfirm = false; return; }
            if (e.key === "Tab") {
                const card = document.querySelector(".lv-sheet-confirm-card");
                if (card) {
                    const btns = Array.from(card.querySelectorAll<HTMLElement>("button:not([disabled])"));
                    if (btns.length > 0) {
                        const first = btns[0], last = btns[btns.length - 1];
                        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return; }
                        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); return; }
                    }
                }
            }
            return;
        }
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
                eventFlowRef?.submitCurrentSubAction(e.altKey);
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
                    const firstInput = document.querySelector<HTMLElement>(".lv-modal.open .lv-sheet input:not([type='hidden']), .lv-modal.open .lv-sheet textarea, .lv-modal.open .lv-sheet select");
                    if (firstInput) firstInput.focus();
                    else {
                        const firstBtn = document.querySelector<HTMLElement>(".lv-modal.open .lv-sheet button");
                        firstBtn?.focus();
                    }
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
    const activeTarget = $derived(plugin.settings.dbRefs?.[moduleId]);
    const currentTemplates = $derived(getQuickTemplates(moduleId));

    function applyTemplate(template: QuickRecordTemplate) {
        for (const [k, v] of Object.entries(template.values)) {
            values[k] = v;
            clearFieldError(k);
        }
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
                rowIdentity: rowIdentity ??= { avID: "", desiredItemID: "", before: [], submitted: false },
                t,
                fieldLabel,
                modLabel,
                ensureTargetRef,
            });

            if (!result.success) {
                if (result.pendingModuleId) pendingModuleId = result.pendingModuleId;
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
            } else if (returnToEventSub) {
                const targetSub = returnToEventSub;
                returnToEventSub = undefined;
                values = {};
                valuesByModule = { ...valuesByModule, [moduleId]: {} };
                captureTab = "event";
                void tick().then(() => {
                    eventFlowRef?.reloadContext?.();
                    if (targetSub) eventFlowRef?.selectSubAction?.(targetSub);
                    showMessage(t("capture.backToEventHint"), 3200, "info");
                });
            } else {
                values = {};
                valuesByModule = { ...valuesByModule, [moduleId]: {} };
                open = false;
            }
            try {
                lvLaunchpad.haptic(10);
                lvNotify.capsule({
                    source: "小驴管家",
                    message: continueAfter ? "已记入台账，可继续记录下一笔" : "记账成功，已实时入账",
                    level: "success",
                    duration: 2200
                });
            } catch { /* soft */ }
            pendingRowId = undefined;
            pendingModuleId = undefined;
            saveOperationKey = undefined;
            rowIdentity = undefined;
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
    function discardUncertainDraft() { if (!saving) showDiscardConfirm = true; }
    function confirmDiscardUncertain() {
        values = {};
        pendingRowId = undefined;
        pendingModuleId = undefined;
        saveOperationKey = undefined;
        rowIdentity = undefined;
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
    <div class="lv-sheet" style={keyboardOffset > 0 ? `transform:translateY(-${Math.min(keyboardOffset, 160)}px); max-height: calc(100% - ${Math.min(keyboardOffset, 160)}px);` : undefined}>
        {#if showDiscardConfirm}
            <QuickCaptureConfirm
                {t}
                moduleName={modLabel(pendingModuleId ?? moduleId)}
                onCancel={() => { showDiscardConfirm = false; }}
                onConfirm={confirmDiscardUncertain}
            />
        {/if}
        <div class="lv-sheet-head">
            <b id="lv-capture-title" class="lv-sheet-title"><UiIcon name="bolt" size={15} /> {t("capture.title")}</b>
            {#if captureTab === "ledger"}
                <select class="b3-select lv-cap-select" bind:value={moduleId} aria-label={t("capture.moduleSelect")} disabled={saving || identityPending || !!pendingRowId}>
                    {#each groupedMods as g (g.groupId)}
                        <optgroup label={g.groupLabel}>
                            {#each g.modules as m (m.id)}
                                <option value={m.id}>{modLabel(m.id)}{plugin.settings.dbRefs?.[m.id]?.avId ? "" : t("triage.needProvision")}</option>
                            {/each}
                        </optgroup>
                    {/each}
                </select>
                {#if plugin.settings.dbRefs?.[moduleId]?.docId}
                    <button type="button" class="b3-button b3-button--text" onclick={openPendingLedger} title={t("ledger.openDoc")} disabled={saving}>
                        <UiIcon name="folder" size={14} />
                    </button>
                {/if}
            {:else}
                <span class="fn__flex-1"></span>
                <button type="button" class="b3-button b3-button--text" onclick={() => eventFlowRef?.openCurrentTargetDoc?.()} title={t("ledger.openDoc")} disabled={saving}>
                    <UiIcon name="folder" size={14} /> <span>{t("ledger.openDoc")}</span>
                </button>
            {/if}
            <button type="button" class="lv-iconbtn" aria-label={t("capture.closeKeepDraft")} title={t("capture.closeKeepDraft")} onclick={close} disabled={saving}><UiIcon name="close" size={16} /></button>
        </div>
        <div class="lv-sheet-body lv-cap-body" style={keyboardOffset > 0 ? `scroll-padding-bottom: ${keyboardOffset + 36}px;` : undefined}>
            <div class="lv-capture-mode-bar" role="tablist" aria-label={t("capture.title")}>
                <button type="button" class="lv-capture-mode-btn" class:active={captureTab === "event"} role="tab" aria-selected={captureTab === "event"} tabindex={captureTab === "event" ? 0 : -1} onclick={() => switchMode("event")} onkeydown={onModeKey}><span>{t("capture.tabEvent")}</span></button>
                <button type="button" class="lv-capture-mode-btn" class:active={captureTab === "ledger"} role="tab" aria-selected={captureTab === "ledger"} tabindex={captureTab === "ledger" ? 0 : -1} onclick={() => switchMode("ledger")} onkeydown={onModeKey}><span>{t("capture.tabLedger")}</span></button>
            </div>

            {#if captureTab === "event"}
                <QuickEventFlow
                    bind:this={eventFlowRef}
                    {plugin}
                    {t}
                    bind:saving
                    bind:saveError
                    keepContext={keepContext}
                    onClose={close}
                    onSwitchToLedger={(mod, returnSub) => {
                        captureTab = "ledger";
                        moduleId = mod;
                        returnToEventSub = returnSub;
                    }}
                />
            {:else}
                <!-- 实体台账建档模式 -->
                {#if modules.length === 0 || captureFields.length === 0}
                    <div class="lv-capture-empty">
                        <span class="lv-caption">{modules.length === 0 ? t("capture.noModules") : t("capture.noFields")}</span>
                        <button type="button" class="b3-button b3-button--outline" onclick={() => plugin.openSetting()}>{t("startGuide.openSettings")}</button>
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

                <QuickCaptureForm
                    {moduleId}
                    {captureFields}
                    {activeTarget}
                    {plugin}
                    {t}
                    {saving}
                    {saveError}
                    bind:fieldErrors
                    bind:values
                    bind:keepContext
                    {identityPending}
                    bind:nameEl
                    onSave={(continueAfter) => void save(continueAfter)}
                    onClearFieldError={clearFieldError}
                    onDiscardUncertain={discardUncertainDraft}
                />
            {/if}
            {/if}
        </div>
        <QuickCaptureFoot
            {captureTab}
            {saving}
            {identityPending}
            {pendingRowId}
            canSubmitLedger={modules.length > 0 && captureFields.length > 0}
            {t}
            onClose={close}
            onSubmitEvent={(continueAfter) => { eventFlowRef?.submitCurrentSubAction(continueAfter); }}
            onOpenPendingLedger={openPendingLedger}
            onSaveLedger={(continueAfter) => void save(continueAfter)}
        />
    </div>
</div>
