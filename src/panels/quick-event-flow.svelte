<script lang="ts">
    import { onMount } from "svelte";
    import { localDateKey } from "@/core/hub/rule";
    import { homeNotify as showMessage } from "@/libs/notice";
    import { renderLedgerAll } from "@/core/siyuan";
    import { saveSettings } from "@/core/settings";
    import { assessBloodPressure, assessBloodGlucose, assessTemperature, resolveDefaultVitalMember } from "@/core/vitals";
    import {
        currentLocalHHMM,
        validateFuelingInput,
        validateVitalInput,
    } from "@/core/quick-actions";
    import type { EnergyKind } from "@/core/fuel";
    import { loadQuickDefaults } from "@/core/quick-defaults";
    import {
        dispatchBackgroundSync,
        saveQuickFuelingRecord,
        saveQuickVitalRecord,
        saveQuickChoreRecord,
        saveQuickShoppingRecord,
        saveQuickSnippetRecord,
    } from "@/core/quick-event-saver";
    import UiIcon from "@/ui/icon.svelte";
    import { memberChips } from "@/core/members";

    let {
        plugin,
        t,
        saving = $bindable(false),
        saveError = $bindable(""),
        keepContext = false,
        onClose,
        onSwitchToLedger,
    }: {
        plugin: any;
        t: (k: string) => string;
        saving: boolean;
        saveError: string;
        keepContext?: boolean;
        onClose?: () => void;
        onSwitchToLedger?: (moduleId: string, returnSubAction?: string) => void;
    } = $props();

    type EventSubAction = "fuel" | "vital" | "chore" | "shopping" | "snippet";
    const subActions: EventSubAction[] = ["fuel", "vital", "chore", "shopping", "snippet"];
    const subActionLabel: Record<EventSubAction, string> = {
        fuel: "capture.actFuel",
        vital: "capture.actVital",
        chore: "capture.actChore",
        shopping: "capture.actShopping",
        snippet: "capture.actSnippet",
    };
    const subTargetModule: Record<EventSubAction, string> = {
        fuel: "vehicles",
        vital: "health",
        chore: "chores",
        shopping: "shopping",
        snippet: "snippets",
    };
    let eventSub = $state<EventSubAction>("fuel");

    function onSubKeydown(e: KeyboardEvent, index: number) {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? subActions.length - 1
            : (index + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + subActions.length) % subActions.length;
        eventSub = subActions[next];
        requestAnimationFrame(() => {
            const btn = document.querySelector<HTMLButtonElement>(".lv-event-subbtn[aria-selected='true']");
            btn?.focus();
        });
    }

    // 默认习惯与上次填写记忆
    // svelte-ignore state_referenced_locally
    const qDefs = loadQuickDefaults(plugin);

    // 常用流水：统一 LifeLog 时间与日期
    const todayStr = localDateKey(new Date());
    const yesterdayStr = localDateKey(new Date(Date.now() - 86400000));
    let eventTime = $state(currentLocalHHMM());
    let eventDate = $state(todayStr);

    // 常用流水：车辆与加油/充电
    let vehiclesList = $state<Array<{ itemID: string; name: string; plate: string; mileage?: number }>>([]);
    let selectedVehicleId = $state(qDefs.fuelVehicleId || "");

    // 补充：油价/电价、油品标号/充电模式、加满充满
    let fuelGrade = $state(qDefs.fuelGrade || "95");
    let fuelPrice = $state<number | undefined>(qDefs.fuelPrice ?? 8.25);
    let chargingMode = $state(qDefs.chargingMode || "dc");
    let chargePrice = $state<number | undefined>(qDefs.chargePrice ?? 1.20);
    let isEnergyFull = $state(qDefs.fuelIsFull ?? true);

    // 默认带入上次加油/充电的价格（实付金额）与升数
    let fuelingAmount = $state<number | undefined>(qDefs.fuelKind === "charging" ? qDefs.chargeAmount : qDefs.fuelAmount);
    let fuelingLiters = $state<number | undefined>(qDefs.fuelKind === "charging" ? qDefs.chargeLiters : qDefs.fuelLiters);
    let fuelingMileage = $state<number | undefined>();
    let fuelingKind = $state<EnergyKind>(qDefs.fuelKind || "fuel");

    const currentVehicle = $derived(vehiclesList.find((v) => v.itemID === selectedVehicleId));

    function stepMileage(delta: number) {
        const base = fuelingMileage ?? currentVehicle?.mileage ?? 0;
        fuelingMileage = Math.max(0, base + delta);
    }

    // 补能三数联动自动计算（图1需求：油价相对固定，填价格自动算升数；修改升数按固定油价变动价格；修改油价变动价格）
    const currentPrice = () => (fuelingKind === "charging" ? chargePrice : fuelPrice);

    function onAmountInput(val?: number) {
        fuelingAmount = val;
        const p = currentPrice();
        fuelingLiters = val && p ? Number((val / p).toFixed(2)) : undefined;
    }

    function onLitersInput(val?: number) {
        fuelingLiters = val;
        const p = currentPrice();
        fuelingAmount = val && p ? Number((val * p).toFixed(2)) : undefined;
    }

    function onPriceInput(val?: number) {
        if (fuelingKind === "charging") chargePrice = val;
        else fuelPrice = val;
        if (val && fuelingLiters) fuelingAmount = Number((fuelingLiters * val).toFixed(2));
        else if (val && fuelingAmount) fuelingLiters = Number((fuelingAmount / val).toFixed(2));
    }

    const currentPresetAmounts = $derived.by(() => {
        const custom = fuelingKind === "charging"
            ? plugin.settings?.chargePresetAmounts
            : plugin.settings?.fuelPresetAmounts;
        if (Array.isArray(custom) && custom.length > 0) {
            const valid = custom.filter((n: any) => typeof n === "number" && n > 0);
            if (valid.length > 0) return valid;
        }
        return fuelingKind === "charging" ? [30, 50, 100] : [200, 300, 500];
    });

    let isEditingPresets = $state(false);
    let editingPresetsText = $state("");

    function openPresetEditor() {
        editingPresetsText = currentPresetAmounts.join(", ");
        isEditingPresets = true;
    }

    async function savePresetEditor() {
        const parts = editingPresetsText
            .split(/[,，\s]+/)
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (parts.length === 0) {
            showMessage(t("capture.invalidPresets"), 3000, "info");
            return;
        }
        if (!plugin.settings) return;
        if (fuelingKind === "charging") {
            plugin.settings.chargePresetAmounts = parts;
        } else {
            plugin.settings.fuelPresetAmounts = parts;
        }
        await saveSettings(plugin, plugin.settings);
        isEditingPresets = false;
        showMessage(t("capture.presetsSaved"), 2500, "info");
    }

    // 常用流水：生理指标（血压/血糖/体重/体温）
    let vitalMemberId = $state(qDefs.vitalMemberId || "");
    let vitalMetricType = $state<"bp" | "glucose" | "weight" | "temp">(qDefs.vitalMetricType || "bp");
    let vitalSys = $state<number | undefined>();
    let vitalDia = $state<number | undefined>();
    let vitalPulse = $state<number | undefined>();
    let vitalGlucose = $state<number | undefined>();
    let vitalTiming = $state<"fasting" | "postprandial">("fasting");
    let vitalWeight = $state<number | undefined>();
    let vitalTemp = $state<number | undefined>();

    const bpAssessment = $derived.by(() => {
        if (vitalMetricType !== "bp" || !vitalSys || !vitalDia) return null;
        return assessBloodPressure(vitalSys, vitalDia);
    });

    const glucoseAssessment = $derived.by(() => {
        if (vitalMetricType !== "glucose" || !vitalGlucose) return null;
        return assessBloodGlucose(vitalGlucose, vitalTiming === "postprandial");
    });

    const tempAssessment = $derived.by(() => {
        if (vitalMetricType !== "temp" || !vitalTemp) return null;
        return assessTemperature(vitalTemp);
    });

    // 粗粒度总额开销与高频耗材预设（CAND-23）
    const GENERAL_SHOPPING_PRESETS = [
        { name: "日用品", cat: "daily" },
        { name: "买菜食材", cat: "food" },
        { name: "超市采购", cat: "daily" },
        { name: "水果生鲜", cat: "food" },
        { name: "餐饮外卖", cat: "food" },
        { name: "生活杂物", cat: "daily" },
    ];
    const STAPLE_SHOPPING_PRESETS = ["鸡蛋", "牛奶", "抽纸", "垃圾袋", "洗洁精"];

    let priceInputEl = $state<HTMLInputElement | undefined>();

    function fillShoppingPreset(item: { name: string; cat?: string }) {
        quickShopName = item.name;
        if (item.cat) quickShopCategory = item.cat;
        requestAnimationFrame(() => priceInputEl?.focus());
    }

    // 常用流水：家务打卡（支持单人打卡或一家人/多成员共同参与）
    let choresList = $state<Array<{ itemID: string; name: string }>>([]);
    let choreRowId = $state(qDefs.choreRowId || "");
    let choreMemberIds = $state<string[]>(
        qDefs.choreMemberIds?.length ? qDefs.choreMemberIds : (qDefs.choreMemberId ? [qDefs.choreMemberId] : [])
    );
    let chorePoints = $state<number | undefined>();
    let choreNote = $state("");

    // 常用流水：快捷待买
    let quickShopName = $state("");
    let quickShopQty = $state(1);
    let quickShopCategory = $state(qDefs.shoppingCategory || "daily");
    let quickShopPrice = $state<number | undefined>();

    // 常用流水：随手便签
    let quickSnippetText = $state("");
    let quickSnippetTag = $state(qDefs.snippetTag || "#备忘");

    const SNIPPET_TAG_SUGGESTIONS = ["#备忘", "#待办", "#灵感", "#记账", "#家庭", "#日常"];

    const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.isComposing) void fn();
    };

    function appendSnippetTag(tag: string) {
        quickSnippetTag = tag;
        if (!quickSnippetText.includes(tag)) {
            quickSnippetText = quickSnippetText.trim() ? `${quickSnippetText.trim()} ${tag}` : tag;
        }
    }

    const onSaveErr = (e: unknown) => { saveError = String(e); saving = false; };
    function onEventSaved(mod: string, nextLogs: any, clearFn: () => void, continueAfter = false) {
        saving = false;
        showMessage(t("capture.savedEvent"), 2000, "info");
        clearFn();
        if (!keepContext && !continueAfter) onClose?.();
        dispatchBackgroundSync(plugin, mod, nextLogs);
    }

    async function submitQuickFueling(continueAfter = false) {
        if (saving) return;
        const missing = validateFuelingInput({ mileage: fuelingMileage, quantity: fuelingLiters, amount: fuelingAmount });
        if (!selectedVehicleId || missing.length > 0) {
            saveError = t("capture.fuelRequired");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const isCharging = fuelingKind === "charging";
            const unitPrice = isCharging ? chargePrice : fuelPrice;
            const nextLogs = await saveQuickFuelingRecord({
                plugin,
                date: eventDate,
                time: eventTime,
                vehicleId: selectedVehicleId,
                kind: fuelingKind,
                amount: fuelingAmount,
                liters: fuelingLiters!,
                mileage: fuelingMileage!,
                unitPrice,
                isFull: isEnergyFull,
                fuelGrade: !isCharging ? fuelGrade : undefined,
                chargingMode: isCharging ? chargingMode : undefined,
            });
            onEventSaved("vehicles", nextLogs, () => {
                fuelingAmount = undefined;
                fuelingLiters = undefined;
            }, continueAfter);
        } catch (e) {
            onSaveErr(e);
        }
    }

    async function submitQuickVital(continueAfter = false) {
        if (saving) return;
        if (!vitalMemberId) {
            saveError = t("members.reassignSelectTo");
            return;
        }
        const missing = validateVitalInput({
            metricType: vitalMetricType,
            systolic: vitalSys,
            diastolic: vitalDia,
            glucose: vitalGlucose,
            weight: vitalWeight,
            temperature: vitalTemp,
        });
        if (missing.length > 0) {
            saveError = t("capture.vitalRequired");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const nextLogs = await saveQuickVitalRecord({
                plugin,
                date: eventDate,
                time: eventTime,
                memberId: vitalMemberId,
                metricType: vitalMetricType,
                sys: vitalSys,
                dia: vitalDia,
                pulse: vitalPulse,
                glucose: vitalGlucose,
                timing: vitalTiming,
                weight: vitalWeight,
                temp: vitalTemp,
            });
            onEventSaved("health", nextLogs, () => {
                vitalSys = vitalDia = vitalPulse = vitalGlucose = vitalWeight = vitalTemp = undefined;
            }, continueAfter);
        } catch (e) {
            onSaveErr(e);
        }
    }

    async function submitQuickChore(continueAfter = false) {
        if (saving) return;
        if (!choreRowId) {
            saveError = t("capture.choreRequired");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const nextLogs = await saveQuickChoreRecord({
                plugin,
                date: eventDate,
                time: eventTime,
                choreRowId,
                memberIds: choreMemberIds,
                points: chorePoints,
                note: choreNote,
            });
            onEventSaved("chores", nextLogs, () => {
                chorePoints = undefined;
                choreNote = "";
            }, continueAfter);
        } catch (e) {
            onSaveErr(e);
        }
    }

    async function submitQuickShopping(continueAfter = false) {
        if (saving) return;
        const name = quickShopName.trim();
        if (!name) {
            saveError = t("form.required");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const nextLogs = await saveQuickShoppingRecord({
                plugin,
                date: eventDate,
                time: eventTime,
                name,
                qty: quickShopQty || 1,
                price: quickShopPrice,
                category: quickShopCategory || "daily",
            });
            onEventSaved("shopping", nextLogs, () => {
                quickShopName = "";
                quickShopQty = 1;
                quickShopPrice = undefined;
            }, continueAfter);
        } catch (e) {
            onSaveErr(e);
        }
    }

    async function submitQuickSnippet(continueAfter = false) {
        if (saving) return;
        const text = quickSnippetText.trim();
        if (!text) {
            saveError = t("form.required");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const nextLogs = await saveQuickSnippetRecord({
                plugin,
                date: eventDate,
                time: eventTime,
                text,
                tag: quickSnippetTag,
            });
            onEventSaved("snippets", nextLogs, () => {
                quickSnippetText = "";
            }, continueAfter);
        } catch (e) {
            onSaveErr(e);
        }
    }

    async function loadQuickEventContext() {
        const vRef = plugin.settings.dbRefs?.vehicles;
        if (vRef?.avId && vRef.columns?.name) {
            try {
                const res = await renderLedgerAll(vRef.avId);
                vehiclesList = (res.rows ?? []).map((r) => {
                    const name = String(r.cells?.[vRef.columns!.name]?.text?.content ?? r.cells?.[vRef.columns!.name]?.block?.content ?? t("module.vehicles")).trim();
                    const plate = String(r.cells?.[vRef.columns!.plate ?? ""]?.text?.content ?? "").trim();
                    const mileage = Number(r.cells?.[vRef.columns!.mileage ?? ""]?.number?.content);
                    return { itemID: r.itemID, name, plate, mileage: isNaN(mileage) ? undefined : mileage };
                });
                if (vehiclesList.length > 0) {
                    if (!selectedVehicleId || !vehiclesList.some((v) => v.itemID === selectedVehicleId)) {
                        selectedVehicleId = vehiclesList[0].itemID;
                    }
                    const curVeh = vehiclesList.find((v) => v.itemID === selectedVehicleId);
                    if (curVeh?.mileage && fuelingMileage === undefined) {
                        fuelingMileage = curVeh.mileage;
                    }
                }
            } catch { /* soft */ }
        }

        const cRef = plugin.settings.dbRefs?.chores;
        if (cRef?.avId && cRef.columns?.name) {
            try {
                const res = await renderLedgerAll(cRef.avId);
                choresList = (res.rows ?? []).map((r) => ({
                    itemID: r.itemID,
                    name: String(r.cells?.[cRef.columns!.name]?.text?.content ?? r.cells?.[cRef.columns!.name]?.block?.content ?? "").trim() || t("ledger.unnamed"),
                }));
                if (choresList.length > 0) {
                    if (!choreRowId || !choresList.some((c) => c.itemID === choreRowId)) {
                        choreRowId = choresList[0].itemID;
                    }
                }
            } catch { /* soft */ }
        }

        const mems = plugin.settings.members ?? [];
        if (mems.length > 0 && !vitalMemberId) {
            vitalMemberId = resolveDefaultVitalMember(mems);
        }
    }

    export function submitCurrentSubAction(continueAfter = false) {
        if (eventSub === "fuel") void submitQuickFueling(continueAfter);
        else if (eventSub === "vital") void submitQuickVital(continueAfter);
        else if (eventSub === "chore") void submitQuickChore(continueAfter);
        else if (eventSub === "shopping") void submitQuickShopping(continueAfter);
        else if (eventSub === "snippet") void submitQuickSnippet(continueAfter);
    }

    export function selectSubAction(sub: string) {
        if ((subActions as readonly string[]).includes(sub)) {
            eventSub = sub as EventSubAction;
        }
    }

    export async function openCurrentTargetDoc() {
        const { openModuleOrJournalDoc } = await import("@/core/doc-sync");
        onClose?.();
        await openModuleOrJournalDoc(plugin, subTargetModule[eventSub]);
    }

    export function reloadContext() {
        eventTime = currentLocalHHMM();
        const defs = loadQuickDefaults(plugin);
        fuelPrice = defs.fuelPrice ?? fuelPrice;
        chargePrice = defs.chargePrice ?? chargePrice;
        fuelGrade = defs.fuelGrade ?? fuelGrade;
        isEnergyFull = defs.fuelIsFull ?? isEnergyFull;
        chargingMode = defs.chargingMode ?? chargingMode;
        fuelingAmount = (fuelingKind === "charging" ? defs.chargeAmount : defs.fuelAmount) ?? fuelingAmount;
        fuelingLiters = (fuelingKind === "charging" ? defs.chargeLiters : defs.fuelLiters) ?? fuelingLiters;
        choreMemberIds = defs.choreMemberIds?.length ? defs.choreMemberIds : (defs.choreMemberId ? [defs.choreMemberId] : choreMemberIds);
        vitalMetricType = defs.vitalMetricType ?? vitalMetricType;
        quickShopCategory = defs.shoppingCategory ?? quickShopCategory;
        void loadQuickEventContext();
    }

    onMount(() => {
        void loadQuickEventContext();
    });
