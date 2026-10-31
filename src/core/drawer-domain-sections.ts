/**
 * 台账行详情抽屉各生活领域专属智能分析卡片扩展板块
 * 包含：
 * 1. 房屋能耗与保修关联合同（House Warranty Contracts Matching）
 * 2. 食品忌口与过敏原排查（Food Dietary Conflicts & Allergen Inspection）
 * 3. 教育学段升学与毕业倒计时进度（Schooling Stage & Graduation Progress）
 * 4. 宠物照护与生理年龄换算（Pet Care & Human-Equivalent Age Evaluation）
 * 5. 育儿辅食观察排查与健康过敏原联运（Parenting Feeding Observation & Allergy Sync）
 * 6. 家庭成员社保退休测算（Social Member Retirement Milestone）
 */

import { uiIcon } from "@/ui/icons";
import { bindDialogA11y } from "./dialog-a11y";

export interface RenderHouseWarrantySectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    plugin: any;
    t: (k: string) => string;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
}

/**
 * 房屋台账：保修关联合同卡片
 */
export async function renderHouseWarrantySection(options: RenderHouseWarrantySectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, plugin, t, renderLedgerAllFn } = options;

    const contractsRef = plugin.settings?.dbRefs?.contracts;
    if (!contractsRef?.avId || !contractsRef?.columns) return;

    const houseWarrantySection = document.createElement("div");
    houseWarrantySection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = t("ledger.houseContractsTitle");
    head.append(title);
    if (contractsRef.docId) {
        const openAll = document.createElement("button");
        openAll.className = "b3-button b3-button--text lv-domain-link";
        openAll.textContent = t("ledger.houseContractsOpenAll");
        openAll.onclick = () => plugin.showTabDocs?.(contractsRef.docId);
        head.append(openAll);
    }
    houseWarrantySection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-dialog-sec";
    contentWrap.innerHTML = `<span class="lv-caption">${t("ledger.loading")}</span>`;
    houseWarrantySection.append(contentWrap);
    body.appendChild(houseWarrantySection);

    try {
        const contractAll = await renderLedgerAllFn(contractsRef.avId);
        const { matchHouseContracts } = await import("./contracts");
        const matched = matchHouseContracts(row, ref.columns ?? {}, contractAll.rows, contractsRef.columns);
        contentWrap.replaceChildren();
        if (matched.length === 0) {
            const empty = document.createElement("span");
            empty.className = "lv-caption";
            empty.textContent = t("ledger.houseContractsEmpty");
            contentWrap.append(empty);
            return;
        }
        for (const m of matched) {
            const line = document.createElement("div");
            line.className = "lv-domain-item";
            const nameSpan = document.createElement("b");
            nameSpan.className = "lv-dialog-name";
            nameSpan.textContent = m.title;

            const badge = document.createElement("span");
            if (m.warrantyStatus === "valid") {
                badge.className = "lv-badge green";
                badge.textContent = t("ledger.warrantyValid");
            } else if (m.warrantyStatus === "expiring") {
                badge.className = "lv-badge orange";
                badge.textContent = t("ledger.warrantyExpiring");
            } else if (m.warrantyStatus === "expired") {
                badge.className = "lv-badge gray";
                badge.textContent = t("ledger.warrantyExpired");
            } else {
                badge.className = "lv-badge gray";
                badge.textContent = t("ledger.warrantyUnknown");
            }

            const metaSpan = document.createElement("span");
            metaSpan.className = "lv-caption lv-ml-auto";
            const parts: string[] = [];
            if (m.party || m.contact) parts.push(m.party || m.contact);
            if (m.expiry) parts.push(m.daysLeft !== undefined && m.daysLeft >= 0 ? `${m.expiry} (${m.daysLeft}d)` : m.expiry);
            metaSpan.textContent = parts.join(" · ");

            line.append(nameSpan, badge, metaSpan);
            contentWrap.append(line);
        }
    } catch {
        contentWrap.innerHTML = `<span class="lv-caption lv-tx-danger">${t("ledger.houseContractsFailed")}</span>`;
    }
}

export interface RenderFoodDietarySectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    plugin: any;
    t: (k: string) => string;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
}

/**
 * 食品台账：忌口与过敏原排查卡片
 */
