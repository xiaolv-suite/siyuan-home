import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    fileFingerprint,
    convertFormCellValue,
    smartExtractTitleFields,
    executeLedgerRecordSave,
} from "@/core/ledger-record-saver";
import { selectCellValue } from "@/core/avcell";
import * as siyuan from "@/core/siyuan";

describe("ledger-record-saver (台账新增记录保存事务引擎)", () => {
    beforeEach(() => {
        vi.spyOn(siyuan, "addDetachedRow").mockResolvedValue("new-row-id");
        vi.spyOn(siyuan, "setCell").mockResolvedValue(undefined);
    });

    it("fileFingerprint 生成文件指纹键", () => {
        expect(fileFingerprint({ name: "passport.pdf", size: 1024, lastModified: 1700000000000 }))
            .toBe("passport.pdf:1024:1700000000000");
        expect(fileFingerprint({ name: "photo.jpg", size: 2048 }))
            .toBe("photo.jpg:2048:0");
    });

    it("convertFormCellValue 对各类列字段转换正确格式", () => {
        const members = [{ avItemId: "mem-1", name: "张三" }];

        // select
        expect(convertFormCellValue("select", "active")).toEqual(selectCellValue("active"));

        // relation
        expect(convertFormCellValue("relation", "mem-1", members)).toEqual({
            type: "relation",
            relation: { blockIDs: ["mem-1"], contents: null },
        });
        expect(convertFormCellValue("relation", "unknown-mem", members)).toBeNull();

        // date
        expect(convertFormCellValue("date", "2026-10-28")).toEqual({
            type: "date",
            date: { content: new Date("2026-10-28T00:00:00").getTime(), isNotEmpty: true, isNotTime: true },
        });
        expect(convertFormCellValue("date", "")).toEqual({
            type: "date",
            date: { isNotEmpty: false },
        });

        // number
        expect(convertFormCellValue("number", 123.45)).toEqual({
            type: "number",
            number: { content: 123.45, isNotEmpty: true },
        });
        expect(convertFormCellValue("number", "")).toEqual({
            type: "number",
            number: { isNotEmpty: false },
        });

        // url & checkbox & text
        expect(convertFormCellValue("url", "https://example.com")).toEqual({
            type: "url",
            url: { content: "https://example.com" },
        });
        expect(convertFormCellValue("checkbox", true)).toEqual({
            type: "checkbox",
            checkbox: { checked: true },
        });
        expect(convertFormCellValue("text", "测试")).toEqual({
            type: "text",
            text: { content: "测试" },
        });
    });

    it("smartExtractTitleFields 智能分离标题与日期金额", () => {
        const schemaCols = [
            { key: "expiry", type: "date" },
            { key: "amount", type: "number" },
        ];
        const res = smartExtractTitleFields("护照 2028-10-01 500元", schemaCols);
        expect(res.cleanTitle).toBe("护照");
        expect(res.extractedDate).toBe("2028-10-01");
        expect(res.extractedAmount).toBe(500);
        expect(res.dateColKey).toBe("expiry");
        expect(res.numColKey).toBe("amount");

        // 普通无提取标题
        const normal = smartExtractTitleFields("普通家庭台账记录", schemaCols);
        expect(normal.cleanTitle).toBe("普通家庭台账记录");
        expect(normal.extractedDate).toBeUndefined();
    });

    it("executeLedgerRecordSave 正常保存台账行并写入相关列", async () => {
        const mockPlugin = {
            settings: {
                dbRefs: {
                    certs: {
                        avId: "av-certs-1",
                        columns: {
                            name: "col_name",
                            category: "col_cat",
                            expiry: "col_exp",
                        },
                    },
                },
                members: [],
            },
            schemaCatalog: {
                certs: {
                    columns: [
                        { key: "name", type: "text" },
                        { key: "category", type: "select" },
                        { key: "expiry", type: "date" },
                    ],
                },
            },
            repairModule: vi.fn(),
        };

        const result = await executeLedgerRecordSave({
            plugin: mockPlugin,
            active: "certs",
            ref: {
                avId: "av-certs-1",
                docId: "doc-certs-1",
                columns: {
                    name: "col_name",
                    category: "col_cat",
                    expiry: "col_exp",
                },
            },
            form: {
                name: "港澳通行证",
                category: "pass",
                expiry: "2029-05-01",
            },
            supportableCols: [
                { key: "name", type: "text" },
                { key: "category", type: "select" },
                { key: "expiry", type: "date" },
            ],
            t: (k) => k,
        });

        expect(result.success).toBe(true);
        expect(result.savedName).toBe("港澳通行证");
        expect(result.failedFields).toEqual([]);
        expect(result.itemID).toBe("new-row-id");
    });
});
