/**
 * 全景生活检索对话框（Spotlight Dialog）：
 * 跨所有已启用模块实时并发检索家庭数据，支持键盘上下导航、回车直达或点击直达对应台账。
 * 独立模块，按需延迟加载。
 */
import { searchSpotlight, searchSpotlightCommands, type SpotlightItem } from "./spotlight";
import { showMessage } from "@/libs/notice";
import { ensurePinyin } from "./pinyin";
import { formatLocationBreadcrumbTag } from "./location-index";
import { uiIcon, moduleUiIcon, type UiIconName } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";

const CMD_ICONS: Record<string, UiIconName> = {
    "open-capture": "bolt",
    "open-location": "mapPin",
    "open-emergency": "alert",
    "open-store-mode": "cart",
    "open-life-index": "shield",
    "open-reminders": "clock",
    "open-settings": "settings",
};

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export interface SpotlightDialogOptions {
    t: (k: string) => string;
    plugin: {
        settings: {
            enabledModules?: string[];
            dbRefs: Record<string, { avId?: string; columns?: Record<string, string> }>;
            members?: Array<{ id: string; name: string; avItemId?: string }>;
        };
        schemaCatalog?: Record<string, any>;
    };
    DialogCls: new (options: { title?: string; content: string; width?: string; destroy?: () => void }) => {
        element: HTMLElement;
        destroy: () => void;
    };
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    onNavigateToTarget: (target: { moduleId: string; rowId: string }) => void;
}