export async function renderFoodDietarySection(options: RenderFoodDietarySectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, plugin, t, showMessageFn, renderLedgerAllFn, cellTextFn } = options;

    const foodName = (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || "";
    const ingredientsRaw = (ref.columns?.ingredients && cellTextFn(row.cells?.[ref.columns.ingredients])) || "";
    if (!foodName && (!ingredientsRaw || ingredientsRaw === "—")) return;

    const foodDietarySection = document.createElement("div");
    foodDietarySection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = t("ledger.foodDietaryTitle");
    head.append(title);
    foodDietarySection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-dialog-sec";
    foodDietarySection.append(contentWrap);
    body.appendChild(foodDietarySection);

    try {
        const healthRef = plugin.settings?.dbRefs?.health;
        let healthRows: any[] | undefined;
        if (healthRef?.avId) {
            try {
                const healthAll = await renderLedgerAllFn(healthRef.avId);
                healthRows = healthAll.rows;
            } catch { /* soft */ }
        }
        const { matchFoodDietaryConflicts, formatShoppingIngredientsText } = await import("./food");
        const check = matchFoodDietaryConflicts(
            foodName,
            ingredientsRaw !== "—" ? ingredientsRaw : "",
            plugin.settings?.members ?? [],
            healthRows,
            healthRef?.columns,
        );

        contentWrap.replaceChildren();

        if (check.isSafe) {
            const safeBadge = document.createElement("div");
            safeBadge.className = "lv-domain-safe-badge";
            safeBadge.innerHTML = `${uiIcon("checkCircle", "", 13)} <span>${t("ledger.foodDietarySafe")}</span>`;
            contentWrap.append(safeBadge);
        } else {
            for (const c of check.conflicts) {
                const alertEl = document.createElement("div");
                if (c.type === "allergy") {
                    alertEl.className = "lv-domain-danger";
                    alertEl.innerHTML = `<span>${uiIcon("alert", "", 13)} <b>${c.memberName}</b>：${t("ledger.foodAllergyAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}${c.detail ? ` (${c.detail})` : ""}</span>`;
                } else {
                    alertEl.className = "lv-domain-warn";
                    alertEl.innerHTML = `<span>${uiIcon("info", "", 13)} <b>${c.memberName}</b>：${t("ledger.foodDislikeAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}</span>`;
                }
                contentWrap.append(alertEl);
            }
        }

        if (check.parsedIngredients.length > 0) {
            const actionRow = document.createElement("div");
            actionRow.className = "lv-domain-action-row";
            const copyIngBtn = document.createElement("button");
            copyIngBtn.className = "b3-button b3-button--outline lv-btn-text-sm";
            copyIngBtn.innerHTML = `${uiIcon("add", "", 12)} <span>${t("ledger.foodCopyIngredients")}</span>`;
            copyIngBtn.onclick = async () => {
                const text = formatShoppingIngredientsText(foodName, check.parsedIngredients);
                try {
                    await navigator.clipboard.writeText(text);
                    showMessageFn(t("ledger.foodIngredientsCopied"), 2500, "info");
                } catch {
                    showMessageFn(t("ledger.copyAsImageFail"), 4000, "error");
                }
            };
            actionRow.append(copyIngBtn);
            contentWrap.append(actionRow);
        }
    } catch {
        /* soft fail */
    }
}

export interface RenderSchoolingStageSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    t: (k: string) => string;
    cellTextFn: (cell: any, key?: string) => string;
}

/**
 * 教育台账：学段进度与毕业倒计时卡片
 */
