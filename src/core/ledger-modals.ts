/**
 * 台账所有专业领域模态框的按需触发器与统一分发中心（解耦抽取自 ledger.svelte，促进大文件瘦身）
 */

export interface LedgerModalContext {
    active: string;
    ref?: { avId?: string; docId?: string; columns?: Record<string, string> };
    rows?: any[];
    plugin: any;
    t: (k: string) => string;
    DialogCls: any;
    showMessageFn: (msg: string, timeout?: number, type?: string) => void;
    renderLedgerAllFn: (avId: string) => Promise<{ complete: boolean; rows: any[] }>;
    cellTextFn: (cell: any, key?: string) => string;
    selectContentFn?: (cell: any) => string | undefined;
    addDetachedRowFn?: (avId: string, content: string, options?: any) => Promise<string>;
    setCellFn?: (avId: string, keyId: string, itemId: string, val: any, options?: any) => Promise<void>;
    cellValueFn?: (type: string, val: any) => any;
    onOpenNewRecord?: () => void;
    onOpenDetail?: (row: any) => void;
    onReload?: () => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errFail = (showMessageFn: any, t: any, e: unknown) => {
    showMessageFn(t("ledger.logReadFailed") + " (" + errMsg(e) + ")", 5000, "error");
};

async function loadAllRows(renderLedgerAllFn: any, avId: string, showMessageFn: any, t: any) {
    const all = await renderLedgerAllFn(avId);
    if (!all.complete) {
        showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
        return null;
    }
    return all.rows;
}

export async function openEnergyDashboardModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, active, t, plugin, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, selectContentFn, onOpenNewRecord, onOpenDetail } = ctx;
    if (!ref?.avId || active !== "vehicles") return;
    try {
        const { openEnergyDashboardDialog } = await import("@/core/fuel");
        await openEnergyDashboardDialog({
            sourceRef: ref,
            t,
            plugin,
            DialogCls,
            showMessageFn,
            renderLedgerAllFn,
            cellTextFn,
            selectContentFn: selectContentFn ?? (() => undefined),
            onOpenNewRecord,
            onOpenVehicleDetail: onOpenDetail,
        });
    } catch (error) {
        showMessageFn(t("ledger.readFailed").replace("${msg}", errMsg(error)), 5000, "error");
    }
}

export async function openGrowthChartModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, rows = [], plugin, t, DialogCls, showMessageFn } = ctx;
    try {
        const { openGrowthChartDialog } = await import("@/core/growth-dialog");
        openGrowthChartDialog({
            t,
            rows,
            columns: (ref?.columns ?? {}) as Record<string, string | undefined>,
            members: plugin.settings.members ?? [],
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        showMessageFn(t("ledger.growthFailed").replace("${msg}", errMsg(e)), 6000, "error");
    }
}

export async function openVaccineScheduleModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, cellTextFn, onReload } = ctx;
    if (!ref?.avId || !ref.columns) return;
    try {
        const { openVaccineScheduleDialog } = await import("@/core/growth-dialog");
        await openVaccineScheduleDialog({
            t,
            members: plugin.settings.members ?? [],
            avId: ref.avId,
            columns: ref.columns,
            DialogCls,
            showMessageFn,
            cellTextFn,
            onRecordSaved: async () => {
                if (onReload) await onReload();
            },
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openShoppingListModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, plugin, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.name || !ref.columns.qty || !ref.columns.low_stock_at) {
        if (!ref?.avId) showMessageFn(t("diag.missing"), 3000, "info");
        else showMessageFn(t("ledger.missingColumnsPrompt") + " " + (t("field.low_stock_at") || "low_stock_at"), 3000, "info");
        return;
    }
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;
        const { openLowStockShoppingDialog } = await import("@/core/shopping");
        openLowStockShoppingDialog({
            ref: ref as any,
            allRows: rows,
            t,
            plugin,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        showMessageFn(t("ledger.shoppingFailed").replace("${msg}", errMsg(e)), 6000, "error");
    }
}

export async function openFavorsReportModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns) return;
    const { openFavorsReportDialog } = await import("@/core/favors-dialog");
    return openFavorsReportDialog({
        ref,
        t,
        DialogCls,
        showMessageFn,
        loadRows: () => renderLedgerAllFn(ref.avId!),
    });
}

