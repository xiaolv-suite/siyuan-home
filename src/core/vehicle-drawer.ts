/**
 * 车辆详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，大幅瘦身巨石组件）
 * 包含：
 * 1. 车辆全寿命费用总览卡片 (addVehicleCostSummarySection)
 * 2. 能源能耗流水、贝塞尔平滑S走势图与月度支出直方图 (addVehicleEnergySection)
 * 3. 维护保养/维修记录、分类支出统计与到期提醒 (addVehicleMaintenanceSection)
 */

import { loadRowLogs, updateRowLogs, getEntries, appendEntry, removeEntry } from "./rowlog";
import { bindDialogA11y } from "./dialog-a11y";
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

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};

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
        requestAnimationFrame(() => {
            if (!line.isConnected) return;
            line.scrollIntoView({ block: "center", behavior: (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth" });
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
        wrap.className = "lv-detail-section lv-domain-sec";
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

        wrap.appendChild(mk("h3", "lv-h3-title", t("vehicle.summary.title")));
        wrap.appendChild(mk("div", "ft__on-surface lv-caption lv-mb-10", t("vehicle.summary.hint")));

        const grid = mk("div", "lv-diag-grid");
        const metric = (label: string, value: string) => {
            const box = mk("div", "lv-diag-stat-card");
            box.append(mk("span", "ft__on-surface lv-caption", label), mk("b", "lv-metric-val", value));
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
            wrap.appendChild(mk("div", "ft__on-surface lv-caption lv-mt-6", t("vehicle.summary.incomplete")));
        }

        const reminders: string[] = [];
        if (summary.maintenance.nextDate) reminders.push(`${t("vehicle.maintenance.nextDateShort")} ${summary.maintenance.nextDate}`);
        if (summary.maintenance.nextOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.nextOdometerShort")} ${formatAmount(summary.maintenance.nextOdometer)} ${t("fuel.km")}`);
        if (summary.maintenance.overdueDate) reminders.push(`${t("vehicle.maintenance.overdueDate")} ${summary.maintenance.overdueDate}`);
        if (summary.maintenance.overdueOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.overdueOdometer")} ${formatAmount(summary.maintenance.overdueOdometer)} ${t("fuel.km")}`);
        if (reminders.length) {
            wrap.appendChild(mk("div", "lv-record-next lv-caption lv-mt-6", `${t("vehicle.summary.nextAction")}：${reminders.join(" · ")}`));
        }
    }

    // 3. 维护保养板块
    async function addVehicleMaintenanceSection() {
        const wrap = document.createElement("section");
        wrap.id = "lv-vehicle-maintenance";
        wrap.className = "lv-detail-section lv-domain-sec";
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
                content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-maintenance-form"></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-maintenance-cancel">${t("cancel")}</button><span class="fn__flex-1"></span><button class="b3-button" id="lv-maintenance-save">${t(existing ? "vehicle.maintenance.update" : "save")}</button></div>`,
                width: "560px",
            });
            bindDialogA11y({ dlg: dialog });
            const formBody = dialog.element.querySelector("#lv-maintenance-form") as HTMLElement;
            const grid = document.createElement("div");
            grid.className = "lv-diag-grid";
            const controls: Record<string, HTMLInputElement | HTMLSelectElement> = {};
            const fieldErrors: Record<string, HTMLSpanElement> = {};
            const field = (key: string, type: "date" | "number" | "text" | "select", opts?: string[]) => {
                const label = document.createElement("label");
                label.className = "lv-form-group";
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
            const head = mk("div", "lv-domain-head");
            const title = mk("h3", "lv-h3-title", t("vehicle.maintenance.title"));
            const add = mk("button", "b3-button b3-button--outline", `+ ${t("vehicle.maintenance.add")}`) as HTMLButtonElement;
            add.dataset.lvVehicleAction = "maintenance";
            add.onclick = () => openForm();
            head.append(title, add);
            wrap.appendChild(head);
            registerVehicleAction("maintenance", add);
            const stats = calculateMaintenanceStats(records, new Date().toISOString().slice(0, 10), Number.isFinite(currentOdometer) ? currentOdometer : undefined);
            const summary = mk("div", "lv-diag-grid lv-mb-10");
            const metric = (label: string, value: string) => {
                const box = mk("div", "lv-diag-stat-card");
                box.append(mk("span", "ft__on-surface lv-caption", label), mk("b", "lv-metric-val", value));
                summary.appendChild(box);
            };
            metric(t("vehicle.maintenance.totalRecords"), String(stats.recordCount));
            metric(t("vehicle.maintenance.totalCost"), stats.costRecordCount ? formatMoney(stats.totalCost) : t("fuel.costUnknown"));
            metric(t("vehicle.maintenance.nextDate"), stats.nextDate ?? "—");
            metric(t("vehicle.maintenance.nextOdometer"), stats.nextOdometer === undefined ? "—" : `${formatAmount(stats.nextOdometer)} ${t("fuel.km")}`);
            if (stats.overdueDate) metric(t("vehicle.maintenance.overdueDate"), stats.overdueDate);
            if (stats.overdueOdometer !== undefined) metric(t("vehicle.maintenance.overdueOdometer"), `${formatAmount(stats.overdueOdometer)} ${t("fuel.km")}`);
            wrap.appendChild(summary);
            const byCategory = Object.entries(stats.byCategory);
            if (byCategory.length) {
                wrap.appendChild(mk("div", "ft__on-surface lv-caption lv-mb-10", `${t("vehicle.maintenance.byCategory")}：${byCategory.map(([key, value]) => `${categoryLabel(key)} ${value.count}${value.cost ? ` · ${formatMoney(value.cost)}` : ""}`).join(" · ")}`));
            }
            if (!records.length) {
                wrap.appendChild(mk("div", "ft__on-surface lv-caption", t("vehicle.maintenance.empty")));
                return;
            }
            const recentRecords = [...records].reverse().slice(0, 8);
            if (activityTarget?.activityId) {
                const targetEntry = records.find((entry) => rowLogActivityId(active, row.itemID, "maintenance", entry as unknown as Record<string, unknown>) === activityTarget.activityId);
                if (targetEntry && !recentRecords.includes(targetEntry)) recentRecords.push(targetEntry);
            }
            for (const entry of recentRecords) {
                const line = mk("div", "lv-vehicle-log-row");
                line.dataset.lvActivityId = rowLogActivityId(active, row.itemID, "maintenance", entry as unknown as Record<string, unknown>);
                if (line.dataset.lvActivityId === activityTarget?.activityId) markActivityLine(line);
                const descText = `${entry.date} · ${categoryLabel(entry.category)} · ${formatAmount(entry.odometer)} ${t("fuel.km")}${entry.cost !== undefined ? ` · ${formatMoney(entry.cost)}` : ""}${entry.shop ? ` · ${entry.shop}` : ""}${entry.nextDate ? ` · ${t("vehicle.maintenance.nextDateShort")} ${entry.nextDate}` : ""}${entry.nextOdometer !== undefined ? ` · ${t("vehicle.maintenance.nextOdometerShort")} ${formatAmount(entry.nextOdometer)}` : ""}`;
                const desc = mk("span", "lv-flex-wrap-anywhere", descText);
                const edit = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("members.edit")) as HTMLButtonElement;
                edit.onclick = () => openForm(entry);
                const del = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("delete")) as HTMLButtonElement;
                del.onclick = () => confirm(t("vehicle.maintenance.delete"), t("vehicle.maintenance.deleteConfirm"), async () => {
                    del.disabled = true;
                    try {
                        const next = await updateRowLogs(plugin, (latest) => removeEntry(latest, ref.avId!, row.itemID, "maintenance", entry as unknown as Record<string, unknown>));
                        records = getEntries<MaintenanceRecord>(next, ref.avId!, row.itemID, "maintenance");
                        render();
                        if (onLogUpdated) await onLogUpdated();
                    } catch (error) {
                        del.disabled = false;
                        showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error");
                    }
                });
                line.append(desc, edit, del);
                wrap.appendChild(line);
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
