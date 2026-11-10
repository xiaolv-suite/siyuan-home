/**
 * 儿童生长发育曲线与疫苗接种日程弹窗（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { collectGrowthSeries, whoBand, whoPercentile } from "./growth";
import { bindDialogA11y } from "./dialog-a11y";
import { calculateVaccineSchedule, type GivenDoseRecord } from "./immunization";
import { addDetachedRow, setCell, renderLedgerAll, type AvRow } from "./siyuan";
import { writeLedgerRow } from "./ledger-writer";
import { pointsToSmoothBezierPath } from "./chart";
import { uiIcon } from "@/ui/icons";
import type { FamilyMember } from "@/types";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};

export interface GrowthChartDialogOptions {
    t: (k: string) => string;
    rows: any[];
    columns: Record<string, string | undefined>;
    members: FamilyMember[];
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
}

export function openGrowthChartDialog(options: GrowthChartDialogOptions): void {
    const { t, rows, columns, members, DialogCls, showMessageFn } = options;
    const series = collectGrowthSeries(rows, columns, members);
    const dlg = new DialogCls({
        title: t("ledger.growthChart"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-growth-body"></div>`,
        width: "560px",
    });
    bindDialogA11y({ dlg });
    const body = dlg.element.querySelector("#lv-growth-body") as HTMLElement;
    if (!body) return;

    if (series.length === 0) {
        body.innerHTML = `<div class="ft__on-surface" style="font-size:13px;padding:12px">${t("ledger.noGrowthData")}</div>`;
        return;
    }

    const COLORS = ["#4a6785", "#ac503d", "#5a8a48", "#8a5aa0", "#b08030"];
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag: string, attrs: Record<string, string | number>, textContent?: string) => {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
        if (textContent !== undefined) e.textContent = textContent;
        return e;
    };

    let bandMode: "auto" | "male" | "female" | "off" = "auto";
    const sexById = new Map(members.map((m) => [m.id, m.sex as "male" | "female" | undefined]));
    const controls = document.createElement("div");
    controls.className = "lv-dialog-row__left lv-mb-10";
    const ctlLabel = document.createElement("span");
    ctlLabel.className = "ft__on-surface";
    ctlLabel.textContent = t("ledger.growthWhoSex");
    const sel = document.createElement("select");
    sel.className = "b3-select";
    for (const [v, key] of [["auto", "ledger.growthWhoAuto"], ["male", "members.sex.male"], ["female", "members.sex.female"], ["off", "ledger.growthWhoOff"]] as const) {
        sel.add(new Option(t(key), v));
    }
    sel.addEventListener("change", () => { bandMode = sel.value as typeof bandMode; renderPanels(); });
    controls.append(ctlLabel, sel);
    body.appendChild(controls);

    function renderPanels() {
        body.querySelectorAll(".lv-growth-panel, .lv-growth-note").forEach((n) => n.remove());
        for (const metric of ["height", "weight"] as const) {
            const ss = series.filter((s) => s.metric === metric);
            if (!ss.length) continue;
            const panel = document.createElement("div");
            panel.className = "lv-growth-panel";
            const head = document.createElement("div");
            head.className = "lv-domain-title lv-mt-10";
            head.textContent = t(metric === "height" ? "ledger.growthHeight" : "ledger.growthWeight");
            panel.appendChild(head);
            const W = 500, H = 170, PAD = 40;
            const all = ss.flatMap((s) => s.points.map((p, pi) => ({ x: p.ageMonths ?? pi, y: p.value })));
            const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
            const xMin = Math.min(...xs), xMax = Math.max(...xs);
            let yMin = Math.min(...ys), yMax = Math.max(...ys);

            const knownSexes = [...new Set(ss.map((s) => sexById.get(s.memberId)).filter(Boolean))] as ("male" | "female")[];
            const bandSex: "male" | "female" | null =
                bandMode === "off" ? null : bandMode === "auto" ? (knownSexes.length === 1 ? knownSexes[0] : null) : bandMode;
            const x0b = Math.max(xMin, 0), x1b = Math.min(xMax, 60);
            const bandPts: { x: number; p3: number; p50: number; p97: number }[] = [];
            if (bandSex && x1b >= x0b) {
                const samples = new Set<number>([x0b, x1b]);
                for (let m = Math.ceil(x0b); m <= Math.floor(x1b); m++) samples.add(m);
                for (const x of [...samples].sort((a, b) => a - b)) {
                    const b = whoBand(bandSex, metric, x);
                    if (b) { bandPts.push({ x, p3: b.p3, p50: b.p50, p97: b.p97 }); yMin = Math.min(yMin, b.p3); yMax = Math.max(yMax, b.p97); }
                }
            }
            const sx = (x: number) => (xMax === xMin ? W / 2 : PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2));
            const sy = (y: number) => (yMax === yMin ? H / 2 : H - PAD - ((y - yMin) / (yMax - yMin)) * (H - PAD * 2));
            const fx = (x: number) => (Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1));
            const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });

            svg.appendChild(el("line", { x1: PAD, y1: H - PAD, x2: W - PAD / 2, y2: H - PAD, stroke: "var(--lv-line)", "stroke-opacity": "0.5" }));
            svg.appendChild(el("line", { x1: PAD, y1: PAD / 2, x2: PAD, y2: H - PAD, stroke: "var(--lv-line)", "stroke-opacity": "0.5" }));
            svg.appendChild(el("text", { x: PAD - 6, y: PAD / 2 + 4, "text-anchor": "end", "font-size": 10, fill: "var(--lv-tx-3)" }, String(Math.round(yMax * 10) / 10)));
            svg.appendChild(el("text", { x: PAD - 6, y: H - PAD + 4, "text-anchor": "end", "font-size": 10, fill: "var(--lv-tx-3)" }, String(Math.round(yMin * 10) / 10)));
            svg.appendChild(el("text", { x: PAD, y: H - PAD + 14, "font-size": 10, fill: "var(--lv-tx-3)" }, fx(xMin)));
            svg.appendChild(el("text", { x: W - PAD / 2, y: H - PAD + 14, "text-anchor": "end", "font-size": 10, fill: "var(--lv-tx-3)" }, `${fx(xMax)}${xs.some((x) => x > 0) ? "月龄" : ""}`));

            if (bandPts.length >= 2) {
                const top = bandPts.map((b) => `${sx(b.x)},${sy(b.p97)}`).join(" ");
                const bottom = [...bandPts].reverse().map((b) => `${sx(b.x)},${sy(b.p3)}`).join(" ");
                svg.appendChild(el("polygon", { points: `${top} ${bottom}`, fill: "var(--lv-accent)", opacity: 0.08 }));
                svg.appendChild(el("polyline", { points: bandPts.map((b) => `${sx(b.x)},${sy(b.p50)}`).join(" "), fill: "none", stroke: "var(--lv-accent)", opacity: 0.45, "stroke-width": 1.2, "stroke-dasharray": "4 3" }));
                const bandLabel = el("text", { x: W - PAD / 2, y: PAD / 2 - 8, "text-anchor": "end", "font-size": 10, fill: "var(--lv-accent)", opacity: 0.85 });
                bandLabel.textContent = `WHO P3–P97 · ${t(bandSex === "male" ? "members.sex.male" : "members.sex.female")}`;
                svg.appendChild(bandLabel);
            }
            ss.forEach((s, i) => {
                const color = COLORS[i % COLORS.length];
                const pts = s.points;
                const memberSex = sexById.get(s.memberId);
                const pointEl = (x: number, y: number, p: { date: string; value: number; ageMonths: number | null }) => {
                    const dot = el("circle", { cx: sx(x), cy: sy(y), r: pts.length === 1 ? 3.5 : 3, fill: color, stroke: "var(--lv-surface)", "stroke-width": 1.5 });
                    const pct = memberSex && p.ageMonths !== null ? whoPercentile(memberSex, metric, p.ageMonths, p.value) : null;
                    const label = document.createElementNS(NS, "title");
                    label.textContent = pct !== null ? `P${Math.round(pct)} · ${p.date} ${p.value}` : `${p.date} ${p.value}`;
                    dot.appendChild(label);
                    return dot;
                };
                if (pts.length === 1) {
                    svg.appendChild(pointEl(sx(pts[0].ageMonths ?? 0), sy(pts[0].value), pts[0]));
                } else {
                    const chartPts = pts.map((p) => ({ x: sx(p.ageMonths ?? 0), y: sy(p.value) }));
                    const smoothPath = pointsToSmoothBezierPath(chartPts, 0.2);
                    const pathEl = el("path", {
                        d: smoothPath,
                        fill: "none",
                        stroke: color,
                        "stroke-width": 2.5,
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    });
                    svg.appendChild(pathEl);
                    for (const p of pts) svg.appendChild(pointEl(p.ageMonths ?? 0, p.value, p));
                }
                const legend = el("text", { x: PAD + 4, y: PAD / 2 + 16 + i * 14, "font-size": 11, fill: color });
                legend.textContent = s.memberName;
                svg.appendChild(legend);
            });
            panel.appendChild(svg);
            body.appendChild(panel);
        }
        const note = document.createElement("div");
        note.className = "lv-growth-note ft__on-surface lv-caption lv-mt-6";
        note.textContent = t("ledger.growthWhoNote");
        body.appendChild(note);
    }
    try {
        renderPanels();
    } catch (e) {
        showMessageFn(t("ledger.growthFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
    }
}

export interface VaccineScheduleDialogOptions {
    t: (k: string) => string;
    members: FamilyMember[];
    avId: string;
    columns: Record<string, string>;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (v: any) => string;
    onRecordSaved?: () => Promise<void>;
}

export async function openVaccineScheduleDialog(options: VaccineScheduleDialogOptions): Promise<void> {
    const { t, members, avId, columns, DialogCls, showMessageFn, cellTextFn, onRecordSaved } = options;
    const children = members.filter((m) => m.birthday && (m.role === "child" || !m.role));
    const candidate = children.length > 0 ? children : members.filter((m) => m.birthday);

    if (candidate.length === 0) {
        showMessageFn(t("ledger.vaccineNoBirthdayChild"), 4000, "info");
        return;
    }

    try {
        const all = await renderLedgerAll(avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }

        let selectedChildId = candidate[0].id;
        const dlg = new DialogCls({
            title: t("ledger.vaccineSchedule"),
            content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-vaccine-sched-body"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" id="lv-vaccine-sched-close">${t("close")}</button></div>`,
            width: "580px",
        });
        const body = dlg.element.querySelector("#lv-vaccine-sched-body") as HTMLElement;
        (dlg.element.querySelector("#lv-vaccine-sched-close") as HTMLButtonElement).onclick = () => dlg.destroy();
        bindDialogA11y({ dlg });

        const render = () => {
            body.replaceChildren();
            const child = members.find((m) => m.id === selectedChildId) || candidate[0];
            if (!child.birthday) return;

            const givenRecords: GivenDoseRecord[] = [];
            for (const r of all.rows) {
                const mBlock = columns.member ? r.cells?.[columns.member]?.relation?.blockIDs?.[0] : undefined;
                if (mBlock && child.avItemId && mBlock !== child.avItemId) continue;

                const vname = columns.vaccine_name ? cellTextFn(r.cells?.[columns.vaccine_name]) : (columns.name ? cellTextFn(r.cells?.[columns.name]) : "");
                const doseRaw = columns.dose_no ? cellTextFn(r.cells?.[columns.dose_no]) : "";
                const dateVal = columns.date ? cellTextFn(r.cells?.[columns.date]) : "";
                const batchVal = columns.vaccine_batch ? cellTextFn(r.cells?.[columns.vaccine_batch]) : "";
                const siteVal = columns.vaccine_site ? cellTextFn(r.cells?.[columns.vaccine_site]) : "";

                if (vname && vname !== "—") {
                    givenRecords.push({
                        id: r.itemID,
                        vaccineName: vname,
                        doseNo: Number(doseRaw) || undefined,
                        date: dateVal !== "—" ? dateVal : undefined,
                        batch: batchVal !== "—" ? batchVal : undefined,
                        site: siteVal !== "—" ? siteVal : undefined,
                    });
                }
            }

            const report = calculateVaccineSchedule(child.birthday, givenRecords);
            if (!report) return;

            const topBar = mk("div", "lv-domain-head");
            if (candidate.length > 1) {
                const sel = mk("select", "b3-select") as HTMLSelectElement;
                for (const c of candidate) sel.add(new Option(`${c.name} (${c.birthday})`, c.id, false, c.id === selectedChildId));
                sel.onchange = () => { selectedChildId = sel.value; render(); };
                topBar.appendChild(sel);
            } else {
                topBar.appendChild(mk("b", "lv-dialog-name", `${child.name} · ${child.birthday}`));
            }
            const rateSpan = mk("span", "lv-caption");
            rateSpan.innerHTML = `${t("ledger.vaccineCompletionRate")}: <b class="lv-num lv-metric-val" style="color:var(--lv-data-accent);font-size:14px">${report.completionRate}%</b>`;
            topBar.appendChild(rateSpan);
            body.appendChild(topBar);

            const progressTrack = mk("div", "lv-member-retire-bar lv-mb-10");
            progressTrack.innerHTML = `<div style="height:100%;background:var(--lv-data-accent);width:${report.completionRate}%;border-radius:3px"></div>`;
            body.appendChild(progressTrack);

            const metrics = mk("div", "lv-metric-grid-4 lv-mb-10");
            const metricBox = (label: string, count: number, color?: string) => {
                const d = mk("div", "lv-metric-item lv-diag-stat-card fn__text-center");
                d.innerHTML = `<span class="lv-caption">${label}</span><b class="lv-num lv-metric-val${color ? ` ${color}` : ""}">${count}</b>`;
                return d;
            };
            metrics.append(
                metricBox(t("ledger.vaccineGiven"), report.givenCount, "lv-tx-accent"),
                metricBox(t("ledger.vaccineOverdue"), report.overdueCount, "lv-tx-danger"),
                metricBox(t("ledger.vaccineDueSoon"), report.dueSoonCount, "lv-tx-warn"),
                metricBox(t("ledger.vaccineUpcoming"), report.upcomingCount)
            );
            body.appendChild(metrics);

            const list = mk("div", "lv-dialog-sec");
            for (const it of report.items) {
                const itemEl = mk("div", "lv-domain-item lv-dialog-row");

                const left = mk("div", "lv-dialog-col");
                const titleLine = mk("div", "lv-dialog-row__left");
                titleLine.append(
                    mk("b", "lv-dialog-name", `${it.vaccine}（第 ${it.dose} 剂）`),
                    mk("span", "lv-caption", it.monthAge === 0 ? "出生时" : `${it.monthAge}月龄`)
                );

                const metaParts = [`应种日: ${it.targetDate}`];
                if (it.note) metaParts.push(it.note);
                if (it.givenDate) metaParts.push(`实种日: ${it.givenDate}`);
                if (it.batch) metaParts.push(`批号: ${it.batch}`);
                left.append(titleLine, mk("span", "lv-caption", metaParts.join(" · ")));

                const right = mk("div", "lv-dialog-row__right");
                right.style.display = "flex";
                right.style.alignItems = "center";
                right.style.gap = "6px";
                const badgeCls = it.status === "given" ? "green" : it.status === "overdue" ? "red" : it.status === "due_soon" ? "orange" : "gray";
                const badgeTxt = t(it.status === "given" ? "ledger.vaccineGiven" : it.status === "overdue" ? "ledger.vaccineOverdue" : it.status === "due_soon" ? "ledger.vaccineDueSoon" : "ledger.vaccineUpcoming");
                right.appendChild(mk("span", `lv-badge ${badgeCls}`, badgeTxt));

                if (it.status !== "given") {
                    const recordBtn = document.createElement("button");
                    recordBtn.type = "button";
                    recordBtn.className = "b3-button b3-button--outline lv-btn-text-sm";
                    recordBtn.innerHTML = `${uiIcon("add", "", 13)} ${t("ledger.recordVaccineDose")}`;
                    recordBtn.onclick = () => {
                        const rdlg = new DialogCls({
                            title: `${t("ledger.recordVaccineTitle")} · ${it.vaccine}`,
                            content: `<div class="b3-dialog__content lv-dialog-col">
                                <label class="lv-form-group">
                                    <span class="lv-caption">${t("field.date")}</span>
                                    <input class="b3-text-field" id="lv-vrec-date" type="date" value="${it.targetDate}" />
                                </label>
                                <label class="lv-form-group">
                                    <span class="lv-caption">${t("field.vaccine_batch")}</span>
                                    <input class="b3-text-field" id="lv-vrec-batch" placeholder="${t("field.vaccine_batch")}" />
                                </label>
                                <label class="lv-form-group">
                                    <span class="lv-caption">${t("field.vaccine_site")}</span>
                                    <input class="b3-text-field" id="lv-vrec-site" placeholder="${t("field.vaccine_site")}" />
                                </label>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="lv-vrec-cancel">${t("cancel")}</button>
                                <button class="b3-button" id="lv-vrec-save">${t("save")}</button>
                            </div>`,
                            width: "400px",
                        });
                        (rdlg.element.querySelector("#lv-vrec-cancel") as HTMLButtonElement).onclick = () => rdlg.destroy();
                        bindDialogA11y({ dlg: rdlg, defaultFocus: "#lv-vrec-date" });
                        (rdlg.element.querySelector("#lv-vrec-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                            const dateVal = (rdlg.element.querySelector("#lv-vrec-date") as HTMLInputElement)?.value.trim() || it.targetDate;
                            const batchVal = (rdlg.element.querySelector("#lv-vrec-batch") as HTMLInputElement)?.value.trim();
                            const siteVal = (rdlg.element.querySelector("#lv-vrec-site") as HTMLInputElement)?.value.trim();
                            this.disabled = true;
                            rdlg.destroy();
                            try {
                                // 经写入网关：分类走 select 双形态、日期转时间戳（此前日期以字符串写入、分类单形态，内核落盘为空）
                                const { itemID: rowId, failed } = await writeLedgerRow({
                                    moduleId: "parenting",
                                    target: { avId, columns },
                                    name: it.vaccine,
                                    fields: {
                                        category: "vaccine_p",
                                        date: dateVal,
                                        vaccine_name: it.vaccine,
                                        dose_no: it.dose,
                                        vaccine_batch: batchVal,
                                        vaccine_site: siteVal,
                                        member: child.avItemId,
                                    },
                                    addRowFn: addDetachedRow,
                                    setCellFn: setCell,
                                });
                                if (failed.length > 0) {
                                    showMessageFn(t("ledger.writePartialFailed").replace("${fields}", failed.map((k) => t(`field.${k}`)).join("、")), 6000, "error");
                                } else {
                                    showMessageFn(t("ledger.recordVaccineSaved"), 3000, "info");
                                }
                                all.rows.push({
                                    itemID: rowId,
                                    cells: {
                                        [columns.vaccine_name]: { type: "text", text: { content: it.vaccine } },
                                        [columns.dose_no]: { type: "number", number: { content: it.dose, isNotEmpty: true } },
                                        [columns.date]: { type: "date", date: { content: new Date(`${dateVal}T00:00:00`).getTime(), isNotEmpty: true } },
                                        [columns.category]: { type: "select", select: { content: "vaccine_p" }, mSelect: [{ content: "vaccine_p" }] },
                                        ...(columns.member && child.avItemId ? { [columns.member]: { type: "relation", relation: { blockIDs: [child.avItemId] } } } : {}),
                                    },
                                } as AvRow);
                                render();
                                if (onRecordSaved) await onRecordSaved();
                            } catch (err) {
                                showMessageFn(t("ledger.saveFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 6000, "error");
                            }
                        };
                    };
                    right.appendChild(recordBtn);
                }
                itemEl.append(left, right);
                list.appendChild(itemEl);
            }
            body.appendChild(list);
        };
        render();
    } catch (e) {
        showMessageFn(t("ledger.logReadFailed") + " (" + (e instanceof Error ? e.message : String(e)) + ")", 6000, "error");
    }
}
