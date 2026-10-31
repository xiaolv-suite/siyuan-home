/**
 * CSV 批量导入向导弹窗（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

import { parseCsv } from "./csv";
import { bindDialogA11y } from "./dialog-a11y";
import { planImport, guessMapping } from "./importer";
import { addDetachedRow, setCell, RowIdentityPendingError } from "./siyuan";
import { cellValue } from "./avcell";
import { confirm } from "@/libs/dialog";

export interface CsvImportDialogOptions {
    active: string;
    ref: { avId?: string; columns?: Record<string, string> };
    schemaCols: any[];
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    onImportSuccess?: () => Promise<void>;
}

export function openCsvImportDialog(options: CsvImportDialogOptions): void {
    if (typeof document === "undefined") return;
    const { active, ref, schemaCols, t, DialogCls, showMessageFn, onImportSuccess } = options;
    if (!ref?.avId) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        let table: string[][];
        try {
            table = parseCsv(await file.text());
        } catch (e) {
            showMessageFn(t("ledger.importBadCsv") + ` (${e instanceof Error ? e.message : String(e)})`, 5000, "error");
            return;
        }
        if (table.length < 2) {
            showMessageFn(t("ledger.importBadCsv"), 5000, "error");
            return;
        }
        const headers = table[0];
        const labelOf = (key: string) => (t(`field.${key}`) !== `field.${key}` ? t(`field.${key}`) : key);
        let mapping = guessMapping(headers, schemaCols, labelOf);

        const dlg = new DialogCls({
            title: t("ledger.importCsv"),
            content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-csvimp-body">
<p class="lv-caption ft__on-surface">${t("ledger.importMapHint").replace("${file}", file.name).replace("${n}", String(table.length - 1))}</p>
<div id="lv-csvimp-map"></div></div>
<div class="b3-dialog__action"><span class="lv-caption fn__flex-1" id="lv-csvimp-stat"></span><button class="b3-button b3-button--cancel" id="lv-csvimp-close">${t("cancel")}</button><button class="b3-button" id="lv-csvimp-start">${t("ledger.importStart")}</button></div>`,
            width: "560px",
        });

        bindDialogA11y({ dlg });
        const mapBox = dlg.element.querySelector("#lv-csvimp-map") as HTMLElement;
        const selects: HTMLSelectElement[] = [];
        headers.forEach((h, i) => {
            const line = document.createElement("div");
            line.className = "lv-csv-map-line";
            const label = document.createElement("span");
            label.textContent = h || `#${i + 1}`;
            const sel = document.createElement("select");
            sel.className = "b3-select";
            sel.add(new Option(t("ledger.importSkip"), ""));
            for (const c of schemaCols) sel.add(new Option(labelOf(c.key), c.key));
            sel.value = mapping[i] ?? "";
            selects.push(sel);
            line.append(label, sel);
            mapBox.appendChild(line);
        });

        (dlg.element.querySelector("#lv-csvimp-close") as HTMLButtonElement).onclick = () => dlg.destroy();
        (dlg.element.querySelector("#lv-csvimp-start") as HTMLButtonElement).onclick = async (event: any) => {
            const startBtn = event.currentTarget as HTMLButtonElement;
            if (startBtn.disabled) return;
            mapping = Object.fromEntries(selects.map((s, i) => [i, s.value || undefined]));
            const mappedCount = Object.values(mapping).filter(Boolean).length;
            if (mappedCount === 0) {
                showMessageFn(t("ledger.importNoMap"), 4000, "error");
                return;
            }
            const plan = planImport(table, mapping, schemaCols, "name");
            if (plan.rows.length === 0) {
                showMessageFn(t("ledger.importNoRows"), 4000, "error");
                return;
            }
            startBtn.disabled = true;
            dlg.destroy();

            confirm(
                t("ledger.importCsv"),
                t("ledger.importConfirm")
                    .replace("${n}", String(plan.rows.length))
                    .replace("${skip}", String(plan.skipped))
                    .replace("${warnings}", String(plan.rows.reduce((n, row) => n + row.warnings.length, 0))),
                async () => {
                    try {
                        let ok = 0;
                        const importOperationKey = `ledger-import:${active}:${file.name}:${file.size}:${file.lastModified}`;
                        const failed: number[] = [];
                        const partial: number[] = [];
                        const pending: number[] = [];
                        for (let i = 0; i < plan.rows.length; i++) {
                            const row = plan.rows[i];
                            let created = false;
                            try {
                                const rowOperationKey = `${importOperationKey}:row:${i}`;
                                const itemID = await addDetachedRow(ref.avId!, row.name, { idempotencyKey: rowOperationKey });
                                created = true;
                                for (const c of row.cells) {
                                    if (ref.columns?.[c.key]) {
                                        await setCell(ref.avId!, ref.columns[c.key], itemID, cellValue(c.type, c.value), {
                                            idempotencyKey: `${rowOperationKey}:cell:${c.key}`,
                                        });
                                    }
                                }
                                ok++;
                            } catch (e) {
                                if (e instanceof RowIdentityPendingError) pending.push(i + 1);
                                else if (created) partial.push(i + 1);
                                else failed.push(i + 1);
                            }
                        }
                        if (onImportSuccess) await onImportSuccess();
                        const failTxt = failed.length ? ` · ${t("ledger.importRowFail").replace("${n}", String(failed.length))}` : "";
                        showMessageFn(t("ledger.importDone").replace("${n}", String(ok)) + failTxt, 4000, ok > 0 ? "info" : "error");
                    } catch (e) {
                        showMessageFn(String(e), 5000, "error");
                    }
                }
            );
        };
    };
    input.click();
}
