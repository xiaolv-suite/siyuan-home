import { describe, expect, it } from "vitest";
import {
    renderLocationCapsuleHtml,
    findSiblingItemsInSameLocation,
    type LocationRowInput,
} from "../../src/core/location-index";
import {
    formatDailyHomeBoardMarkdown,
    type DailyHomeBoardItem,
} from "../../src/core/reminder-digest";

describe("Home Native Document Synergy: Daily Alert Board & Location Capsule", () => {
    describe("1. formatDailyHomeBoardMarkdown 每日生活备忘与到期预警看板", () => {
        const mockReminders: DailyHomeBoardItem[] = [
            { id: "rem-1", moduleId: "insurance", title: "车辆商业险续保", dueDate: "2026-11-06", daysLeft: -2, level: "overdue" },
            { id: "rem-2", moduleId: "certs", title: "护照到期换发", dueDate: "2026-11-13", daysLeft: 5, level: "soon", location: "主卧 › 大衣柜 › 顶层文件箱" },
            { id: "rem-3", moduleId: "chores", title: "更换净水器滤芯", dueDate: "2026-11-20", daysLeft: 12, level: "lead", location: "厨房 / 橱柜下方" },
        ];

        it("正确生成带红黄绿状态灯、模块标签与空间位置的 Bento Callout 看板", () => {
            const md = formatDailyHomeBoardMarkdown(mockReminders, {
                date: "2026-11-08",
                label: (m) => (m === "insurance" ? "保险管理" : (m === "certs" ? "证件管理" : "家务周期")),
            });

            expect(md).toContain("> 🏠 **今日家庭生活备忘与到期预警 · 2026-11-08**");
            expect(md).toContain("待处理: **3** 项 (🔴 逾期: **1** · 🟠 7天内: **1** · 🟡 预警期: **1**)");
            // 逾期项
            expect(md).toContain("> - [ ] 🔴 **车辆商业险续保** `保险管理` (已逾期 2 天 · 2026-11-06)");
            // 7天内到期项（带位置胶囊）
            expect(md).toContain("> - [ ] 🟠 **护照到期换发** `证件管理` `📍 主卧 › 大衣柜 › 顶层文件箱` (剩 5 天 · 2026-11-13)");
            // 预警期项（斜杠自动归一化为标准面包屑箭头）
            expect(md).toContain("> - [ ] 🟡 **更换净水器滤芯** `家务周期` `📍 厨房 › 橱柜下方` (剩 12 天 · 2026-11-20)");
            // 思源原生 IAL 属性
            expect(md).toContain("custom-type=\"home-alert-board\"");
            expect(md).toContain("custom-home-id=\"rem-1\"");
        });

        it("今日无待办时给出轻松愉悦的绿色反馈", () => {
            const md = formatDailyHomeBoardMarkdown([], { date: "2026-11-08" });
            expect(md).toContain("待处理: **0** 项");
            expect(md).toContain("🟢 今日无待处理到期事项，家庭生活井井有条！");
        });
    });

    describe("2. renderLocationCapsuleHtml 空间拓扑微胶囊标签渲染", () => {
        it("将多层级存放位置渲染为符合思源规范的微胶囊 HTML", () => {
            const html = renderLocationCapsuleHtml("主卧 › 大衣柜 › 抽屉1");
            expect(html).toContain("class=\"b3-chip b3-chip--secondary b3-chip--small lv-location-pill\"");
            expect(html).toContain("主卧");
            expect(html).toContain("大衣柜");
            expect(html).toContain("抽屉1");
            expect(html).toContain("›");
            expect(html).toContain("<svg");
        });

        it("未填写或空值安全渲染友好占位", () => {
            expect(renderLocationCapsuleHtml("")).toContain("（未填写位置）");
            expect(renderLocationCapsuleHtml(undefined)).toContain("（未填写位置）");
        });
    });

    describe("3. findSiblingItemsInSameLocation 同空间位置关联检索器", () => {
        const mockRows: LocationRowInput[] = [
            { rowId: "item-1", moduleId: "certs", name: "护照原件", location: "主卧 › 大衣柜 › 顶层文件箱" },
            { rowId: "item-2", moduleId: "certs", name: "港澳通行证", location: "主卧 / 大衣柜 / 顶层文件箱" },
            { rowId: "item-3", moduleId: "medicine", name: "退烧药", location: "主卧 > 大衣柜 > 抽屉1" },
            { rowId: "item-4", moduleId: "assets-real", name: "房产证", location: "主卧 › 大衣柜 › 顶层文件箱" },
        ];

        it("根据目标物品准确查找同一具体储物空间下的全部同伴物品", () => {
            // 查询与 item-1（护照原件）放在同一个顶层文件箱的物品
            const res = findSiblingItemsInSameLocation("item-1", mockRows);
            expect(res).not.toBeNull();
            expect(res!.location).toBe("主卧 › 大衣柜 › 顶层文件箱");
            expect(res!.breadcrumbs).toEqual(["主卧", "大衣柜", "顶层文件箱"]);
            // 应该找到 2 个同伴：港澳通行证、房产证（排除自身 item-1）
            expect(res!.siblings).toHaveLength(2);
            expect(res!.siblings.map(s => s.name)).toEqual(["房产证", "港澳通行证"]);
        });

        it("目标物品不存在或未填写位置时安全返回 null", () => {
            expect(findSiblingItemsInSameLocation("non-exist-id", mockRows)).toBeNull();
            const rowsWithEmpty: LocationRowInput[] = [{ rowId: "e1", moduleId: "stock", name: "某物", location: "" }];
            expect(findSiblingItemsInSameLocation("e1", rowsWithEmpty)).toBeNull();
        });
    });
});
