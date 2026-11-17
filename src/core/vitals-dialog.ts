/**
 * 健康指标流水区块（314 波，G5）：
 * 在 health 台账详情抽屉渲染「生理指标监测（血压/血糖/心率）+ 记一笔 + 趋势简报」。
 * 独立到 core 层避免 Svelte 页面体积膨胀。
 */
import * as rl from "./rowlog";
import { summarizeVitals, type VitalReading, type VitalType } from "./vitals";
import { localDateKey } from "./hub/rule";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (clsOrText(c)) el.className = c;
    if (s) el.textContent = s;
    return el;
};
function clsOrText(c: string) { return c.length > 0; }

export interface VitalsSectionOptions {
    t: (k: string) => string;
    plugin: { saveData: (name: string, data: unknown) => Promise<unknown> };
    avId: string;
    rowId: string;
    body: HTMLElement;
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
}

export async function addVitalsSectionImpl(opts: VitalsSectionOptions): Promise<void> {
    const { t, plugin, avId, rowId, body, showMessageFn } = opts;

    body.appendChild(mk("div", "ft__on-surface lv-dialog-sec-head", t("ledger.vitalsTitle")));

    const summary = mk("div", "lv-dialog-summary-card");
    body.appendChild(summary);

    const form = mk("div", "lv-dialog-form-row");
    const typeSel = mk("select", "b3-select lv-select-sm") as HTMLSelectElement;
    typeSel.style.width = "95px";
    typeSel.innerHTML = `<option value="bp">${t("ledger.vitalBp")}</option><option value="bg">${t("ledger.vitalBg")}</option><option value="hr">${t("ledger.vitalHr")}</option>`;

    const dateInp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    dateInp.type = "date";
    dateInp.style.width = "125px";
    dateInp.value = localDateKey();

    const val1Inp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    val1Inp.type = "number";
    val1Inp.inputMode = "numeric";
    val1Inp.placeholder = t("ledger.vitalVal1");
    val1Inp.style.width = "80px";

    const val2Inp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    val2Inp.type = "number";
    val2Inp.inputMode = "numeric";
    val2Inp.placeholder = t("ledger.vitalVal2");
    val2Inp.style.width = "80px";

    const addBtn = mk("button", "b3-button b3-button--outline lv-select-sm", t("ledger.valAdd")) as HTMLButtonElement;
    form.append(typeSel, dateInp, val1Inp, val2Inp, addBtn);
    body.appendChild(form);

    const list = mk("div", "lv-dialog-list");
    list.style.maxHeight = "160px";
    body.appendChild(list);

    let logs: rl.RowLogs = {};
    const readAll = () => (rl.getEntries<VitalReading>(logs, avId, rowId, "vitals") as unknown as VitalReading[]) ?? [];

    const render = () => {
        const curType = (typeSel.value as VitalType) || "bp";
        val2Inp.style.display = curType === "hr" ? "none" : "";
        val2Inp.placeholder = curType === "bp" ? t("ledger.vitalDiastolic") : t("ledger.vitalPostMeal");

        const all = readAll();
        const currentTypeReadings = all.filter((r) => r.type === curType);
        const report = summarizeVitals(currentTypeReadings, curType);

        summary.replaceChildren();
        const title = document.createElement("b");
        title.className = "lv-tx-accent";
        title.style.fontSize = "13px";
        title.textContent = report.total > 0
            ? `${t("ledger.vitalLatest")}: ${report.latest ? `${report.latest.val1}${report.latest.val2 !== undefined ? `/${report.latest.val2}` : ""}` : "—"} (${report.latestAssessment?.label ?? "—"})`
            : t("ledger.vitalNoReadings");
        const metaText = `${t("ledger.vitalCount")} ${report.total}${report.abnormalCount > 0 ? ` · ${t("ledger.vitalAbnormal")} ${report.abnormalCount}` : ""}`;
        const meta = mk("span", "lv-caption", metaText);
        meta.style.marginLeft = "8px";
        summary.append(title, meta);

        list.replaceChildren();
        if (currentTypeReadings.length === 0) {
            list.appendChild(mk("div", "ft__on-surface lv-caption", t("ledger.vitalEmpty")));
            return;
        }
        for (const r of currentTypeReadings.slice().reverse()) {
            const line = mk("div", "lv-dialog-row");
            line.style.padding = "2px 0";
            const valStr = r.val2 !== undefined ? `${r.val1}/${r.val2}` : String(r.val1);
            const del = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("delete")) as HTMLButtonElement;
            del.onclick = async () => {
                del.disabled = true;
                try {
                    logs = await rl.updateRowLogs(plugin as never, (cur) => rl.removeEntry(cur, avId, rowId, "vitals", r as unknown as Record<string, unknown>));
                    render();
                } catch (err) {
                    del.disabled = false;
                    showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                }
            };
            line.append(mk("span", "", `${r.date} · ${valStr}`), del);
            list.appendChild(line);
        }
    };

    typeSel.onchange = render;

    addBtn.onclick = async () => {
        const val1 = Number(val1Inp.value);
        if (!dateInp.value || !Number.isFinite(val1) || val1 <= 0) {
            showMessageFn(t("ledger.logInvalid"), 3000, "error");
            return;
        }
        const curType = (typeSel.value as VitalType) || "bp";
        const val2 = curType !== "hr" && val2Inp.value ? Number(val2Inp.value) : undefined;
        addBtn.disabled = true;
        try {
            logs = await rl.updateRowLogs(plugin as never, (cur) => rl.appendEntry(cur, avId, rowId, "vitals", {
                date: dateInp.value,
                type: curType,
                val1,
                ...(val2 !== undefined ? { val2 } : {}),
                at: new Date().toISOString(),
            }));
            val1Inp.value = "";
            val2Inp.value = "";
            render();
        } catch (err) {
            showMessageFn(t("ledger.logSavedRefreshFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
        } finally {
            addBtn.disabled = false;
        }
    };

    try {
        logs = await rl.loadRowLogs(plugin as never);
        render();
    } catch (err) {
        summary.textContent = t("ledger.logReadFailed").replace("${msg}", err instanceof Error ? err.message : String(err));
    }
}
