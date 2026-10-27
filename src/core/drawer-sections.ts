/**
 * 台账详情抽屉专属扩展区块（解耦抽取自 ledger.svelte，促进大文件瘦身）
 * 包含：证件换证链 (Certs Renew Chain)、人情转人脉 (Favors to Contacts)、购物转资产 (Shopping to Asset)
 */

import { setCell } from "./siyuan";
import { saveRuntime } from "./hub/runtime";

export interface RenewChainSectionOptions {
    body: HTMLElement;
    row: any;
    rows: any[];
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    cellTextFn: (cell: any) => string;
    onChainUpdated?: (targetRowId: string) => Promise<void>;
}

export function renderRenewChainSection(options: RenewChainSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, rows, ref, active, t, DialogCls, showMessageFn, cellTextFn, onChainUpdated } = options;
    if (active !== "certs" || !ref.columns) return;
    const relKey = ref.columns.renewed_to;
    if (!relKey) return;

    const nameOf = (id: string) => {
        const r = rows.find((x) => x.itemID === id);
        return r ? String(cellTextFn(r.cells[ref.columns!.name])) : "?";
    };

    const forward = (row.cells[relKey]?.relation?.blockIDs ?? []) as string[];
    const backward = rows.filter((r) => ((r.cells[relKey]?.relation?.blockIDs ?? []) as string[]).includes(row.itemID));

    const linkBtn = () => {
        const btn = document.createElement("button");
        btn.className = "b3-button b3-button--outline";
        btn.style.cssText = "margin-top:8px;font-size:12px";
        btn.textContent = t("ledger.linkNew");
        btn.onclick = () => {
            const picker = new DialogCls({
                title: t("ledger.pickNew"),
                content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-pick-body" style="max-height:50vh;overflow:auto;padding:12px"></div>`,
                width: "420px",
            });
            const list = picker.element.querySelector("#lv-pick-body") as HTMLElement;
            for (const r of rows) {
                if (r.itemID === row.itemID) continue;
                const b = document.createElement("button");
                b.className = "b3-button b3-button--text";
                b.style.cssText = "display:block;width:100%;text-align:left;font-size:13px;padding:6px 8px";
                const exp = ref.columns!.expiry ? cellTextFn(r.cells[ref.columns!.expiry]) : "";
                b.textContent = `${String(cellTextFn(r.cells[ref.columns!.name]))}${exp && exp !== "—" ? ` · ${exp}` : ""}`;
                b.onclick = async () => {
                    b.disabled = true;
                    try {
                        await setCell(ref.avId!, relKey, row.itemID, { type: "relation", relation: { blockIDs: [r.itemID], contents: null } }, {
                            idempotencyKey: `ledger:renew-link:${row.itemID}:${r.itemID}`,
                            retries: 1,
                        });
                        picker.destroy();
                        showMessageFn(t("ledger.linked").replace("${name}", String(cellTextFn(r.cells[ref.columns!.name]))), 2500, "info");
                        if (onChainUpdated) await onChainUpdated(row.itemID);
                    } catch (e) {
                        showMessageFn(t("ledger.renewLinkFailed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
                        b.disabled = false;
                    }
                };
                list.appendChild(b);
            }
            if (!list.children.length) list.innerHTML = `<div class="ft__on-surface" style="font-size:13px">${t("ledger.noOtherRows")}</div>`;
        };
        return btn;
    };

    if (forward.length === 0 && backward.length === 0) {
        body.appendChild(linkBtn());
        return;
    }

    const head = document.createElement("div");
    head.className = "ft__on-surface";
    head.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px;font-weight:600";
    head.textContent = t("ledger.renewChain");
    body.appendChild(head);

    for (const id of forward) {
        const line = document.createElement("div");
        line.style.cssText = "padding:2px 0;font-size:12.5px;color:var(--lv-tx-2)";
        line.textContent = `→ ${nameOf(id)} (${t("ledger.newCert")})`;
        body.appendChild(line);
    }
    for (const r of backward) {
        const line = document.createElement("div");
        line.style.cssText = "padding:2px 0;font-size:12.5px;color:var(--lv-tx-2)";
        line.textContent = `← ${String(cellTextFn(r.cells[ref.columns!.name]))} (${t("ledger.oldCert")})`;
        body.appendChild(line);
    }
    body.appendChild(linkBtn());
}

export interface FavorsSyncSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { avId?: string; columns?: Record<string, string> };
    active: string;
    plugin: any;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    selectContentFn: (cell: any) => string | undefined;
    rawDateFn: (cell: any) => string;
}

