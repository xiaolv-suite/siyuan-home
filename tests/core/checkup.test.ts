import { describe, it, expect } from "vitest";
import { evaluateRoutineCheckupPlan, formatCheckupPlanMarkdown } from "@/core/checkup";

describe("checkup (家庭成员年度健康体检项推算与周期提醒引擎)", () => {
    const today = "2026-10-27";

    it("为成年成员生成基础全套检查项目", () => {
        const plan = evaluateRoutineCheckupPlan({
            birthDate: "1995-05-15",
            sex: "male",
            today,
        });

        expect(plan.age).toBe(31);
        expect(plan.status).toBe("unrecorded");
        const itemIds = plan.recommendedItems.map((i) => i.id);
        expect(itemIds).toContain("general");
        expect(itemIds).toContain("routine_lab");
        expect(itemIds).toContain("biochemical");
        expect(itemIds).toContain("ecg");
        expect(itemIds).toContain("abdomen_us");
        expect(itemIds).toContain("thyroid_us");
    });

    it("女性不同年龄段的专项早筛项目推算", () => {
        // 28岁女性：包含乳腺超声、TCT+HPV，不包含乳腺钼靶（40+）
        const plan28 = evaluateRoutineCheckupPlan({
            birthDate: "1998-03-10",
            sex: "female",
            today,
        });
        const ids28 = plan28.recommendedItems.map((i) => i.id);
        expect(ids28).toContain("breast_us");
        expect(ids28).toContain("cervical_screen");
        expect(ids28).not.toContain("mammography");

        // 45岁女性：应包含乳腺超声、TCT+HPV、乳腺钼靶、低剂量螺旋CT、胃肠镜早筛
        const plan45 = evaluateRoutineCheckupPlan({
            birthDate: "1981-08-20",
            sex: "female",
            today,
        });
        const ids45 = plan45.recommendedItems.map((i) => i.id);
        expect(ids45).toContain("breast_us");
        expect(ids45).toContain("mammography");
        expect(ids45).toContain("ldct_lung");
        expect(ids45).toContain("gi_endoscopy");
    });

    it("男性50岁及以上专属项目（PSA、颈动脉超声、骨密度）", () => {
        const plan55 = evaluateRoutineCheckupPlan({
            birthDate: "1971-02-14",
            sex: "male",
            today,
        });
        expect(plan55.age).toBe(55);
        const ids55 = plan55.recommendedItems.map((i) => i.id);
        expect(ids55).toContain("psa_screening");
        expect(ids55).toContain("carotid_us");
        expect(ids55).toContain("bone_density");
    });

    it("慢病标签触发靶向心肾肝糖代谢加项", () => {
        const planChronic = evaluateRoutineCheckupPlan({
            birthDate: "1985-06-10",
            sex: "male",
            diagnoses: ["高血压2级", "2型糖尿病", "重度脂肪肝"],
            today,
        });
        const ids = planChronic.recommendedItems.map((i) => i.id);
        expect(ids).toContain("echo_heart");
        expect(ids).toContain("hba1c");
        expect(ids).toContain("liver_afp");
    });

    it("周期到期状态推算（正常、即将到期、已逾期）", () => {
        // 1. 履约正常：半年前体检
        const planNormal = evaluateRoutineCheckupPlan({
            birthDate: "1990-01-01",
            lastCheckupDate: "2026-04-27",
            today,
        });
        expect(planNormal.status).toBe("up_to_date");
        expect(planNormal.nextRecommendedDate).toBe("2027-04-27");
        expect(planNormal.daysUntilNext).toBeGreaterThan(100);

        // 2. 即将到期：还有 20 天到期
        const planSoon = evaluateRoutineCheckupPlan({
            birthDate: "1990-01-01",
            lastCheckupDate: "2025-11-16",
            today,
        });
        expect(planSoon.status).toBe("due_soon");
        expect(planSoon.daysUntilNext).toBeLessThanOrEqual(45);

        // 3. 已逾期：14 个月前体检
        const planOverdue = evaluateRoutineCheckupPlan({
            birthDate: "1990-01-01",
            lastCheckupDate: "2025-08-01",
            today,
        });
        expect(planOverdue.status).toBe("overdue");
        expect(planOverdue.daysUntilNext).toBeLessThan(0);
    });

    it("formatCheckupPlanMarkdown 结构化 Markdown 报告生成", () => {
        const plan = evaluateRoutineCheckupPlan({
            birthDate: "1980-10-01",
            sex: "female",
            lastCheckupDate: "2025-10-01",
            diagnoses: ["高血压"],
            today,
        });

        const md = formatCheckupPlanMarkdown(plan, "张阿姨");
        expect(md).toContain("# 张阿姨 · 年度健康体检规划");
        expect(md).toContain("张阿姨 (女) · 46 岁");
        expect(md).toContain("已逾期待检");
        expect(md).toContain("一般体格检查");
        expect(md).toContain("乳腺超声");
        expect(md).toContain("心脏超声");
    });
});
