/**
 * 家务轮换区块（310 波，G1）：
 * 在 chores 台账详情抽屉里渲染「本轮该谁 + 完成历史 + 记一次完成」。
 * 抽到 core 层是为了给 Svelte 页面减负（页内长段 DOM/模板字符串对 gzip 不友好）。
 */
import * as rl from "./rowlog";
import { nextAssignee, buildChoreHistory } from "./chores";
import type { AvCellLike } from "./avcell";

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

    const head = document.createElement("div");
    head.className = "ft__on-surface lv-dialog-sec-head";
    head.textContent = t("ledger.choreRotation");
    body.appendChild(head);

    const summary = document.createElement("div");
    summary.className = "lv-dialog-summary-card";
    body.appendChild(summary);

    const list = document.createElement("div");
    list.className = "lv-dialog-list";
    list.style.maxHeight = "180px";
    body.appendChild(list);

    const form = document.createElement("div");
    form.className = "lv-dialog-form-row";
    const whoSel = document.createElement("select");
    whoSel.className = "b3-select lv-select-sm";
    whoSel.style.width = "110px";
    for (const m of roster) {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.name;
        whoSel.append(o);
    }
    const dateInp = document.createElement("input");
    dateInp.type = "date";
    dateInp.className = "b3-text-field lv-select-sm";
    dateInp.style.width = "130px";
    dateInp.value = new Date().toISOString().slice(0, 10);
    const noteInp = document.createElement("input");
    noteInp.className = "b3-text-field lv-select-sm";
    noteInp.placeholder = t("ledger.choreNote");
    noteInp.style.flex = "1";
    noteInp.style.minWidth = "90px";
    const pointsInp = document.createElement("input");
    pointsInp.type = "number";
    pointsInp.className = "b3-text-field lv-select-sm";
    pointsInp.placeholder = t("ledger.chorePoints");
    pointsInp.title = t("ledger.chorePointsTip");
    pointsInp.style.width = "60px";
    pointsInp.min = "0";
    const addBtn = document.createElement("button");
    addBtn.className = "b3-button b3-button--outline lv-select-sm";
    addBtn.textContent = t("ledger.choreDone");
    form.append(whoSel, dateInp, noteInp, pointsInp, addBtn);
    body.appendChild(form);

    let logs: rl.RowLogs = {};
    const render = () => {
        const completions = readCompletions(logs) as unknown as Parameters<typeof buildChoreHistory>[0];
        const today = new Date().toISOString().slice(0, 10);
        const assignee = nextAssignee(roster, completions, today);
        const history = buildChoreHistory(completions, roster);

        summary.replaceChildren();
        const who = document.createElement("b");
        who.className = "lv-tx-accent";
        who.style.fontSize = "13px";
        who.textContent = assignee.member
            ? `${t("ledger.choreNext")}: ${assignee.member.name}`
            : t("ledger.choreNoRoster");
        const meta = document.createElement("span");
        meta.className = "lv-caption";
        meta.style.marginLeft = "8px";
        meta.textContent = assignee.lastDone
            ? `${t("ledger.choreLast")} ${assignee.lastDone}${assignee.daysSince !== undefined ? ` · ${assignee.daysSince} ${t("days.unit")}` : ""} · ${t("ledger.choreTotal")} ${history.total}`
            : `${t("ledger.choreTotal")} ${history.total}`;
        summary.append(who, meta);

        list.replaceChildren();
        if (history.entries.length === 0) {
            const none = document.createElement("div");
            none.className = "ft__on-surface lv-caption";
            none.textContent = t("ledger.choreEmpty");
            list.appendChild(none);
            return;
        }
        for (const e of history.entries) {
            const line = document.createElement("div");
            line.className = "lv-dialog-row";
            line.style.padding = "2px 0";
            const txt = document.createElement("span");
            const ptsTag = e.points ? ` <span class="lv-badge green">+${e.points}分</span>` : "";
            const safeNote = e.note ? String(e.note).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
            const safeName = String(e.memberName || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            txt.innerHTML = `${e.date} · ${safeName}${ptsTag}${safeNote ? ` —— ${safeNote}` : ""}`;
            const del = document.createElement("button");
            del.className = "b3-button b3-button--text lv-btn-text-sm";
            del.textContent = t("delete");
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
