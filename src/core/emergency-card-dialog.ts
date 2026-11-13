/**
 * 家庭急救与应急卡弹窗（318波）：
 * 聚合全家血型、已知过敏源、慢病用药、医保卡号、急救箱存放处与应急联络方式，
 * 在突发急救或访客只读模式下提供一键可达的生命支持卡片。
 * 独立模块，按需延迟加载以减轻主包负担。
 */

import { buildFamilyEmergencyCard, formatEmergencyCardText, generateEmergencyCards, formatEmergencyCardsMarkdown, type HealthRowLike, type CertRowLike, type StockRowLike } from "./emergency-card";
import type { AvRow } from "./siyuan";
import type { AvCellLike } from "./avcell";
import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";
import { createReadTracker, escapeHtml, modalWarningHtml } from "./modal-shell";

export interface EmergencyCardDialogOptions {
    t: (k: string) => string;
    plugin: {
        settings: {
            members?: Array<{ id: string; name: string; role?: string; notes?: string; contactSnapshot?: string; avItemId?: string }>;
            dbRefs: Record<string, { avId?: string; columns?: Record<string, string> }>;
        };
        runtime?: { guestModeActive?: boolean };
    };
    DialogCls: new (options: { title: string; content: string; width?: string }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    showMessageFn: (message: string, timeout?: number, type?: "info" | "error") => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: AvRow[] }>;
    cellTextFn: (v: AvCellLike | null | undefined, k?: string) => string;
}