export async function renderSchoolingStageSection(options: RenderSchoolingStageSectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, t, cellTextFn } = options;

    const catVal = ref.columns?.category ? cellTextFn(row.cells?.[ref.columns.category]) : "";
    const enrollRaw = ref.columns?.enroll_year ? cellTextFn(row.cells?.[ref.columns.enroll_year]) : "";
    const enrollYear = Number(enrollRaw);
    const statusVal = ref.columns?.status ? cellTextFn(row.cells?.[ref.columns.status]) : "enrolled";

    if (!catVal || !Number.isFinite(enrollYear) || enrollYear < 1980) return;

    const schoolStageSection = document.createElement("div");
    schoolStageSection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = t("ledger.schoolingStageTitle");
    head.append(title);
    schoolStageSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-domain-box";
    schoolStageSection.append(contentWrap);
    body.appendChild(schoolStageSection);

    try {
        const { calculateSchoolingStage } = await import("./schooling");
        const stage = calculateSchoolingStage({
            category: catVal,
            enrollYear,
            status: statusVal,
        });

        if (stage) {
            const badgeCls = stage.isGraduated ? "green" : stage.daysUntilGraduation <= 100 ? "orange" : "blue";
            const badgeText = stage.isGraduated
                ? t("ledger.schoolingGraduated")
                : t("ledger.schoolingDaysUntil").replace("${n}", String(stage.daysUntilGraduation));

            contentWrap.innerHTML = `
                <div class="lv-row-split">
                  <span><b>${stage.currentGradeLabel}</b> · ${stage.transitionEventLabel}</span>
                  <span class="lv-badge ${badgeCls}">${badgeText}</span>
                </div>
                <div class="lv-row-split lv-caption">
                  <span>${t("ledger.schoolingGraduationDate")}: ${stage.graduationDate} (${stage.stageTotalYears} 年制)</span>
                  <span>${t("ledger.schoolingProgress")}: ${stage.stageProgressPercent}%</span>
                </div>
                <div class="lv-meter">
                  <div style="height:100%;background:var(--lv-data-accent);width:${stage.stageProgressPercent}%;border-radius:999px"></div>
                </div>`;
        }
    } catch {
        /* soft fail */
    }
}

export interface RenderPetCareSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    t: (k: string) => string;
    cellTextFn: (cell: any, key?: string) => string;
}

/**
 * 宠物台账：生理年龄换算与照护提醒卡片
 */
export async function renderPetCareSection(options: RenderPetCareSectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, t, cellTextFn } = options;

    const speciesVal = ref.columns?.species ? cellTextFn(row.cells?.[ref.columns.species]) : "cat";
    const vdueVal = ref.columns?.vaccine_due ? cellTextFn(row.cells?.[ref.columns.vaccine_due]) : undefined;
    const ddueVal = ref.columns?.deworm_due ? cellTextFn(row.cells?.[ref.columns.deworm_due]) : undefined;
    const noteVal = ref.columns?.note ? cellTextFn(row.cells?.[ref.columns.note]) : "";

    const birthMatch = noteVal.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];

    const petCareSection = document.createElement("div");
    petCareSection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = t("ledger.petCareTitle");
    head.append(title);
    petCareSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-domain-box";
    petCareSection.append(contentWrap);
    body.appendChild(petCareSection);

    try {
        const { evaluatePetSummary } = await import("./pets");
        const summary = evaluatePetSummary(
            birthMatch,
            speciesVal,
            vdueVal !== "—" ? vdueVal : undefined,
            ddueVal !== "—" ? ddueVal : undefined,
        );

        contentWrap.replaceChildren();

        if (summary.ageInfo) {
            const ageLine = document.createElement("div");
            ageLine.className = "lv-dialog-row";
            ageLine.innerHTML = `
                <span>${t("ledger.petAgeEquivalent")}: <b>${summary.ageInfo.humanEquivalentAge} 岁</b> (${summary.ageInfo.chronologicalYears} 岁 ${summary.ageInfo.chronologicalMonths} 个月)</span>
                <span class="lv-badge purple">${summary.ageInfo.lifeStageLabel}</span>
            `;
            const desc = document.createElement("div");
            desc.className = "lv-caption";
            desc.style.fontSize = "11px";
            desc.style.lineHeight = "1.4";
            desc.textContent = summary.ageInfo.description;
            contentWrap.append(ageLine, desc);
        }

        const careGrid = document.createElement("div");
        careGrid.className = "lv-grid-2 lv-mt-2";

        const badgeCls = (u: string) => u === "overdue" ? "danger" : u === "soon" ? "orange" : u === "ok" ? "green" : "gray";

        const vBox = document.createElement("div");
        vBox.className = "lv-domain-subbox";
        vBox.innerHTML = `
            <div class="lv-row-split">
                <span style="font-weight:500">${t("field.vaccine_due")}</span>
                <span class="lv-badge ${badgeCls(summary.vaccine.urgency)}">${summary.vaccine.label}</span>
            </div>
            <span class="lv-caption" style="font-size:11px">${summary.vaccine.dueDate ? summary.vaccine.dueDate : "未填写"}</span>
        `;

        const dBox = document.createElement("div");
        dBox.className = "lv-domain-subbox";
        dBox.innerHTML = `
            <div class="lv-row-split">
                <span style="font-weight:500">${t("field.deworm_due")}</span>
                <span class="lv-badge ${badgeCls(summary.deworm.urgency)}">${summary.deworm.label}</span>
            </div>
            <span class="lv-caption" style="font-size:11px">${summary.deworm.dueDate ? summary.deworm.dueDate : "未填写"}</span>
        `;

        careGrid.append(vBox, dBox);
        contentWrap.append(careGrid);
    } catch {
        /* soft fail */
    }
}

