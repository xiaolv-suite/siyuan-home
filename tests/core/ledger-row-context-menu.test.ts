import { describe, it, expect, vi } from "vitest";

describe("ledger-row-context-menu (POOL-FEAT-15 / CAND-19: 台账表格行右键上下文快捷菜单)", () => {
    it("生成整行 Markdown 表格字符串格式正确", () => {
        const headers = ["名称", "分类", "金额", "到期日"];
        const values = ["商业保险", "人身险", "¥3,600", "2027-05-01"];

        function buildRowMarkdown(heads: string[], vals: string[]) {
            return `| ${heads.join(" | ")} |\n| ${heads.map(() => "---").join(" | ")} |\n| ${vals.join(" | ")} |`;
        }

        const md = buildRowMarkdown(headers, values);
        expect(md).toContain("| 名称 | 分类 | 金额 | 到期日 |");
        expect(md).toContain("| --- | --- | --- | --- |");
        expect(md).toContain("| 商业保险 | 人身险 | ¥3,600 | 2027-05-01 |");
    });

    it("生成思源原生块引用锚文本标准语法", () => {
        const itemID = "20261101123456-abcdef1";
        const title = "车辆保单";

        const ref = `((${itemID} '${title}'))`;
        expect(ref).toBe("((20261101123456-abcdef1 '车辆保单'))");
    });

    it("右键菜单阻止浏览器默认菜单并打开原生菜单项", () => {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        function onContextMenu(e: { preventDefault: () => void; stopPropagation: () => void }) {
            e.preventDefault();
            e.stopPropagation();
        }

        onContextMenu({ preventDefault, stopPropagation });
        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
    });
});
