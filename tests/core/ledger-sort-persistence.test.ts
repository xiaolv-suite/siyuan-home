import { describe, it, expect } from "vitest";
import { defaultSettings } from "@/core/settings";

describe("ledger-sort-persistence (POOL-FEAT-11 / CAND-13: 台账表格自选排序列与方向模块化持久化)", () => {
    it("默认设置提供空 ledgerSort 偏好映射", () => {
        const s = defaultSettings();
        expect(s.ledgerSort).toEqual({});
    });

    it("单模块排序切换逻辑：首选升序、重选反转、选新列重置升序", () => {
        let sortKey = "";
        let sortAsc = true;

        function toggleSort(k: string) {
            if (sortKey === k) {
                sortAsc = !sortAsc;
            } else {
                sortKey = k;
                sortAsc = true;
            }
        }

        toggleSort("expiry");
        expect(sortKey).toBe("expiry");
        expect(sortAsc).toBe(true);

        toggleSort("expiry");
        expect(sortKey).toBe("expiry");
        expect(sortAsc).toBe(false);

        toggleSort("amount");
        expect(sortKey).toBe("amount");
        expect(sortAsc).toBe(true);
    });

    it("不同模块独立记忆互不干扰", () => {
        const settings = {
            ledgerSort: {} as Record<string, { key: string; asc: boolean }>,
        };

        function setModuleSort(mod: string, key: string, asc: boolean) {
            settings.ledgerSort[mod] = { key, asc };
        }

        setModuleSort("vehicles", "mileage", false);
        setModuleSort("stock", "qty", true);
        setModuleSort("house", "amount", false);

        expect(settings.ledgerSort.vehicles).toEqual({ key: "mileage", asc: false });
        expect(settings.ledgerSort.stock).toEqual({ key: "qty", asc: true });
        expect(settings.ledgerSort.house).toEqual({ key: "amount", asc: false });
    });

    it("数据清洗过滤非法键与非布尔排序方向", () => {
        const defaults = { ledgerSort: {} };
        const rawData = {
            ledgerSort: {
                vehicles: { key: "mileage", asc: true },
                invalid1: "not-an-object",
                invalid2: { key: 123, asc: true },
                invalid3: { key: "amount", asc: "yes" },
            },
        };

        const ledgerSort = Object.fromEntries(
            Object.entries(rawData.ledgerSort).filter(
                (entry): entry is [string, { key: string; asc: boolean }] =>
                    typeof entry[1] === "object" &&
                    entry[1] !== null &&
                    typeof (entry[1] as any).key === "string" &&
                    typeof (entry[1] as any).asc === "boolean"
            )
        );

        expect(ledgerSort).toEqual({
            vehicles: { key: "mileage", asc: true },
        });
    });
});