export async function openBookmarksCheckModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.url) {
        if (!ref?.avId) showMessageFn(t("diag.missing"), 3000, "info");
        else showMessageFn(t("ledger.missingColumnsPrompt") + " " + (t("field.url") || "url"), 3000, "info");
        return;
    }
    try {
        const all = await renderLedgerAllFn(ref.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }
        const { openBookmarksCheckDialog } = await import("@/core/bookmarks");
        await openBookmarksCheckDialog({
            rows: all.rows,
            columns: ref.columns,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openSubscriptionStatsModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.amount) {
        if (!ref?.avId) showMessageFn(t("diag.missing"), 3000, "info");
        else showMessageFn(t("ledger.expenseTrendNoCol"), 4000, "info");
        return;
    }
    try {
        const all = await renderLedgerAllFn(ref.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }
        const { openSubscriptionStatsDialog } = await import("@/core/subscriptions");
        openSubscriptionStatsDialog({
            rows: all.rows,
            columns: ref.columns,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openAssetValuationModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.amount) {
        if (!ref?.avId) showMessageFn(t("diag.missing"), 3000, "info");
        else showMessageFn(t("ledger.expenseTrendNoCol"), 4000, "info");
        return;
    }
    try {
        const all = await renderLedgerAllFn(ref.avId);
        if (!all.complete) {
            showMessageFn(t("ledger.loadIncomplete"), 5000, "error");
            return;
        }
        const { loadRowLogs } = await import("@/core/rowlog");
        const logs = await loadRowLogs(plugin);
        const { openAssetValuationDialog } = await import("@/core/valuation");
        openAssetValuationDialog({
            rows: all.rows,
            columns: ref.columns,
            logs,
            avId: ref.avId,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openMediaReportModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns) {
        showMessageFn(t("diag.missing"), 3000, "info");
        return;
    }
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;
        const { openMediaReportDialog } = await import("@/core/media");
        openMediaReportDialog({
            rows,
            columns: ref.columns,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openMealPlanModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, addDetachedRowFn, setCellFn, cellValueFn } = ctx;
    if (!ref?.avId || !ref.columns?.name) {
        showMessageFn(t("diag.missing"), 3000, "info");
        return;
    }
    try {
        const foodRows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!foodRows) return;
        if (foodRows.length === 0) {
            showMessageFn(t("ledger.mealPlanEmptyFood"), 4000, "info");
            return;
        }

        let stockItems: import("@/core/meal-plan").StockItemInfo[] = [];
        const stockRef = plugin.settings.dbRefs?.stock;
        if (stockRef?.avId && stockRef.columns?.name) {
            // 囤货读不到时缺口会被算成“全部要买”，必须提示用户结果不可信
            let stockReadOk = false;
            try {
                const allStock = await renderLedgerAllFn(stockRef.avId);
                if (allStock.complete) {
                    const { extractStockItemsFromRows } = await import("@/core/meal-plan");
                    stockItems = extractStockItemsFromRows(allStock.rows, {
                        nameCol: stockRef.columns.name,
                        qtyCol: stockRef.columns.qty,
                    });
                    stockReadOk = true;
                }
            } catch { /* 下方统一提示 */ }
            if (!stockReadOk) showMessageFn(t("modal.readIncomplete").replace("${modules}", t("module.stock")), 6000, "error");
        }

        const { openMealPlanDialog } = await import("@/core/meal-plan");
        openMealPlanDialog({
            allFoodRows: foodRows,
            stockItems,
            ref,
            plugin,
            t,
            DialogCls,
            showMessageFn,
            cellTextFn,
            addDetachedRowFn: addDetachedRowFn ?? (async () => ""),
            setCellFn: setCellFn ?? (async () => {}),
            cellValueFn: cellValueFn ?? (() => null),
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openMedicineSupplyModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.name) {
        showMessageFn(t("diag.missing"), 3000, "info");
        return;
    }
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;
        if (rows.length === 0) {
            showMessageFn(t("ledger.medicineSupplyEmpty"), 4000, "info");
            return;
        }

        const { evaluateMedicineSupplyReport, openMedicineSupplyDialog } = await import("@/core/medicine-dosing");
        const report = evaluateMedicineSupplyReport(rows, ref.columns);

        openMedicineSupplyDialog({
            report,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openWasteScheduleModal(ctx: LedgerModalContext): Promise<void> {
    const { t, DialogCls, showMessageFn } = ctx;
    const { openWasteScheduleDialog } = await import("@/core/waste-dialog");
    openWasteScheduleDialog({
        t,
        DialogCls,
        showMessageFn,
    });
}

export async function openRewardsLedgerModal(ctx: LedgerModalContext): Promise<void> {
    const { plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, addDetachedRowFn, setCellFn } = ctx;
    const { openRewardsDialog } = await import("@/core/rewards-dialog");
    openRewardsDialog({
        t,
        plugin,
        DialogCls,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
        addDetachedRowFn: addDetachedRowFn ?? (async () => ""),
        setCellFn: setCellFn ?? (async () => {}),
    });
}

export async function openExpenseTrendModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = ctx;
    if (!ref?.avId) return;
    const amountCol = ref.columns?.amount;
    const dateCol = ref.columns?.date ?? ref.columns?.expiry;
    if (!amountCol || !dateCol) {
        showMessageFn(t("ledger.expenseTrendNoCol"), 4000, "info");
        return;
    }
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;

        const entries = rows
            .map((row) => ({
                date: cellTextFn(row.cells?.[dateCol]),
                amount: Number(cellTextFn(row.cells?.[amountCol]).replace(/[^\d.-]/g, "")),
                category: ref.columns?.category ? cellTextFn(row.cells?.[ref.columns.category]) : undefined,
            }))
            .filter((e) => e.date && Number.isFinite(e.amount) && e.amount > 0);

        if (entries.length === 0) {
            showMessageFn(t("ledger.expenseTrendEmpty"), 4000, "info");
            return;
        }

        const { openExpenseTrendDialog } = await import("@/core/expense-dialog");
        openExpenseTrendDialog({
            entries,
            budgetLimits: plugin.settings.budgetLimits,
            t,
            DialogCls,
            showMessageFn,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openUtilityTiersModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = ctx;
    if (!ref?.avId || !ref.columns?.name) return;
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;
        if (rows.length === 0) {
            showMessageFn(t("ledger.utilityEmptyReadings"), 4000, "info");
            return;
        }

        const { loadRowLogs, getEntries } = await import("@/core/rowlog");
        const currentLogs = await loadRowLogs(plugin);

        const { openUtilityTiersDialog } = await import("@/core/utility-tiers");
        openUtilityTiersDialog({
            allHouseRows: rows,
            currentLogs,
            ref,
            t,
            DialogCls,
            showMessageFn,
            cellTextFn,
            getEntriesFn: getEntries,
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openLocationIndexModal(ctx: LedgerModalContext): Promise<void> {
    const { plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn } = ctx;
    const { openLocationIndexDialog } = await import("@/core/location-dialog");
    return openLocationIndexDialog({
        t,
        plugin,
        DialogCls,
        showMessageFn,
        renderLedgerAllFn,
        cellTextFn,
    });
}

export async function openBlockIngestModal(ctx: LedgerModalContext): Promise<void> {
    const { active, plugin, t, DialogCls, showMessageFn, addDetachedRowFn, setCellFn, onReload } = ctx;
    const { openBlockIngestDialog } = await import("@/core/block-ingest-dialog");
    return openBlockIngestDialog({
        t,
        currentModule: active,
        plugin,
        DialogCls,
        showMessageFn,
        addDetachedRowFn: addDetachedRowFn ?? (async () => ""),
        setCellFn: setCellFn ?? (async () => {}),
        onSuccessCallback: async () => {
            if (onReload) await onReload();
            try { await plugin.refreshHub?.([active]); } catch { /* ignore */ }
        },
    });
}

export async function openStoreModeModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, t, DialogCls, showMessageFn, renderLedgerAllFn } = ctx;
    if (!ref?.avId || !ref.columns?.name) {
        showMessageFn(t("diag.missing"), 3000, "info");
        return;
    }
    const { openStoreModeDialog } = await import("@/core/store-dialog");
    return openStoreModeDialog({
        t,
        DialogCls,
        showMessageFn,
        loadRows: () => renderLedgerAllFn(ref.avId!),
        columns: {
            name: ref.columns.name,
            category: ref.columns.category,
            qty: ref.columns.qty,
            note: ref.columns.note,
        },
    });
}

export async function openEmergencyKitModal(ctx: LedgerModalContext): Promise<void> {
    const { ref, plugin, t, DialogCls, showMessageFn, renderLedgerAllFn, cellTextFn, addDetachedRowFn, setCellFn, onReload } = ctx;
    if (!ref?.avId || !ref.columns?.name) {
        showMessageFn(t("diag.missing"), 3000, "info");
        return;
    }
    try {
        const rows = await loadAllRows(renderLedgerAllFn, ref.avId, showMessageFn, t);
        if (!rows) return;

        const { openEmergencyKitDialog } = await import("@/core/emergency-kit");
        openEmergencyKitDialog({
            stockRows: rows,
            ref: ref as { avId: string; columns?: Record<string, string> },
            t,
            DialogCls,
            showMessageFn,
            cellTextFn,
            addDetachedRowFn: addDetachedRowFn ?? (async () => ""),
            setCellFn: setCellFn ?? (async () => {}),
            isGuestReadOnly: Boolean(plugin.runtime?.guestModeActive),
            onCreatedCallback: async () => {
                if (onReload) await onReload();
                try { await plugin.refreshHub?.([ctx.active]); } catch { /* ignore */ }
            },
        });
    } catch (e) {
        errFail(showMessageFn, t, e);
    }
}

export async function openCsvImportModal(ctx: LedgerModalContext): Promise<void> {
    const { active, ref, plugin, t, DialogCls, showMessageFn, onReload } = ctx;
    if (!ref?.avId) return;
    if (plugin.runtime?.guestModeActive) {
        showMessageFn(t("guest.writeBlocked"), 4000, "info");
        return;
    }
    try {
        const importableTypes = new Set(["text", "number", "date", "checkbox", "select"]);
        const schemaCols = (plugin.schemaCatalog?.[active]?.columns ?? []).filter((c: any) => importableTypes.has(c.type));
        const { openCsvImportDialog } = await import("@/core/csv-import-dialog");
        openCsvImportDialog({
            active,
            ref,
            schemaCols,
            t,
            DialogCls,
            showMessageFn,
            onImportSuccess: async () => {
                if (onReload) await onReload();
                try { await plugin.refreshHub?.([active]); } catch { /* soft */ }
            },
        });
    } catch (e) {
        showMessageFn(String(e), 5000, "error");
    }
}

/** 统一分发工具栏所触发的各专业分析与辅助模态框 */
export function dispatchLedgerModal(action: string, ctx: LedgerModalContext): void {
    switch (action) {
        case "energy": return void openEnergyDashboardModal(ctx);
        case "growth": return void openGrowthChartModal(ctx);
        case "vaccine": return void openVaccineScheduleModal(ctx);
        case "shopping": return void openShoppingListModal(ctx);
        case "emergency-kit": return void openEmergencyKitModal(ctx);
        case "store-mode": return void openStoreModeModal(ctx);
        case "location-index": return void openLocationIndexModal(ctx);
        case "block-ingest": return void openBlockIngestModal(ctx);
        case "expense-trend": return void openExpenseTrendModal(ctx);
        case "favors-report": return void openFavorsReportModal(ctx);
        case "bookmarks-check": return void openBookmarksCheckModal(ctx);
        case "subscription-stats": return void openSubscriptionStatsModal(ctx);
        case "asset-valuation": return void openAssetValuationModal(ctx);
        case "media-report": return void openMediaReportModal(ctx);
        case "meal-plan": return void openMealPlanModal(ctx);
        case "medicine-supply": return void openMedicineSupplyModal(ctx);
        case "utility-tiers": return void openUtilityTiersModal(ctx);
        case "waste-schedule": return void openWasteScheduleModal(ctx);
        case "rewards-settle": return void openRewardsLedgerModal(ctx);
        case "csv-import": return void openCsvImportModal(ctx);
    }
}

