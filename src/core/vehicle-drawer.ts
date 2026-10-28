/**
 * 车辆详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，大幅瘦身巨石组件）
 * 包含：
 * 1. 车辆全寿命费用总览卡片 (addVehicleCostSummarySection)
 * 2. 能源能耗流水、贝塞尔平滑S走势图与月度支出直方图 (addVehicleEnergySection)
 * 3. 维护保养/维修记录、分类支出统计与到期提醒 (addVehicleMaintenanceSection)
 */

import { loadRowLogs, updateRowLogs, getEntries, appendEntry, removeEntry } from "./rowlog";
import type { EnergyRecord } from "./fuel";
import { renderVehicleEnergySection } from "./vehicle-energy-section";
import {
    calculateMaintenanceStats,
    calculateVehicleCostSummary,
    type MaintenanceRecord,
    type VehicleQuickAction,
} from "./vehicle";
import { rowLogActivityId, type ActivityTarget } from "./activity";
import { formatAmount } from "./format";
import { localDateKey } from "./hub/rule";
import { confirm } from "@/libs/dialog";

export interface VehicleDetailDrawerOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any, key?: string) => string;
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

const wrapBorderCss = "margin-top:14px;padding-top:10px;border-top:1px solid var(--lv-line)";
const h3TitleCss = "font-size:14px;margin:0 0 6px";
const statsGrid112Css = "display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px";
const subCardBoxCss = "min-width:0;padding:8px;border-radius:8px;background:var(--lv-surface-2);border:1px solid var(--lv-line)";
const subCardValCss = "font-size:14px;overflow-wrap:anywhere";
const sectionHeaderCss = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px";
const logItemRowCss = "display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:6px 0;border-top:1px solid var(--lv-line);font-size:12px;flex-wrap:wrap";
const btnActionSmCss = "padding:2px 4px;font-size:12px";
const fieldErrCss = "font-size:11px;color:var(--lv-danger);line-height:1.4";
const fs11Lh16Css = "font-size:11px;line-height:1.6";
const cap11Mb3Css = "display:block;font-size:11px;margin-bottom:3px";
const flex1Min180Css = "flex:1;min-width:180px;overflow-wrap:anywhere";

