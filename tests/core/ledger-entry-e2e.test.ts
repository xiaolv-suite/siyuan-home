/**
 * 台账录入与端到端读取验证 (E2E Simulation Test)
 * 验证：车辆及各模块录入后数据完整性、SiYuan cells 解析容错、列别名匹配与空值防御。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setTransport, renderLedger } from "@/core/siyuan";
import { provisionModule, COMMON_COLUMN_ALIASES } from "@/core/provisioner";
import { VEHICLES_SCHEMA } from "@/core/schema";
import { defaultSettings } from "@/core/settings";
import { cellContentText } from "@/core/avcell";

describe("台账录入与数据呈现端到端 (E2E) 验证", () => {
    let handler: (endpoint: string, payload: any) => any;

    beforeEach(() => {
        setTransport(async (endpoint, payload) => {
            if (handler) return handler(endpoint, payload);
            return { code: 0, msg: "", data: {} };
        });
    });

    afterEach(() => {
        setTransport(null);
    });

    it("车辆建库能正确识别并生成全量字段别名", () => {
        expect(COMMON_COLUMN_ALIASES.plate).toContain("车牌");
        expect(COMMON_COLUMN_ALIASES.plate).toContain("车牌号");
        expect(COMMON_COLUMN_ALIASES.brand_model).toContain("品牌型号");
        expect(COMMON_COLUMN_ALIASES.brand_model).toContain("车型");
        expect(COMMON_COLUMN_ALIASES.energy_type).toContain("能源类型");
        expect(COMMON_COLUMN_ALIASES.mileage).toContain("里程");
        expect(COMMON_COLUMN_ALIASES.inspection_due).toContain("车检到期");
        expect(COMMON_COLUMN_ALIASES.insurance_due).toContain("车险到期");
    });

    it("renderLedger 兼容包含 c.value 和直接展平的 cell 结构", async () => {
        const AV_ID = "av-test-123";
        handler = (endpoint) => {
            if (endpoint === "/api/av/renderAttributeView") {
                return {
                    code: 0,
                    msg: "",
                    data: {
                        view: {
                            columns: [
                                { id: "col-name", name: "名称", type: "text" },
                                { id: "col-plate", name: "车牌", type: "text" },
                                { id: "col-mileage", name: "里程", type: "number" },
                            ],
                            rowCount: 2,
                            rows: [
                                {
                                    id: "row-1",
                                    cells: [
                                        // 结构一：带 value 包装层
                                        { value: { type: "text", text: { content: "特斯拉 Model Y" }, keyID: "col-name" } },
                                        { value: { type: "text", text: { content: "京A12345" }, keyID: "col-plate" } },
                                        { value: { type: "number", number: { content: 15000 }, keyID: "col-mileage" } },
                                    ],
                                },
                                {
                                    id: "row-2",
                                    cells: [
                                        // 结构二：直接展平无 value 包装
                                        { type: "text", text: { content: "蔚来 ET5" }, keyID: "col-name" },
                                        { type: "text", text: { content: "沪B88888" }, keyID: "col-plate" },
                                        { type: "number", number: { content: 8000 }, keyID: "col-mileage" },
                                    ],
                                },
                            ],
                        },
                    },
                };
            }
            return { code: 0, msg: "", data: {} };
        };

        const res = await renderLedger(AV_ID);
        expect(res.rows).toHaveLength(2);

        // row-1 提取
        expect(res.rows[0].cells["col-name"]?.text?.content).toBe("特斯拉 Model Y");
        expect(res.rows[0].cells["col-plate"]?.text?.content).toBe("京A12345");
        expect(res.rows[0].cells["col-mileage"]?.number?.content).toBe(15000);

        // row-2 展平提取
        expect(res.rows[1].cells["col-name"]?.text?.content).toBe("蔚来 ET5");
        expect(res.rows[1].cells["col-plate"]?.text?.content).toBe("沪B88888");
        expect(res.rows[1].cells["col-mileage"]?.number?.content).toBe(8000);
    });

    it("cellContentText 针对无 isNotEmpty 的数字和日期能正确提取文本", () => {
        // 数字无 isNotEmpty
        expect(cellContentText({ type: "number", number: { content: 23000 } })).toBe("23000");
        // 数字含 isNotEmpty
        expect(cellContentText({ type: "number", number: { content: 0, isNotEmpty: true } })).toBe("0");
        // 日期无 isNotEmpty（毫秒时间戳）
        const timestamp = new Date("2026-10-24T00:00:00Z").getTime();
        expect(cellContentText({ type: "date", date: { content: timestamp } })).toBeTruthy();
        // 字符串日期
        expect(cellContentText({ type: "date", date: { content: "2026-10-24" as any } })).toBe("2026-10-24");
    });
});
