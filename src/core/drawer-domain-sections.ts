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

export const sectionBorderCss = "margin-top:14px;padding-top:10px;border-top:1px solid var(--lv-line)";
export const flexBetweenCenterGap8Css = "display:flex;align-items:center;justify-content:space-between;gap:8px";
export const sectionHeaderCss = `${flexBetweenCenterGap8Css};margin-bottom:8px`;
export const sectionTitleCss = "font-weight:600;font-size:12px";
export const lineBadgeCss = "display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line)";
export const linkBtnCss = "font-size:11.5px;padding:0 4px;color:var(--lv-accent)";
export const boxContentCss = "padding:10px 12px;background:var(--lv-surface-2);border-radius:8px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:6px;font-size:12px";
export const actionRowEndCss = "display:flex;align-items:center;justify-content:flex-end;margin-top:2px";
export const flexColGap6Css = "display:flex;flex-direction:column;gap:6px";
export const dangerAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-danger-soft);border-radius:6px;border:1px solid var(--lv-danger);color:var(--lv-danger);font-size:12px";
export const warnAlertCss = "display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-line);color:var(--lv-warn);font-size:12px";
export const pad6BorderSurfaceCss = "padding:6px 8px;background:var(--lv-surface);border-radius:6px;border:1px solid var(--lv-line);display:flex;flex-direction:column;gap:3px";
export const fs12Pad38Css = "font-size:12px;padding:3px 8px";

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
    houseWarrantySection.className = "lv-detail-section";
    houseWarrantySection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = t("ledger.houseContractsTitle");
    head.append(title);
    if (contractsRef.docId) {
        const openAll = document.createElement("button");
        openAll.className = "b3-button b3-button--text";
        openAll.style.cssText = linkBtnCss;
        openAll.textContent = t("ledger.houseContractsOpenAll");
        openAll.onclick = () => plugin.showTabDocs?.(contractsRef.docId);
        head.append(openAll);
    }
    houseWarrantySection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
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
            line.style.cssText = lineBadgeCss;
            const nameSpan = document.createElement("b");
            nameSpan.style.cssText = "font-size:12.5px;color:var(--lv-tx)";
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
            metaSpan.className = "lv-caption";
            metaSpan.style.cssText = "margin-left:auto;font-size:11.5px";
            const parts: string[] = [];
            if (m.party || m.contact) parts.push(m.party || m.contact);
            if (m.expiry) parts.push(m.daysLeft !== undefined && m.daysLeft >= 0 ? `${m.expiry} (${m.daysLeft}d)` : m.expiry);
            metaSpan.textContent = parts.join(" · ");

            line.append(nameSpan, badge, metaSpan);
            contentWrap.append(line);
        }
    } catch {
        contentWrap.innerHTML = `<span class="lv-caption" style="color:var(--lv-danger)">${t("ledger.houseContractsFailed")}</span>`;
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
    foodDietarySection.className = "lv-detail-section";
    foodDietarySection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = t("ledger.foodDietaryTitle");
    head.append(title);
    foodDietarySection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = `${flexColGap6Css};font-size:12.5px`;
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
            safeBadge.style.cssText = "padding:8px 12px;background:var(--lv-surface-2);border-radius:6px;border:1px solid var(--lv-accent);color:var(--lv-accent);font-size:12px";
            safeBadge.textContent = `✓ ${t("ledger.foodDietarySafe")}`;
            contentWrap.append(safeBadge);
        } else {
            for (const c of check.conflicts) {
                const alertEl = document.createElement("div");
                if (c.type === "allergy") {
                    alertEl.style.cssText = dangerAlertCss;
                    alertEl.innerHTML = `<span>🚨 <b>${c.memberName}</b>：${t("ledger.foodAllergyAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}${c.detail ? ` (${c.detail})` : ""}</span>`;
                } else {
                    alertEl.style.cssText = warnAlertCss;
                    alertEl.innerHTML = `<span>⚠️ <b>${c.memberName}</b>：${t("ledger.foodDislikeAlert").replace("${member}", c.memberName).replace("${item}", c.matchedItem)}</span>`;
                }
                contentWrap.append(alertEl);
            }
        }

        if (check.parsedIngredients.length > 0) {
            const actionRow = document.createElement("div");
            actionRow.style.cssText = actionRowEndCss;
            const copyIngBtn = document.createElement("button");
            copyIngBtn.className = "b3-button b3-button--outline";
            copyIngBtn.style.cssText = fs12Pad38Css;
            copyIngBtn.textContent = `＋ ${t("ledger.foodCopyIngredients")}`;
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
    schoolStageSection.className = "lv-detail-section";
    schoolStageSection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = t("ledger.schoolingStageTitle");
    head.append(title);
    schoolStageSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = boxContentCss;
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
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span><b>${stage.currentGradeLabel}</b> · ${stage.transitionEventLabel}</span>
                  <span class="lv-badge ${badgeCls}">${badgeText}</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                  <span>${t("ledger.schoolingGraduationDate")}: ${stage.graduationDate} (${stage.stageTotalYears} 年制)</span>
                  <span>${t("ledger.schoolingProgress")}: ${stage.stageProgressPercent}%</span>
                </div>
                <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                  <div style="height:100%;background:var(--lv-data-accent);width:${stage.stageProgressPercent}%;border-radius:2px"></div>
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
    petCareSection.className = "lv-detail-section";
    petCareSection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = t("ledger.petCareTitle");
    head.append(title);
    petCareSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = boxContentCss;
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
            ageLine.style.cssText = flexBetweenCenterGap8Css;
            ageLine.innerHTML = `
                <span>${t("ledger.petAgeEquivalent")}: <b>${summary.ageInfo.humanEquivalentAge} 岁</b> (${summary.ageInfo.chronologicalYears} 岁 ${summary.ageInfo.chronologicalMonths} 个月)</span>
                <span class="lv-badge purple">${summary.ageInfo.lifeStageLabel}</span>
            `;
            const desc = document.createElement("div");
            desc.className = "lv-caption";
            desc.style.cssText = "font-size:11px;line-height:1.4";
            desc.textContent = summary.ageInfo.description;
            contentWrap.append(ageLine, desc);
        }

        const careGrid = document.createElement("div");
        careGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px";

        const badgeCls = (u: string) => u === "overdue" ? "danger" : u === "soon" ? "orange" : u === "ok" ? "green" : "gray";

        const vBox = document.createElement("div");
        vBox.style.cssText = pad6BorderSurfaceCss;
        vBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-weight:500">${t("field.vaccine_due")}</span>
                <span class="lv-badge ${badgeCls(summary.vaccine.urgency)}">${summary.vaccine.label}</span>
            </div>
            <span class="lv-caption" style="font-size:11px">${summary.vaccine.dueDate ? summary.vaccine.dueDate : "未填写"}</span>
        `;

        const dBox = document.createElement("div");
        dBox.style.cssText = pad6BorderSurfaceCss;
        dBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
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
    feedingSection.className = "lv-detail-section";
    feedingSection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = t("ledger.feedingObserveTitle");
    head.append(title);
    feedingSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = "font-size:12.5px;display:flex;flex-direction:column;gap:8px";
    feedingSection.append(contentWrap);
    body.appendChild(feedingSection);

    try {
        const { evaluateFeedingObservation, findMemberAllergies, checkAllergyConflict } = await import("./feeding");
        const obs = evaluateFeedingObservation(dateVal);

        if (obs) {
            const statusLine = document.createElement("div");
            statusLine.style.cssText = lineBadgeCss;
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
            timeText.className = "lv-caption";
            timeText.style.cssText = "margin-left:auto;font-size:11.5px";
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
                    alertLine.style.cssText = dangerAlertCss;
                    alertLine.innerHTML = `<span>⚠️ ${t("ledger.feedingAllergyConflict").replace("${food}", conflict.name)}${conflict.reaction ? `（${conflict.reaction}）` : ""}</span>`;
                    contentWrap.append(alertLine);
                }
            } catch { /* soft */ }
        }

        if (healthRef?.avId && healthRef?.columns) {
            const actionRow = document.createElement("div");
            actionRow.style.cssText = actionRowEndCss;
            const addAllergyBtn = document.createElement("button");
            addAllergyBtn.className = "b3-button b3-button--outline";
            addAllergyBtn.style.cssText = fs12Pad38Css;
            addAllergyBtn.textContent = `＋ ${t("ledger.recordAllergyToHealth")}`;
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
                (adlg.element.querySelector("#lv-allergy-save") as HTMLButtonElement).onclick = async function (this: HTMLButtonElement) {
                    this.disabled = true;
                    try {
                        const { addDetachedRow, setCell } = await import("./siyuan");
                        const newRowId = await addDetachedRow(healthRef.avId!, `${t("field.category.opt.allergy")} - ${foodName}`, {
                            idempotencyKey: `allergy-sync:${row.itemID}:${Date.now()}`,
                            retries: 1,
                        });
                        if (healthRef.columns.category) {
                            await setCell(healthRef.avId!, healthRef.columns.category, newRowId, { type: "select", select: [{ content: "allergy" }] });
                        }
                        if (healthRef.columns.name) {
                            await setCell(healthRef.avId!, healthRef.columns.name, newRowId, { type: "text", text: { content: foodName } });
                        }
                        if (healthRef.columns.member && memberBlockId) {
                            await setCell(healthRef.avId!, healthRef.columns.member, newRowId, { type: "relation", relation: { blockIDs: [memberBlockId], contents: null } });
                        }
                        const reaction = reactionInput.value.trim();
                        if (healthRef.columns.note && reaction) {
                            await setCell(healthRef.avId!, healthRef.columns.note, newRowId, { type: "text", text: { content: reaction } });
                        }
                        adlg.destroy();
                        showMessageFn(t("ledger.recordAllergyDone"), 3000, "info");
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
    socialRetireSection.className = "lv-detail-section";
    socialRetireSection.style.cssText = sectionBorderCss;

    const head = document.createElement("div");
    head.style.cssText = sectionHeaderCss;
    const title = document.createElement("span");
    title.className = "ft__on-surface";
    title.style.cssText = sectionTitleCss;
    title.textContent = `${t("members.retirementTitle")} · ${member.name}`;
    head.append(title);
    socialRetireSection.append(head);

    const contentWrap = document.createElement("div");
    contentWrap.style.cssText = boxContentCss;
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
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t("members.retirementTarget")}: <b>${ret.targetRetireDate}</b> (${t("members.retirementAge").replace("${age}", String(ret.targetRetireAge))}${delayText})</span>
                    ${daysBadge}
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;color:var(--lv-tx-2);font-size:11.5px">
                    <span>${t("members.retirementCareerProgress")}</span>
                    <span>${ret.careerProgressPercent}%</span>
                </div>
                <div style="height:4px;border-radius:2px;background:var(--lv-line);overflow:hidden;width:100%">
                    <div style="height:100%;background:var(--lv-accent);width:${ret.careerProgressPercent}%;border-radius:2px"></div>
                </div>`;
        }
    } catch {
        /* soft fail */
    }
}
