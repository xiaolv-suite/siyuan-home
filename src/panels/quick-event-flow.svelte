<script lang="ts">
    import { onMount } from "svelte";
    import { localDateKey } from "@/core/hub/rule";
    import { showMessage } from "siyuan";
    import { addDetachedRow, setCell, renderLedgerAll } from "@/core/siyuan";
    import { buildFuelingLog, buildVitalLog } from "@/core/quick-actions";
    import { appendEntry, updateRowLogs } from "@/core/rowlog";
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

    type EventSubAction = "fuel" | "vital" | "shopping" | "snippet";
    const subActions: EventSubAction[] = ["fuel", "vital", "shopping", "snippet"];
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

    // 常用流水：车辆与加油
    let vehiclesList = $state<Array<{ itemID: string; name: string; plate: string; mileage?: number }>>([]);
    let selectedVehicleId = $state("");
    let fuelingAmount = $state<number | undefined>();
    let fuelingLiters = $state<number | undefined>();
    let fuelingMileage = $state<number | undefined>();
    let fuelingType = $state("gasoline");
    let fuelingDate = $state(localDateKey(new Date()));

    // 常用流水：生理指标（血压/血糖）
    let vitalMemberId = $state("");
    let vitalMetricType = $state<"bp" | "glucose">("bp");
    let vitalDate = $state(localDateKey(new Date()));
    let vitalSys = $state<number | undefined>();
    let vitalDia = $state<number | undefined>();
    let vitalPulse = $state<number | undefined>();
    let vitalGlucose = $state<number | undefined>();
    let vitalTiming = $state<"fasting" | "postprandial">("fasting");

    // 常用流水：快捷待买
    let quickShopName = $state("");
    let quickShopQty = $state(1);

    // 常用流水：随手便签
    let quickSnippetText = $state("");

    async function ensureTargetRef(mod: string) {
        let r = plugin.settings.dbRefs?.[mod];
        if (!r?.avId) {
            await plugin.repairModule?.(mod);
            r = plugin.settings.dbRefs?.[mod];
        }
        if (!r?.avId) throw new Error(t("triage.noTarget"));
        return r;
    }

    async function submitQuickFueling() {
        if (saving) return;
        if (!selectedVehicleId || !fuelingAmount) {
            saveError = t("ledger.logInvalid");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const log = buildFuelingLog({
                date: fuelingDate,
                amount: fuelingAmount,
                liters: fuelingLiters,
                mileage: fuelingMileage,
                fuelType: fuelingType,
            });
            const vRef = await ensureTargetRef("vehicles");
            await updateRowLogs(plugin as any, (cur) => appendEntry(cur, vRef.avId!, selectedVehicleId, fuelingType === "electric" ? "chargings" : "fuelings", log));
            if (fuelingMileage && vRef.columns?.mileage) {
                await setCell(vRef.avId!, vRef.columns.mileage, selectedVehicleId, { type: "number", number: { content: fuelingMileage } });
            }
            try { await plugin.refreshHub?.(undefined, true); } catch { /* soft */ }
            showMessage(t("capture.savedEvent"), 2500, "info");
            fuelingAmount = undefined;
            fuelingLiters = undefined;
            fuelingMileage = undefined;
            if (!keepContext) onClose?.();
        } catch (e) {
            saveError = String(e);
        } finally {
            saving = false;
        }
    }

    async function submitQuickVital() {
        if (saving) return;
        if (!vitalMemberId) {
            saveError = t("members.reassignSelectTo");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const log = buildVitalLog({
                date: vitalDate,
                metricType: vitalMetricType,
                systolic: vitalSys,
                diastolic: vitalDia,
                pulse: vitalPulse,
                glucose: vitalGlucose,
                glucoseTiming: vitalTiming,
            });
            const healthRef = await ensureTargetRef("health");
            const all = await renderLedgerAll(healthRef.avId!);
            let row = vitalMemberId
                ? (all.rows ?? []).find((r) => r.cells?.[healthRef.columns?.member ?? ""]?.relation?.blockIDs?.includes(vitalMemberId))
                : (all.rows?.[0]);
            if (!row) {
                const targetMember = plugin.settings.members?.find((m) => m.avItemId === vitalMemberId);
                const memberName = targetMember ? `${targetMember.name}健康档案` : "家庭健康档案";
                const rowId = await addDetachedRow(healthRef.avId!, memberName, { idempotencyKey: `vital:init:${vitalMemberId || "default"}:${Date.now()}` });
                if (healthRef.columns?.member && vitalMemberId) {
                    await setCell(healthRef.avId!, healthRef.columns.member, rowId, { type: "relation", relation: { blockIDs: [vitalMemberId] } });
                }
                row = { itemID: rowId, cells: {} };
            }
            await updateRowLogs(plugin as any, (cur) => appendEntry(cur, healthRef.avId!, row.itemID, "vitals", log));
            try { await plugin.refreshHub?.(undefined, true); } catch { /* soft */ }
            showMessage(t("capture.savedEvent"), 2500, "info");
            vitalSys = undefined;
            vitalDia = undefined;
            vitalGlucose = undefined;
            if (!keepContext) onClose?.();
        } catch (e) {
            saveError = String(e);
        } finally {
            saving = false;
        }
    }

    async function submitQuickShopping() {
        if (saving) return;
        const name = quickShopName.trim();
        if (!name) {
            saveError = t("ledger.nameRequired");
            return;
        }
        saving = true;
        saveError = "";
        try {
            const shopRef = await ensureTargetRef("shopping");
            const rowId = await addDetachedRow(shopRef.avId!, name, { idempotencyKey: `quick:shop:${Date.now()}` });
            if (shopRef.columns?.qty && quickShopQty) {
                await setCell(shopRef.avId!, shopRef.columns.qty, rowId, { type: "number", number: { content: quickShopQty } });
            }
            showMessage(t("capture.savedEvent"), 2500, "info");
            quickShopName = "";
            quickShopQty = 1;
            if (!keepContext) onClose?.();
        } catch (e) {
            saveError = String(e);
        } finally {
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
            const title = text.slice(0, 30);
            const rowId = await addDetachedRow(snipRef.avId!, title, { idempotencyKey: `quick:snip:${Date.now()}` });
            const col = snipRef.columns?.content || snipRef.columns?.note || snipRef.columns?.name;
            if (col) {
                await setCell(snipRef.avId!, col, rowId, { type: "text", text: { content: text } });
            }
            showMessage(t("capture.savedEvent"), 2500, "info");
            quickSnippetText = "";
            if (!keepContext) onClose?.();
        } catch (e) {
            saveError = String(e);
        } finally {
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
                if (vehiclesList.length > 0 && !selectedVehicleId) {
                    selectedVehicleId = vehiclesList[0].itemID;
                    if (vehiclesList[0].mileage) fuelingMileage = vehiclesList[0].mileage;
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
        else if (eventSub === "shopping") void submitQuickShopping();
        else if (eventSub === "snippet") void submitQuickSnippet();
    }

    export function reloadContext() {
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
            {s === "fuel" ? t("capture.actFuel") : s === "vital" ? t("capture.actVital") : s === "shopping" ? t("capture.actShopping") : t("capture.actSnippet")}
        </button>
    {/each}
</div>

<div class="lv-event-card">
    {#if eventSub === "fuel"}
        {#if vehiclesList.length === 0}
            <div class="lv-capture-empty">
                <span class="lv-caption">{t("capture.noVehicles")}</span>
                <button class="b3-button b3-button--outline" onclick={() => onSwitchToLedger?.("vehicles")}><UiIcon name="add" size={13} /> {t("capture.addVehicleFirst")}</button>
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
                <label for="lv-fuel-amount">{t("capture.amountCny")} *</label>
                <input id="lv-fuel-amount" class="b3-text-field" type="number" min="0" step="any" placeholder="例如：300 或 250.5" bind:value={fuelingAmount} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickFueling(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-fuel-mileage">{t("capture.currentMileage")}</label>
                <input id="lv-fuel-mileage" class="b3-text-field" type="number" min="0" placeholder="例如：15800（公里）" bind:value={fuelingMileage} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickFueling(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-fuel-liters">{t("capture.fuelLiters")}</label>
                <input id="lv-fuel-liters" class="b3-text-field" type="number" min="0" step="any" placeholder="例如：42.5（升）或 50（度）" bind:value={fuelingLiters} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickFueling(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-fuel-date">{t("field.date")}</label>
                <input id="lv-fuel-date" class="b3-text-field" type="date" bind:value={fuelingDate} disabled={saving} />
            </div>
        {/if}
    {:else if eventSub === "vital"}
        <div class="lv-frow">
            <label for="lv-vital-mem">{t("field.member")}</label>
            <select id="lv-vital-mem" class="b3-select" bind:value={vitalMemberId} disabled={saving}>
                {#each plugin.settings.members ?? [] as m (m.avItemId ?? m.id)}
                    <option value={m.avItemId ?? ""}>{m.name}</option>
                {/each}
            </select>
        </div>
        <div class="lv-frow">
            <label for="lv-vital-type">指标类型</label>
            <div class="lv-radio-group">
                <label class="lv-radio-label"><input type="radio" name="vitalType" value="bp" bind:group={vitalMetricType} /> {t("capture.metricBp")}</label>
                <label class="lv-radio-label"><input type="radio" name="vitalType" value="glucose" bind:group={vitalMetricType} /> {t("capture.metricGlucose")}</label>
            </div>
        </div>
        {#if vitalMetricType === "bp"}
            <div class="lv-frow">
                <label for="lv-vital-sys">{t("capture.systolic")}</label>
                <input id="lv-vital-sys" class="b3-text-field" type="number" min="40" max="250" placeholder="收缩压高压，例如：120" bind:value={vitalSys} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickVital(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-dia">{t("capture.diastolic")}</label>
                <input id="lv-vital-dia" class="b3-text-field" type="number" min="30" max="150" placeholder="舒张压低压，例如：80" bind:value={vitalDia} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickVital(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-pulse">{t("capture.pulse")}</label>
                <input id="lv-vital-pulse" class="b3-text-field" type="number" min="30" max="220" placeholder="静息心率，例如：72" bind:value={vitalPulse} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickVital(); }} />
            </div>
        {:else}
            <div class="lv-frow">
                <label for="lv-vital-glu">{t("capture.glucoseVal")}</label>
                <input id="lv-vital-glu" class="b3-text-field" type="number" min="0" step="0.1" placeholder="空腹/餐后血糖，例如：5.6" bind:value={vitalGlucose} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickVital(); }} />
            </div>
            <div class="lv-frow">
                <label for="lv-vital-tim">测量时段</label>
                <select id="lv-vital-tim" class="b3-select" bind:value={vitalTiming} disabled={saving}>
                    <option value="fasting">{t("capture.fasting")}</option>
                    <option value="postprandial">{t("capture.postprandial")}</option>
                </select>
            </div>
        {/if}
    {:else if eventSub === "shopping"}
        <div class="lv-frow">
            <label for="lv-shop-name">{t("field.name")} *</label>
            <input id="lv-shop-name" class="b3-text-field" type="text" placeholder="例如：维达无芯卷纸 / 纯牛奶 / 抽纸" bind:value={quickShopName} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickShopping(); }} />
        </div>
        <div class="lv-frow">
            <label for="lv-shop-qty">{t("field.qty")}</label>
            <input id="lv-shop-qty" class="b3-text-field" type="number" min="1" placeholder="数量，默认 1" bind:value={quickShopQty} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && !e.isComposing) void submitQuickShopping(); }} />
        </div>
    {:else if eventSub === "snippet"}
        <div class="lv-frow lv-col-stretch">
            <label for="lv-snip-text">{t("capture.actSnippet")}</label>
            <textarea id="lv-snip-text" class="b3-text-field" rows="4" placeholder="随时记录一句话、常用语或家庭备忘，支持自动提炼标题与日期 (Ctrl+Enter快速保存)..." bind:value={quickSnippetText} disabled={saving} onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitQuickSnippet(); } }}></textarea>
        </div>
    {/if}
    {#if saveError}
        <div class="lv-caption lv-event-flow-error">
            <span aria-hidden="true"><UiIcon name="alert" size={13} /></span>
            <span>{saveError}</span>
        </div>
    {/if}
</div>

<style>
    .lv-radio-group {
        display: flex;
        gap: 8px;
    }
    .lv-radio-label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
    }
    .lv-col-stretch {
        display: flex;
        flex-direction: column;
        align-items: stretch;
    }
    .lv-event-flow-error {
        margin-top: 8px;
        padding: 6px 12px;
        background: var(--lv-surface-2);
        border-radius: var(--lv-r-control);
        border: 1px solid var(--lv-danger);
        color: var(--lv-danger);
        display: flex;
        align-items: center;
        gap: 6px;
    }
</style>
