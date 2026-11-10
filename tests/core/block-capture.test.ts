import { describe, it, expect } from "vitest";
import {
    inferModuleFromText,
    extractDateFromText,
    extractAmountFromText,
    smartExtractFieldsFromTitle,
    smartParseNoteContent,
    cleanTaskPrefix,
    formatAsTaskBlock,
} from "@/core/block-capture";

describe("core/block-capture 思源块内容与笔记智能速记（301波）", () => {
    describe("inferModuleFromText 模块关键词语义推断", () => {
        it("推断药品模块", () => {
            const res = inferModuleFromText("买了布洛芬缓释胶囊，每日2次饭后温水送服");
            expect(res).toBeDefined();
            expect(res?.moduleId).toBe("medicine");
            expect(res?.confidence).toBeGreaterThanOrEqual(0.7);
        });

        it("推断合同模块", () => {
            const res = inferModuleFromText("和房东签了房屋租赁合同，押金 4000元，自动续约条款已确认");
            expect(res?.moduleId).toBe("contracts");
        });

        it("推断车辆模块", () => {
            const res = inferModuleFromText("今天给机动车做基础保养，换了机油，里程 45000公里");
            expect(res?.moduleId).toBe("vehicles");
        });

        it("推断证件模块", () => {
            const res = inferModuleFromText("港澳通行证签注即将到期，需要去出入境大厅换证");
            expect(res?.moduleId).toBe("certs");
        });

        it("推断人情往来模块", () => {
            const res = inferModuleFromText("老李家孩子满月红包 1000元");
            expect(res?.moduleId).toBe("favors");
        });

        it("推断囤货模块", () => {
            const res = inferModuleFromText("超市采购囤了抽纸和两瓶洗衣液");
            expect(res?.moduleId).toBe("stock");
            expect(res?.confidence).toBeGreaterThanOrEqual(0.6);
        });

        it("推断家务模块", () => {
            const res = inferModuleFromText("周末家庭大扫除，扫地拖地并擦窗倒垃圾");
            expect(res?.moduleId).toBe("chores");
        });

        it("推断教育上学模块", () => {
            const res = inferModuleFromText("下周三下午学校开家长会并交下学期学费");
            expect(res?.moduleId).toBe("schooling");
        });

        it("推断商业保险模块", () => {
            const res = inferModuleFromText("全家投保了重疾险和百万医疗险保单");
            expect(res?.moduleId).toBe("insurance");
        });

        it("推断影音书库模块", () => {
            const res = inferModuleFromText("最近在读一本豆瓣高分小说书单");
            expect(res?.moduleId).toBe("media");
        });

        it("无特征文本返回 undefined", () => {
            expect(inferModuleFromText("今天天气真好，出去散步了一会儿")).toBeUndefined();
            expect(inferModuleFromText("")).toBeUndefined();
        });
    });

    describe("extractDateFromText 日期智能抽取", () => {
        it("抽取标准 YYYY-MM-DD 格式", () => {
            const res = extractDateFromText("合同截止到 2026-11-20 请注意续约");
            expect(res.date).toBe("2026-11-20");
            expect(res.cleanText).toBe("合同截止到   请注意续约");
        });

        it("抽取中文年月日格式", () => {
            const res = extractDateFromText("2026年10月05日 参加朋友婚礼");
            expect(res.date).toBe("2026-10-05");
        });

        it("无日期文本返回原内容", () => {
            const res = extractDateFromText("纯文本不带时间");
            expect(res.date).toBeUndefined();
            expect(res.cleanText).toBe("纯文本不带时间");
        });
    });

    describe("extractAmountFromText 金额智能抽取", () => {
        it("抽取人民币符号金额", () => {
            const res = extractAmountFromText("买了一台吸尘器 ¥1299.00");
            expect(res.amount).toBe(1299.0);
        });

        it("抽取带元单位金额", () => {
            const res = extractAmountFromText("随礼份子钱 500元 送给张三");
            expect(res.amount).toBe(500);
        });

        it("抽取押金/费用关键字金额", () => {
            const res = extractAmountFromText("租房押金 3500 务必保留收据");
            expect(res.amount).toBe(3500);
        });
    });

    describe("smartParseNoteContent 结构化智能速记全景解析", () => {
        it("从一句话中提炼标题、模块、金额、到期日与备注", () => {
            const raw = "购买了九号电动车 3800元，保修到 2028-10-15，发票存在抽屉里";
            const parsed = smartParseNoteContent(raw);

            expect(parsed.suggestedModule).toBe("vehicles");
            expect(parsed.confidence).toBeGreaterThanOrEqual(0.6);
            expect(parsed.amount).toBe(3800);
            expect(parsed.date).toBe("2028-10-15");
            expect(parsed.title).toContain("九号电动车");
            expect(parsed.note).toContain("发票存在抽屉里");
        });

        it("空文本稳健回退", () => {
            const parsed = smartParseNoteContent("");
            expect(parsed.title).toBe("");
            expect(parsed.confidence).toBe(0);
        });
    });

    describe("smartExtractFieldsFromTitle 标题智能日期与金额自动析出", () => {
        it("从复合标题中析出日期并净化标题", () => {
            const res = smartExtractFieldsFromTitle("2028-11-20 居民身份证");
            expect(res.extractedDate).toBe("2028-11-20");
            expect(res.cleanTitle).toBe("居民身份证");
        });

        it("从复合标题中析出金额与日期", () => {
            const res = smartExtractFieldsFromTitle("租房合同 3500元 2027年10月01日");
            expect(res.extractedAmount).toBe(3500);
            expect(res.extractedDate).toBe("2027-10-01");
            expect(res.cleanTitle).toBe("租房合同");
        });

        it("普通标题原样返回", () => {
            const res = smartExtractFieldsFromTitle("清风原木纯品抽纸");
            expect(res.cleanTitle).toBe("清风原木纯品抽纸");
            expect(res.extractedDate).toBeUndefined();
            expect(res.extractedAmount).toBeUndefined();
        });

        it("思源任务列表块前缀智能净化 (- [ ] 与 - [x])", () => {
            const res1 = smartExtractFieldsFromTitle("- [ ] 2026-11-20 去车管所年检机动车");
            expect(res1.cleanTitle).toBe("去车管所年检机动车");
            expect(res1.extractedDate).toBe("2026-11-20");
            expect(res1.isTask).toBe(true);
            expect(res1.isCompleted).toBe(false);

            const res2 = smartExtractFieldsFromTitle("* [x] 缴纳物业费 320元");
            expect(res2.cleanTitle).toBe("缴纳物业费");
            expect(res2.extractedAmount).toBe(320);
            expect(res2.isTask).toBe(true);
            expect(res2.isCompleted).toBe(true);
        });
    });

    describe("cleanTaskPrefix 与 formatAsTaskBlock 思源任务列表块联动", () => {
        it("识别任务前缀并提取纯净文本", () => {
            expect(cleanTaskPrefix("- [ ] 购买纯牛奶 2箱")).toEqual({ cleanText: "购买纯牛奶 2箱", isTask: true, isCompleted: false });
            expect(cleanTaskPrefix("* [X] 已完成备忘")).toEqual({ cleanText: "已完成备忘", isTask: true, isCompleted: true });
            expect(cleanTaskPrefix("普通文本")).toEqual({ cleanText: "普通文本", isTask: false, isCompleted: false });
        });

        it("格式化为思源任务列表块 Markdown", () => {
            expect(formatAsTaskBlock("身份证换证", "2026-11-05", "20261026-abc1234"))
                .toBe('- [ ] ((20261026-abc1234 "身份证换证")) · 到期: 2026-11-05');
            expect(formatAsTaskBlock("随手备忘", "2026-11-05"))
                .toBe("- [ ] 随手备忘 · 到期: 2026-11-05");
        });

        it("支持对齐 Task Horizon (任务视界) 标准自定义属性集", () => {
            const task = formatAsTaskBlock("缴纳车险", "2026-11-20", "row-veh-123", {
                moduleName: "车辆档案",
                priority: "high",
            });
            expect(task).toBe(
                "- [ ] 缴纳车险 · 车辆档案 {: custom-status=\"todo\" custom-priority=\"high\" custom-completion-time=\"2026-11-20\" custom-remark=\"(( row-veh-123 '缴纳车险' ))\" }"
            );
        });
    });
});
