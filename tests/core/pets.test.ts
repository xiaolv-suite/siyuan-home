import { describe, it, expect } from "vitest";
import { calculatePetAge, evaluatePetSummary, calculatePetRoutineSchedule } from "@/core/pets";

describe("pets.calculatePetAge（宠物生理年龄与人类年龄换算）", () => {
    it("1岁猫换算为人类约 15 岁，2岁猫换算为约 24 岁", () => {
        const cat1 = calculatePetAge("2025-10-19", "cat", "2026-10-19");
        expect(cat1).not.toBeNull();
        expect(cat1?.chronologicalYears).toBe(1);
        expect(cat1?.humanEquivalentAge).toBe(15);
        expect(cat1?.lifeStage).toBe("prime");

        const cat2 = calculatePetAge("2024-10-19", "cat", "2026-10-19");
        expect(cat2?.chronologicalYears).toBe(2);
        expect(cat2?.humanEquivalentAge).toBe(24);
    });

    it("成长期与熟龄猫阶段推算（5岁猫约36岁，12岁老年猫约64岁）", () => {
        const cat5 = calculatePetAge("2021-10-19", "cat", "2026-10-19");
        expect(cat5?.humanEquivalentAge).toBe(36); // 24 + 3 * 4
        expect(cat5?.lifeStage).toBe("prime");

        const cat12 = calculatePetAge("2014-10-19", "cat", "2026-10-19");
        expect(cat12?.lifeStage).toBe("senior");
        expect(cat12?.lifeStageLabel).toBe("老年猫");
        expect(cat12?.humanEquivalentAge).toBe(64); // 24 + 10 * 4
    });

    it("犬类生理年龄换算", () => {
        const dog3 = calculatePetAge("2023-10-19", "dog", "2026-10-19");
        expect(dog3?.chronologicalYears).toBe(3);
        expect(dog3?.humanEquivalentAge).toBe(29); // 24 + 1 * 4.5 = 28.5 -> 29
    });

    it("未来日期或无效输入返回 null", () => {
        expect(calculatePetAge("2028-01-01", "cat", "2026-10-19")).toBeNull();
        expect(calculatePetAge("invalid-date")).toBeNull();
    });
});

describe("pets.evaluatePetSummary（疫苗与驱虫护理周期评估）", () => {
    it("评估狂犬疫苗与驱虫到期状态（正常、临期、已逾期）", () => {
        const today = "2026-10-19";
        // 疫苗 2026-10-25 (6天后，<=14天) -> soon
        // 驱虫 2026-10-10 (已过9天) -> overdue
        const summary = evaluatePetSummary("2023-05-01", "cat", "2026-10-25", "2026-10-10", today);

        expect(summary.ageInfo).not.toBeNull();
        expect(summary.vaccine.urgency).toBe("soon");
        expect(summary.vaccine.daysDiff).toBe(6);
        expect(summary.deworm.urgency).toBe("overdue");
        expect(summary.deworm.daysDiff).toBe(-9);
        expect(summary.hasOverdue).toBe(true);
        expect(summary.hasSoon).toBe(true);
    });

    it("未填写到期日时标明 not_set", () => {
        const summary = evaluatePetSummary(undefined, "cat", undefined, undefined, "2026-10-19");
        expect(summary.vaccine.urgency).toBe("not_set");
        expect(summary.deworm.urgency).toBe("not_set");
        expect(summary.hasOverdue).toBe(false);
    });

    it("calculatePetRoutineSchedule 自动推算体外30天、体内90天与疫苗365天周期", () => {
        const today = "2026-10-27";
        const sched = calculatePetRoutineSchedule({
            lastExtDewormDate: "2026-10-01", // 30天后是 2026-10-31（4天后 -> soon）
            lastIntDewormDate: "2026-07-01", // 90天后是 2026-09-29（已过 -> overdue）
            lastVaccineDate: "2026-01-01",   // 365天后是 2027-01-01（ok）
            today,
        });

        expect(sched.items).toHaveLength(3);
        expect(sched.overdueCount).toBe(1);
        expect(sched.dueSoonCount).toBe(1);
        expect(sched.allGood).toBe(false);

        const ext = sched.items.find((i) => i.type === "ext_deworm");
        expect(ext?.nextDueDate).toBe("2026-10-31");
        expect(ext?.urgency).toBe("soon");

        const intD = sched.items.find((i) => i.type === "int_deworm");
        expect(intD?.urgency).toBe("overdue");

        const vac = sched.items.find((i) => i.type === "vaccine");
        expect(vac?.urgency).toBe("ok");
    });
});
