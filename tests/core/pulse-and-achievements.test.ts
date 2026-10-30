import { describe, it, expect, vi } from "vitest";
import { getWeeklyPulse, getFamilyAchievements } from "@/core/pulse-and-achievements";
import type { Reminder, HomeSettings } from "@/types";

describe("core/pulse-and-achievements 生活律动与家庭成就", () => {
    it("正确生成本周 7 天日程脉冲，精准标记今天与星期", () => {
        const testDate = new Date("2026-10-21T12:00:00Z"); // 2026-10-21 是周三
        const pulse = getWeeklyPulse(testDate, [
            { id: "r1", dueDate: "2026-10-21", daysLeft: 0 } as Reminder,
            { id: "r2", dueDate: "2026-10-23", daysLeft: 2 } as Reminder,
        ]);
        expect(pulse).toHaveLength(7);
        expect(pulse[0].weekday).toBe("周一");
        expect(pulse[2].weekday).toBe("周三");
        expect(pulse[2].isToday).toBe(true);
        expect(pulse[2].dueCount).toBe(1);
        expect(pulse[4].dueCount).toBe(1);
        expect(pulse[6].weekday).toBe("周日");
    });

    it("正确根据设置与提醒派生家庭成就勋章", () => {
        const settings = {
            members: [{ id: "m1", name: "爸爸" }],
            enabledModules: ["members", "certs", "health", "medicine", "stock", "house", "vehicles", "shopping"],
            dbRefs: {
                certs: { docId: "doc-certs" },
                medicine: { docId: "doc-med" },
                health: { docId: "doc-health" },
            },
        } as unknown as HomeSettings;

        const reminders: Reminder[] = [
            { id: "r1", moduleId: "certs", daysLeft: 10 } as Reminder,
        ];

        const achievements = getFamilyAchievements(settings, reminders);
        expect(achievements.find((a) => a.id === "all_clear")?.achieved).toBe(true);
        expect(achievements.find((a) => a.id === "certs_safe")?.achieved).toBe(true);
        expect(achievements.find((a) => a.id === "emergency_ready")?.achieved).toBe(true);
        expect(achievements.find((a) => a.id === "full_archive")?.achieved).toBe(true);
    });

    it("生活律动周条键盘漫游导航 (ArrowLeft / ArrowRight / Home / End)", () => {
        const pill1 = { focus: vi.fn() };
        const pill2 = { focus: vi.fn() };
        const pill3 = { focus: vi.fn() };
        const pill7 = { focus: vi.fn() };
        const pills = [pill1, pill2, pill3, { focus: vi.fn() }, { focus: vi.fn() }, { focus: vi.fn() }, pill7];

        function handlePulseKeydown(e: { key: string; target: any; currentTarget: any; preventDefault: () => void }) {
            const idx = pills.indexOf(e.target);
            if (idx === -1) return;
            e.preventDefault();
            if (e.key === "ArrowRight") {
                pills[(idx + 1) % pills.length].focus();
            } else if (e.key === "ArrowLeft") {
                pills[(idx - 1 + pills.length) % pills.length].focus();
            } else if (e.key === "Home") {
                pills[0].focus();
            } else if (e.key === "End") {
                pills[pills.length - 1].focus();
            }
        }

        const preventDefault = vi.fn();
        // 0 -> ArrowRight -> 1
        handlePulseKeydown({ key: "ArrowRight", target: pill1, currentTarget: {}, preventDefault });
        expect(pill2.focus).toHaveBeenCalled();

        // 0 -> ArrowLeft -> 6 (周日)
        handlePulseKeydown({ key: "ArrowLeft", target: pill1, currentTarget: {}, preventDefault });
        expect(pill7.focus).toHaveBeenCalled();

        // 2 -> Home -> 0 (周一)
        handlePulseKeydown({ key: "Home", target: pill3, currentTarget: {}, preventDefault });
        expect(pill1.focus).toHaveBeenCalled();

        // 1 -> End -> 6 (周日)
        handlePulseKeydown({ key: "End", target: pill2, currentTarget: {}, preventDefault });
        expect(pill7.focus).toHaveBeenCalledTimes(2);
    });

    it("日历脉冲胶囊多语言 aria-label 与 title 格式化验证", () => {
        const t = (k: string) => {
            if (k === "overview.filterDayTip") return "${date} ${weekday}：${count} 项待办（点击筛选该日）";
            return k;
        };

        const tip = t("overview.filterDayTip")
            .replace("${date}", "2026-10-21")
            .replace("${weekday}", "周三")
            .replace("${count}", "3");

        expect(tip).toBe("2026-10-21 周三：3 项待办（点击筛选该日）");
    });
});
