import { describe, it, expect } from "vitest";
import {
    getCertificateScalarCols,
    getQuickAssetCols,
    hasAnyFormInput,
    canSubmitRecord,
    prepareCategoryChange,
    validateFieldInput,
} from "@/core/ledger-record-view-model";
import type { ColumnDef } from "@/core/schema";

describe("ledger-record-view-model (台账录入视图模型与字段校验)", () => {
    const t = (k: string) => {
        const dict: Record<string, string> = {
            "field.name": "名称",
            "capture.validation.required": "请填写${field}",
            "members.notLinked": "成员未关联",
        };
        return dict[k] ?? k;
    };

    it("getCertificateScalarCols 正确派生身份证与护照的标量字段", () => {
        const schemaCols = [
            { key: "holder_no", type: "text" },
            { key: "x_cert_id_number", type: "text" },
            { key: "x_cert_valid_from", type: "date" },
            { key: "expiry", type: "date" },
            { key: "attachments", type: "mAsset" },
        ];

        // 身份证 profile（category: "id"）自动剔除 holder_no
        const idProfile = { category: "id", fieldKeys: ["x_cert_valid_from"] };
        const idCols = getCertificateScalarCols(schemaCols, idProfile);
        const idKeys = idCols.map((c) => c.key);
        expect(idKeys).not.toContain("holder_no");
        expect(idKeys).not.toContain("attachments"); // 剔除 mAsset

        // profile 为 null 返回空数组
        expect(getCertificateScalarCols(schemaCols, null)).toEqual([]);
    });

    it("getQuickAssetCols 正确去重提取附件与证件照插槽", () => {
        const schemaCols: ColumnDef[] = [
            { key: "attachments", type: "mAsset", labelKey: "field.attachments" },
            { key: "name", type: "text" },
        ];
        const certProfile = {
            category: "id",
            columns: [
                { key: "x_cert_id_card_front", type: "mAsset", labelKey: "field.front" },
                { key: "attachments", type: "mAsset" }, // 重复项
            ] as ColumnDef[],
        };

        const assetCols = getQuickAssetCols(schemaCols, certProfile, "certs");
        expect(assetCols.map((c) => c.key)).toEqual(["attachments", "x_cert_id_card_front"]);
    });

    it("hasAnyFormInput 正确判断表单草稿存在性", () => {
        const supportableCols: ColumnDef[] = [
            { key: "name", type: "text" },
            { key: "note", type: "text" },
        ];

        // 完全空表单
        expect(hasAnyFormInput(supportableCols, [], [], {}, {}, {})).toBe(false);

        // 包含空白字符的名称不算有效输入
        expect(hasAnyFormInput(supportableCols, [], [], { name: "   " }, {}, {})).toBe(false);

        // 包含实际内容
        expect(hasAnyFormInput(supportableCols, [], [], { name: "居民身份证" }, {}, {})).toBe(true);

        // 包含附件文件
        expect(hasAnyFormInput(supportableCols, [], [{ key: "attachments" }], {}, { attachments: [new File([], "test.jpg")] }, {})).toBe(true);
    });

    it("canSubmitRecord 门禁校验", () => {
        // 保存中禁止重复点击
        expect(canSubmitRecord(true, "证件", true, "certs", "id")).toBe(false);

        // 证件台账未选分类禁止提交
        expect(canSubmitRecord(false, "证件", true, "certs", "")).toBe(false);

        // 有输入但缺失名称禁止提交
        expect(canSubmitRecord(false, "", true, "certs", "id")).toBe(false);

        // 正常情况允许提交
        expect(canSubmitRecord(false, "我的身份证", true, "certs", "id")).toBe(true);
    });

    it("prepareCategoryChange 正确保护已有草稿并在允许时迁移保留字段", () => {
        const form = { name: "旧护照", note: "原件在抽屉", x_custom_temp: "临时值", category: "passport" };
        const files = { attachments: [] };

        // 有草稿且分类不同时拦截
        const blocked = prepareCategoryChange("id", "passport", true, form, files, {});
        expect(blocked.blocked).toBe(true);

        // 无草稿或允许切换时，保留通用基础字段并切换分类
        const allowed = prepareCategoryChange("id", "passport", false, form, files, {});
        expect(allowed.blocked).toBe(false);
        expect(allowed.newForm?.category).toBe("id");
        expect(allowed.newForm?.name).toBe("旧护照");
        expect(allowed.newForm?.note).toBe("原件在抽屉");
        expect(allowed.newForm?.x_custom_temp).toBeUndefined(); // 非保留字段清洗
    });

    it("validateFieldInput 校验必填字段与成员关联", () => {
        const reqField: ColumnDef = { key: "name", type: "text", required: true };
        expect(validateFieldInput(reqField, "", [], t)).toContain("请填写名称");

        const relField: ColumnDef = { key: "member", type: "relation" };
        const members = [{ avItemId: "item_1", name: "张三" }];
        // 未关联成员
        expect(validateFieldInput(relField, "invalid_id", members, t)).toBe("成员未关联");
        // 合法成员
        expect(validateFieldInput(relField, "item_1", members, t)).toBe("");
    });
});
