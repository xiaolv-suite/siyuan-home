/**
 * 家庭成员年度健康体检项推算与周期提醒引擎
 * 依据成员年龄、性别、过往慢病/诊断史，智能推算个性化年度体检项目及临期状态
 */

import { localDateKey } from "./hub/rule";

export interface CheckupRecommendationItem {
    id: string;
    name: string;
    category: "routine" | "cancer_screening" | "cardiovascular" | "chronic" | "special";
    categoryLabel: string;
    reason: string;
    frequency: string;
    isAgeTriggered?: boolean;
    isGenderSpecific?: boolean;
    isChronicTriggered?: boolean;
}

export type CheckupCycleStatus = "overdue" | "due_soon" | "up_to_date" | "unrecorded";

export interface RoutineCheckupPlan {
    age?: number;
    sex?: string;
    status: CheckupCycleStatus;
    statusLabel: string;
    lastCheckupDate?: string;
    nextRecommendedDate?: string;
    daysUntilNext?: number;
    recommendedItems: CheckupRecommendationItem[];
    actionAdvice: string;
}

export interface CheckupEvaluationOptions {
    birthDate?: string;
    sex?: "male" | "female" | string;
    lastCheckupDate?: string;
    diagnoses?: string[];
    today?: string;
    cycleMonths?: number;
}

function calculateAge(birthDate: string, today: string): number | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return undefined;
    const [by, bm, bd] = birthDate.split("-").map(Number);
    const [ty, tm, td] = today.split("-").map(Number);
    let age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) {
        age -= 1;
    }
    return Math.max(0, age);
}

