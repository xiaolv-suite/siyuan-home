<script lang="ts">
    import { onMount } from "svelte";
    import { localDateKey } from "@/core/hub/rule";
    import { showMessage } from "siyuan";
    import { renderLedgerAll } from "@/core/siyuan";
    import {
        buildChoreLog,
        buildFuelingLog,
        buildVitalLog,
        composeLifelogIsoAt,
        currentLocalHHMM,
        validateFuelingInput,
        validateVitalInput,
    } from "@/core/quick-actions";
    import type { EnergyKind } from "@/core/fuel";
    import { appendEntry, updateRowLogs } from "@/core/rowlog";
    import { loadQuickDefaults, saveQuickDefaults } from "@/core/quick-defaults";
    import { writeLedgerRow } from "@/core/ledger-writer";
    import { syncModuleDocSection, syncDailyJournalDoc } from "@/core/doc-sync";
    import UiIcon from "@/ui/icon.svelte";

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
        onSwitchToLedger?: (moduleId: string) => void;
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
    let eventTime = $state(currentLocalHHMM());
    let eventDate = $state(localDateKey(new Date()));

    // 常用流水：车辆与加油/充电
    let vehiclesList = $state<Array<{ itemID: string; name: string; plate: string; mileage?: number }>>([]);
    let selectedVehicleId = $state(qDefs.fuelVehicleId || "");
    let fuelingAmount = $state<number | undefined>();
    let fuelingLiters = $state<number | undefined>();
    let fuelingMileage = $state<number | undefined>();
    let fuelingKind = $state<EnergyKind>(qDefs.fuelKind || "fuel");

    // 补充：油价/电价、油品标号/充电模式、加满充满
    let fuelGrade = $state(qDefs.fuelGrade || "95");
    let fuelPrice = $state<number | undefined>(qDefs.fuelPrice ?? 8.25);
    let chargingMode = $state(qDefs.chargingMode || "dc");
    let chargePrice = $state<number | undefined>(qDefs.chargePrice ?? 1.20);
    let isEnergyFull = $state(qDefs.fuelIsFull ?? true);

    // 补能三数联动自动计算
    const currentPrice = () => (fuelingKind === "charging" ? chargePrice : fuelPrice);
    function onAmountInput(val: number | undefined) {
        fuelingAmount = val;
        if (typeof val === "number" && val > 0) {
            if (typeof fuelingLiters === "number" && fuelingLiters > 0) {
                const p = Number((val / fuelingLiters).toFixed(2));
                if (fuelingKind === "charging") chargePrice = p;
                else fuelPrice = p;
            } else {
                const p = currentPrice();
                if (typeof p === "number" && p > 0) {
                    fuelingLiters = Number((val / p).toFixed(2));
                }
            }
        }
    }
    function onLitersInput(val: number | undefined) {
        fuelingLiters = val;
        if (typeof val === "number" && val > 0) {
            if (typeof fuelingAmount === "number" && fuelingAmount > 0) {
                const p = Number((fuelingAmount / val).toFixed(2));
                if (fuelingKind === "charging") chargePrice = p;
                else fuelPrice = p;
            } else {
                const p = currentPrice();
                if (typeof p === "number" && p > 0) {
                    fuelingAmount = Number((val * p).toFixed(2));
                }
            }
        }
    }
    function onPriceInput(val: number | undefined) {
        if (fuelingKind === "charging") chargePrice = val;
        else fuelPrice = val;
        if (typeof val === "number" && val > 0) {
            if (typeof fuelingAmount === "number" && fuelingAmount > 0) {
                fuelingLiters = Number((fuelingAmount / val).toFixed(2));
            } else if (typeof fuelingLiters === "number" && fuelingLiters > 0) {
                fuelingAmount = Number((fuelingLiters * val).toFixed(2));
            }
        }
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

    // 常用流水：家务打卡（写入家务行 chexecs，与家务轮换抽屉、积分结算同源）
    let choresList = $state<Array<{ itemID: string; name: string }>>([]);
    let choreRowId = $state(qDefs.choreRowId || "");
    let choreMemberId = $state(qDefs.choreMemberId || "");
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

    async function ensureTargetRef(mod: string) {
        let r = plugin.settings.dbRefs?.[mod];
        if (!r?.avId) {
            await plugin.repairModule?.(mod);
            r = plugin.settings.dbRefs?.[mod];
        }
        if (!r?.avId) throw new Error(t("triage.noTarget"));
        return r;
    }

    function dispatchBackgroundSync(mod: string, nextLogs: any) {
        queueMicrotask(async () => {
            try {
                if (mod !== "shopping" && mod !== "snippets") {
                    await syncModuleDocSection(plugin, mod, nextLogs);
                }
                await syncDailyJournalDoc(plugin, nextLogs);
            } catch { /* soft */ }
            try { await plugin.refreshHub?.([mod], true); } catch { /* soft */ }
        });
    }

    async function submitQuickFueling() {
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
            const isFull = isEnergyFull;

            const log = buildFuelingLog({
                date: eventDate,
                time: eventTime,
                kind: fuelingKind,
                amount: fuelingAmount,
                quantity: fuelingLiters!,
                mileage: fuelingMileage!,
                unitPrice,
                full: isFull,
                fuelGrade: !isCharging ? fuelGrade : undefined,
                chargingMode: isCharging ? chargingMode : undefined,
            });
            const vRef = await ensureTargetRef("vehicles");
            const nextLogs = await updateRowLogs(plugin as any, (cur) =>
                appendEntry(cur, vRef.avId!, selectedVehicleId, isCharging ? "chargings" : "fuelings", log as unknown as Record<string, unknown>));

            const fullText = isFull ? (isCharging ? "已充满" : "已加满") : "";
            const summaryNote = `最近${isCharging ? "充电" : "加油"}：${eventDate} · ${fuelingLiters}${isCharging ? "kWh" : "L"}${fuelingAmount !== undefined ? ` · ¥${fuelingAmount}` : ""}${fullText ? ` · ${fullText}` : ""} · ${fuelingMileage}km`;

            await writeLedgerRow({
                moduleId: "vehicles",
                target: vRef,
                itemId: selectedVehicleId,
                name: "",
                fields: {
                    ...(fuelingMileage ? { mileage: fuelingMileage } : {}),
                    note: summaryNote,
                },
            });

            // 记忆用户本次填写习惯
            saveQuickDefaults(plugin, {
                fuelVehicleId: selectedVehicleId,
                fuelKind: fuelingKind,
                fuelGrade,
                fuelPrice,
                fuelIsFull: isEnergyFull,
                chargingMode,
                chargePrice,
                chargeIsFull: isEnergyFull,
            });

            // 核心数据落盘即刻释放 UI（秒级响应）
            saving = false;
            showMessage(t("capture.savedEvent"), 2000, "info");
            fuelingAmount = undefined;
            fuelingLiters = undefined;
            if (!keepContext) onClose?.();
            dispatchBackgroundSync("vehicles", nextLogs);
        } catch (e) {
            saveError = String(e);
            saving = false;
        }
    }

    async function submitQuickVital() {
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
            const readings = buildVitalLog({
                date: eventDate,
                time: eventTime,
                metricType: vitalMetricType,
                systolic: vitalSys,
                diastolic: vitalDia,
                pulse: vitalPulse,
                glucose: vitalGlucose,
                glucoseTiming: vitalTiming,
                weight: vitalWeight,
                temperature: vitalTemp,
            });
            const healthRef = await ensureTargetRef("health");
            const all = await renderLedgerAll(healthRef.avId!);
            let row = vitalMemberId
                ? (all.rows ?? []).find((r) => r.cells?.[healthRef.columns?.member ?? ""]?.relation?.blockIDs?.includes(vitalMemberId))
                : (all.rows?.[0]);
            const targetMember = plugin.settings.members?.find((m: any) => m.avItemId === vitalMemberId || m.id === vitalMemberId);
            const memberName = targetMember ? `${targetMember.name}健康档案` : "家庭健康档案";

            let summaryDiag = "";
            if (vitalMetricType === "bp") {
                summaryDiag = `血压 ${vitalSys}/${vitalDia} mmHg${vitalPulse ? ` · 心率 ${vitalPulse} bpm` : ""}`;
            } else if (vitalMetricType === "glucose") {
                summaryDiag = `${vitalTiming === "postprandial" ? "餐后" : "空腹"}血糖 ${vitalGlucose} mmol/L`;
            } else if (vitalMetricType === "weight") {
                summaryDiag = `体重 ${vitalWeight} kg`;
            } else if (vitalMetricType === "temp") {
                summaryDiag = `体温 ${vitalTemp} ℃`;
            }

            if (!row) {
                const { itemID } = await writeLedgerRow({
                    moduleId: "health",
                    target: healthRef,
                    name: memberName,
                    members: plugin.settings.members,
                    operationKey: `vital:init:${vitalMemberId || "default"}:${Date.now()}`,
                    fields: {
                        member: vitalMemberId,
                        category: "checkup",
                        status: "following",
                        date: eventDate,
                        diagnosis: summaryDiag,
                        note: `${eventDate} 录入：${summaryDiag}`,
                    },
                });
                row = { itemID, cells: {} };
            } else {
                await writeLedgerRow({
                    moduleId: "health",
                    target: healthRef,
                    itemId: row.itemID,
                    name: "",
                    members: plugin.settings.members,
                    fields: {
                        member: vitalMemberId,
                        category: "checkup",
                        status: "following",
                        date: eventDate,
                        diagnosis: summaryDiag,
                        note: `${eventDate} 录入：${summaryDiag}`,
                    },
                });
            }
            const nextLogs = await updateRowLogs(plugin as any, (cur) => readings.reduce(
                (acc, reading) => appendEntry(acc, healthRef.avId!, row!.itemID, "vitals", reading as unknown as Record<string, unknown>), cur));

            // 记忆用户体征习惯
            saveQuickDefaults(plugin, {
                vitalMemberId,
                vitalMetricType,
            });

            // 秒级响应
            saving = false;
            showMessage(t("capture.savedEvent"), 2000, "info");
            vitalSys = undefined;
            vitalDia = undefined;
            vitalPulse = undefined;
            vitalGlucose = undefined;
            vitalWeight = undefined;
            vitalTemp = undefined;
            if (!keepContext) onClose?.();
            dispatchBackgroundSync("health", nextLogs);
        } catch (e) {
            saveError = String(e);
            saving = false;
        }
    }

    async function submitQuickChore() {
        if (saving) return;
        if (!choreRowId) {
            saveError = t("capture.choreRequired");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const choreRef = await ensureTargetRef("chores");
            const log = buildChoreLog({
                date: eventDate,
                time: eventTime,
                memberId: choreMemberId || undefined,
                points: chorePoints,
                note: choreNote,
            });
            const nextLogs = await updateRowLogs(plugin as any, (cur) =>
                appendEntry(cur, choreRef.avId!, choreRowId, "chexecs", log));

            const whoName = plugin.settings.members?.find((m: any) => m.id === choreMemberId)?.name;
            const summaryNote = `上次完成：${eventDate}${whoName ? ` · ${whoName}` : ""}${chorePoints ? ` · +${chorePoints}积分` : ""}${choreNote ? ` (${choreNote})` : ""}`;

            await writeLedgerRow({
                moduleId: "chores",
                target: choreRef,
                itemId: choreRowId,
                name: "",
                fields: {
                    lastDone: eventDate,
                    ...(choreMemberId ? { assignee: choreMemberId } : {}),
                    note: summaryNote,
                },
            });

            saveQuickDefaults(plugin, {
                choreRowId,
                choreMemberId,
            });

            saving = false;
            showMessage(t("capture.savedEvent"), 2000, "info");
            chorePoints = undefined;
            choreNote = "";
            if (!keepContext) onClose?.();
            dispatchBackgroundSync("chores", nextLogs);
        } catch (e) {
            saveError = String(e);
            saving = false;
        }
    }

    async function submitQuickShopping() {
        if (saving) return;
        const name = quickShopName.trim();
        if (!name) {
            saveError = t("form.required");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const shopRef = await ensureTargetRef("shopping");
            const dateStr = eventDate;
            const { itemID } = await writeLedgerRow({
                moduleId: "shopping",
                target: shopRef,
                name,
                operationKey: `quick:shop:${Date.now()}`,
                fields: {
                    qty: quickShopQty || 1,
                    date: dateStr,
                    category: quickShopCategory || "daily",
                    ...(quickShopPrice ? { price: quickShopPrice } : {}),
                },
            });
            const nextLogs = await updateRowLogs(plugin as any, (cur) => appendEntry(cur, shopRef.avId!, itemID, "quickflows", {
                kind: "shopping",
                date: dateStr,
                time: eventTime,
                title: name,
                qty: quickShopQty || 1,
                price: quickShopPrice,
                category: quickShopCategory,
                at: composeLifelogIsoAt(dateStr, eventTime),
            }));

            saveQuickDefaults(plugin, {
                shoppingCategory: quickShopCategory,
            });

            saving = false;
            showMessage(t("capture.savedEvent"), 2000, "info");
            quickShopName = "";
            quickShopQty = 1;
            quickShopPrice = undefined;
            if (!keepContext) onClose?.();
            dispatchBackgroundSync("shopping", nextLogs);
        } catch (e) {
            saveError = String(e);
            saving = false;
        }
    }

    async function submitQuickSnippet() {
        if (saving) return;
        const text = quickSnippetText.trim();
        if (!text) {
            saveError = t("form.required");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const snipRef = await ensureTargetRef("snippets");
            const dateStr = eventDate;
            const title = text.slice(0, 30);
            const { itemID } = await writeLedgerRow({
                moduleId: "snippets",
                target: snipRef,
                name: title,
                operationKey: `quick:snip:${Date.now()}`,
                fields: {
                    content: text,
                    category: "other_sn",
                    note: text,
                },
            });
            const nextLogs = await updateRowLogs(plugin as any, (cur) => appendEntry(cur, snipRef.avId!, itemID, "quickflows", {
                kind: "snippet",
                date: dateStr,
                time: eventTime,
                title,
                detail: text,
                tag: quickSnippetTag,
                at: composeLifelogIsoAt(dateStr, eventTime),
            }));

            saveQuickDefaults(plugin, {
                snippetTag: quickSnippetTag,
            });

            saving = false;
            showMessage(t("capture.savedEvent"), 2000, "info");
            quickSnippetText = "";
            if (!keepContext) onClose?.();
            dispatchBackgroundSync("snippets", nextLogs);
        } catch (e) {
            saveError = String(e);
            saving = false;
        }
    }

    async function loadQuickEventContext() {
        const vRef = plugin.settings.dbRefs?.vehicles;
        if (vRef?.avId && vRef.columns?.name) {
            try {
                const res = await renderLedgerAll(vRef.avId);
                vehiclesList = (res.rows ?? []).map((r) => {
                    const name = String(r.cells?.[vRef.columns!.name]?.text?.content ?? r.cells?.[vRef.columns!.name]?.block?.content ?? "车辆").trim();
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
            const first = mems.find((m) => !!m.avItemId) || mems[0];
            if (first?.avItemId) vitalMemberId = first.avItemId;
        }
    }

    export function submitCurrentSubAction() {
        if (eventSub === "fuel") void submitQuickFueling();
        else if (eventSub === "vital") void submitQuickVital();
        else if (eventSub === "chore") void submitQuickChore();
        else if (eventSub === "shopping") void submitQuickShopping();
        else if (eventSub === "snippet") void submitQuickSnippet();
    }

    export function selectSubAction(sub: string) {
        if ((subActions as string[]).includes(sub)) {
            eventSub = sub as EventSubAction;
        }
    }

    const subTargetModule: Record<EventSubAction, string> = {
        fuel: "vehicles",
        vital: "health",
        chore: "chores",
        shopping: "shopping",
        snippet: "snippets",
    };

    export async function openCurrentTargetDoc() {
        const { openModuleOrJournalDoc } = await import("@/core/doc-sync");
        onClose?.();
        await openModuleOrJournalDoc(plugin, subTargetModule[eventSub]);
    }

    export function reloadContext() {
        eventTime = currentLocalHHMM();
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
                <button type="button" class="b3-button b3-button--outline" onclick={() => onSwitchToLedger?.("vehicles")}><UiIcon name="add" size={13} /> {t("capture.addVehicleFirst")}</button>
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
                        onclick={() => { fuelingKind = "fuel"; }}
                        disabled={saving}
                    >
                        ⛽ {t("fuel.fuelTitle")}
                    </button>
                    <button
                        type="button"
                        class="lv-seg-btn"
                        class:active={fuelingKind === "charging"}
                        onclick={() => { fuelingKind = "charging"; }}
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
                        {#each [["92", "92#"], ["95", "95#"], ["98", "98#"], ["0", "0# 柴油"]] as [val, lbl]}
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
                    min="0"
                    step="0.01"
                    placeholder={fuelingKind === "fuel" ? t("capture.phUnitPrice") : t("capture.phChargeUnitPrice")}
                    value={fuelingKind === "charging" ? chargePrice : fuelPrice}
                    oninput={(e) => onPriceInput(Number(e.currentTarget.value) || undefined)}
                    disabled={saving}
                />
            </div>

            <div class="lv-frow">
                <label for="lv-fuel-amount">{t("capture.amountCny")}</label>
                <input
                    id="lv-fuel-amount"
                    class="b3-text-field"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={t("capture.phAmount")}
                    value={fuelingAmount}
                    oninput={(e) => onAmountInput(Number(e.currentTarget.value) || undefined)}
                    disabled={saving}
                    onkeydown={onEnter(submitQuickFueling)}
                />
            </div>

            <div class="lv-frow">
                <label for="lv-fuel-liters">{t("capture.fuelLiters")} *</label>
                <input
                    id="lv-fuel-liters"
                    class="b3-text-field"
                    type="number"
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
                <input
                    id="lv-fuel-mileage"
                    class="b3-text-field"
                    type="number"
                    min="0"
                    required
                    placeholder={t("capture.phMileage")}
                    bind:value={fuelingMileage}
                    disabled={saving}
                    onkeydown={onEnter(submitQuickFueling)}
                />
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
                <input id="lv-vital-sys" class="b3-text-field" type="number" min="40" max="250" placeholder={t("capture.phSystolic")} bind:value={vitalSys} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-dia">{t("capture.diastolic")} *</label>
                <input id="lv-vital-dia" class="b3-text-field" type="number" min="30" max="150" placeholder={t("capture.phDiastolic")} bind:value={vitalDia} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-pulse">{t("capture.pulse")}</label>
                <input id="lv-vital-pulse" class="b3-text-field" type="number" min="30" max="220" placeholder={t("capture.phPulse")} bind:value={vitalPulse} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
        {:else if vitalMetricType === "glucose"}
            <div class="lv-frow">
                <label for="lv-vital-glu">{t("capture.glucoseVal")} *</label>
                <input id="lv-vital-glu" class="b3-text-field" type="number" min="0" step="0.1" placeholder={t("capture.phGlucose")} bind:value={vitalGlucose} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-tim">{t("capture.measureTiming")}</label>
                <select id="lv-vital-tim" class="b3-select" bind:value={vitalTiming} disabled={saving}>
                    <option value="fasting">{t("capture.fasting")}</option>
                    <option value="postprandial">{t("capture.postprandial")}</option>
                </select>
            </div>
        {:else if vitalMetricType === "weight"}
            <div class="lv-frow">
                <label for="lv-vital-weight">{t("capture.weightVal")} *</label>
                <input id="lv-vital-weight" class="b3-text-field" type="number" min="1" max="500" step="0.1" placeholder={t("capture.phWeight")} bind:value={vitalWeight} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
        {:else if vitalMetricType === "temp"}
            <div class="lv-frow">
                <label for="lv-vital-temp">{t("capture.tempVal")} *</label>
                <input id="lv-vital-temp" class="b3-text-field" type="number" min="30" max="45" step="0.1" placeholder={t("capture.phTemp")} bind:value={vitalTemp} disabled={saving} onkeydown={onEnter(submitQuickVital)} />
            </div>
        {/if}
    {:else if eventSub === "chore"}
        {#if choresList.length === 0}
            <div class="lv-capture-empty">
                <span class="lv-caption">{t("capture.noChores")}</span>
                <button type="button" class="b3-button b3-button--outline" onclick={() => onSwitchToLedger?.("chores")}><UiIcon name="add" size={13} /> {t("capture.addChoreFirst")}</button>
            </div>
        {:else}
            <div class="lv-frow">
                <label for="lv-chore-row">{t("capture.selectChore")} *</label>
                <select id="lv-chore-row" class="b3-select" bind:value={choreRowId} disabled={saving}>
                    {#each choresList as c (c.itemID)}
                        <option value={c.itemID}>{c.name}</option>
                    {/each}
                </select>
            </div>
            <div class="lv-frow">
                <label for="lv-chore-mem">{t("field.member")}</label>
                <select id="lv-chore-mem" class="b3-select" bind:value={choreMemberId} disabled={saving}>
                    <option value="">{t("capture.selectOptional")}</option>
                    {#each plugin.settings.members ?? [] as m (m.id)}
                        <option value={m.id}>{m.name}</option>
                    {/each}
                </select>
            </div>
            <div class="lv-frow">
                <label for="lv-chore-points">{t("ledger.chorePoints")}</label>
                <input id="lv-chore-points" class="b3-text-field" type="number" min="0" step="1" placeholder={t("ledger.chorePointsTip")} bind:value={chorePoints} disabled={saving} />
            </div>
            <div class="lv-frow">
                <label for="lv-chore-note">{t("field.note")}</label>
                <input id="lv-chore-note" class="b3-text-field" type="text" placeholder={t("ledger.choreNote")} bind:value={choreNote} disabled={saving} onkeydown={onEnter(submitQuickChore)} />
            </div>
        {/if}
    {:else if eventSub === "shopping"}
        <div class="lv-frow">
            <label for="lv-shop-name">{t("field.name")} *</label>
            <input id="lv-shop-name" class="b3-text-field" type="text" placeholder={t("capture.phShopName")} bind:value={quickShopName} disabled={saving} onkeydown={onEnter(submitQuickShopping)} />
        </div>
        <div class="lv-frow">
            <label for="lv-shop-qty">{t("field.qty")}</label>
            <div class="lv-stepper-row">
                <button type="button" class="b3-button b3-button--outline lv-step-btn" onclick={() => { if (quickShopQty > 1) quickShopQty--; }} disabled={saving || quickShopQty <= 1}>-</button>
                <input id="lv-shop-qty" class="b3-text-field lv-stepper-input" type="number" min="1" bind:value={quickShopQty} disabled={saving} onkeydown={onEnter(submitQuickShopping)} />
                <button type="button" class="b3-button b3-button--outline lv-step-btn" onclick={() => { quickShopQty++; }} disabled={saving}>+</button>
            </div>
        </div>
        <div class="lv-frow">
            <label for="lv-shop-price">{t("capture.shopPrice")}</label>
            <input id="lv-shop-price" class="b3-text-field" type="number" min="0" step="0.1" placeholder="¥ (可选)" bind:value={quickShopPrice} disabled={saving} />
        </div>
        <div class="lv-frow">
            <label for="lv-shop-cat">{t("capture.shopCat")}</label>
            <select id="lv-shop-cat" class="b3-select" bind:value={quickShopCategory} disabled={saving}>
                <option value="daily">日用百货</option>
                <option value="food">生鲜食品</option>
                <option value="baby">母婴儿童</option>
                <option value="health">医药健康</option>
                <option value="digital">数码办公</option>
                <option value="other">其他采购</option>
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
                        eventDate = localDateKey(new Date());
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
                    class:b3-chip--primary={eventDate === localDateKey(new Date())}
                    class:b3-chip--secondary={eventDate !== localDateKey(new Date())}
                    onclick={() => { eventDate = localDateKey(new Date()); }}
                    disabled={saving}
                >
                    {t("capture.today")}
                </button>
                <button
                    type="button"
                    class="b3-chip lv-dt-chip"
                    class:b3-chip--primary={eventDate === localDateKey(new Date(Date.now() - 86400000))}
                    class:b3-chip--secondary={eventDate !== localDateKey(new Date(Date.now() - 86400000))}
                    onclick={() => { eventDate = localDateKey(new Date(Date.now() - 86400000)); }}
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
