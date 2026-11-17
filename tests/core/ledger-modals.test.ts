import { describe, it, expect, vi } from "vitest";
import {
    openEnergyDashboardModal,
    openGrowthChartModal,
    openVaccineScheduleModal,
    openShoppingListModal,
    openFavorsReportModal,
    openBookmarksCheckModal,
    openSubscriptionStatsModal,
    openAssetValuationModal,
    openMediaReportModal,
    openMealPlanModal,
    openMedicineSupplyModal,
    openWasteScheduleModal,
    openRewardsLedgerModal,
    openExpenseTrendModal,
    openUtilityTiersModal,
    openLocationIndexModal,
    openBlockIngestModal,
    openStoreModeModal,
    openEmergencyKitModal,
    openCsvImportModal,
    type LedgerModalContext,
} from "@/core/ledger-modals";

describe("ledger-modals (台账专业分析模态框统一分发中心)", () => {
    const makeCtx = (active = "vehicles", columns: Record<string, string> = {}): LedgerModalContext => ({
        active,
        ref: { avId: "av-test", columns },
        rows: [],
        plugin: {
            settings: { dbRefs: {}, members: [] },
            schemaCatalog: {},
            runtime: {},
        },
        t: (k: string) => k,
        DialogCls: class {
            element = {
                querySelector: vi.fn().mockReturnValue({
                    onclick: null,
                    addEventListener: vi.fn(),
                    replaceChildren: vi.fn(),
                    appendChild: vi.fn(),
                    append: vi.fn(),
                }),
                querySelectorAll: vi.fn().mockReturnValue([]),
            };
            destroy = vi.fn();
        } as any,
        showMessageFn: vi.fn(),
        renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
        cellTextFn: () => "",
    });

    it("各模态框触发器在边界缺失参数时优雅跳过或提示，不抛未捕获异常", async () => {
        const ctx = makeCtx();

        await expect(openEnergyDashboardModal(ctx)).resolves.not.toThrow();
        await expect(openGrowthChartModal(ctx)).resolves.not.toThrow();
        await expect(openVaccineScheduleModal(ctx)).resolves.not.toThrow();
        await expect(openShoppingListModal(ctx)).resolves.not.toThrow();
        await expect(openFavorsReportModal(ctx)).resolves.not.toThrow();
        await expect(openBookmarksCheckModal(ctx)).resolves.not.toThrow();
        await expect(openSubscriptionStatsModal(ctx)).resolves.not.toThrow();
        await expect(openAssetValuationModal(ctx)).resolves.not.toThrow();
        await expect(openMediaReportModal(ctx)).resolves.not.toThrow();
        await expect(openMealPlanModal(ctx)).resolves.not.toThrow();
        await expect(openMedicineSupplyModal(ctx)).resolves.not.toThrow();
        await expect(openWasteScheduleModal(ctx)).resolves.not.toThrow();
        await expect(openRewardsLedgerModal(ctx)).resolves.not.toThrow();
        await expect(openExpenseTrendModal(ctx)).resolves.not.toThrow();
        await expect(openUtilityTiersModal(ctx)).resolves.not.toThrow();
        await expect(openLocationIndexModal(ctx)).resolves.not.toThrow();
        await expect(openBlockIngestModal(ctx)).resolves.not.toThrow();
        await expect(openStoreModeModal(ctx)).resolves.not.toThrow();
        await expect(openEmergencyKitModal(ctx)).resolves.not.toThrow();
        await expect(openCsvImportModal(ctx)).resolves.not.toThrow();
    });
});
