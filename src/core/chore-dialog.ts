/**
 * 家务轮换区块（310 波，G1）：
 * 在 chores 台账详情抽屉里渲染「本轮该谁 + 完成历史 + 记一次完成」。
 * 抽到 core 层是为了给 Svelte 页面减负（页内长段 DOM/模板字符串对 gzip 不友好）。
 */
import * as rl from "./rowlog";
import { nextAssignee, buildChoreHistory } from "./chores";
import { localDateKey } from "./hub/rule";
import type { AvCellLike } from "./avcell";

const mk = (t: string, c = "", s = "") => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (s) el.textContent = s;
    return el;
};

export interface ChoreSectionOptions {
    t: (k: string) => string;
    plugin: { settings: { members?: Array<{ id: string; name: string }> }; saveData: (name: string, data: unknown) => Promise<unknown> };
    avId: string;
    rowId: string;
    body: HTMLElement;
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
}

export async function addChoreRotationSectionImpl(opts: ChoreSectionOptions): Promise<void> {
    const { t, plugin, avId, rowId, body, showMessageFn } = opts;
    const roster = (plugin.settings.members ?? []).map((m) => ({ id: m.id, name: m.name }));
    const readCompletions = (logs: rl.RowLogs) =>
        rl.getEntries<Record<string, unknown>>(logs, avId, rowId, "chexecs");

    body.appendChild(mk("div", "ft__on-surface lv-dialog-sec-head", t("ledger.choreRotation")));

    const summary = mk("div", "lv-dialog-summary-card");
    body.appendChild(summary);

    const list = mk("div", "lv-dialog-list");
    list.style.maxHeight = "180px";
    body.appendChild(list);

    const form = mk("div", "lv-dialog-form-row");
    const whoSel = mk("select", "b3-select lv-select-sm") as HTMLSelectElement;
    whoSel.style.width = "110px";
    for (const m of roster) {
        const o = mk("option", "", m.name) as HTMLOptionElement;
        o.value = m.id;
        whoSel.append(o);
    }
    const dateInp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    dateInp.type = "date";
    dateInp.style.width = "130px";
    dateInp.value = localDateKey();

    const noteInp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    noteInp.placeholder = t("ledger.choreNote");
    noteInp.style.flex = "1";
    noteInp.style.minWidth = "90px";

    const pointsInp = mk("input", "b3-text-field lv-select-sm") as HTMLInputElement;
    pointsInp.type = "number";
    pointsInp.inputMode = "numeric";
    pointsInp.placeholder = t("ledger.chorePoints");
    pointsInp.title = t("ledger.chorePointsTip");
    pointsInp.style.width = "60px";
    pointsInp.min = "0";

    const addBtn = mk("button", "b3-button b3-button--outline lv-select-sm", t("ledger.choreDone")) as HTMLButtonElement;
    form.append(whoSel, dateInp, noteInp, pointsInp, addBtn);
    body.appendChild(form);

    let logs: rl.RowLogs = {};
    const render = () => {
        const completions = readCompletions(logs) as unknown as Parameters<typeof buildChoreHistory>[0];
        const today = localDateKey();
        const assignee = nextAssignee(roster, completions, today);
        const history = buildChoreHistory(completions, roster);

        summary.replaceChildren();
        const whoText = assignee.member ? `${t("ledger.choreNext")}: ${assignee.member.name}` : t("ledger.choreNoRoster");
        const who = mk("b", "lv-tx-accent", whoText);
        who.style.fontSize = "13px";

        const metaText = assignee.lastDone
            ? `${t("ledger.choreLast")} ${assignee.lastDone}${assignee.daysSince !== undefined ? ` · ${assignee.daysSince} ${t("days.unit")}` : ""} · ${t("ledger.choreTotal")} ${history.total}`
            : `${t("ledger.choreTotal")} ${history.total}`;
        const meta = mk("span", "lv-caption", metaText);
        meta.style.marginLeft = "8px";
        summary.append(who, meta);

        list.replaceChildren();
        if (history.entries.length === 0) {
            list.appendChild(mk("div", "ft__on-surface lv-caption", t("ledger.choreEmpty")));
            return;
        }
        for (const e of history.entries) {
            const line = mk("div", "lv-dialog-row");
            line.style.padding = "2px 0";
            const ptsTag = e.points ? ` <span class="lv-badge green">+${e.points}分</span>` : "";
            const safeNote = e.note ? String(e.note).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
            const safeName = String(e.memberName || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const txt = mk("span");
            txt.innerHTML = `${e.date} · ${safeName}${ptsTag}${safeNote ? ` —— ${safeNote}` : ""}`;
            const del = mk("button", "b3-button b3-button--text lv-btn-text-sm", t("delete")) as HTMLButtonElement;
            del.onclick = async () => {
                del.disabled = true;
                try {
                    logs = await rl.updateRowLogs(plugin as never, (cur) => rl.removeEntry(cur, avId, rowId, "chexecs", e as unknown as Record<string, unknown>));
                    render();
                } catch (err) {
                    del.disabled = false;
                    showMessageFn(t("ledger.logDeleteFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                }
            };
            line.append(txt, del);
            list.appendChild(line);
        }
    };

    addBtn.onclick = async () => {
        if (addBtn.disabled) return;
        if (!dateInp.value) {
            showMessageFn(t("ledger.logInvalid"), 3000, "error");
            return;
        }
        const pts = Number(pointsInp.value);
        addBtn.disabled = true;
        try {
            logs = await rl.updateRowLogs(plugin as never, (cur) => rl.appendEntry(cur, avId, rowId, "chexecs", {
                date: dateInp.value,
                memberId: whoSel.value || undefined,
                note: noteInp.value.trim() || undefined,
                ...(Number.isFinite(pts) && pts > 0 ? { points: pts } : {}),
                at: new Date().toISOString(),
            }));
            noteInp.value = "";
            pointsInp.value = "";
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

export type { AvCellLike };
