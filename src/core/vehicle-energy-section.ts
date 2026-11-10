/**
 * 车辆能源能耗板块（油耗、充电、能耗折线图、月度支出图与加注流水）
 * 解耦自 vehicle-drawer.ts，提升模块可维护度
 */

import { loadRowLogs, updateRowLogs, getEntries, appendEntry, removeEntry } from "./rowlog";
import { bindDialogA11y } from "./dialog-a11y";
import { calculateEnergyStats, type EnergyKind, type EnergyRecord } from "./fuel";
import { pointsToSmoothBezierPath, pointsToAreaBezierPath } from "./chart";
import { rowLogActivityId, markActivityLine, type ActivityTarget } from "./activity";
import { formatAmount } from "./format";
import { localDateKey } from "./hub/rule";
import { confirm } from "@/libs/dialog";
import type { VehicleQuickAction } from "./vehicle";

export interface VehicleEnergySectionOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    selectContentFn: (cell: any) => string | undefined;
    rawFromValueFn: (type: string, cell: any) => any;
    activityTarget?: ActivityTarget;
    vehicleActionQueue: {
        register: (action: VehicleQuickAction, handler: () => void) => boolean;
        fail: (action: VehicleQuickAction, error: string) => boolean;
        request: (action: VehicleQuickAction) => { status: "ready" | "queued" | "failed"; error?: string };
    };
    onLogUpdated?: () => Promise<void>;
}

