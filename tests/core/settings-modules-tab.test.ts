import { describe, it, expect, vi } from "vitest";
import { MODULE_GROUPS, modulesByGroup, BUILT_IN_MODULES } from "@/core/modules";

describe("settings-modules-tab (设置面板模块管理子组件)", () => {
    it("支持按模块分类与关键词实时过滤", () => {
        const t = (k: string) => {
            if (k === "module.medicine") return "家庭药箱";
            if (k === "module.vehicle") return "爱车档案";
            return k;
        };

        const filterModules = (group: any, search: string) => {
            return search.trim()
                ? BUILT_IN_MODULES.filter((m) => (t(`module.${m.id}`) + m.id).toLowerCase().includes(search.trim().toLowerCase()))
                : modulesByGroup(group);
        };

        const peopleModules = filterModules("people", "");
        expect(peopleModules.length).toBeGreaterThan(0);
        expect(peopleModules.some((m) => m.id === "members" || m.id === "health")).toBe(true);

        const searchResult = filterModules("people", "药箱");
        expect(searchResult.length).toBe(1);
        expect(searchResult[0].id).toBe("medicine");
    });

    it("支持全选所有模块与仅保留核心/常开模块", () => {
        const allModules = MODULE_GROUPS.flatMap((g) => modulesByGroup(g).map((m) => m.id));
        expect(allModules.length).toBe(BUILT_IN_MODULES.length);

        const coreModules = MODULE_GROUPS.flatMap((g) => modulesByGroup(g))
            .filter((m) => m.defaultEnabled || m.alwaysOn)
            .map((m) => m.id);

        expect(coreModules.length).toBeLessThan(allModules.length);
        expect(coreModules).toContain("members");
        expect(coreModules).toContain("health");
    });

    it("切换模块状态时遵循 alwaysOn 保护与角色建议提示", () => {
        let draftEnabled = ["overview", "reminders"];
        const draftMembers = [{ id: "m1", name: "张三", role: "adult" }];
        const showMessage = vi.fn();
        const confirm = vi.fn((title, body, cb) => cb());

        const toggleModule = (id: string, alwaysOn?: boolean) => {
            if (alwaysOn) return;
            const enabledSet = new Set(draftEnabled);
            if (enabledSet.has(id)) {
                confirm("disableTitle", "disableBody", () => {
                    draftEnabled = draftEnabled.filter((x) => x !== id);
                });
            } else {
                draftEnabled = [...draftEnabled, id];
                const mod = modulesByGroup("kids").find((m) => m.id === id);
                if (mod?.suggestRoles?.length) {
                    const has = draftMembers.some((m) => mod.suggestRoles!.includes(m.role as any));
                    if (!has) showMessage("members.suggestOn");
                }
            }
        };

        // alwaysOn 保护无法关闭
        toggleModule("overview", true);
        expect(draftEnabled).toContain("overview");

        // 启用新模块（无对应角色触发建议）
        toggleModule("schooling", false);
        expect(draftEnabled).toContain("schooling");
        expect(showMessage).toHaveBeenCalled();

        // 再次点击触发关闭确认
        toggleModule("schooling", false);
        expect(confirm).toHaveBeenCalled();
        expect(draftEnabled).not.toContain("schooling");
    });
});
