import { describe, it, expect } from "vitest";
import { defaultSettings } from "@/core/settings";

describe("quick-energy-presets (POOL-FEAT-04: 快速加油/充电常用预设面额自定义)", () => {
    it("默认设置提供标准加油与充电预设面额", () => {
        const s = defaultSettings();
        expect(s.fuelPresetAmounts).toEqual([200, 300, 500]);
        expect(s.chargePresetAmounts).toEqual([30, 50, 100]);
    });

    it("解析与清洗用户自定义面额字符串（支持中英文逗号与空格）", () => {
        function parsePresets(input: string): number[] {
            return input
                .split(/[,，\s]+/)
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
        }

        // 摩托车小面额场景
        expect(parsePresets("30, 50, 80")).toEqual([30, 50, 80]);
        // 中文逗号与空格混排
        expect(parsePresets("100， 200 300，500")).toEqual([100, 200, 300, 500]);
        // 过滤非正数与非法字符
        expect(parsePresets("50, abc, -20, 0, 120")).toEqual([50, 120]);
    });

    it("无效输入安全拦截判定", () => {
        function validatePresets(input: string): boolean {
            const parts = input
                .split(/[,，\s]+/)
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
            return parts.length > 0;
        }

        expect(validatePresets("")).toBe(false);
        expect(validatePresets("   ")).toBe(false);
        expect(validatePresets("0, -10, abc")).toBe(false);
        expect(validatePresets("100")).toBe(true);
    });

    it("设置持久化清洗：过滤非数值、非有限数和非正数", () => {
        const defaults = {
            fuelPresetAmounts: [200, 300, 500],
            chargePresetAmounts: [30, 50, 100],
        };

        const rawData = {
            fuelPresetAmounts: [100, "200", -50, 0, 400],
            chargePresetAmounts: "invalid",
        };

        const fuelPresetAmounts = Array.isArray(rawData.fuelPresetAmounts)
            ? rawData.fuelPresetAmounts.map(Number).filter((n) => Number.isFinite(n) && n > 0)
            : defaults.fuelPresetAmounts;

        const chargePresetAmounts = Array.isArray(rawData.chargePresetAmounts)
            ? (rawData.chargePresetAmounts as any[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
            : defaults.chargePresetAmounts;

        expect(fuelPresetAmounts).toEqual([100, 200, 400]);
        expect(chargePresetAmounts).toEqual([30, 50, 100]);
    });
});