export async function openEmergencyCardDialog(opts: EmergencyCardDialogOptions): Promise<void> {
    const { t, plugin, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = opts;

    const members = plugin.settings.members ?? [];
    const memberMap = new Map(members.map((m) => [m.avItemId ?? m.id, m.id]));

    const healthRef = plugin.settings.dbRefs?.health;
    const certsRef = plugin.settings.dbRefs?.certs;
    const stockRef = plugin.settings.dbRefs?.stock;

    const healthRows: HealthRowLike[] = [];
    const certRows: CertRowLike[] = [];
    const stockRows: StockRowLike[] = [];

    // 并行拉取各模块真实台账行；读取失败或不完整的模块记下来，弹窗顶部如实提示
    const reads = createReadTracker();
    await Promise.all([
        (async () => {
            if (!healthRef?.avId || !healthRef.columns) return;
            {
                const res = await reads.read("health", () => renderLedgerAllFn(healthRef.avId!));
                if (!res) return;
                for (const r of res.rows) {
                    const memId = memberMap.get(String(r.cells[healthRef.columns.member ?? ""]?.relation?.blockIDs?.[0] ?? ""));
                    const cat = cellTextFn(r.cells[healthRef.columns.category ?? ""]);
                    const diag = healthRef.columns.diagnosis ? cellTextFn(r.cells[healthRef.columns.diagnosis]) : undefined;
                    const name = healthRef.columns.name ? cellTextFn(r.cells[healthRef.columns.name]) : undefined;
                    const note = healthRef.columns.note ? cellTextFn(r.cells[healthRef.columns.note]) : undefined;
                    healthRows.push({ memberId: memId, category: cat, diagnosis: diag, name, note });
                }
            }
        })(),
        (async () => {
            if (!certsRef?.avId || !certsRef.columns) return;
            {
                const res = await reads.read("certs", () => renderLedgerAllFn(certsRef.avId!));
                if (!res) return;
                for (const r of res.rows) {
                    const memId = memberMap.get(String(r.cells[certsRef.columns.member ?? ""]?.relation?.blockIDs?.[0] ?? ""));
                    const cat = cellTextFn(r.cells[certsRef.columns.category ?? ""]);
                    const no = certsRef.columns.number ? cellTextFn(r.cells[certsRef.columns.number]) : undefined;
                    const name = certsRef.columns.name ? cellTextFn(r.cells[certsRef.columns.name]) : undefined;
                    certRows.push({ memberId: memId, category: cat, number: no, name });
                }
            }
        })(),
        (async () => {
            if (!stockRef?.avId || !stockRef.columns) return;
            {
                const res = await reads.read("stock", () => renderLedgerAllFn(stockRef.avId!));
                if (!res) return;
                for (const r of res.rows) {
                    const cat = cellTextFn(r.cells[stockRef.columns.category ?? ""]);
                    const name = stockRef.columns.name ? cellTextFn(r.cells[stockRef.columns.name]) : undefined;
                    const loc = stockRef.columns.location ? cellTextFn(r.cells[stockRef.columns.location]) : undefined;
                    stockRows.push({ category: cat, name, location: loc });
                }
            }
        })(),
    ]);

    const card = buildFamilyEmergencyCard({
        members,
        healthRows,
        certRows,
        stockRows,
    });

    const isGuest = Boolean(plugin.runtime?.guestModeActive);
    const cardText = formatEmergencyCardText(card, { maskSensitive: isGuest });

    const dlg = new DialogCls({
        title: t("overview.emergencyCardTitle"),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="lv-ecard-body">
  ${modalWarningHtml(reads.failed.length ? [t("modal.readIncomplete").replace("${modules}", reads.failed.map((m) => t(`module.${m}`)).join("、"))] : [])}
  ${card.emergencyKitLocation ? `<div class="lv-ecard-location"><span>${uiIcon("box", "", 13)} ${t("overview.emergencyKitLocation")}: <b>${escapeHtml(card.emergencyKitLocation)}</b></span></div>` : ""}
  <div id="lv-ecard-members" class="lv-ecard-list"></div>
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("close")}</button>
  <button class="b3-button b3-button--outline" id="lv-ecard-flashcards">${uiIcon("idCard", "", 13)} ${t("overview.exportFlashcards")}</button>
  <button class="b3-button" id="lv-ecard-copy">${uiIcon("copy", "", 13)} ${t("overview.copyEmergencyCard") || "复制急救卡"}</button>
</div>`,
        width: "600px",
    });

    const membersEl = dlg.element.querySelector("#lv-ecard-members") as HTMLElement;
    (dlg.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dlg.destroy();
    bindDialogA11y({ dlg });

    for (const m of card.members) {
        const item = document.createElement("div");
        item.className = "lv-ecard-member-card";

        const head = document.createElement("div");
        head.className = "lv-ecard-member-head";

        const nameLine = document.createElement("div");
        nameLine.className = "lv-ecard-nameline";
        const roleLabel = t(`role.${m.role}`) !== `role.${m.role}` ? t(`role.${m.role}`) : m.role;
        nameLine.innerHTML = `<b>${escapeHtml(m.name)}</b><span class="lv-badge gray">${escapeHtml(roleLabel)}</span>`;
        if (m.bloodType) {
            nameLine.innerHTML += `<span class="lv-badge orange">${uiIcon("heartPulse", "", 11)} ${escapeHtml(m.bloodType)}</span>`;
        }

        const contact = document.createElement("span");
        contact.className = "lv-caption";
        if (m.emergencyContact) {
            contact.textContent = `📞 ${m.emergencyContact}`;
        }
        head.append(nameLine, contact);
        item.appendChild(head);

        if (m.allergies.length > 0) {
            const allSec = document.createElement("div");
            allSec.className = "lv-ecard-allergies";
            allSec.innerHTML = `<span class="lv-badge red">${uiIcon("alert", "", 12)} ${t("overview.emergencyAllergies")}</span>`;
            for (const a of m.allergies) {
                const b = document.createElement("span");
                b.className = "lv-badge red";
                b.textContent = a;
                allSec.appendChild(b);
            }
            item.appendChild(allSec);
        }

        if (m.chronicConditions.length > 0) {
            const condSec = document.createElement("div");
            condSec.className = "lv-caption";
            condSec.textContent = `🩺 ${t("overview.emergencyConditions")}: ${m.chronicConditions.join("、")}`;
            item.appendChild(condSec);
        }

        if (m.medicalInsuranceNo) {
            const insSec = document.createElement("div");
            insSec.className = "lv-caption";
            let no = m.medicalInsuranceNo;
            if (isGuest && no.length > 8) no = no.slice(0, 4) + " **** **** " + no.slice(-4);
            insSec.textContent = `💳 ${t("overview.emergencyInsurance")}: ${no}`;
            item.appendChild(insSec);
        }

        membersEl.appendChild(item);
    }

    (dlg.element.querySelector("#lv-ecard-flashcards") as HTMLButtonElement | null)?.addEventListener("click", async () => {
        const cards = generateEmergencyCards(card);
        if (!cards.length) {
            showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
            return;
        }
        const md = formatEmergencyCardsMarkdown(cards);
        try {
            await navigator.clipboard.writeText(md);
            showMessageFn(t("overview.flashcardsCopied").replace("${n}", String(cards.length)), 3500, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
        }
    });

    (dlg.element.querySelector("#lv-ecard-copy") as HTMLButtonElement).onclick = async () => {
        try {
            await navigator.clipboard.writeText(cardText);
            showMessageFn(t("overview.lifeIndexCopied"), 2500, "info");
        } catch {
            showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
        }
    };
}
