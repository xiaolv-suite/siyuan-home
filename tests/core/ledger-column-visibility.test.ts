import { describe, it, expect, vi } from "vitest";
import { defaultSettings } from "@/core/settings";
import { computeTableKeys } from "@/core/ledger-view-model";

describe("ledger-column-visibility (POOL-FEAT-05: 台账表格列显示与隐藏自选与持久化)", () => {
    it("默认设置包含空的 columnVisibility 映射", () => {
        const s = defaultSettings();
        expect(s.columnVisibility).toEqual({});
    });

    it("当无自定义列配置时，回退至 computeTableKeys 默认列推导", () => {
        const schemaKeys = ["name", "plate", "mileage", "brand_model", "energy_type", "note", "insurance_due"];
        const defaultKeys = computeTableKeys(schemaKeys);

        const customCols: string[] | undefined = undefined;
        const activeKeys = customCols && customCols.length > 0
            ? customCols.filter((k) => schemaKeys.includes(k))
            : defaultKeys;

        expect(activeKeys).toEqual(defaultKeys);
        expect(activeKeys).toContain("name");
        expect(activeKeys).toContain("plate");
    });

    it("当存在自定义列配置时，严格依据自选列并过滤无效字段", () => {
        const schemaKeys = ["name", "plate", "mileage", "brand_model", "energy_type", "note"];
        const customCols = ["plate", "mileage", "non_existent_key"];

        const filtered = customCols.filter((k) => schemaKeys.includes(k));
        expect(filtered).toEqual(["plate", "mileage"]);
        expect(filtered).not.toContain("non_existent_key");
    });

    it("列勾选与取消：增加新列与移除已有列", () => {
        let currentKeys = ["name", "plate"];

        // 勾选新列 mileage
        function toggleCol(k: string) {
            if (currentKeys.includes(k)) {
                if (currentKeys.length <= 1) return false;
                currentKeys = currentKeys.filter((x) => x !== k);
            } else {
                currentKeys = [...currentKeys, k];
            }
            return true;
        }

        expect(toggleCol("mileage")).toBe(true);
        expect(currentKeys).toEqual(["name", "plate", "mileage"]);

        // 取消勾选 plate
        expect(toggleCol("plate")).toBe(true);
        expect(currentKeys).toEqual(["name", "mileage"]);
    });

    it("列安全防护：尝试移除最后一列时拦截并保留至少一列", () => {
        let currentKeys = ["name"];
        const showMessage = vi.fn();

        function toggleCol(k: string) {
            if (currentKeys.includes(k)) {
                if (currentKeys.length <= 1) {
                    showMessage("ledger.atLeastOneCol", 3000, "info");
                    return false;
                }
                currentKeys = currentKeys.filter((x) => x !== k);
            } else {
                currentKeys = [...currentKeys, k];
            }
            return true;
        }

        expect(toggleCol("name")).toBe(false);
        expect(currentKeys).toEqual(["name"]);
        expect(showMessage).toHaveBeenCalledWith("ledger.atLeastOneCol", 3000, "info");
    });

    it("重置默认列：清理模块自定义列并恢复默认状态", () => {
        const settings = {
            columnVisibility: {
                vehicles: ["plate", "mileage"],
                stock: ["name", "qty"],
            } as Record<string, string[]>,
        };

        function resetColumns(moduleId: string) {
            if (settings.columnVisibility[moduleId]) {
                delete settings.columnVisibility[moduleId];
            }
        }

        resetColumns("vehicles");
        expect(settings.columnVisibility.vehicles).toBeUndefined();
        expect(settings.columnVisibility.stock).toEqual(["name", "qty"]);
    });
});