export async function renderVehicleDetailSections(options: VehicleDetailDrawerOptions): Promise<void> {
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
        cellTextFn,
        selectContentFn,
        rawFromValueFn,
        activityTarget,
        vehicleActionQueue,
        onLogUpdated,
    } = options;

    if (active !== "vehicles" || !ref?.avId || !ref.columns) return;

    const showVehicleActionError = (error: string) =>
        showMessageFn(t("ledger.logReadFailed") + " (" + error + ")", 6000, "error");

    const failVehicleActions = (actions: readonly VehicleQuickAction[], error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        for (const action of actions) vehicleActionQueue.fail(action, detail);
        showVehicleActionError(detail);
    };

    const markActivityLine = (line: HTMLElement) => {
        if (!activityTarget?.activityId) return;
        line.classList.add("lv-activity-target");
        line.setAttribute("aria-current", "location");
        line.tabIndex = -1;
        line.style.cssText += ";border-radius:6px;background:var(--lv-accent-soft);outline:2px solid var(--lv-accent);outline-offset:2px;padding:7px";
        requestAnimationFrame(() => {
            if (!line.isConnected) return;
            line.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            line.focus({ preventScroll: true });
        });
    };

    const registerVehicleAction = (action: VehicleQuickAction, target: HTMLButtonElement) => {
        vehicleActionQueue.register(action, () => {
            if (!body.contains(target)) return;
            target.click();
            target.scrollIntoView({ block: "nearest" });
        });
    };

    // 1. 车辆全寿命费用总览
    async function addVehicleCostSummarySection() {
        const wrap = document.createElement("section");
        wrap.style.cssText = wrapBorderCss;
        body.appendChild(wrap);
        const logs = await loadRowLogs(plugin);
        const fuelRecords = getEntries<EnergyRecord>(logs, ref.avId!, row.itemID, "fuelings");
        const chargingRecords = getEntries<EnergyRecord>(logs, ref.avId!, row.itemID, "chargings");
        const maintenanceRecords = getEntries<MaintenanceRecord>(logs, ref.avId!, row.itemID, "maintenance");
        const currentOdometer = Number(cellTextFn(row.cells[ref.columns!.mileage ?? ""], "mileage"));
        const summary = calculateVehicleCostSummary(
            fuelRecords,
            chargingRecords,
            maintenanceRecords,
            new Date().toISOString().slice(0, 10),
            Number.isFinite(currentOdometer) ? currentOdometer : undefined
        );

        const title = document.createElement("h3");
        title.style.cssText = h3TitleCss;
        title.textContent = t("vehicle.summary.title");
        wrap.appendChild(title);

        const hint = document.createElement("div");
        hint.className = "ft__on-surface";
        hint.style.cssText = "font-size:11px;line-height:1.5;margin:0 0 8px";
        hint.textContent = t("vehicle.summary.hint");
        wrap.appendChild(hint);

        const grid = document.createElement("div");
        grid.style.cssText = statsGrid112Css;
        const metric = (label: string, value: string) => {
            const box = document.createElement("div");
            box.style.cssText = subCardBoxCss;
            const cap = document.createElement("span");
            cap.className = "ft__on-surface";
            cap.style.cssText = cap11Mb3Css;
            cap.textContent = label;
            const val = document.createElement("b");
            val.style.cssText = subCardValCss;
            val.textContent = value;
            box.append(cap, val);
            grid.appendChild(box);
        };

        const money = (amount: number) => `${formatAmount(amount)} ${t("fuel.currency")}`;
        const costLabel = (records: number, known: number, amount: number) =>
            records === 0 ? "—" : known === 0 ? t("fuel.costUnknown") : `${money(amount)}${known < records ? ` · ${t("fuel.subtotal")}` : ""}`;
        const knownCosts = summary.fuel.costRecordCount + summary.charging.costRecordCount + summary.maintenance.costRecordCount;

        metric(t("vehicle.summary.totalCost"), summary.eventCount === 0 ? "—" : knownCosts === 0 ? t("fuel.costUnknown") : `${money(summary.totalCost)}${!summary.costComplete ? ` · ${t("fuel.subtotal")}` : ""}`);
        metric(t("vehicle.summary.fuelCost"), costLabel(summary.fuel.recordCount, summary.fuel.costRecordCount, summary.fuelCost));
        metric(t("vehicle.summary.chargingCost"), costLabel(summary.charging.recordCount, summary.charging.costRecordCount, summary.chargingCost));
        metric(t("vehicle.summary.maintenanceCost"), costLabel(summary.maintenance.recordCount, summary.maintenance.costRecordCount, summary.maintenanceCost));
        metric(t("vehicle.summary.eventCount"), String(summary.eventCount));
        metric(t("vehicle.summary.latestEvent"), summary.latestDate ?? "—");
        wrap.appendChild(grid);

        if (summary.eventCount && !summary.costComplete) {
            const incomplete = document.createElement("div");
            incomplete.className = "ft__on-surface";
            incomplete.style.cssText = "font-size:10px;line-height:1.5;margin-top:6px";
            incomplete.textContent = t("vehicle.summary.incomplete");
            wrap.appendChild(incomplete);
        }

        const reminders: string[] = [];
        if (summary.maintenance.nextDate) reminders.push(`${t("vehicle.maintenance.nextDateShort")} ${summary.maintenance.nextDate}`);
        if (summary.maintenance.nextOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.nextOdometerShort")} ${formatAmount(summary.maintenance.nextOdometer)} ${t("fuel.km")}`);
        if (summary.maintenance.overdueDate) reminders.push(`${t("vehicle.maintenance.overdueDate")} ${summary.maintenance.overdueDate}`);
        if (summary.maintenance.overdueOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.overdueOdometer")} ${formatAmount(summary.maintenance.overdueOdometer)} ${t("fuel.km")}`);
        if (reminders.length) {
            const reminder = document.createElement("div");
            reminder.className = "lv-record-next";
            reminder.style.cssText = `${fs11Lh16Css};margin-top:6px`;
            reminder.textContent = `${t("vehicle.summary.nextAction")}：${reminders.join(" · ")}`;
            wrap.appendChild(reminder);
        }
    }

    // 3. 维护保养板块
    async function addVehicleMaintenanceSection() {
        const wrap = document.createElement("section");
        wrap.id = "lv-vehicle-maintenance";
        wrap.style.cssText = wrapBorderCss;
        body.appendChild(wrap);
        let records = getEntries<MaintenanceRecord>(await loadRowLogs(plugin), ref.avId!, row.itemID, "maintenance");
        const categoryLabel = (category: string) => {
            const key = `vehicle.maintenance.category.${category}`;
            return t(key) === key ? category : t(key);
        };
        const currentOdometer = Number(cellTextFn(row.cells[ref.columns!.mileage ?? ""], "mileage"));
        const formatMoney = (value: number) => `${formatAmount(value)} ${t("fuel.currency")}`;

        const openForm = (existing?: MaintenanceRecord) => {
            const dialog = new DialogCls({
                title: t(existing ? "vehicle.maintenance.edit" : "vehicle.maintenance.add"),
                content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-maintenance-form" style="max-height:65vh;overflow:auto"></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-maintenance-cancel">${t("cancel")}</button><span style="flex:1"></span><button class="b3-button" id="lv-maintenance-save">${t(existing ? "vehicle.maintenance.update" : "save")}</button></div>`,
                width: "560px",
            });
            const formBody = dialog.element.querySelector("#lv-maintenance-form") as HTMLElement;
            const grid = document.createElement("div");
            grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px 8px";
            const controls: Record<string, HTMLInputElement | HTMLSelectElement> = {};
            const fieldErrors: Record<string, HTMLSpanElement> = {};
            const field = (key: string, type: "date" | "number" | "text" | "select", opts?: string[]) => {
                const label = document.createElement("label");
                label.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px";
                const caption = document.createElement("span"); caption.className = "ft__on-surface"; caption.textContent = t(`vehicle.maintenance.field.${key}`);
                const input = type === "select" ? document.createElement("select") : document.createElement("input");
                input.className = type === "select" ? "b3-select" : "b3-text-field";
                if (input instanceof HTMLInputElement) {
                    input.type = type;
                    if (type === "number") input.min = "0";
                    if (type === "date" && key === "date") input.value = localDateKey(new Date());
                } else {
                    for (const value of opts ?? []) input.append(new Option(categoryLabel(value), value));
                }
                controls[key] = input;
                const error = document.createElement("span");
                error.id = `lv-maintenance-${key}-error`;
                error.className = "lv-field-error";
                error.setAttribute("role", "alert");
                error.style.cssText = fieldErrCss;
                fieldErrors[key] = error;
                input.addEventListener("input", () => {
                    input.removeAttribute("aria-invalid");
                    input.removeAttribute("aria-describedby");
                    error.replaceChildren();
                });
                label.append(caption, input, error);
                grid.appendChild(label);
            };

            const categories = ["routine", "repair", "tires", "battery", "inspection", "cleaning", "other"];
            field("category", "select", categories);
            field("date", "date");
            field("odometer", "number");
            const odometerInput = controls.odometer as HTMLInputElement;
            if (Number.isFinite(currentOdometer)) odometerInput.value = String(currentOdometer);
            field("cost", "number");
            field("nextDate", "date");
            field("nextOdometer", "number");
            field("shop", "text");
            field("note", "text");
            formBody.appendChild(grid);

            if (existing) {
                for (const key of ["category", "date", "odometer", "cost", "nextDate", "nextOdometer", "shop", "note"]) {
                    if (!(key in controls)) continue;
                    const value = (existing as any)[key];
                    if (value !== undefined && value !== null) (controls[key] as HTMLInputElement | HTMLSelectElement).value = String(value);
                }
            }

            const cancel = dialog.element.querySelector("#lv-maintenance-cancel") as HTMLButtonElement;
            const save = dialog.element.querySelector("#lv-maintenance-save") as HTMLButtonElement;
            cancel.onclick = () => dialog.destroy();
            save.onclick = async () => {
                const value = (key: string) => (controls[key] as HTMLInputElement | HTMLSelectElement).value.trim();
                for (const [key, control] of Object.entries(controls)) {
                    control.removeAttribute("aria-invalid");
                    control.removeAttribute("aria-describedby");
                    fieldErrors[key]?.replaceChildren();
                }
                const category = value("category");
                const date = value("date");
                const odometer = Number(value("odometer"));
                const costText = value("cost");
                const nextDate = value("nextDate");
                const nextOdometerText = value("nextOdometer");
                const invalid: string[] = [];
                if (!category) invalid.push("category");
                if (!date) invalid.push("date");
                if (!Number.isFinite(odometer) || !(odometer > 0)) invalid.push("odometer");
                if (costText !== "" && (!Number.isFinite(Number(costText)) || Number(costText) < 0)) invalid.push("cost");
                if (nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) invalid.push("nextDate");
                if (nextOdometerText !== "" && (!Number.isFinite(Number(nextOdometerText)) || !(Number(nextOdometerText) > 0))) invalid.push("nextOdometer");
                if (invalid.length) {
                    for (const key of invalid) {
                        const control = controls[key];
                        const error = fieldErrors[key];
                        if (control && error) {
                            control.setAttribute("aria-invalid", "true");
                            control.setAttribute("aria-describedby", error.id);
                            error.textContent = t("vehicle.maintenance.invalidField").replace("${field}", t(`vehicle.maintenance.field.${key}`));
                        }
                    }
                    (controls[invalid[0]] as HTMLElement | undefined)?.focus();
                    showMessageFn(t("vehicle.maintenance.invalid"), 3500, "error");
                    return;
                }
                save.disabled = true; cancel.disabled = true;
                const entry: MaintenanceRecord = {
                    category, date, odometer,
                    ...(costText === "" ? {} : { cost: Number(costText) }),
                    ...(nextDate ? { nextDate } : {}),
                    ...(nextOdometerText === "" ? {} : { nextOdometer: Number(nextOdometerText) }),
                    ...(value("shop") ? { shop: value("shop") } : {}),
                    ...(value("note") ? { note: value("note") } : {}),
                };
                try {
                    const next = await updateRowLogs(plugin, (latest) => {
                        const base = existing ? removeEntry(latest, ref.avId!, row.itemID, "maintenance", existing as unknown as Record<string, unknown>) : latest;
                        return appendEntry(base, ref.avId!, row.itemID, "maintenance", { ...entry, at: new Date().toISOString() });
                    });
                    records = getEntries<MaintenanceRecord>(next, ref.avId!, row.itemID, "maintenance");
                    dialog.destroy(); render();
                    if (onLogUpdated) await onLogUpdated();
                    showMessageFn(t(existing ? "vehicle.maintenance.updated" : "vehicle.maintenance.saved"), 2500, "info");
                } catch (error) {
                    showMessageFn(t("ledger.logSaveFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error");
                    save.disabled = false; cancel.disabled = false;
                }
            };
        };

        const render = () => {
            wrap.replaceChildren();
            const head = document.createElement("div"); head.style.cssText = sectionHeaderCss;
            const title = document.createElement("h3"); title.style.cssText = "font-size:14px;margin:0"; title.textContent = t("vehicle.maintenance.title");
            const add = document.createElement("button"); add.className = "b3-button b3-button--outline"; add.dataset.lvVehicleAction = "maintenance"; add.textContent = `+ ${t("vehicle.maintenance.add")}`; add.onclick = () => openForm();
            head.append(title, add); wrap.appendChild(head);
            registerVehicleAction("maintenance", add);
            const stats = calculateMaintenanceStats(records, new Date().toISOString().slice(0, 10), Number.isFinite(currentOdometer) ? currentOdometer : undefined);
            const summary = document.createElement("div"); summary.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px;margin-bottom:8px";
            const metric = (label: string, value: string) => { const box = document.createElement("div"); box.style.cssText = subCardBoxCss; const cap = document.createElement("span"); cap.className = "ft__on-surface"; cap.style.cssText = "display:block;font-size:11px;margin-bottom:3px"; cap.textContent = label; const val = document.createElement("b"); val.style.cssText = subCardValCss; val.textContent = value; box.append(cap, val); summary.appendChild(box); };
            metric(t("vehicle.maintenance.totalRecords"), String(stats.recordCount));
            metric(t("vehicle.maintenance.totalCost"), stats.costRecordCount ? formatMoney(stats.totalCost) : t("fuel.costUnknown"));
            metric(t("vehicle.maintenance.nextDate"), stats.nextDate ?? "—");
            metric(t("vehicle.maintenance.nextOdometer"), stats.nextOdometer === undefined ? "—" : `${formatAmount(stats.nextOdometer)} ${t("fuel.km")}`);
            if (stats.overdueDate) metric(t("vehicle.maintenance.overdueDate"), stats.overdueDate);
            if (stats.overdueOdometer !== undefined) metric(t("vehicle.maintenance.overdueOdometer"), `${formatAmount(stats.overdueOdometer)} ${t("fuel.km")}`);
            wrap.appendChild(summary);
            const byCategory = Object.entries(stats.byCategory);
            if (byCategory.length) { const line = document.createElement("div"); line.className = "ft__on-surface"; line.style.cssText = "font-size:11px;line-height:1.6;margin:0 0 6px"; line.textContent = `${t("vehicle.maintenance.byCategory")}：${byCategory.map(([key, value]) => `${categoryLabel(key)} ${value.count}${value.cost ? ` · ${formatMoney(value.cost)}` : ""}`).join(" · ")}`; wrap.appendChild(line); }
            if (!records.length) { const empty = document.createElement("div"); empty.className = "ft__on-surface"; empty.style.cssText = "font-size:12px;line-height:1.6"; empty.textContent = t("vehicle.maintenance.empty"); wrap.appendChild(empty); return; }
            const recentRecords = [...records].reverse().slice(0, 8);
            if (activityTarget?.activityId) {
                const targetEntry = records.find((entry) => rowLogActivityId(active, row.itemID, "maintenance", entry as unknown as Record<string, unknown>) === activityTarget.activityId);
                if (targetEntry && !recentRecords.includes(targetEntry)) recentRecords.push(targetEntry);
            }
            for (const entry of recentRecords) {
                const line = document.createElement("div"); line.style.cssText = logItemRowCss;
                line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, "maintenance", entry as unknown as Record<string, unknown>);
                if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);
                const desc = document.createElement("span"); desc.style.cssText = flex1Min180Css; desc.textContent = `${entry.date} · ${categoryLabel(entry.category)} · ${formatAmount(entry.odometer)} ${t("fuel.km")}${entry.cost !== undefined ? ` · ${formatMoney(entry.cost)}` : ""}${entry.shop ? ` · ${entry.shop}` : ""}${entry.nextDate ? ` · ${t("vehicle.maintenance.nextDateShort")} ${entry.nextDate}` : ""}${entry.nextOdometer !== undefined ? ` · ${t("vehicle.maintenance.nextOdometerShort")} ${formatAmount(entry.nextOdometer)}` : ""}`;
                const edit = document.createElement("button"); edit.className = "b3-button b3-button--text"; edit.style.cssText = btnActionSmCss; edit.textContent = t("members.edit"); edit.onclick = () => openForm(entry);
                const del = document.createElement("button"); del.className = "b3-button b3-button--text"; del.style.cssText = btnActionSmCss; del.textContent = t("delete"); del.onclick = () => confirm(t("vehicle.maintenance.delete"), t("vehicle.maintenance.deleteConfirm"), async () => { del.disabled = true; try { const next = await updateRowLogs(plugin, (latest) => removeEntry(latest, ref.avId!, row.itemID, "maintenance", entry as unknown as Record<string, unknown>)); records = getEntries<MaintenanceRecord>(next, ref.avId!, row.itemID, "maintenance"); render(); if (onLogUpdated) await onLogUpdated(); } catch (error) { del.disabled = false; showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error"); } });
                line.append(desc, edit, del); wrap.appendChild(line);
            }
        };
        render();
    }

    try {
        await addVehicleCostSummarySection();
    } catch (error) {
        showVehicleActionError(error instanceof Error ? error.message : String(error));
    }
    try {
        await renderVehicleEnergySection({
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
        });
    } catch (error) {
        failVehicleActions(["fuel", "charging"], error);
    }
    try {
        await addVehicleMaintenanceSection();
    } catch (error) {
        failVehicleActions(["maintenance"], error);
    }
}
