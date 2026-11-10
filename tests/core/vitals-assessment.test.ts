import { describe, it, expect } from "vitest";
import { assessBloodPressure, assessBloodGlucose, assessTemperature } from "@/core/vitals";

describe("vitals-assessment (POOL-FEAT-17 / CAND-21: 生理指标实时医学健康区间与高压预警反馈)", () => {
    it("血压医学分级判定：理想正常、正常高值、高血压预警与低血压", () => {
        // 理想正常 <120/80
        expect(assessBloodPressure(115, 75).level).toBe("normal");
        expect(assessBloodPressure(115, 75).isAbnormal).toBe(false);

        // 正常高值 120-139 / 80-89
        expect(assessBloodPressure(130, 85).level).toBe("elevated");
        expect(assessBloodPressure(130, 85).isAbnormal).toBe(false);

        // 高血压预警 ≥140 或 ≥90
        expect(assessBloodPressure(145, 85).level).toBe("high");
        expect(assessBloodPressure(145, 85).isAbnormal).toBe(true);
        expect(assessBloodPressure(125, 95).level).toBe("high");
        expect(assessBloodPressure(125, 95).isAbnormal).toBe(true);

        // 低血压 <90/60
        expect(assessBloodPressure(85, 55).level).toBe("low");
        expect(assessBloodPressure(85, 55).isAbnormal).toBe(true);
    });

    it("空腹与餐后血糖医学分级判定", () => {
        // 空腹正常 3.9 ~ 6.1
        expect(assessBloodGlucose(5.2, false).level).toBe("normal");
        // 空腹偏高 ≥ 7.0
        expect(assessBloodGlucose(7.5, false).level).toBe("high");
        expect(assessBloodGlucose(7.5, false).isAbnormal).toBe(true);

        // 餐后正常 3.9 ~ 7.8
        expect(assessBloodGlucose(6.8, true).level).toBe("normal");
        // 餐后偏高 ≥ 11.1
        expect(assessBloodGlucose(12.0, true).level).toBe("high");
        expect(assessBloodGlucose(12.0, true).isAbnormal).toBe(true);
    });

    it("体温医学分级判定：正常、低热、发热与高热", () => {
        // 正常腋温 36.0 ~ 37.2°C
        expect(assessTemperature(36.5).level).toBe("normal");
        expect(assessTemperature(36.5).isAbnormal).toBe(false);

        // 低热 37.3 ~ 38.0°C
        expect(assessTemperature(37.5).level).toBe("elevated");
        expect(assessTemperature(37.5).label).toContain("低热");

        // 中度发热 38.1 ~ 39.0°C
        expect(assessTemperature(38.5).level).toBe("high");
        expect(assessTemperature(38.5).label).toContain("发热");

        // 高热 > 39.0°C
        expect(assessTemperature(39.5).level).toBe("high");
        expect(assessTemperature(39.5).label).toContain("高热");
    });
});
