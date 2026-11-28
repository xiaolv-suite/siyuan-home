/**
 * 车辆详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，大幅瘦身巨石组件）
 * 包含：
 * 1. 车辆全寿命费用总览卡片 (addVehicleCostSummarySection)
 * 2. 能源能耗流水、贝塞尔平滑S走势图与月度支出直方图 (addVehicleEnergySection)
 * 3. 维护保养/维修记录、分类支出统计与到期提醒 (addVehicleMaintenanceSection)
 */

import { loadRowLogs, updateRowLogs, getEntries, appendEntry, removeEntry, type RowLogs } from "./rowlog";
import { recordHighFrequencyDiaryEvent, deleteDiaryEventWithTombstone, queryDiaryEventsFromSql } from "./diary-envelope";
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
    const isGuest = Boolean(plugin?.runtime?.guestModeActive);

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
    const costSummaryWrap = document.createElement("section");
    costSummaryWrap.id = "lv-vehicle-cost-summary";
    costSummaryWrap.className = "lv-detail-section lv-domain-sec";
    body.appendChild(costSummaryWrap);

    async function renderCostSummary(providedLogs?: RowLogs) {
        const logs = providedLogs ?? (await loadRowLogs(plugin));
        const fuelRecords = getEntries<EnergyRecord>(logs, ref.avId!, row.itemID, "fuelings");
        const chargingRecords = getEntries<EnergyRecord>(logs, ref.avId!, row.itemID, "chargings");
        const maintenanceRecords = getEntries<MaintenanceRecord>(logs, ref.avId!, row.itemID, "maintenance");
        const rowOdometer = Number(cellTextFn(row.cells[ref.columns!.mileage ?? ""], "mileage"));
        let effectiveOdometer = Number.isFinite(rowOdometer) ? rowOdometer : undefined;
        for (const rec of [...fuelRecords, ...chargingRecords, ...maintenanceRecords]) {
            if (typeof rec.odometer === "number" && Number.isFinite(rec.odometer)) {
                effectiveOdometer = effectiveOdometer === undefined ? rec.odometer : Math.max(effectiveOdometer, rec.odometer);
            }
        }
        const summary = calculateVehicleCostSummary(
            fuelRecords,
            chargingRecords,
            maintenanceRecords,
            localDateKey(),
            effectiveOdometer,
        );

        const nodes: HTMLElement[] = [
            mk("h3", "lv-h3-title", t("vehicle.summary.title")),
            mk("div", "ft__on-surface lv-caption lv-mb-10", t("vehicle.summary.hint")),
        ];

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
        nodes.push(grid);

        if (summary.eventCount && !summary.costComplete) {
            nodes.push(mk("div", "ft__on-surface lv-caption lv-mt-6", t("vehicle.summary.incomplete")));
        }

        const reminders: string[] = [];
        if (summary.maintenance.nextDate) reminders.push(`${t("vehicle.maintenance.nextDateShort")} ${summary.maintenance.nextDate}`);
        if (summary.maintenance.nextOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.nextOdometerShort")} ${formatAmount(summary.maintenance.nextOdometer)} ${t("fuel.km")}`);
        if (summary.maintenance.overdueDate) reminders.push(`${t("vehicle.maintenance.overdueDate")} ${summary.maintenance.overdueDate}`);
        if (summary.maintenance.overdueOdometer !== undefined) reminders.push(`${t("vehicle.maintenance.overdueOdometer")} ${formatAmount(summary.maintenance.overdueOdometer)} ${t("fuel.km")}`);
        if (reminders.length) {
            nodes.push(mk("div", "lv-record-next lv-caption lv-mt-6", `${t("vehicle.summary.nextAction")}：${reminders.join(" · ")}`));
        }

        if (typeof costSummaryWrap.replaceChildren === "function") {
            costSummaryWrap.replaceChildren(...nodes);
        } else {
            for (const n of nodes) costSummaryWrap.appendChild(n);
        }
    }

    const handleLogsUpdated = async (latestLogs?: RowLogs) => {
        await renderCostSummary(latestLogs);
        if (onLogUpdated) await onLogUpdated();
    };

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
            if (plugin?.runtime?.guestModeActive) {
                showMessageFn(t("guest.writeBlocked"), 3500, "info");
                return;
            }
            const dialog = new DialogCls({
                title: t(existing ? "vehicle.maintenance.edit" : "vehicle.maintenance.add"),
                content: `<div class="b3-dialog__content b3-dialog__content--wrap lv-dialog-scroll-body" id="lv-maintenance-form"></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-maintenance-cancel">${t("cancel")}</button><span class="fn__flex-1"></span><button class="b3-button" id="lv-maintenance-save">${t(existing ? "vehicle.maintenance.update" : "save")}</button></div>`,
                width: "min(560px, 94vw)",
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
                if (plugin?.runtime?.guestModeActive) {
                    showMessageFn(t("guest.writeBlocked"), 3500, "info");
                    return;
                }
                const value = (key: string) => (controls[key] as HTMLInputElement | HTMLSelectElement).value.trim();
                for (const [key, control] of Object.entries(controls)) {
                    control.removeAttribute("aria-invalid");
                    control.removeAttribute("aria-describedby");
                    fieldErrors[key]?.replaceChildren();
                }
                const category = value("category") || "routine";
                const date = value("date") || localDateKey(new Date());
                const odometerText = value("odometer");
                const odometer = odometerText ? Number(odometerText) : 0;
                const costText = value("cost");
                const nextDate = value("nextDate");
                const nextOdometerText = value("nextOdometer");
                const invalid: string[] = [];
                if (odometerText !== "" && (!Number.isFinite(odometer) || odometer < 0)) invalid.push("odometer");
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
                    const rawExisting = existing as unknown as Record<string, any> | undefined;
                    let diaryMeta: Record<string, string> = rawExisting?.diaryBlockId
                        ? {
                            ...(rawExisting.diaryEventId ? { diaryEventId: String(rawExisting.diaryEventId) } : {}),
                            diaryBlockId: String(rawExisting.diaryBlockId),
                            ...(rawExisting.diaryDocId ? { diaryDocId: String(rawExisting.diaryDocId) } : {}),
                        }
                        : {};
                    try {
                        if (rawExisting?.diaryBlockId) {
                            await deleteDiaryEventWithTombstone(plugin, {
                                eventId: String(rawExisting.diaryEventId || rawExisting.diaryBlockId),
                                blockId: String(rawExisting.diaryBlockId),
                                module: "vehicles",
                                action: "maintenance",
                                target: row.itemID,
                                bizDate: existing!.date,
                            });
                            diaryMeta = {};
                        }
                        const res = await recordHighFrequencyDiaryEvent(plugin, {
                            module: "vehicles",
                            action: "maintenance",
                            target: row.itemID,
                            avId: ref.avId,
                            bizDate: date,
                            recordedAt: new Date().toISOString(),
                            text: `🔧 车辆维保：${categoryLabel(category)} · ${odometer}km${costText ? ` · ¥${costText}` : ""}${value("shop") ? ` · ${value("shop")}` : ""} #车辆 #维保`,
                            amount: costText || undefined,
                            odometer,
                        });
                        diaryMeta = { diaryEventId: res.eventId, diaryBlockId: res.blockId, diaryDocId: res.docId };
                    } catch { /* soft */ }
                    const next = await updateRowLogs(plugin, (latest) => {
                        const base = existing ? removeEntry(latest, ref.avId!, row.itemID, "maintenance", existing as unknown as Record<string, unknown>) : latest;
                        return appendEntry(base, ref.avId!, row.itemID, "maintenance", { ...entry, ...diaryMeta, at: new Date().toISOString() });
                    });
                    await import("./doc-sync")
                        .then(({ syncModuleDocSection }) => syncModuleDocSection(plugin, "vehicles", next))
                        .catch(() => undefined);
                    records = getEntries<MaintenanceRecord>(next, ref.avId!, row.itemID, "maintenance");
                    dialog.destroy(); render();
                    await handleLogsUpdated(next);
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
            if (isGuest) {
                add.disabled = true;
                add.title = t("guest.writeBlocked");
            }
            add.onclick = () => openForm();
            head.append(title, add);
            wrap.appendChild(head);
            registerVehicleAction("maintenance", add);
            const stats = calculateMaintenanceStats(records, localDateKey(), Number.isFinite(currentOdometer) ? currentOdometer : undefined);
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
                const del = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("delete")) as HTMLButtonElement;
                if (isGuest) {
                    edit.disabled = true;
                    edit.title = t("guest.writeBlocked");
                    del.disabled = true;
                    del.title = t("guest.writeBlocked");
                }
                edit.onclick = () => openForm(entry);
                del.onclick = () => {
                    if (plugin?.runtime?.guestModeActive) {
                        showMessageFn(t("guest.writeBlocked"), 3500, "info");
                        return;
                    }
                    confirm(t("vehicle.maintenance.delete"), t("vehicle.maintenance.deleteConfirm"), async () => {
                    del.disabled = true;
                    try {
                        const rawRec = entry as unknown as Record<string, any>;
                        if (rawRec.diaryBlockId) {
                            await deleteDiaryEventWithTombstone(plugin, {
                                eventId: String(rawRec.diaryEventId || rawRec.diaryBlockId),
                                blockId: String(rawRec.diaryBlockId),
                                module: "vehicles",
                                action: "maintenance",
                                target: row.itemID,
                                bizDate: entry.date,
                            });
                        }
                        const next = await updateRowLogs(plugin, (latest) => removeEntry(latest, ref.avId!, row.itemID, "maintenance", entry as unknown as Record<string, unknown>));
                        records = getEntries<MaintenanceRecord>(next, ref.avId!, row.itemID, "maintenance");
                        render();
                        await handleLogsUpdated(next);
                    } catch (error) {
                        del.disabled = false;
                        showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", error instanceof Error ? error.message : String(error)), 5000, "error");
                    }
                });
                };
                line.append(desc, edit, del);
                wrap.appendChild(line);
            }
        };
        render();
    }

    try {
        await renderCostSummary();
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
            onLogUpdated: handleLogsUpdated,
        });
    } catch (error) {
        failVehicleActions(["fuel", "charging"], error);
    }
    try {
        await addVehicleMaintenanceSection();
    } catch (error) {
        failVehicleActions(["maintenance"], error);
    }

    // 4. 关联随手记与车务日记时间轴（方案 A：自由随手记可选挂车辆 + 车辆相关日记流聚合）
    try {
        const notesWrap = document.createElement("section");
        notesWrap.id = "lv-vehicle-notes";
        notesWrap.className = "lv-detail-section lv-domain-sec";
        body.appendChild(notesWrap);
        notesWrap.appendChild(mk("h3", "lv-h3-title", t("vehicle.notes.title")));

        const logs = await loadRowLogs(plugin);
        const quickNotes = getEntries<Record<string, any>>(logs, ref.avId!, row.itemID, "quickflows");
        const sqlNotes = await queryDiaryEventsFromSql(undefined, { moduleId: "vehicles", targetId: row.itemID }).catch(() => []);

        const merged: Array<{
            key: string;
            date: string;
            summary: string;
            docId?: string;
            blockId?: string;
        }> = [];
        const seen = new Set<string>();
        for (const n of [...quickNotes].reverse()) {
            const key = String(n.diaryEventId || n.diaryBlockId || `${n.date}:${n.detail || n.title || ""}`);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push({
                key,
                date: String(n.date || ""),
                summary: `${n.date || ""}${n.time ? ` ${n.time}` : ""} · ${n.detail || n.title || ""}${n.tag ? ` ${n.tag}` : ""}`.trim(),
                docId: n.diaryDocId,
                blockId: n.diaryBlockId,
            });
        }
        for (const ev of sqlNotes) {
            const key = String(ev.eventId || ev.blockId);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push({
                key,
                date: ev.bizDate || "",
                summary: `${ev.bizDate ? `${ev.bizDate} · ` : ""}${ev.content || ""}`.trim(),
                docId: ev.docId,
                blockId: ev.blockId,
            });
        }
        merged.sort((a, b) => b.date.localeCompare(a.date));

        if (merged.length === 0) {
            notesWrap.appendChild(mk("div", "ft__on-surface lv-caption", t("vehicle.notes.empty")));
        } else {
            for (const item of merged.slice(0, 10)) {
                const line = mk("div", "lv-vehicle-log-row");
                line.appendChild(mk("span", "lv-flex-wrap-anywhere", item.summary));
                if (item.docId && typeof plugin.showTabDocs === "function") {
                    const jumpBtn = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("vehicle.notes.openDiary")) as HTMLButtonElement;
                    jumpBtn.onclick = () => plugin.showTabDocs(item.docId, item.blockId);
                    line.appendChild(jumpBtn);
                }
                notesWrap.appendChild(line);
            }
        }
    } catch { /* soft */ }
}