export async function openSpotlightDialog(options: SpotlightDialogOptions): Promise<void> {
    if (typeof document !== "undefined" && document.querySelector(".lv-spotlight-dialog-body")) return;
    const { t, plugin, DialogCls, renderLedgerAllFn, cellTextFn, onNavigateToTarget } = options;

    // 预先保证拼音字典加载就绪
    void ensurePinyin();

    const enabled = (plugin.settings.enabledModules ?? []).filter((id) => id !== "adhoc");
    const modLabel = (m: string) => (t(`module.${m}`) !== `module.${m}` ? t(`module.${m}`) : m);
    const memberNameMap = new Map((plugin.settings.members ?? []).map((m) => [m.avItemId ?? m.id, m.name]));

    let debounceTimer: number | undefined;

    const dlg = new DialogCls({
        title: "",
        content: `
            <div class="b3-dialog__content lv-spotlight-dialog-body">
                <div class="lv-spotlight-input-wrap">
                    <span class="lv-spotlight-icon">${uiIcon("search", "", 16)}</span>
                    <input class="b3-text-field lv-spotlight-input" id="lv-spotlight-input"
                        placeholder="${t("spotlight.placeholder") || "输入生活记录、物品、证件、存放位置或备注..."}" />
                    <button type="button" class="lv-iconbtn lv-spotlight-close-btn" id="lv-spotlight-close" aria-label="${t("close") || "关闭"}" title="${t("close") || "关闭"}">✕</button>
                </div>
                <div id="lv-spotlight-status" class="lv-caption lv-tx-muted lv-dialog-topbar">
                    <span>${t("spotlight.loading") || "正在索引家庭数据..."}</span>
                </div>
                <div id="lv-spotlight-list" class="lv-dialog-scroll-body lv-spotlight-list"></div>
            </div>
        `,
        width: "600px",
    });

    const inp = dlg.element.querySelector("#lv-spotlight-input") as HTMLInputElement;
    const statusEl = dlg.element.querySelector("#lv-spotlight-status") as HTMLElement;
    const listEl = dlg.element.querySelector("#lv-spotlight-list") as HTMLElement;
    const closeBtn = dlg.element.querySelector("#lv-spotlight-close") as HTMLButtonElement | null;
    if (closeBtn) {
        closeBtn.onclick = () => dlg.destroy();
    }

    let isClosed = false;
    bindDialogA11y({
        dlg,
        defaultFocus: inp,
        onClose: () => {
            isClosed = true;
            if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
        },
    });

    // 1. 并发拉取全部模块数据
    const allItems: SpotlightItem[] = [];
    const loadPromises = enabled.map(async (modId) => {
        const ref = plugin.settings.dbRefs?.[modId];
        if (!ref?.avId || !ref.columns) return;
        try {
            const data = await renderLedgerAllFn(ref.avId);
            const cols = ref.columns;
            for (const r of data.rows ?? []) {
                const title = String(cellTextFn(r.cells?.[cols.name], "name") ?? "").trim();
                if (!title || title === "—") continue;

                let memberName = "";
                if (cols.member && r.cells?.[cols.member]?.relation?.blockIDs?.length) {
                    const mId = r.cells[cols.member].relation.blockIDs[0];
                    memberName = memberNameMap.get(mId) || "";
                }

                const locKey = cols.location || cols.store_place || cols.copy_location;
                const locVal = locKey ? String(cellTextFn(r.cells?.[locKey], "location") ?? "").trim() : "";
                const catVal = cols.category ? String(cellTextFn(r.cells?.[cols.category], "category") ?? "").trim() : "";
                const dueKey = cols.expiry || cols.due || cols.date;
                const dueVal = dueKey ? String(cellTextFn(r.cells?.[dueKey], "date") ?? "").trim() : "";
                const amountVal = cols.amount ? Number(r.cells?.[cols.amount]?.number?.content) : undefined;
                const noteVal = cols.note ? String(cellTextFn(r.cells?.[cols.note], "note") ?? "").trim() : "";

                allItems.push({
                    rowId: r.itemID,
                    moduleId: modId,
                    title,
                    location: locVal && locVal !== "—" ? locVal : undefined,
                    category: catVal && catVal !== "—" ? catVal : undefined,
                    memberName: memberName || undefined,
                    dueDate: dueVal && dueVal !== "—" ? dueVal : undefined,
                    amount: Number.isFinite(amountVal) ? amountVal : undefined,
                    note: noteVal && noteVal !== "—" ? noteVal : undefined,
                });
            }
        } catch { /* skip unreadable modules */ }
    });

    await Promise.all(loadPromises);
    if (isClosed) return;

    const renderResults = (query: string) => {
        const matched = searchSpotlight(allItems, query, 30);
        const matchedCmds = searchSpotlightCommands(query);
        statusEl.innerHTML = `
            <span>${query ? t("spotlight.resultsCount").replace("${n}", String(matched.length + matchedCmds.length)) : t("spotlight.totalIndexed").replace("${n}", String(allItems.length))}</span>
            <span style="font-size:11px">${t("spotlight.hint")}${t("spotlight.cmdTriggerHint")} · ${t("spotlight.filterTagHint")}</span>
        `;
        listEl.innerHTML = "";

        if (matched.length === 0 && matchedCmds.length === 0) {
            const safeQ = escapeHtml(query);
            listEl.innerHTML = `
                <div class="lv-spotlight-empty">
                    ${t("spotlight.empty").replace("${q}", safeQ)}
                </div>
            `;
            return;
        }

        // 渲染匹配的快捷命令项
        matchedCmds.forEach((cmd, idx) => {
            const numKey = idx < 9 ? String(idx + 1) : "";
            const card = document.createElement("div");
            card.className = "lv-card lv-spotlight-cmd";
            card.tabIndex = 0;
            if (numKey) card.setAttribute("data-cmd-num", numKey);
            card.innerHTML = `
                <div class="lv-spotlight-item-head">
                    ${numKey ? `<span class="lv-badge lv-badge--xs lv-badge--cmd-num" title="${escapeHtml(t("spotlight.cmdNumTip").replace("${n}", numKey))}">${numKey}</span>` : ""}
                    <span class="lv-spotlight-icon-item">${uiIcon(CMD_ICONS[cmd.action] ?? "bolt", "", 16)}</span>
                    <b>${escapeHtml(cmd.title)}</b>
                    <span class="lv-caption lv-tx-muted">${escapeHtml(cmd.sub)}</span>
                </div>
                <span class="lv-badge lv-badge--accent lv-badge--sm">${escapeHtml(t("spotlight.cmdBadge"))}</span>
            `;
            const runCmd = () => {
                dlg.destroy();
                if (typeof window !== "undefined") {
                    if (cmd.action === "open-capture") window.dispatchEvent(new CustomEvent("siyuan-home:open-capture"));
                    else if (cmd.action === "open-location") window.dispatchEvent(new CustomEvent("siyuan-home:open-location"));
                    else if (cmd.action === "open-emergency") window.dispatchEvent(new CustomEvent("siyuan-home:open-emergency"));
                    else if (cmd.action === "open-life-index") window.dispatchEvent(new CustomEvent("siyuan-home:open-life-index"));
                    else if (cmd.action === "open-reminders") (plugin as any).openRemindersScreen?.();
                    else if (cmd.action === "open-settings") (plugin as any).openSetting?.();
                    else if (cmd.action === "open-store-mode") window.dispatchEvent(new CustomEvent("siyuan-home:open-store"));
                }
            };
            card.onclick = runCmd;
            card.onkeydown = (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    runCmd();
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    (card.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (card.previousElementSibling) (card.previousElementSibling as HTMLElement).focus();
                    else inp.focus();
                }
            };
            listEl.appendChild(card);
        });

        for (const item of matched) {
            const card = document.createElement("div");
            card.className = "lv-card lv-spotlight-item";
            card.tabIndex = 0;

            const top = document.createElement("div");
            top.className = "lv-spotlight-item__top";

            const left = document.createElement("div");
            left.className = "lv-spotlight-item-head";
            const safeTitle = escapeHtml(item.title);
            left.innerHTML = `
                <span class="lv-spotlight-icon-item">${uiIcon(moduleUiIcon(item.moduleId), "", 16)}</span>
                <b>${safeTitle}</b>
            `;

            const rightOps = document.createElement("div");
            rightOps.className = "lv-spotlight-item__ops";

            const copyRef = document.createElement("button");
            copyRef.type = "button";
            copyRef.className = "b3-button b3-button--text lv-badge--sm lv-tx-muted";
            copyRef.title = `${t("ledger.copyBlockRef")} ((id "title")) (Alt+C)`;
            copyRef.textContent = t("spotlight.copyRef");
            copyRef.onclick = async (e) => {
                e.stopPropagation();
                const blockRefText = `((${item.rowId} "${item.title}"))`;
                try {
                    await navigator.clipboard.writeText(blockRefText);
                    showMessage(t("spotlight.refCopied"), 2500, "info");
                } catch (err) {
                    showMessage(t("ledger.copyAsImageFail") + ` (${err instanceof Error ? err.message : String(err)})`, 4000, "error");
                }
            };

            const badge = document.createElement("span");
            badge.className = "lv-badge lv-badge--sm";
            badge.textContent = modLabel(item.moduleId);

            rightOps.append(copyRef, badge);
            top.append(left, rightOps);

            const meta = document.createElement("div");
            meta.className = "lv-spotlight-item__meta";

            const metaParts: string[] = [];
            if (item.memberName) metaParts.push(`<span>${uiIcon("users", "", 11)} ${escapeHtml(item.memberName)}</span>`);
            if (item.location) metaParts.push(`<span>${uiIcon("mapPin", "", 11)} ${escapeHtml(formatLocationBreadcrumbTag(item.location))}</span>`);
            if (item.dueDate) metaParts.push(`<span>${uiIcon("calendar", "", 11)} ${escapeHtml(item.dueDate)}</span>`);
            if (item.amount !== undefined) metaParts.push(`<span>${uiIcon("money", "", 11)} ¥${item.amount}</span>`);
            if (item.note) metaParts.push(`<span>${uiIcon("note", "", 11)} ${escapeHtml(item.note.slice(0, 24))}</span>`);
            meta.innerHTML = metaParts.join("");

            card.append(top, meta);
            card.onkeydown = (e) => {
                if (e.key === "Enter") {
                    dlg.destroy();
                    onNavigateToTarget({ moduleId: item.moduleId, rowId: item.rowId });
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    (card.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (card.previousElementSibling) (card.previousElementSibling as HTMLElement).focus();
                    else inp.focus();
                } else if ((e.key === "c" || e.key === "C") && (e.altKey || e.metaKey)) {
                    e.preventDefault();
                    copyRef.click();
                }
            };
            card.onclick = () => {
                if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
                dlg.destroy();
                onNavigateToTarget({ moduleId: item.moduleId, rowId: item.rowId });
            };

            listEl.appendChild(card);
        }
    };

    renderResults("");

    inp.oninput = () => {
        if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            renderResults(inp.value);
        }, 120);
    };

    inp.onkeydown = (e) => {
        /* IME 合成期让路：ArrowDown 属候选导航，Enter 属确认选字。 */
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
            if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
            dlg.destroy();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            (listEl.firstElementChild as HTMLElement | null)?.focus();
        } else if (e.key === "Enter") {
            e.preventDefault();
            (listEl.firstElementChild as HTMLElement | null)?.click();
        } else if (inp.value.startsWith(">") && /^[1-9]$/.test(e.key)) {
            const targetNumCard = listEl.querySelector<HTMLElement>(`[data-cmd-num="${e.key}"]`);
            if (targetNumCard) {
                e.preventDefault();
                targetNumCard.click();
            }
        }
    };
}