export function renderFavorsSyncSection(options: FavorsSyncSectionOptions): void {
    if (typeof document === "undefined") return;
    const { body, row, ref, active, plugin, t, showMessageFn, selectContentFn, rawDateFn } = options;
    if (active !== "favors" || !ref.columns?.person) return;
    const personName = (row.cells[ref.columns.person]?.text?.content ?? "").trim();
    if (!personName) return;

    const synced = plugin.runtime?.favorSyncs?.[row.itemID];
    const head = document.createElement("div");
    head.className = "ft__on-surface";
    head.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid var(--lv-line);font-size:12px;font-weight:600";
    head.textContent = t("ec15.title");
    body.appendChild(head);

    const btn = document.createElement("button");
    btn.className = "b3-button b3-button--outline";
    btn.style.cssText = "margin-top:8px;font-size:12px";
    btn.textContent = synced ? t("ec15.again") : t("ec15.record");

    btn.onclick = async () => {
        const w = (typeof window !== "undefined" ? window : {}) as Record<string, unknown>;
        const bridge = (w.LvContacts || w.xiaolvContacts || w.siyuanContacts || w.lvContacts) as {
            ensurePerson: (name: string) => Promise<{ docId: string; name: string; created: boolean }>;
            recordInteraction: (ids: readonly string[], meta?: { ref?: string; date?: string; note?: string }) => Promise<{ recorded: number }>;
        } | undefined;

        if (!bridge?.ensurePerson || !bridge.recordInteraction) {
            showMessageFn(t("ledger.contactsMissing"), 5000, "info");
            return;
        }

        btn.disabled = true;
        try {
            const person = await bridge.ensurePerson(personName);
            const dateVal = ref.columns!.date ? rawDateFn(row.cells[ref.columns!.date]) : "";
            const dir = selectContentFn(row.cells[ref.columns!.direction ?? ""]) ?? "";
            const amount = row.cells[ref.columns!.amount ?? ""]?.number;
            const noteParts = [
                dir === "in" ? t("ec15.received") : dir === "out" ? t("ec15.given") : "",
                typeof amount?.content === "number" && amount.isNotEmpty ? String(amount.content) : "",
            ].filter(Boolean);

            const result = await bridge.recordInteraction([person.docId], {
                ref: `favor:${row.itemID}`,
                date: dateVal || undefined,
                note: noteParts.join(" "),
            });

            plugin.runtime.favorSyncs = {
                ...(plugin.runtime.favorSyncs ?? {}),
                [row.itemID]: { docId: person.docId, at: new Date().toISOString() },
            };
            await saveRuntime(plugin, plugin.runtime);
            showMessageFn(t("ec15.done").replace("${n}", person.name).replace("${r}", String(result.recorded)), 3000, "info");
            btn.disabled = false;
        } catch (e) {
            showMessageFn(t("ec15.failed").replace("${msg}", e instanceof Error ? e.message : String(e)), 6000, "error");
            btn.disabled = false;
        }
    };

    if (synced) {
        const tag = document.createElement("span");
        tag.className = "lv-caption";
        tag.style.cssText = "margin-left:8px;color:var(--lv-accent);font-weight:normal";
        tag.textContent = t("ec15.synced");
        head.appendChild(tag);
    }

    body.appendChild(btn);
}
