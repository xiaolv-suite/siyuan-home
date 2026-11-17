import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    homeNotify,
    homeSilent,
    homeCard,
    homeInline,
    isHomeMutedToday,
    muteHomeToday,
    lvNotify,
} from "@/libs/notice";

describe("notice (统一通知出口包装器与分流测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("error 类型自动升级为现代交互卡片 (lvNotify.card)", () => {
        const cardSpy = vi.spyOn(lvNotify, "card").mockReturnValue("card-err-1");
        homeNotify("网络请求失败，请检查思源内核", 4000, "error");

        expect(cardSpy).toHaveBeenCalledTimes(1);
        const opt = cardSpy.mock.calls[0][0];
        expect(opt.source).toBe("小驴管家");
        expect(opt.level).toBe("error");
        expect(opt.message).toBe("网络请求失败，请检查思源内核");
        expect(opt.duration).toBe(6000); // 最小保底 6000ms
    });

    it("info 类型转为瞬时微胶囊 (lvNotify.capsule)", () => {
        const capSpy = vi.spyOn(lvNotify, "capsule").mockReturnValue("cap-1");
        homeNotify("已成功保存成员信息", 2500, "info");

        expect(capSpy).toHaveBeenCalledTimes(1);
        const opt = capSpy.mock.calls[0][0];
        expect(opt.source).toBe("小驴管家");
        expect(opt.message).toBe("已成功保存成员信息");
        expect(opt.duration).toBe(2500);
    });

    it("后台常规运行静默入库 (homeSilent -> lvNotify.silent)", () => {
        const silentSpy = vi.spyOn(lvNotify, "silent");
        homeSilent("hub-scan", "管家后台扫描完成：0 逾期");

        expect(silentSpy).toHaveBeenCalledTimes(1);
        const opt = silentSpy.mock.calls[0][0];
        expect(opt.source).toBe("小驴管家");
        expect(opt.category).toBe("hub-scan");
        expect(opt.message).toBe("管家后台扫描完成：0 逾期");
        expect(opt.level).toBe("info");
    });

    it("卡片式重点通知 (homeCard -> lvNotify.card)", () => {
        const cardSpy = vi.spyOn(lvNotify, "card").mockReturnValue("card-p-1");
        const id = homeCard({
            title: "重要通知",
            message: "身份证即将到期",
            level: "warn",
        });

        expect(id).toBe("card-p-1");
        expect(cardSpy).toHaveBeenCalledTimes(1);
        expect(cardSpy.mock.calls[0][0].source).toBe("小驴管家");
    });

    it("原位微动效 (homeInline -> lvNotify.inline)", () => {
        const inlineSpy = vi.spyOn(lvNotify, "inline");
        homeInline(null, "已复制");
        expect(inlineSpy).toHaveBeenCalledWith(null, "已复制", true);
    });

    it("免打扰查询与设置转发", () => {
        const isMutedSpy = vi.spyOn(lvNotify, "isMutedToday").mockReturnValue(true);
        const muteSpy = vi.spyOn(lvNotify, "muteToday");

        expect(isHomeMutedToday("priority-reminders")).toBe(true);
        expect(isMutedSpy).toHaveBeenCalledWith("priority-reminders");

        muteHomeToday("priority-reminders");
        expect(muteSpy).toHaveBeenCalledWith("priority-reminders");
    });
});