export interface RenderParentingFeedingSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
}

/**
 * 育儿台账：辅食排查观察与健康过敏原联运卡片
 */
export async function renderParentingFeedingSection(options: RenderParentingFeedingSectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = options;

    const catVal = ref.columns?.category ? cellTextFn(row.cells?.[ref.columns.category]) : "";
    if (catVal !== "feeding" && catVal !== t("field.category.opt.feeding")) return;

    const dateVal = ref.columns?.date ? cellTextFn(row.cells?.[ref.columns.date]) : "";
    const foodName = (ref.columns?.name && cellTextFn(row.cells?.[ref.columns.name])) || "";
    const memberBlockId = ref.columns?.member ? row.cells?.[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;

    const feedingSection = document.createElement("div");
    feedingSection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = t("ledger.feedingObserveTitle");
    head.append(title);
    feedingSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-dialog-sec";
    contentWrap.style.fontSize = "12.5px";
    feedingSection.append(contentWrap);
    body.appendChild(feedingSection);

    try {
        const { evaluateFeedingObservation, findMemberAllergies, checkAllergyConflict } = await import("./feeding");
        const obs = evaluateFeedingObservation(dateVal);

        if (obs) {
            const statusLine = document.createElement("div");
            statusLine.className = "lv-domain-item";
            const badge = document.createElement("span");
            if (obs.status === "observing") {
                badge.className = "lv-badge orange";
                badge.textContent = obs.dayProgressText;
            } else if (obs.status === "completed") {
                badge.className = "lv-badge green";
                badge.textContent = t("ledger.feedingObserveDone");
            } else {
                badge.className = "lv-badge gray";
                badge.textContent = obs.dayProgressText;
            }
            const timeText = document.createElement("span");
            timeText.className = "lv-caption lv-ml-auto";
            timeText.textContent = `${t("ledger.feedingObserveUntil")}: ${obs.observeUntil}`;
            statusLine.append(badge, timeText);
            contentWrap.append(statusLine);
        }

        const healthRef = plugin.settings?.dbRefs?.health;
        if (healthRef?.avId && healthRef?.columns) {
            try {
                const healthAll = await renderLedgerAllFn(healthRef.avId);
                const allergies = findMemberAllergies(memberBlockId, healthAll.rows, healthRef.columns);
                const conflict = checkAllergyConflict(foodName, allergies);

                if (conflict) {
                    const alertLine = document.createElement("div");
                    alertLine.className = "lv-domain-danger";
                    alertLine.innerHTML = `<span>${uiIcon("alert", "", 13)} ${t("ledger.feedingAllergyConflict").replace("${food}", conflict.name)}${conflict.reaction ? `（${conflict.reaction}）` : ""}</span>`;
                    contentWrap.append(alertLine);
                }
            } catch { /* soft */ }
        }

        if (healthRef?.avId && healthRef?.columns) {
            const actionRow = document.createElement("div");
            actionRow.className = "lv-domain-action-row";
            const addAllergyBtn = document.createElement("button");
            addAllergyBtn.className = "b3-button b3-button--outline lv-btn-text-sm";
            addAllergyBtn.innerHTML = `${uiIcon("add", "", 13)} ${t("ledger.recordAllergyToHealth")}`;
            addAllergyBtn.onclick = () => {
                const adlg = new DialogCls({
                    title: t("ledger.recordAllergyTitle"),
                    content: `<div class="b3-dialog__content lv-dialog-col">
                        <p class="lv-caption" style="margin:0">${t("ledger.recordAllergyIntro").replace("${food}", foodName)}</p>
                        <input class="b3-text-field" id="lv-allergy-reaction" placeholder="${t("ledger.recordAllergyReactionPlaceholder")}" style="width:100%" />
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="lv-allergy-cancel">${t("cancel")}</button>
                        <button class="b3-button" id="lv-allergy-save">${t("save")}</button>
                    </div>`,
                    width: "420px",
                });
                const reactionInput = adlg.element.querySelector("#lv-allergy-reaction") as HTMLInputElement;
                (adlg.element.querySelector("#lv-allergy-cancel") as HTMLButtonElement).onclick = () => adlg.destroy();
                bindDialogA11y({ dlg: adlg, defaultFocus: "#lv-allergy-reaction" });
                (adlg.element.querySelector("#lv-allergy-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                    this.disabled = true;
                    try {
                        // 经写入网关：分类走 select 双形态（此前单形态数组，内核 3.8.x 落盘为空）
                        const { writeLedgerRow } = await import("./ledger-writer");
                        const { failed } = await writeLedgerRow({
                            moduleId: "health",
                            target: healthRef,
                            name: foodName,
                            fields: { category: "allergy", member: memberBlockId, note: reactionInput.value.trim() },
                            operationKey: `allergy-sync:${row.itemID}:${Date.now()}`,
                        });
                        adlg.destroy();
                        if (failed.length > 0) {
                            showMessageFn(t("ledger.writePartialFailed").replace("${fields}", failed.map((k) => t(`field.${k}`)).join("、")), 6000, "error");
                        } else {
                            showMessageFn(t("ledger.recordAllergyDone"), 3000, "info");
                        }
                    } catch (err) {
                        showMessageFn(t("ledger.recordAllergyFailed").replace("${msg}", err instanceof Error ? err.message : String(err)), 5000, "error");
                        this.disabled = false;
                    }
                };
            };
            actionRow.append(addAllergyBtn);
            contentWrap.append(actionRow);
        }
    } catch {
        /* soft fail */
    }
}

export interface RenderSocialRetirementSectionOptions {
    body: HTMLElement;
    row: any;
    ref: { columns?: Record<string, string> };
    plugin: any;
    t: (k: string) => string;
}

/**
 * 社交/家庭台账：退休里程碑进度测算卡片
 */
export async function renderSocialRetirementSection(options: RenderSocialRetirementSectionOptions): Promise<void> {
    if (typeof document === "undefined") return;
    const { body, row, ref, plugin, t } = options;

    const memberBlockId = ref.columns?.member ? row.cells?.[ref.columns.member]?.relation?.blockIDs?.[0] : undefined;
    const member = memberBlockId ? (plugin.settings?.members ?? []).find((m: any) => m.avItemId === memberBlockId) : undefined;
    if (!member?.birthday) return;

    const socialRetireSection = document.createElement("div");
    socialRetireSection.className = "lv-detail-section lv-domain-sec";

    const head = document.createElement("div");
    head.className = "lv-domain-head";
    const title = document.createElement("span");
    title.className = "ft__on-surface lv-domain-title";
    title.textContent = `${t("members.retirementTitle")} · ${member.name}`;
    head.append(title);
    socialRetireSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.className = "lv-domain-box";
    socialRetireSection.append(contentWrap);
    body.appendChild(socialRetireSection);

    try {
        const { calculateRetirement } = await import("./retirement");
        const ret = calculateRetirement({ birthday: member.birthday, sex: member.sex });
        if (ret) {
            const delayText = ret.delayedMonths > 0 ? ` · ${t("members.retirementDelay").replace("${n}", String(ret.delayedMonths))}` : "";
            const daysBadge = ret.isRetired
                ? `<span class="lv-badge green">${t("members.retirementRetired")}</span>`
                : `<span class="lv-badge orange">${t("members.retirementDaysLeft").replace("${n}", String(ret.daysLeft))}</span>`;

            contentWrap.innerHTML = `
                <div class="lv-row-split">
                    <span>${t("members.retirementTarget")}: <b>${ret.targetRetireDate}</b> (${t("members.retirementAge").replace("${age}", String(ret.targetRetireAge))}${delayText})</span>
                    ${daysBadge}
                </div>
                <div class="lv-row-split lv-caption">
                    <span>${t("members.retirementCareerProgress")}</span>
                    <span>${ret.careerProgressPercent}%</span>
                </div>
                <div class="lv-meter">
                    <div style="height:100%;background:var(--lv-accent);width:${ret.careerProgressPercent}%;border-radius:999px"></div>
                </div>`;
        }
    } catch {
        /* soft fail */
    }
}
