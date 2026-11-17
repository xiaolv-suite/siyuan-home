import { describe, it, expect } from "vitest";
import { searchSpotlight, searchSpotlightCommands, type SpotlightItem } from "@/core/spotlight";

describe("core/spotlight 全景生活检索", () => {
    const items: SpotlightItem[] = [
        { rowId: "1", moduleId: "certs", title: "居民身份证", location: "主卧抽屉", memberName: "驴爸爸", category: "id" },
        { rowId: "2", moduleId: "medicine", title: "布洛芬缓释胶囊", location: "客厅药箱", dueDate: "2027-05-01" },
        { rowId: "3", moduleId: "stock", title: "清风抽纸", location: "客厅储物柜" },
        { rowId: "4", moduleId: "contracts", title: "房屋租赁合同", amount: 3500, note: "每年10月续签" },
    ];

    it("空查询返回前 N 项", () => {
        expect(searchSpotlight(items, "")).toHaveLength(4);
    });

    it("按标题精准/包含搜索", () => {
        const res = searchSpotlight(items, "身份证");
        expect(res).toHaveLength(1);
        expect(res[0].moduleId).toBe("certs");
    });

    it("按存放位置搜索生活物品", () => {
        const res = searchSpotlight(items, "客厅");
        expect(res.map((r) => r.rowId)).toEqual(["2", "3"]);
    });

    it("按关联成员搜索", () => {
        const res = searchSpotlight(items, "爸爸");
        expect(res).toHaveLength(1);
        expect(res[0].rowId).toBe("1");
    });

    it("按备注关键词搜索", () => {
        const res = searchSpotlight(items, "续签");
        expect(res).toHaveLength(1);
        expect(res[0].moduleId).toBe("contracts");
    });

    it("无匹配返回空数组", () => {
        expect(searchSpotlight(items, "不存在的内容xyz")).toEqual([]);
    });

    it("searchSpotlightCommands 支持 > 触发快捷命令模式", () => {
        const allCmds = searchSpotlightCommands(">");
        expect(allCmds.length).toBeGreaterThan(0);

        const captureCmd = searchSpotlightCommands("> 快速");
        expect(captureCmd.some((c) => c.action === "open-capture")).toBe(true);

        const emergencyCmd = searchSpotlightCommands("> 急救");
        expect(emergencyCmd.some((c) => c.action === "open-emergency")).toBe(true);
    });

    it("支持 #标签 与 !紧急 过滤语法 (CAND-26)", () => {
        const testItems: SpotlightItem[] = [
            { rowId: "10", moduleId: "medicine", title: "急救心通口服液", category: "急救", note: "心脏加急备用" },
            { rowId: "20", moduleId: "stock", title: "日用纸巾", category: "日用品" },
            { rowId: "30", moduleId: "insurance", title: "车险保单", category: "车务", dueDate: "2026-11-02" }, // 临近
            { rowId: "40", moduleId: "contracts", title: "普通合同", category: "合同", dueDate: "2029-01-01" }, // 远期
        ];

        // #标签过滤
        const dailyItems = searchSpotlight(testItems, "#日用品");
        expect(dailyItems).toHaveLength(1);
        expect(dailyItems[0].rowId).toBe("20");

        // !紧急过滤 (含急救关键词或临期到期日)
        const urgentItems = searchSpotlight(testItems, "!紧急");
        const urgentIds = urgentItems.map((i) => i.rowId);
        expect(urgentIds).toContain("10"); // 含急救
        expect(urgentIds).toContain("30"); // 临期
        expect(urgentIds).not.toContain("40"); // 远期

        // 组合过滤: #日用品 加文本搜索
        const combined = searchSpotlight(testItems, "#日用品 纸巾");
        expect(combined).toHaveLength(1);
        expect(combined[0].rowId).toBe("20");
    });
});
