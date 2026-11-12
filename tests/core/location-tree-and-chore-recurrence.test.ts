import { describe, expect, it } from "vitest";
import {
    buildLocationTree,
    queryLocationSubtree,
    flattenLocationTree,
    formatLocationTreeText,
    parseLocationBreadcrumbs,
    formatLocationBreadcrumbTag,
    type LocationRowInput,
} from "../../src/core/location-index";
import {
    advanceChoreRecurrence,
    type ChoreRecurrenceInput,
} from "../../src/core/chores";

describe("Station 3: Location Topology & Dual Recurrence Anchors Engine", () => {
    describe("1. 多层级存放位置空间拓扑 (Location Spatial Topology)", () => {
        const mockRows: LocationRowInput[] = [
            { rowId: "r1", moduleId: "certs", name: "护照原件", location: "主卧 › 大衣柜 › 顶层文件箱", memberName: "张三" },
            { rowId: "r2", moduleId: "certs", name: "港澳通行证", location: "主卧 / 大衣柜 / 顶层文件箱", memberName: "李四" },
            { rowId: "r3", moduleId: "medicine", name: "家庭常备感冒药", location: "主卧 > 大衣柜 > 抽屉1" },
            { rowId: "r4", moduleId: "assets-real", name: "单反相机镜头", location: "主卧 - 防潮箱" },
            { rowId: "r5", moduleId: "stock", name: "备用电池批次", location: "客厅 › 电视柜 › 右收纳盒" },
            { rowId: "r6", moduleId: "certs", name: "结婚证原件", location: "" }, // 未填写
        ];

        it("parseLocationBreadcrumbs 与 formatLocationBreadcrumbTag 兼容多态分隔符", () => {
            expect(parseLocationBreadcrumbs("主卧 › 衣柜 › 抽屉1")).toEqual(["主卧", "衣柜", "抽屉1"]);
            expect(parseLocationBreadcrumbs("书房 / 电脑桌 / 抽屉2")).toEqual(["书房", "电脑桌", "抽屉2"]);
            expect(parseLocationBreadcrumbs("厨房 > 冰箱 - 冷冻室")).toEqual(["厨房", "冰箱", "冷冻室"]);
            expect(formatLocationBreadcrumbTag("主卧 / 衣柜 / 抽屉1")).toBe("主卧 › 衣柜 › 抽屉1");
            expect(formatLocationBreadcrumbTag("")).toBe("（未填写）");
        });

        it("buildLocationTree 正确构建多层空间拓扑树与级联计数", () => {
            const tree = buildLocationTree(mockRows);
            expect(tree).toBeInstanceOf(Array);
            // 顶层空间应该有：主卧 (4 件)、客厅 (1 件)、（未填写）(1 件)
            expect(tree.length).toBe(3);

            const masterBed = tree.find(n => n.segment === "主卧");
            expect(masterBed).toBeDefined();
            expect(masterBed!.totalCount).toBe(4);
            expect(masterBed!.depth).toBe(1);
            expect(masterBed!.fullPath).toBe("主卧");

            // 主卧的子空间应该有：大衣柜 (3 件)、防潮箱 (1 件)
            expect(masterBed!.children.length).toBe(2);
            const closet = masterBed!.children.find(c => c.segment === "大衣柜");
            expect(closet).toBeDefined();
            expect(closet!.totalCount).toBe(3);
            expect(closet!.depth).toBe(2);
            expect(closet!.fullPath).toBe("主卧 › 大衣柜");

            // 大衣柜的子空间应该有：顶层文件箱 (2 件)、抽屉1 (1 件)
            expect(closet!.children.length).toBe(2);
            const fileBox = closet!.children.find(c => c.segment === "顶层文件箱");
            expect(fileBox!.totalCount).toBe(2);
            expect(fileBox!.directEntries).toHaveLength(2);
            expect(fileBox!.directEntries.map(e => e.name)).toEqual(["港澳通行证", "护照原件"]);
        });

        it("queryLocationSubtree 支持按路径查询任意子树空间", () => {
            const tree = buildLocationTree(mockRows);
            const closet = queryLocationSubtree(tree, "主卧 › 大衣柜");
            expect(closet).not.toBeNull();
            expect(closet!.segment).toBe("大衣柜");
            expect(closet!.totalCount).toBe(3);

            // 支持斜杠分隔符查询
            const fileBox = queryLocationSubtree(tree, "主卧 / 大衣柜 / 顶层文件箱");
            expect(fileBox).not.toBeNull();
            expect(fileBox!.segment).toBe("顶层文件箱");
            expect(fileBox!.totalCount).toBe(2);

            // 不存在的路径安全返回 null
            expect(queryLocationSubtree(tree, "地下室 › 酒窖")).toBeNull();
        });

        it("flattenLocationTree 展平为大纲平铺视图", () => {
            const tree = buildLocationTree(mockRows);
            const flat = flattenLocationTree(tree);
            expect(flat.length).toBeGreaterThanOrEqual(6);
            const paths = flat.map(f => f.fullPath);
            expect(paths).toContain("主卧");
            expect(paths).toContain("主卧 › 大衣柜");
            expect(paths).toContain("主卧 › 大衣柜 › 顶层文件箱");
            expect(paths).toContain("客厅");
        });

        it("formatLocationTreeText 格式化输出直观美观的拓扑大纲文本", () => {
            const tree = buildLocationTree(mockRows);
            const text = formatLocationTreeText(tree);
            expect(text).toContain("家庭物品存放位置空间拓扑树");
            expect(text).toContain("主卧 (4 件)");
            expect(text).toContain("大衣柜 (3 件)");
            expect(text).toContain("护照原件");
            expect(text).toContain("客厅 (1 件)");
        });
    });

    describe("2. 周期维护任务双重循环锚点 (Dual Recurrence Anchors: due vs completion)", () => {
        it("completion 锚点：从实际完成日向后递延一个周期（物理消耗型家务）", () => {
            // 场景：原计划 2026-11-01 更换净水器滤芯（周期 90 天），结果拖延到 2026-11-10 才实际完成
            const choreInput: ChoreRecurrenceInput = {
                dueDate: "2026-11-01",
                cycle: "90d",
                recurrenceAnchor: "completion",
            };
            const result = advanceChoreRecurrence(choreInput, "2026-11-10");
            expect(result.anchorUsed).toBe("completion");
            expect(result.daysFromCompletion).toBe(90);
            // 2026-11-10 + 90天 = 2027-02-08
            expect(result.nextDueDate).toBe("2027-02-08");
        });

        it("completion 锚点按月/周递延（如洗车 1 个月）", () => {
            const choreInput: ChoreRecurrenceInput = {
                dueDate: "2026-10-15",
                cycle: "month",
                recurrenceAnchor: "completion",
            };
            const result = advanceChoreRecurrence(choreInput, "2026-11-05");
            expect(result.anchorUsed).toBe("completion");
            // 2026-11-05 + 1个月 = 2026-12-05
            expect(result.nextDueDate).toBe("2026-12-05");
        });

        it("due 锚点：从原约定计划日滚动到完成日及以后的下一个固定日历周期点（日历约定型任务）", () => {
            // 场景：每月 1 号交房租/物业费，2026-11-01 计划，拖到 2026-11-05 完成
            const choreInput: ChoreRecurrenceInput = {
                dueDate: "2026-11-01",
                cycle: "month",
                recurrenceAnchor: "due",
            };
            const result = advanceChoreRecurrence(choreInput, "2026-11-05");
            expect(result.anchorUsed).toBe("due");
            // 2026-11-01 往后滚动一个日历月到 2026-12-01
            expect(result.nextDueDate).toBe("2026-12-01");
        });

        it("缺省 recurrenceAnchor 默认采用 completion 保持生活物理直觉", () => {
            const choreInput: ChoreRecurrenceInput = {
                cycle: "14d",
            };
            const result = advanceChoreRecurrence(choreInput, "2026-11-08");
            expect(result.anchorUsed).toBe("completion");
            expect(result.daysFromCompletion).toBe(14);
            expect(result.nextDueDate).toBe("2026-11-22");
        });
    });
});
