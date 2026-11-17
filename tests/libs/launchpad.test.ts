import { describe, it, expect, vi, beforeEach } from "vitest";
import { lvLaunchpad } from "@/libs/notice";

describe("lvLaunchpad (小驴罗盘 · 家族极速弹射坞生态测试)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lvLaunchpad 支持注册插件条目并可在 getItems 中正确检索", () => {
        const onClickMock = vi.fn();
        const onActionMock = vi.fn();

        const unregister = lvLaunchpad.register({
            id: "siyuan-home-test",
            name: "管家",
            fullName: "小驴管家",
            svgIcon: "iconLvHome",
            color: "#10b981",
            desc: "事项归档 · 效期预警",
            digit: 3,
            badge: "2 到期",
            badgeType: "warn",
            actions: ["记一笔备忘", "今日清单", "逾期扫描", "证件到期速览"],
            onClick: onClickMock,
            onAction: onActionMock,
        });

        const items = lvLaunchpad.getItems();
        const found = items.find((item) => item.id === "siyuan-home-test");
        expect(found).toBeDefined();
        expect(found?.name).toBe("管家");
        expect(found?.fullName).toBe("小驴管家");
        expect(found?.digit).toBe(3);
        expect(found?.badge).toBe("2 到期");
        expect(found?.actions).toHaveLength(4);

        found?.onClick();
        expect(onClickMock).toHaveBeenCalledTimes(1);

        found?.onAction?.("记一笔备忘");
        expect(onActionMock).toHaveBeenCalledWith("记一笔备忘");

        unregister();
        const afterItems = lvLaunchpad.getItems();
        expect(afterItems.find((item) => item.id === "siyuan-home-test")).toBeUndefined();
    });

    it("lvLaunchpad.setPluginState 支持调整插件三态（置顶/坞内/隐藏）", () => {
        const unregister = lvLaunchpad.register({
            id: "state-test-plugin",
            name: "测试",
            fullName: "测试插件",
            svgIcon: "icon-test",
            onClick: () => {},
        });

        lvLaunchpad.setPluginState("state-test-plugin", "pinned");
        let items = lvLaunchpad.getItems();
        let target = items.find((i) => i.id === "state-test-plugin");
        expect(target?.state).toBe("pinned");

        lvLaunchpad.setPluginState("state-test-plugin", "hidden");
        items = lvLaunchpad.getItems();
        target = items.find((i) => i.id === "state-test-plugin");
        expect(target?.state).toBe("hidden");

        unregister();
    });

    it("lvLaunchpad.open 和 close 在无异常情况下安全调度", () => {
        expect(() => lvLaunchpad.open("popover")).not.toThrow();
        expect(() => lvLaunchpad.open("center")).not.toThrow();
        expect(() => lvLaunchpad.close()).not.toThrow();
    });
});
