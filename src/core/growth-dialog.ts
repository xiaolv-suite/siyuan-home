/**
 * 儿童生长发育曲线与疫苗接种日程弹窗（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { collectGrowthSeries, whoBand, whoPercentile } from "./growth";
import { calculateVaccineSchedule, type GivenDoseRecord } from "./immunization";
import { addDetachedRow, setCell, renderLedgerAll, type AvRow } from "./siyuan";
import { pointsToSmoothBezierPath } from "./chart";
import type { FamilyMember } from "@/types";

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
    controls.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px";
    const ctlLabel = document.createElement("span");
    ctlLabel.className = "ft__on-surface";
    ctlLabel.textContent = t("ledger.growthWhoSex");
    const sel = document.createElement("select");
    sel.className = "b3-select";
    for (const [v, key] of [["auto", "ledger.growthWhoAuto"], ["male", "members.sex.male"], ["female", "members.sex.female"], ["off", "ledger.growthWhoOff"]] as const) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t(key);
        sel.appendChild(o);
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
            head.style.cssText = "font-weight:600;font-size:13px;margin:10px 0 4px";
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
        note.className = "lv-growth-note ft__on-surface";
        note.style.cssText = "font-size:11.5px;margin-top:6px";
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

            const topBar = document.createElement("div");
            topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px";
            if (candidate.length > 1) {
                const sel = document.createElement("select");
                sel.className = "b3-select";
                for (const c of candidate) {
                    const opt = document.createElement("option");
                    opt.value = c.id;
                    opt.textContent = `${c.name} (${c.birthday})`;
                    if (c.id === selectedChildId) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.onchange = () => { selectedChildId = sel.value; render(); };
                topBar.appendChild(sel);
            } else {
                const nameSpan = document.createElement("b");
                nameSpan.style.cssText = "font-size:13px;color:var(--lv-tx)";
                nameSpan.textContent = `${child.name} · ${child.birthday}`;
                topBar.appendChild(nameSpan);
            }
            const rateSpan = document.createElement("span");
            rateSpan.className = "lv-caption";
            rateSpan.innerHTML = `${t("ledger.vaccineCompletionRate")}: <b class="lv-num" style="color:var(--lv-data-accent);font-size:14px">${report.completionRate}%</b>`;
            topBar.appendChild(rateSpan);
            body.appendChild(topBar);

            const progressTrack = document.createElement("div");
            progressTrack.style.cssText = "height:6px;border-radius:3px;background:var(--lv-line);overflow:hidden;width:100%;margin-bottom:8px";
            progressTrack.innerHTML = `<div style="height:100%;background:var(--lv-data-accent);width:${report.completionRate}%;border-radius:3px"></div>`;
            body.appendChild(progressTrack);

            const metrics = document.createElement("div");
            metrics.style.cssText = "display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;margin-bottom:8px";
            const metricBox = (label: string, count: number, color?: string) => {
                const d = document.createElement("div");
                d.className = "lv-metric-item";
                d.style.cssText = "padding:8px;border-radius:6px;background:var(--lv-surface-2);border:1px solid var(--lv-line);text-align:center";
                d.innerHTML = `<span class="lv-caption">${label}</span><b class="lv-num" style="font-size:16px;${color ? `color:${color}` : ""}">${count}</b>`;
                return d;
            };
            metrics.append(
                metricBox(t("ledger.vaccineGiven"), report.givenCount, "var(--lv-accent)"),
                metricBox(t("ledger.vaccineOverdue"), report.overdueCount, "var(--lv-danger)"),
                metricBox(t("ledger.vaccineDueSoon"), report.dueSoonCount, "var(--lv-warn)"),
                metricBox(t("ledger.vaccineUpcoming"), report.upcomingCount)
            );
            body.appendChild(metrics);

            const list = document.createElement("div");
            list.style.cssText = "display:flex;flex-direction:column;gap:6px";
            for (const it of report.items) {
                const itemEl = document.createElement("div");
                itemEl.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line)";

                const left = document.createElement("div");
                left.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
                const titleLine = document.createElement("div");
                titleLine.style.cssText = "display:flex;align-items:center;gap:6px";
                const nameSpan = document.createElement("b");
                nameSpan.style.cssText = "color:var(--lv-tx)";
                nameSpan.textContent = `${it.vaccine}（第 ${it.dose} 剂）`;
                const monthBadge = document.createElement("span");
                monthBadge.className = "lv-caption";
                monthBadge.textContent = it.monthAge === 0 ? "出生时" : `${it.monthAge}月龄`;
                titleLine.append(nameSpan, monthBadge);

                const metaSpan = document.createElement("span");
                metaSpan.className = "lv-caption";
                const metaParts = [`应种日: ${it.targetDate}`];
                if (it.note) metaParts.push(it.note);
                if (it.givenDate) metaParts.push(`实种日: ${it.givenDate}`);
                if (it.batch) metaParts.push(`批号: ${it.batch}`);
                metaSpan.textContent = metaParts.join(" · ");
                left.append(titleLine, metaSpan);

                const right = document.createElement("div");
                right.style.cssText = "display:flex;align-items:center;gap:6px";
                const statusBadge = document.createElement("span");
                statusBadge.className = `lv-badge ${it.status === "given" ? "green" : it.status === "overdue" ? "red" : it.status === "due_soon" ? "orange" : "gray"}`;
                statusBadge.textContent = t(it.status === "given" ? "ledger.vaccineGiven" : it.status === "overdue" ? "ledger.vaccineOverdue" : it.status === "due_soon" ? "ledger.vaccineDueSoon" : "ledger.vaccineUpcoming");
                right.appendChild(statusBadge);

                if (it.status !== "given") {
                    const recordBtn = document.createElement("button");
                    recordBtn.className = "b3-button b3-button--text";
                    recordBtn.style.cssText = "font-size:12px;padding:2px 6px";
                    recordBtn.textContent = `＋ ${t("ledger.recordVaccineDose")}`;
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
                        (rdlg.element.querySelector("#lv-vrec-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                            const dateVal = (rdlg.element.querySelector("#lv-vrec-date") as HTMLInputElement)?.value.trim() || it.targetDate;
                            const batchVal = (rdlg.element.querySelector("#lv-vrec-batch") as HTMLInputElement)?.value.trim();
                            const siteVal = (rdlg.element.querySelector("#lv-vrec-site") as HTMLInputElement)?.value.trim();
                            this.disabled = true;
                            rdlg.destroy();
                            try {
                                const rowId = await addDetachedRow(avId, it.vaccine);
                                if (columns.category) await setCell(avId, columns.category, rowId, { type: "select", select: { content: "vaccine_p" } });
                                if (columns.date) await setCell(avId, columns.date, rowId, { type: "date", date: { content: dateVal, isNotEmpty: true } });
                                if (columns.vaccine_name) await setCell(avId, columns.vaccine_name, rowId, { type: "text", text: { content: it.vaccine } });
                                if (columns.dose_no) await setCell(avId, columns.dose_no, rowId, { type: "number", number: { content: it.dose, isNotEmpty: true } });
                                if (columns.vaccine_batch && batchVal) await setCell(avId, columns.vaccine_batch, rowId, { type: "text", text: { content: batchVal } });
                                if (columns.vaccine_site && siteVal) await setCell(avId, columns.vaccine_site, rowId, { type: "text", text: { content: siteVal } });
                                if (columns.member && child.avItemId) await setCell(avId, columns.member, rowId, { type: "relation", relation: { blockIDs: [child.avItemId] } });
                                showMessageFn(t("ledger.recordVaccineSaved"), 3000, "info");
                                all.rows.push({
                                    itemID: rowId,
                                    cells: {
                                        [columns.vaccine_name]: { type: "text", text: { content: it.vaccine } },
                                        [columns.dose_no]: { type: "number", number: { content: it.dose } },
                                        [columns.date]: { type: "date", date: { content: dateVal } },
                                        [columns.category]: { type: "select", select: { content: "vaccine_p" } },
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