</script>

<div class="lv-event-subnav" role="tablist" aria-label={t("capture.tabEvent")}>
    {#each subActions as s, i (s)}
        <button
            type="button"
            class="lv-event-subbtn"
            class:active={eventSub === s}
            role="tab"
            aria-selected={eventSub === s}
            tabindex={eventSub === s ? 0 : -1}
            onclick={() => { eventSub = s; }}
            onkeydown={(e) => onSubKeydown(e, i)}
        >
            {t(subActionLabel[s])}
        </button>
    {/each}
</div>

<div class="lv-event-card">
    {#if eventSub === "fuel"}
        {#if vehiclesList.length === 0}
            <div class="lv-capture-empty">
                <span class="lv-caption">{t("capture.noVehicles")}</span>
                <button type="button" class="b3-button b3-button--outline" onclick={() => onSwitchToLedger?.("vehicles", "fuel")}><UiIcon name="add" size={13} /> {t("capture.addVehicleFirst")}</button>
            </div>
        {:else}
            <div class="lv-frow">
                <label for="lv-fuel-veh">{t("capture.selectVehicle")}</label>
                <select id="lv-fuel-veh" class="b3-select" bind:value={selectedVehicleId} disabled={saving} onchange={(e) => {
                    const sel = vehiclesList.find((v) => v.itemID === (e.currentTarget as HTMLSelectElement).value);
                    if (sel?.mileage) fuelingMileage = sel.mileage;
                }}>
                    {#each vehiclesList as v (v.itemID)}
                        <option value={v.itemID}>{v.name} {v.plate ? `(${v.plate})` : ""}</option>
                    {/each}
                </select>
            </div>

            <div class="lv-frow">
                <span class="lv-frow-label">{t("capture.energyKind")}</span>
                <div class="lv-segmented-group" role="radiogroup" aria-label={t("capture.energyKind")}>
                    <button
                        type="button"
                        class="lv-seg-btn"
                        class:active={fuelingKind === "fuel"}
                        onclick={() => {
                            if (fuelingKind !== "fuel") {
                                fuelingKind = "fuel";
                                if (qDefs.fuelAmount !== undefined) onAmountInput(qDefs.fuelAmount);
                                else if (qDefs.fuelLiters !== undefined) onLitersInput(qDefs.fuelLiters);
                                else onAmountInput(fuelingAmount);
                                if (qDefs.fuelIsFull !== undefined) isEnergyFull = qDefs.fuelIsFull;
                            }
                        }}
                        disabled={saving}
                    >
                        ⛽ {t("fuel.fuelTitle")}
                    </button>
                    <button
                        type="button"
                        class="lv-seg-btn"
                        class:active={fuelingKind === "charging"}
                        onclick={() => {
                            if (fuelingKind !== "charging") {
                                fuelingKind = "charging";
                                if (qDefs.chargeAmount !== undefined) onAmountInput(qDefs.chargeAmount);
                                else if (qDefs.chargeLiters !== undefined) onLitersInput(qDefs.chargeLiters);
                                else onAmountInput(fuelingAmount);
                                if (qDefs.chargeIsFull !== undefined) isEnergyFull = qDefs.chargeIsFull;
                            }
                        }}
                        disabled={saving}
                    >
                        ⚡ {t("fuel.chargingTitle")}
                    </button>
                </div>
            </div>

            <div class="lv-frow">
                <span class="lv-frow-label">{fuelingKind === "fuel" ? t("capture.fuelGrade") : t("capture.chargeMode")}</span>
                <div class="lv-pill-chips">
                    {#if fuelingKind === "fuel"}
                        {#each [["92", "92#"], ["95", "95#"], ["98", "98#"], ["0", t("fuel.option.0")]] as [val, lbl]}
                            <button type="button" class="b3-chip lv-pill-chip" class:b3-chip--primary={fuelGrade === val} class:b3-chip--secondary={fuelGrade !== val} onclick={() => { fuelGrade = val; }} disabled={saving}>{lbl}</button>
                        {/each}
                    {:else}
                        {#each [["dc", `⚡ ${t("capture.fastDc")}`], ["ac", `🔌 ${t("capture.slowAc")}`], ["home", `🏠 ${t("capture.homeCharge")}`]] as [val, lbl]}
                            <button type="button" class="b3-chip lv-pill-chip" class:b3-chip--primary={chargingMode === val} class:b3-chip--secondary={chargingMode !== val} onclick={() => { chargingMode = val; }} disabled={saving}>{lbl}</button>
                        {/each}
                    {/if}
                </div>
            </div>

            <div class="lv-frow">
                <label for="lv-unit-price">{fuelingKind === "fuel" ? t("capture.unitPrice") : t("capture.chargeUnitPrice")}</label>
                <input
                    id="lv-unit-price"
                    class="b3-text-field"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="0.01"
                    placeholder={fuelingKind === "fuel" ? t("capture.phUnitPrice") : t("capture.phChargeUnitPrice")}
                    value={fuelingKind === "charging" ? chargePrice : fuelPrice}
                    oninput={(e) => onPriceInput(Number(e.currentTarget.value) || undefined)}
                    disabled={saving}
                />
            </div>

            <div class="lv-frow">
                <label for="lv-fuel-amount">{t("capture.amountCny")} *</label>
                <div class="lv-col-stretch" style="width: 100%;">
                    <input
                        id="lv-fuel-amount"
                        class="b3-text-field"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="any"
                        placeholder={t("capture.phAmount")}
                        value={fuelingAmount}
                        oninput={(e) => onAmountInput(Number(e.currentTarget.value) || undefined)}
                        disabled={saving}
                        onkeydown={onEnter(submitQuickFueling)}
                    />
                    <div class="lv-dt-quick-bar" style="margin-top: 5px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
                        {#each currentPresetAmounts as amt}
                            <button type="button" class="b3-chip lv-dt-chip" class:b3-chip--primary={fuelingAmount === amt} onclick={() => onAmountInput(amt)} disabled={saving}>¥{amt}</button>
                        {/each}
                        <button type="button" class="b3-button b3-button--text lv-dt-chip-edit" style="font-size: 11px; padding: 2px 6px;" title={t("capture.customPresets")} onclick={openPresetEditor} disabled={saving}>
                            <UiIcon name="settings" size={12} /> {t("capture.customPresetsShort")}
                        </button>
                    </div>
                    {#if isEditingPresets}
                        <div class="lv-dt-preset-editor" style="display: flex; gap: 6px; align-items: center; margin-top: 6px;">
                            <input class="b3-text-field fn__flex-1" style="font-size: 12px; padding: 3px 6px;" placeholder={t("capture.phCustomPresets")} aria-label={t("capture.customPresets")} title={t("capture.customPresets")} bind:value={editingPresetsText} />
                            <button type="button" class="b3-button b3-button--small" onclick={savePresetEditor}>{t("save")}</button>
                            <button type="button" class="b3-button b3-button--cancel b3-button--small" onclick={() => { isEditingPresets = false; }}>{t("cancel")}</button>
                        </div>
                    {/if}
                </div>
            </div>

            <div class="lv-frow">
                <label for="lv-fuel-liters">{t("capture.fuelLiters")} *</label>
                <input
                    id="lv-fuel-liters"
                    class="b3-text-field"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="any"
                    required
                    placeholder={t("capture.phQuantity")}
                    value={fuelingLiters}
                    oninput={(e) => onLitersInput(Number(e.currentTarget.value) || undefined)}
                    disabled={saving}
                    onkeydown={onEnter(submitQuickFueling)}
                />
            </div>

            <div class="lv-frow">
                <span class="lv-frow-label">{fuelingKind === "charging" ? t("capture.isChargeFull") : t("capture.isFull")}</span>
                <label class="lv-checkbox-label" for="lv-fuel-full">
                    <input
                        id="lv-fuel-full"
                        type="checkbox"
                        bind:checked={isEnergyFull}
                        disabled={saving}
                        aria-label={fuelingKind === "charging" ? t("capture.isChargeFull") : t("capture.isFull")}
                    />
                    <b>{fuelingKind === "charging" ? t("capture.isChargeFull") : t("capture.isFull")}</b>
                    <span class="lv-caption">{fuelingKind === "charging" ? t("capture.chargeFullHint") : t("capture.fullHint")}</span>
                </label>
            </div>

            <div class="lv-calc-tip">
                <UiIcon name="info" size={13} />
                <span>{t("capture.autoCalcHint")}</span>
            </div>

            <div class="lv-frow">
                <label for="lv-fuel-mileage">{t("capture.currentMileage")} *</label>
                <div class="lv-col-stretch" style="width: 100%;">
                    <input
                        id="lv-fuel-mileage"
                        class="b3-text-field"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        required
                        placeholder={t("capture.phMileage")}
                        bind:value={fuelingMileage}
                        disabled={saving}
                        onkeydown={onEnter(submitQuickFueling)}
                    />
                    <div class="lv-dt-quick-bar" style="margin-top: 5px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
                        {#if currentVehicle?.mileage}
                            <button type="button" class="b3-chip lv-dt-chip" onclick={() => { fuelingMileage = currentVehicle.mileage; }} disabled={saving} title={t("capture.fillLastMileage")}>
                                {t("capture.lastMileage")}: {currentVehicle.mileage}km
                            </button>
                        {/if}
                        {#each [50, 100, 200, 500] as delta}
                            <button type="button" class="b3-chip lv-dt-chip" onclick={() => stepMileage(delta)} disabled={saving} title={`+${delta}km`}>
                                +{delta}km
                            </button>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
    {:else if eventSub === "vital"}
        <div class="lv-frow">
            <label for="lv-vital-mem">{t("field.member")}</label>
            <select id="lv-vital-mem" class="b3-select" bind:value={vitalMemberId} disabled={saving}>
                {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                    <option value={m.avItemId ?? m.id}>{m.name}</option>
                {/each}
            </select>
        </div>

        <div class="lv-frow">
            <span class="lv-frow-label">{t("capture.metricType")}</span>
            <div class="lv-segmented-group" role="radiogroup" aria-label={t("capture.metricType")}>
                {#each [["bp", "💓 " + t("capture.metricBp")], ["glucose", "🩸 " + t("capture.metricGlucose")], ["weight", "⚖️ " + t("capture.metricWeight")], ["temp", "🌡️ " + t("capture.metricTemp")]] as [vt, vl]}
                    <button type="button" class="lv-seg-btn" class:active={vitalMetricType === vt} onclick={() => { vitalMetricType = vt as any; }} disabled={saving}>{vl}</button>
                {/each}
            </div>
        </div>

        {#if vitalMetricType === "bp"}
            <div class="lv-frow">
                <label for="lv-vital-sys">{t("capture.systolic")} *</label>
                <input id="lv-vital-sys" class="b3-text-field" type="number" inputMode="numeric" min="40" max="250" placeholder={t("capture.phSystolic")} bind:value={vitalSys} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-dia">{t("capture.diastolic")} *</label>
                <input id="lv-vital-dia" class="b3-text-field" type="number" inputMode="numeric" min="30" max="150" placeholder={t("capture.phDiastolic")} bind:value={vitalDia} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-pulse">{t("capture.pulse")}</label>
                <input id="lv-vital-pulse" class="b3-text-field" type="number" inputMode="numeric" min="30" max="220" placeholder={t("capture.phPulse")} bind:value={vitalPulse} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            {#if bpAssessment}
                <div class="lv-vital-status-pill" class:is-abnormal={bpAssessment.isAbnormal} class:is-elevated={bpAssessment.level === 'elevated'}>
                    <UiIcon name={bpAssessment.isAbnormal ? "alert" : "check"} size={13} />
                    <span>{bpAssessment.label}</span>
                </div>
            {/if}
        {:else if vitalMetricType === "glucose"}
            <div class="lv-frow">
                <label for="lv-vital-glu">{t("capture.glucoseVal")} *</label>
                <input id="lv-vital-glu" class="b3-text-field" type="number" inputMode="numeric" min="0" step="0.1" placeholder={t("capture.phGlucose")} bind:value={vitalGlucose} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-tim">{t("capture.measureTiming")}</label>
                <select id="lv-vital-tim" class="b3-select" bind:value={vitalTiming} disabled={saving}>
                    <option value="fasting">{t("capture.fasting")}</option>
                    <option value="postprandial">{t("capture.postprandial")}</option>
                </select>
            </div>
            {#if glucoseAssessment}
                <div class="lv-vital-status-pill" class:is-abnormal={glucoseAssessment.isAbnormal} class:is-elevated={glucoseAssessment.level === 'elevated'}>
                    <UiIcon name={glucoseAssessment.isAbnormal ? "alert" : "check"} size={13} />
                    <span>{glucoseAssessment.label}</span>
                </div>
            {/if}
        {:else if vitalMetricType === "weight"}
            <div class="lv-frow">
                <label for="lv-vital-weight">{t("capture.weightVal")} *</label>
                <input id="lv-vital-weight" class="b3-text-field" type="number" inputMode="numeric" min="1" max="500" step="0.1" placeholder={t("capture.phWeight")} bind:value={vitalWeight} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
        {:else if vitalMetricType === "temp"}
            <div class="lv-frow">
                <label for="lv-vital-temp">{t("capture.tempVal")} *</label>
                <input id="lv-vital-temp" class="b3-text-field" type="number" inputMode="numeric" min="30" max="45" step="0.1" placeholder={t("capture.phTemp")} bind:value={vitalTemp} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            {#if tempAssessment}
                <div class="lv-vital-status-pill" class:is-abnormal={tempAssessment.isAbnormal} class:is-elevated={tempAssessment.level === 'elevated'}>
                    <UiIcon name={tempAssessment.isAbnormal ? "alert" : "check"} size={13} />
                    <span>{tempAssessment.label}</span>
                </div>
            {/if}
        {/if}
    {:else if eventSub === "chore"}
        {#if choresList.length === 0}
            <div class="lv-capture-empty">
                <span class="lv-caption">{t("capture.noChores")}</span>
                <button type="button" class="b3-button b3-button--outline" onclick={() => onSwitchToLedger?.("chores", "chore")}><UiIcon name="add" size={13} /> {t("capture.addChoreFirst")}</button>
            </div>
        {:else}
            <div class="lv-frow">
                <label for="lv-chore-row">{t("capture.selectChore")} *</label>
                <div class="lv-col-stretch" style="width: 100%;">
                    <select id="lv-chore-row" class="b3-select" bind:value={choreRowId} disabled={saving}>
                        {#each choresList as c (c.itemID)}
                            <option value={c.itemID}>{c.name}</option>
                        {/each}
                    </select>
                    {#if choresList.length > 1}
                        <div class="lv-dt-quick-bar" style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px;">
                            {#each choresList.slice(0, 5) as c (c.itemID)}
                                <button type="button" class="b3-chip lv-dt-chip" class:b3-chip--primary={choreRowId === c.itemID} onclick={() => { choreRowId = c.itemID; }} disabled={saving}>
                                    {c.name}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            <div class="lv-frow">
                <span class="lv-frow-label">{t("field.member")} · {t("members.multipleSelectHint")}</span>
                <div id="lv-chore-mem-chips" use:memberChips={{ id: "lv-chore-mem", members: plugin.settings?.members, value: choreMemberIds, disabled: saving, useAvItemId: false, allText: t("members.allFamily"), onChange: (v) => { choreMemberIds = Array.isArray(v) ? v : (v ? [v] : []); } }}></div>
            </div>
            <div class="lv-frow">
                <label for="lv-chore-points">{t("ledger.chorePoints")}</label>
                <input id="lv-chore-points" class="b3-text-field" type="number" inputMode="numeric" min="0" step="1" placeholder={t("ledger.chorePointsTip")} bind:value={chorePoints} disabled={saving} />
            </div>
            <div class="lv-frow">
                <label for="lv-chore-note">{t("field.note")}</label>
                <input id="lv-chore-note" class="b3-text-field" type="text" placeholder={t("ledger.choreNote")} bind:value={choreNote} disabled={saving} onkeydown={onEnter(submitQuickChore)} />
            </div>
        {/if}
    {:else if eventSub === "shopping"}
        <div class="lv-frow">
            <label for="lv-shop-name">{t("field.name")} *</label>
            <div class="lv-col-stretch" style="width: 100%;">
                <input id="lv-shop-name" class="b3-text-field" type="text" placeholder={t("capture.phShopName")} bind:value={quickShopName} disabled={saving} onkeydown={onEnter(submitQuickShopping)} />
                <div class="lv-dt-quick-bar" style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
                    <span class="lv-caption lv-tx-muted" style="margin-right: 2px;">{t("capture.quickPresetsTitle")}:</span>
                    {#each GENERAL_SHOPPING_PRESETS as p}
                        <button type="button" class="b3-chip lv-dt-chip" class:b3-chip--primary={quickShopName === p.name} onclick={() => fillShoppingPreset(p)} disabled={saving}>
                            {p.name}
                        </button>
                    {/each}
                    {#each STAPLE_SHOPPING_PRESETS as name}
                        <button type="button" class="b3-chip lv-dt-chip" class:b3-chip--primary={quickShopName === name} onclick={() => fillShoppingPreset({ name })} disabled={saving}>
                            {name}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
        <div class="lv-frow">
            <label for="lv-shop-price">{t("capture.shopPrice")}</label>
            <div class="lv-col-stretch" style="width: 100%;">
                <input bind:this={priceInputEl} id="lv-shop-price" class="b3-text-field" type="number" inputMode="numeric" min="0" step="any" placeholder={`¥ (${t("capture.optional")})`} bind:value={quickShopPrice} disabled={saving} onkeydown={onEnter(submitQuickShopping)} />
                <div class="lv-dt-quick-bar" style="margin-top: 5px; display: flex; flex-wrap: wrap; gap: 5px;">
                    {#each [20, 50, 100, 200, 500] as amt}
                        <button type="button" class="b3-chip lv-dt-chip" class:b3-chip--primary={quickShopPrice === amt} onclick={() => { quickShopPrice = amt; }} disabled={saving}>
                            ¥{amt}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
        <div class="lv-frow">
            <label for="lv-shop-qty">{t("field.qty")}</label>
            <div class="lv-stepper-row">
                <button type="button" class="b3-button b3-button--outline lv-step-btn" onclick={() => { if (quickShopQty > 1) quickShopQty--; }} disabled={saving || quickShopQty <= 1}>-</button>
                <input id="lv-shop-qty" class="b3-text-field lv-stepper-input" type="number" inputMode="numeric" min="1" bind:value={quickShopQty} disabled={saving} onkeydown={onEnter(submitQuickShopping)} />
                <button type="button" class="b3-button b3-button--outline lv-step-btn" onclick={() => { quickShopQty++; }} disabled={saving}>+</button>
            </div>
        </div>
        <div class="lv-frow">
            <label for="lv-shop-cat">{t("capture.shopCat")}</label>
            <select id="lv-shop-cat" class="b3-select" bind:value={quickShopCategory} disabled={saving}>
                <option value="daily">{t("field.category.opt.daily")}</option>
                <option value="food_sh">{t("field.category.opt.food_sh")}</option>
                <option value="digital">{t("field.category.opt.digital")}</option>
                <option value="apparel">{t("field.category.opt.apparel")}</option>
                <option value="wish">{t("field.category.opt.wish")}</option>
                <option value="other_sh">{t("field.category.opt.other_sh")}</option>
            </select>
        </div>
    {:else if eventSub === "snippet"}
        <div class="lv-frow lv-col-stretch">
            <label for="lv-snip-text">{t("capture.actSnippet")} *</label>
            <textarea id="lv-snip-text" class="b3-text-field" rows="3" placeholder={t("capture.phSnippet")} bind:value={quickSnippetText} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitQuickSnippet(); } }}></textarea>
        </div>
        <div class="lv-frow">
            <span class="lv-frow-label">{t("capture.snippetTag")}</span>
            <div class="lv-pill-chips">
                {#each SNIPPET_TAG_SUGGESTIONS as tag}
                    <button
                        type="button"
                        class="b3-chip lv-pill-chip"
                        class:b3-chip--primary={quickSnippetTag === tag}
                        class:b3-chip--secondary={quickSnippetTag !== tag}
                        onclick={() => appendSnippetTag(tag)}
                        disabled={saving}
                    >
                        {tag}
                    </button>
                {/each}
            </div>
        </div>
    {/if}

    <div class="lv-frow">
        <label for={`lv-${eventSub}-date`}>{t("field.date")}</label>
        <div class="lv-datetime-col">
            <div class="lv-datetime-pair">
                <input
                    id={`lv-${eventSub}-date`}
                    class="b3-text-field lv-date-field"
                    type="date"
                    bind:value={eventDate}
                    disabled={saving}
                />
                <input
                    id={`lv-${eventSub}-time`}
                    class="b3-text-field lv-time-field"
                    type="time"
                    aria-label={t("field.date")}
                    bind:value={eventTime}
                    disabled={saving}
                />
                <button
                    type="button"
                    class="b3-button b3-button--outline lv-snap-now-btn"
                    title={t("capture.snapNow")}
                    onclick={() => {
                        eventDate = todayStr;
                        eventTime = currentLocalHHMM();
                    }}
                    disabled={saving}
                >
                    <UiIcon name="clock" size={12} />
                    <span>{t("capture.snapNow")}</span>
                </button>
            </div>
            <div class="lv-dt-quick-bar">
                <button
                    type="button"
                    class="b3-chip lv-dt-chip"
                    class:b3-chip--primary={eventDate === todayStr}
                    class:b3-chip--secondary={eventDate !== todayStr}
                    onclick={() => { eventDate = todayStr; }}
                    disabled={saving}
                >
                    {t("capture.today")}
                </button>
                <button
                    type="button"
                    class="b3-chip lv-dt-chip"
                    class:b3-chip--primary={eventDate === yesterdayStr}
                    class:b3-chip--secondary={eventDate !== yesterdayStr}
                    onclick={() => { eventDate = yesterdayStr; }}
                    disabled={saving}
                >
                    {t("capture.yesterday")}
                </button>
            </div>
        </div>
    </div>

    {#if saveError}
        <div class="lv-caption lv-event-flow-error">
            <span aria-hidden="true"><UiIcon name="alert" size={13} /></span>
            <span>{saveError}</span>
        </div>
    {/if}

    <div class="lv-event-doc-bar">
        <span class="lv-caption"><UiIcon name="note" size={12} /> {t("capture.docSyncHint")}</span>
        <button type="button" class="b3-button b3-button--text lv-event-doc-btn" onclick={() => void openCurrentTargetDoc()} disabled={saving}>
            <span>{t("ledger.openDoc")}</span> <UiIcon name="forward" size={11} />
        </button>
    </div>
</div>