function addMonthsToYmd(ymd: string, months: number): string | undefined {
    const parts = ymd.split("-").map(Number);
    if (parts.length < 3 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || !Number.isFinite(parts[2])) {
        return undefined;
    }
    const [y, m, d] = parts;
    const totalM = y * 12 + (m - 1) + months;
    const ny = Math.floor(totalM / 12);
    const nm = (totalM % 12) + 1;
    const maxDays = new Date(ny, nm, 0).getDate();
    const nd = Math.min(d, maxDays);
    return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

function diffDays(targetDate: string, baseDate: string): number {
    const [ty, tm, td] = targetDate.split("-").map(Number);
    const [by, bm, bd] = baseDate.split("-").map(Number);
    const tTime = new Date(ty, tm - 1, td).getTime();
    const bTime = new Date(by, bm - 1, bd).getTime();
    return Math.round((tTime - bTime) / (24 * 60 * 60 * 1000));
}

/**
 * 推算家庭成员的年度体检方案及周期状态
 */
export function evaluateRoutineCheckupPlan(options: CheckupEvaluationOptions): RoutineCheckupPlan {
    const today = options.today || localDateKey(new Date());
    const cycleMonths = options.cycleMonths || 12;
    const age = options.birthDate ? calculateAge(options.birthDate, today) : undefined;
    const sex = options.sex;
    const diagnoses = (options.diagnoses || []).map((d) => d.toLowerCase());

    const items: CheckupRecommendationItem[] = [
        {
            id: "general",
            name: "一般体格检查",
            category: "routine",
            categoryLabel: "基础全套",
            reason: "身高、体重、血压、心率、脉搏、BMI 与腰围测量",
            frequency: "每年 1 次",
        },
        {
            id: "routine_lab",
            name: "血常规、尿常规、便常规",
            category: "routine",
            categoryLabel: "基础全套",
            reason: "贫血、感染、肾损伤与消化道隐血常规筛查",
            frequency: "每年 1 次",
        },
        {
            id: "biochemical",
            name: "肝肾功能、血脂血糖、电解质",
            category: "routine",
            categoryLabel: "生化代谢",
            reason: "评估肝脏代谢、肾小球滤过、血脂水平与早期糖代谢异常",
            frequency: "每年 1 次",
        },
        {
            id: "ecg",
            name: "静息心电图 (12导联)",
            category: "cardiovascular",
            categoryLabel: "心血管",
            reason: "排查心律失常、心肌缺血或传导阻滞",
            frequency: "每年 1 次",
        },
        {
            id: "abdomen_us",
            name: "腹部超声 (肝胆胰脾肾)",
            category: "routine",
            categoryLabel: "腹部影像",
            reason: "筛查脂肪肝、胆囊息肉/结石、肾结石及腹部脏器占位",
            frequency: "每年 1 次",
        },
    ];

    // 年龄与性别专项推荐
    if (age !== undefined) {
        if (age >= 18) {
            items.push({
                id: "thyroid_us",
                name: "甲状腺超声",
                category: "routine",
                categoryLabel: "腺体健康",
                reason: "成人高发甲状腺结节与炎性病变筛查",
                frequency: "每年 1 次",
                isAgeTriggered: true,
            });
        }

        // 女性专项
        if (sex === "female") {
            if (age >= 20) {
                items.push({
                    id: "breast_us",
                    name: "乳腺超声",
                    category: "cancer_screening",
                    categoryLabel: "女性早筛",
                    reason: "亚洲女性乳腺致密度较高，超声适合早筛乳腺增生与结节",
                    frequency: "每年 1 次",
                    isAgeTriggered: true,
                    isGenderSpecific: true,
                });
            }
            if (age >= 25 && age <= 65) {
                items.push({
                    id: "cervical_screen",
                    name: "宫颈液基细胞学 (TCT) + HPV 联合筛查",
                    category: "cancer_screening",
                    categoryLabel: "女性早筛",
                    reason: "国家指南推荐育龄女性宫颈癌联合防癌早筛",
                    frequency: "每 3-5 年 1 次",
                    isAgeTriggered: true,
                    isGenderSpecific: true,
                });
            }
            if (age >= 40) {
                items.push({
                    id: "mammography",
                    name: "乳腺钼靶 X 线摄影",
                    category: "cancer_screening",
                    categoryLabel: "女性早筛",
                    reason: "针对 40 岁以上女性微小钙化灶的早期高灵敏度检查",
                    frequency: "每 1-2 年 1 次",
                    isAgeTriggered: true,
                    isGenderSpecific: true,
                });
            }
        }

        // 男性专项
        if (sex === "male" && age >= 50) {
            items.push({
                id: "psa_screening",
                name: "前列腺特异抗原 (PSA + fPSA)",
                category: "cancer_screening",
                categoryLabel: "男性早筛",
                reason: "50 岁以上男性前列腺良恶性病变特异性血液指标",
                frequency: "每年 1 次",
                isAgeTriggered: true,
                isGenderSpecific: true,
            });
        }

        // 40 岁及以上高发肿瘤与消化道
        if (age >= 40) {
            items.push({
                id: "ldct_lung",
                name: "胸部低剂量螺旋 CT (LDCT)",
                category: "cancer_screening",
                categoryLabel: "肺部早筛",
                reason: "40 岁及以上或吸烟人群肺部微小结节首选筛查方案（辐射剂量仅为常规CT的1/5）",
                frequency: "每年 1 次",
                isAgeTriggered: true,
            });
            items.push({
                id: "gi_endoscopy",
                name: "胃肠镜筛查 (胃镜 + 肠镜)",
                category: "cancer_screening",
                categoryLabel: "消化道早筛",
                reason: "40 岁建议完成人生首次消化道早筛，可直接发现并切除息肉",
                frequency: "每 5-10 年 1 次",
                isAgeTriggered: true,
            });
        }

        // 50 岁及以上骨质与心脑血管
        if (age >= 50) {
            items.push({
                id: "carotid_us",
                name: "颈动脉超声",
                category: "cardiovascular",
                categoryLabel: "脑卒中早筛",
                reason: "排查颈动脉硬化斑块与管腔狭窄，预防中风及心血管意外",
                frequency: "每年 1 次",
                isAgeTriggered: true,
            });
            items.push({
                id: "bone_density",
                name: "双能 X 射线骨密度检查 (DXA)",
                category: "special",
                categoryLabel: "骨骼健康",
                reason: "评估骨质疏松与脆性骨折风险",
                frequency: "每 1-2 年 1 次",
                isAgeTriggered: true,
            });
        }
    }

    // 慢病/诊断史靶向强化加项
    const diagStr = diagnoses.join(" ");
    if (diagStr.includes("高血压") || diagStr.includes("hypertension")) {
        items.push({
            id: "echo_heart",
            name: "心脏超声 (超声心动图)",
            category: "chronic",
            categoryLabel: "慢病追踪",
            reason: "评估高血压靶器官损伤、左室肥厚与舒张功能",
            frequency: "每年 1 次",
            isChronicTriggered: true,
        });
    }
    if (diagStr.includes("糖尿病") || diagStr.includes("diabetes") || diagStr.includes("血糖高")) {
        items.push({
            id: "hba1c",
            name: "糖化血红蛋白 (HbA1c) + 尿微量白蛋白",
            category: "chronic",
            categoryLabel: "慢病追踪",
            reason: "评估过去 3 个月平均血糖控制及早期糖尿病肾损伤",
            frequency: "每 3-6 个月 1 次",
            isChronicTriggered: true,
        });
    }
    if (diagStr.includes("脂肪肝") || diagStr.includes("肝结节")) {
        items.push({
            id: "liver_afp",
            name: "甲胎蛋白 (AFP) + 肝脏剪切波弹性成像",
            category: "chronic",
            categoryLabel: "慢病追踪",
            reason: "肝脏脂肪变性分级、纤维化量化与早期肝病标志物追踪",
            frequency: "每年 1 次",
            isChronicTriggered: true,
        });
    }

    // 计算到期与周期状态
    let status: CheckupCycleStatus = "unrecorded";
    let statusLabel = "尚未记录体检";
    let nextRecommendedDate: string | undefined;
    let daysUntilNext: number | undefined;
    let actionAdvice = "尚未在健康台账中登记过往体检记录，建议根据推荐清单尽快规划一次基础体检。";

    if (options.lastCheckupDate && /^\d{4}-\d{2}-\d{2}$/.test(options.lastCheckupDate)) {
        nextRecommendedDate = addMonthsToYmd(options.lastCheckupDate, cycleMonths);
        if (nextRecommendedDate) {
            daysUntilNext = diffDays(nextRecommendedDate, today);
            if (daysUntilNext < 0) {
                status = "overdue";
                statusLabel = "已逾期待检";
                actionAdvice = `距上次体检已超过 ${cycleMonths} 个月（逾期 ${Math.abs(daysUntilNext)} 天），建议尽早预约体检机构或医院健康管理中心。`;
            } else if (daysUntilNext <= 45) {
                status = "due_soon";
                statusLabel = "即将到期 (45天内)";
                actionAdvice = `距离下次建议体检仅剩 ${daysUntilNext} 天（预计 ${nextRecommendedDate}），已进入预约窗口期，建议提前选定套餐。`;
            } else {
                status = "up_to_date";
                statusLabel = "履约正常";
                actionAdvice = `上次体检时间为 ${options.lastCheckupDate}，体检记录处于有效期内，下次建议体检时间为 ${nextRecommendedDate}。`;
            }
        }
    }

    return {
        age,
        sex,
        status,
        statusLabel,
        lastCheckupDate: options.lastCheckupDate,
        nextRecommendedDate,
        daysUntilNext,
        recommendedItems: items,
        actionAdvice,
    };
}

/**
 * 将成员体检方案输出为结构化 Markdown 报告
 */
export function formatCheckupPlanMarkdown(plan: RoutineCheckupPlan, memberName: string): string {
    const lines: string[] = [
        `# ${memberName} · 年度健康体检规划`,
        "",
        `- **家庭成员**：${memberName}${plan.sex ? ` (${plan.sex === "male" ? "男" : "女"})` : ""}${plan.age !== undefined ? ` · ${plan.age} 岁` : ""}`,
        `- **周期状态**：${plan.statusLabel}`,
        `- **上次体检日期**：${plan.lastCheckupDate || "尚未记录"}`,
        `- **下次建议体检**：${plan.nextRecommendedDate || "随时安排"}${plan.daysUntilNext !== undefined ? ` (剩余 ${plan.daysUntilNext} 天)` : ""}`,
        "",
        `> **专家建议**：${plan.actionAdvice}`,
        "",
        "## 📋 推荐检查项目清单",
        "",
    ];

    const grouped: Record<string, CheckupRecommendationItem[]> = {};
    for (const item of plan.recommendedItems) {
        if (!grouped[item.categoryLabel]) grouped[item.categoryLabel] = [];
        grouped[item.categoryLabel].push(item);
    }

    for (const [groupName, items] of Object.entries(grouped)) {
        lines.push(`### 🔹 ${groupName}`);
        for (const item of items) {
            lines.push(`- **[ ] ${item.name}** (${item.frequency})`);
            lines.push(`  - *意义*：${item.reason}`);
        }
        lines.push("");
    }

    lines.push("---");
    lines.push("*小驴管家 · 本地优先家庭健康管理引擎*");

    return lines.join("\n");
}
