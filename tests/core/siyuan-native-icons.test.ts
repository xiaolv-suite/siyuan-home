import { describe, it, expect } from "vitest";
import { SIYUAN_NATIVE_ICON_MAP, uiIcon } from "@/ui/icons";

describe("siyuan-native-icons (思源原生图标库 Symbol 映射与渲染引擎)", () => {
    it("提供常用系统图标到思源官方 Symbol 的精准映射", () => {
        expect(SIYUAN_NATIVE_ICON_MAP.settings).toBe("#iconSettings");
        expect(SIYUAN_NATIVE_ICON_MAP.add).toBe("#iconAdd");
        expect(SIYUAN_NATIVE_ICON_MAP.close).toBe("#iconClose");
        expect(SIYUAN_NATIVE_ICON_MAP.search).toBe("#iconSearch");
        expect(SIYUAN_NATIVE_ICON_MAP.calendar).toBe("#iconCalendar");
        expect(SIYUAN_NATIVE_ICON_MAP.folder).toBe("#iconFolder");
        expect(SIYUAN_NATIVE_ICON_MAP.check).toBe("#iconCheck");
        expect(SIYUAN_NATIVE_ICON_MAP.info).toBe("#iconInfo");
        expect(SIYUAN_NATIVE_ICON_MAP.alert).toBe("#iconTriangleAlert");
        expect(SIYUAN_NATIVE_ICON_MAP.bolt).toBe("#iconZap");
    });

    it("命中思源原生映射时优先渲染 svg use 符号并附带 lv-ui-icon--native 标记", () => {
        const svg = uiIcon("settings", "my-class", 18);
        expect(svg).toContain('<use xlink:href="#iconSettings">');
        expect(svg).toContain("lv-ui-icon--native");
        expect(svg).toContain("my-class");
        expect(svg).toContain('width="18"');
    });

    it("领域特有图标无缝回退至定制高保真 SVG 路径并附带 lv-ui-icon--custom 标记", () => {
        // paw, fuel, bus 等在思源官方未包含，回退至内嵌 SVG path
        const svg = uiIcon("paw", "", 16);
        expect(svg).toContain("<path d=");
        expect(svg).toContain("lv-ui-icon--custom");
        expect(svg).not.toContain("<use");
    });
});
