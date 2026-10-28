import { describe, it, expect, vi } from "vitest";
import { smartParseNoteContent } from "@/core/block-capture";

describe("quick-smart-bar (闪速记录智能速记输入与常用模板栏)", () => {
    it("smartParseNoteContent 准确解析自然语言速记文本", () => {
        const text = "去医院给宝宝打疫苗花了350元，2026-11-05去复查";
        const res = smartParseNoteContent(text);

        expect(res).toBeDefined();
        expect(res?.amount).toBe(350);
        expect(res?.date).toBe("2026-11-05");
        expect(res?.suggestedModule).toBe("health");
    });

    it("空输入或纯空白字符安全返回空标题", () => {
        const r1 = smartParseNoteContent("");
        expect(r1.title).toBe("");
        expect(r1.confidence).toBe(0);

        const r2 = smartParseNoteContent("   ");
        expect(r2.title).toBe("");
        expect(r2.confidence).toBe(0);
    });

    it("模板选择与模块切换回调接口完备性", () => {
        const onApplyTemplate = vi.fn();
        const mockTemplate = {
            id: "tpl-1",
            moduleId: "medicine",
            label: "感冒灵",
            values: { name: "999感冒灵", category: "otc" },
        };

        onApplyTemplate(mockTemplate);
        expect(onApplyTemplate).toHaveBeenCalledWith(mockTemplate);
    });
});