export async function renderVehicleEnergySection(options: VehicleEnergySectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const {
        body,
        row,
        ref,
        active,
        plugin,
        t,
        DialogCls,
        showMessageFn,
        selectContentFn,
        rawFromValueFn,
        activityTarget,
        vehicleActionQueue,
        onLogUpdated,
    } = options;

    const registerVehicleAction = (action: VehicleQuickAction, target: HTMLButtonElement) => {
        vehicleActionQueue.register(action, () => {
            if (!body.contains(target)) return;
            target.click();
            target.scrollIntoView({ block: "nearest" });
        });
    };

    const energyWrap = document.createElement("section");
    energyWrap.id = "lv-vehicle-energy";
    energyWrap.className = "lv-domain-sec";
    body.appendChild(energyWrap);

    const hint = document.createElement("p");
    hint.className = "ft__on-surface lv-dialog-intro";
    hint.textContent = t("fuel.vehicleHint");
    energyWrap.appendChild(hint);

    let logs = await loadRowLogs(plugin);
    const energyKinds: EnergyKind[] = ["fuel", "charging"];
    const vehicleEnergyType = selectContentFn(row.cells[ref.columns!.energy_type ?? ""]) ?? "gasoline";
    const isHybridVehicle = vehicleEnergyType === "hybrid";
    const entriesFor = (kind: EnergyKind) => getEntries<EnergyRecord>(logs, ref.avId!, row.itemID, kind === "fuel" ? "fuelings" : "chargings");
    const compactNumber = (value: number | undefined, digits = 2) => value === undefined || !Number.isFinite(value) ? "—" : String(Number(value.toFixed(digits)));

    function openEnergyForm(kind: EnergyKind, existing?: EnergyRecord) {
        const isFuel = kind === "fuel";
        const dialog = new DialogCls({
            title: t(existing ? "fuel.editRecord" : isFuel ? "fuel.addFuel" : "fuel.addCharging"),
            content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-energy-form-body"></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-energy-cancel">${t("cancel")}</button><span class="fn__flex-1"></span><button class="b3-button" id="lv-energy-save">${t(existing ? "fuel.update" : "save")}</button></div>`,
            width: "560px",
        });
        dialog.element.classList.add("lv-energy-dialog");
        bindDialogA11y({ dlg: dialog });
        const formBody = dialog.element.querySelector("#lv-energy-form-body") as HTMLElement;
        const grid = document.createElement("div");
        grid.className = "lv-diag-grid";
        const controls: Record<string, HTMLInputElement | HTMLSelectElement> = {};
        const fieldErrors: Record<string, HTMLSpanElement> = {};

        const clearFieldErrors = () => {
            for (const [key, control] of Object.entries(controls)) {
                control.removeAttribute("aria-invalid");
                control.removeAttribute("aria-describedby");
                fieldErrors[key]?.replaceChildren();
            }
        };
        const markFieldError = (key: string, message: string): boolean => {
            const control = controls[key];
            if (!control) return false;
            control.setAttribute("aria-invalid", "true");
            const error = fieldErrors[key];
            if (error) {
                error.textContent = message;
                control.setAttribute("aria-describedby", error.id);
            }
            return true;
        };

        const field = (key: string, type: "date" | "number" | "text" | "select", opts?: string[]) => {
            const label = document.createElement("label");
            label.className = "lv-dialog-col";
            const caption = document.createElement("span"); caption.className = "ft__on-surface"; caption.textContent = t(`fuel.field.${key}`);
            const input = type === "select" ? document.createElement("select") : document.createElement("input");
            input.className = type === "select" ? "b3-select" : "b3-text-field";
            if (input instanceof HTMLInputElement) {
                input.type = type;
                if (type === "number") { input.step = key === "odometer" || key === "quantity" ? "0.1" : "0.01"; input.min = "0"; }
                if (type === "date" && key === "date") input.value = localDateKey(new Date());
            } else {
                input.append(new Option(t("fuel.chooseOptional"), ""));
                for (const value of opts ?? []) input.append(new Option(t(`fuel.option.${value}`), value));
            }
            controls[key] = input;
            const error = document.createElement("span");
            error.id = `lv-energy-${key}-error`;
            error.className = "lv-field-error lv-tx-danger";
            error.setAttribute("role", "alert");
            fieldErrors[key] = error;
            input.addEventListener("input", () => {
                input.removeAttribute("aria-invalid");
                input.removeAttribute("aria-describedby");
                error.replaceChildren();
            });
            label.append(caption, input, error);
            grid.appendChild(label);
        };

        field("date", "date");
        field("odometer", "number");
        const odometerInput = controls.odometer as HTMLInputElement;
        const currentOdometer = rawFromValueFn("number", row.cells[ref.columns!.mileage ?? ""]);
        if (currentOdometer !== "") odometerInput.value = String(currentOdometer);
        field("quantity", "number");
        if (isFuel) field("fuelGrade", "select", ["92", "95", "98", "0", "diesel", "other"]);
        else field("chargingMode", "select", ["ac", "dc", "other"]);
        field("unitPrice", "number");
        field("totalCost", "number");
        field("station", "text");
        field("note", "text");
        formBody.appendChild(grid);

        if (existing) {
            for (const key of ["date", "odometer", "quantity", "unitPrice", "totalCost", "fuelGrade", "chargingMode", "station", "note"]) {
                if (!(key in controls)) continue;
                const value = (existing as any)[key];
                if (value !== undefined && value !== null) (controls[key] as HTMLInputElement | HTMLSelectElement).value = String(value);
            }
        }

        const fullLabel = document.createElement("label");
        fullLabel.className = "lv-dialog-row__left lv-mt-10";
        const full = document.createElement("input"); full.type = "checkbox"; full.className = "b3-switch";
        full.checked = existing?.full === true;
        const fullText = document.createElement("span"); fullText.textContent = t(isFuel ? "fuel.fullTank" : "fuel.fullCharge");
        fullLabel.append(full, fullText);
        formBody.appendChild(fullLabel);

        const formHint = document.createElement("p");
        formHint.className = "ft__on-surface lv-caption lv-mt-10";
        formHint.textContent = t("fuel.formHint");
        formBody.appendChild(formHint);

        const cancel = dialog.element.querySelector("#lv-energy-cancel") as HTMLButtonElement;
        const save = dialog.element.querySelector("#lv-energy-save") as HTMLButtonElement;
        cancel.onclick = () => dialog.destroy();
        save.onclick = async () => {
            clearFieldErrors();
            const date = (controls.date as HTMLInputElement).value;
            const odometer = Number((controls.odometer as HTMLInputElement).value);
            const quantity = Number((controls.quantity as HTMLInputElement).value);
            const priceText = (controls.unitPrice as HTMLInputElement).value.trim();
            const costText = (controls.totalCost as HTMLInputElement).value.trim();
            const unitPrice = priceText ? Number(priceText) : undefined;
            const totalCost = costText ? Number(costText) : undefined;

            const invalid: string[] = [];
            if (!date) invalid.push("date");
            if (!Number.isFinite(odometer) || odometer <= 0) invalid.push("odometer");
            if (!Number.isFinite(quantity) || quantity <= 0) invalid.push("quantity");
            if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) invalid.push("unitPrice");
            if (totalCost !== undefined && (!Number.isFinite(totalCost) || totalCost < 0)) invalid.push("totalCost");
            if (invalid.length) {
                const first = invalid[0];
                for (const key of invalid) markFieldError(key, t("fuel.invalidField").replace("${field}", t(`fuel.field.${key}`)));
                (controls[first] as HTMLElement)?.focus();
                showMessageFn(t("fuel.invalidRecord"), 4000, "error");
                return;
            }
            save.disabled = true;
            cancel.disabled = true;
            try {
                const entry: EnergyRecord = {
                    kind, date, odometer, quantity, full: full.checked,
                    ...(unitPrice !== undefined ? { unitPrice } : {}),
                    ...(totalCost !== undefined ? { totalCost } : {}),
                    ...(isFuel && (controls.fuelGrade as HTMLSelectElement).value ? { fuelGrade: (controls.fuelGrade as HTMLSelectElement).value } : {}),
                    ...(!isFuel && (controls.chargingMode as HTMLSelectElement).value ? { chargingMode: (controls.chargingMode as HTMLSelectElement).value as EnergyRecord["chargingMode"] } : {}),
                    ...((controls.station as HTMLInputElement).value.trim() ? { station: (controls.station as HTMLInputElement).value.trim() } : {}),
                    ...((controls.note as HTMLInputElement).value.trim() ? { note: (controls.note as HTMLInputElement).value.trim() } : {}),
                };
                const logKind = kind === "fuel" ? "fuelings" : "chargings";
                const next = await updateRowLogs(plugin, (latest) => {
                    const base = existing ? removeEntry(latest, ref.avId!, row.itemID, logKind, existing as unknown as Record<string, unknown>) : latest;
                    return appendEntry(base, ref.avId!, row.itemID, logKind, { ...entry, at: new Date().toISOString() });
                });
                logs = next;
                dialog.destroy();
                renderEnergy();
                if (onLogUpdated) await onLogUpdated();
                showMessageFn(t(existing ? "fuel.updated" : "fuel.saved"), 2500, "info");
            } catch (error) {
                showMessageFn(t("ledger.logSaveFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 6000, "error");
                save.disabled = false;
                cancel.disabled = false;
            }
        };
    }

    function renderEnergy() {
        const mk = (tag: string, cls = "", text = "") => {
            const el = document.createElement(tag);
            if (cls) el.className = cls;
            if (text) el.textContent = text;
            return el;
        };
        const mkSvg = (tag: string, attrs: Record<string, string | number>) => {
            const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
            return el;
        };

        energyWrap.replaceChildren(hint);
        energyWrap.appendChild(mk("h3", "lv-h3-title", t("fuel.sectionTitle")));
        energyWrap.appendChild(mk("div", "lv-record-next lv-caption lv-mb-10", t(isHybridVehicle ? "fuel.hybridHint" : "fuel.separateEnergyHint")));

        for (const kind of energyKinds) {
            const isFuel = kind === "fuel";
            const records = entriesFor(kind);
            const stats = calculateEnergyStats(records, kind);
            const section = mk("section", "lv-card lv-dialog-card");
            const head = mk("div", "lv-domain-head");
            const heading = mk("b", "", t(isFuel ? "fuel.fuelTitle" : "fuel.chargingTitle"));
            const add = mk("button", "b3-button b3-button--outline", `+ ${t(isFuel ? "fuel.addFuel" : "fuel.addCharging")}`) as HTMLButtonElement;
            add.dataset.lvVehicleAction = kind;
            add.onclick = () => openEnergyForm(kind);
            head.append(heading, add);
            section.appendChild(head);

            const statsGrid = mk("div", "lv-diag-grid");
            const metric = (label: string, value: string) => {
                const box = mk("div", "lv-diag-stat-card");
                box.append(mk("span", "ft__on-surface lv-caption", label), mk("b", "lv-metric-val", value));
                statsGrid.appendChild(box);
            };
            const unit = isFuel ? "L" : "kWh";
            const average = stats.consumptionPer100Km === undefined ? "—" : `${compactNumber(stats.consumptionPer100Km)} ${unit}/100km`;
            const costPerKm = isHybridVehicle ? t("fuel.hybridNoRate") : stats.costPer100Km === undefined ? "—" : `${formatAmount(stats.costPer100Km / 100)} ${t("fuel.currencyPerKm")}`;
            metric(t("fuel.avgConsumption"), isHybridVehicle ? `${formatAmount(stats.totalQuantity)} ${unit} · ${t("fuel.totalRecorded")}` : `${average}${stats.method === "estimated" && stats.intervals.length ? ` · ${t("fuel.estimated")}` : ""}`);
            metric(t("fuel.avgCostPerKm"), costPerKm);
            metric(t("fuel.totalSpent"), stats.costRecordCount === 0 ? t("fuel.costUnknown") : `${formatAmount(stats.totalCost)} ${t("fuel.currency")}${stats.costRecordCount < stats.recordCount ? ` · ${t("fuel.subtotal")}` : ""}`);
            if (!isHybridVehicle) metric(t("fuel.totalDistance"), `${formatAmount(stats.totalDistance)} ${t("fuel.km")}`);
            section.appendChild(statsGrid);
            if (stats.warnings.includes("non_increasing_odometer")) {
                section.appendChild(mk("div", "lv-record-error lv-record-warning lv-caption lv-mt-8", t("fuel.odometerWarning")));
            }
            if (stats.warnings.includes("incomplete_initial_interval") || stats.warnings.includes("incomplete_latest_interval")) {
                section.appendChild(mk("div", "ft__on-surface lv-caption lv-mt-6", t("fuel.boundaryWarning")));
            }

            const intervals = stats.intervals.slice(-8);
            if (!isHybridVehicle && intervals.length) {
                const chartTitle = mk("div", "ft__on-surface lv-caption lv-mt-10", t("fuel.trendTitle"));
                const svg = mkSvg("svg", { viewBox: "0 0 300 76", width: "100%", height: 76, role: "img", "aria-label": t("fuel.trendTitle") });
                const values = intervals.map((item) => item.consumptionPer100Km);
                const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
                const pts = values.map((value, index) => ({
                    x: 12 + index * (276 / Math.max(1, values.length - 1)),
                    y: 62 - ((value - min) / range) * 46,
                }));
                const bezierPath = pointsToSmoothBezierPath(pts);
                const areaPath = pointsToAreaBezierPath(pts, 68);

                const defs = mkSvg("defs", {});
                defs.innerHTML = `<linearGradient id="lv-fuel-curve-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--lv-accent)" stop-opacity="0.25"/><stop offset="100%" stop-color="var(--lv-accent)" stop-opacity="0.0"/></linearGradient>`;
                svg.appendChild(defs);

                if (areaPath) {
                    svg.appendChild(mkSvg("path", { d: areaPath, fill: "url(#lv-fuel-curve-grad)" }));
                }

                svg.appendChild(mkSvg("path", { d: bezierPath, fill: "none", stroke: "var(--lv-accent)", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
                for (const [index, interval] of intervals.entries()) {
                    const dot = mkSvg("circle", {
                        cx: 12 + index * (276 / Math.max(1, intervals.length - 1)),
                        cy: 62 - ((interval.consumptionPer100Km - min) / range) * 46,
                        r: 3.5,
                        fill: "var(--lv-accent)",
                    });
                    const tip = mkSvg("title", {});
                    tip.textContent = `${interval.toDate} · ${compactNumber(interval.consumptionPer100Km)} ${unit}/100km`;
                    dot.appendChild(tip);
                    svg.appendChild(dot);
                }
                section.append(chartTitle, svg);
            } else if (!isHybridVehicle) {
                const guidance = document.createElement("div"); guidance.className = "ft__on-surface lv-caption lv-mt-8";
                guidance.textContent = t(records.length ? "fuel.baselineHint" : "fuel.emptyHint");
                section.appendChild(guidance);
            }

            const monthlyCosts = new Map<string, { amount: number; count: number }>();
            for (const entry of records) {
                const amount = typeof entry.totalCost === "number" && Number.isFinite(entry.totalCost)
                    ? entry.totalCost
                    : typeof entry.unitPrice === "number" && Number.isFinite(entry.unitPrice) ? entry.quantity * entry.unitPrice : undefined;
                if (amount === undefined) continue;
                const month = entry.date.slice(0, 7);
                const current = monthlyCosts.get(month) ?? { amount: 0, count: 0 };
                current.amount += amount; current.count += 1; monthlyCosts.set(month, current);
            }
            const monthRows = [...monthlyCosts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
            if (monthRows.length) {
                const monthlyTitle = mk("div", "ft__on-surface lv-caption lv-mt-10", t("fuel.monthlyCostTrend"));
                const monthly = mk("div", "lv-monthly-bar-chart");
                const maxSpend = Math.max(...monthRows.map(([, v]) => v.amount), 1);
                for (const [month, value] of monthRows) {
                    const column = mk("div", "lv-monthly-col");
                    const amount = mk("span", "ft__on-surface lv-monthly-amount", formatAmount(value.amount));
                    amount.title = `${month} · ${formatAmount(value.amount)} ${t("fuel.currency")} · ${value.count}`;
                    const bar = mk("i", "lv-monthly-bar");
                    bar.style.height = `${Math.max(4, (value.amount / maxSpend) * 52)}px`;
                    column.append(amount, bar, mk("span", "lv-monthly-label", month.slice(5)));
                    monthly.appendChild(column);
                }
                section.append(monthlyTitle, monthly, mk("div", "ft__on-surface lv-caption lv-mt-3", t("fuel.monthlyCostHint")));
            }

            section.appendChild(mk("div", "ft__on-surface lv-caption lv-mt-10", `${t("fuel.historyTitle")} · ${records.length}`));
            const recent = [...records].reverse().slice(0, 5);
            if (activityTarget?.activityId) {
                const targetEntry = records.find((entry) => rowLogActivityId(active, row.itemID, kind === "fuel" ? "fuelings" : "chargings", entry as unknown as Record<string, unknown>) === activityTarget.activityId);
                if (targetEntry && !recent.includes(targetEntry)) recent.push(targetEntry);
            }
            if (!recent.length) {
                const empty = mk("div", "ft__on-surface", t("fuel.noRecords"));
                empty.style.fontSize = "12px";
                section.appendChild(empty);
            }
            for (const entry of recent) {
                const line = mk("div", "lv-vehicle-log-row");
                line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, kind === "fuel" ? "fuelings" : "chargings", entry as unknown as Record<string, unknown>);
                if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);

                const volume = `${compactNumber(entry.quantity)} ${unit}`;
                const type = isFuel ? (entry.fuelGrade ? t(`fuel.option.${entry.fuelGrade}`) : "") : (entry.chargingMode ? t(`fuel.option.${entry.chargingMode}`) : "");
                const price = typeof entry.totalCost === "number" ? `${formatAmount(entry.totalCost)} ${t("fuel.currency")}` : typeof entry.unitPrice === "number" ? `${compactNumber(entry.unitPrice)} ${t("fuel.unitPrice")}` : t("fuel.costUnknown");
                const descText = `${entry.date} · ${volume}${type ? ` · ${type}` : ""} · ${formatAmount(entry.odometer)} ${t("fuel.km")}${entry.full ? ` · ${t(isFuel ? "fuel.fullTankShort" : "fuel.fullChargeShort")}` : ""} · ${price}${entry.station ? ` · ${entry.station}` : ""}`;
                const desc = mk("span", "lv-flex-wrap-anywhere", descText);
                const del = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("delete")) as HTMLButtonElement;
                const edit = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("members.edit")) as HTMLButtonElement;
                edit.onclick = () => openEnergyForm(kind, entry);
                del.onclick = () => confirm(t("fuel.deleteEntry"), t("fuel.deleteEntryConfirm"), async () => {
                    del.disabled = true;
                    try {
                        const next = await updateRowLogs(plugin, (latest) => removeEntry(latest, ref.avId!, row.itemID, kind === "fuel" ? "fuelings" : "chargings", entry as unknown as Record<string, unknown>));
                        logs = next; renderEnergy();
                        if (onLogUpdated) await onLogUpdated();
                    } catch (error) {
                        del.disabled = false;
                        showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error");
                    }
                });
                line.append(desc, edit, del);
                section.appendChild(line);
            }
            energyWrap.appendChild(section);
            // 必须在 section 已挂入 energyWrap（处于 body 树内）之后再注册快捷动作，
            // 否则从车辆卡片点击“记加油/记充电”进入抽屉时 body.contains(add) 为 false 会直接丢弃请求！
            registerVehicleAction(kind, add);
        }
    }
    renderEnergy();
}
