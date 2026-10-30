/**
 * 模块图标覆盖测试（第九十八波）：新增模块若忘配图标，此处红。
 */
import { describe, it, expect } from "vitest";
import { BUILT_IN_MODULES, MODULE_ICONS, moduleIcon } from "@/core/modules";

describe("modules.moduleIcon", () => {
    it("全部内置模块都有专属图标（防新模块漂移到 🗂）", () => {
        for (const m of BUILT_IN_MODULES) {
            expect(MODULE_ICONS[m.id], `module ${m.id} 缺图标`).toBeTruthy();
            expect(moduleIcon(m.id)).not.toBe("🗂");
        }
    });

    it("未知 id 回退 🗂", () => {
        expect(moduleIcon("ghost-module")).toBe("🗂");
    });

    it("UI_ICON_PATHS 包含折叠/展开与导轨基础图标定义", async () => {
        const { UI_ICON_PATHS, uiIcon } = await import("@/ui/icons");
        expect(UI_ICON_PATHS.chevronDown).toBeDefined();
        expect(UI_ICON_PATHS.chevronUp).toBeDefined();
        expect(UI_ICON_PATHS.home).toBeDefined();
        expect(UI_ICON_PATHS.settings).toBeDefined();
        expect(UI_ICON_PATHS.moon).toBeDefined();
        expect(UI_ICON_PATHS.copy).toBeDefined();
        expect(UI_ICON_PATHS.link).toBeDefined();

        const rendered = uiIcon("moon", "test-cls", 14);
        expect(rendered).toContain('width="14"');
        expect(rendered).toContain('height="14"');
        expect(rendered).toContain("test-cls");
    });
});
