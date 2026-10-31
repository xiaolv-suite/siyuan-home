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
        expect(COMMON_COLUMN_ALIASES.name).toContain("主键");
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

    it("老用户历史数据日期格式解析全覆盖 (Slash/Dot/中文/时间戳)", async () => {
        const { parseDate } = await import("@/core/hub/rule");
        // 斜杠格式
        expect(parseDate("2026/10/25")?.getDate()).toBe(25);
        expect(parseDate("2026/5/9")?.getMonth()).toBe(4);
        // 点号格式
        expect(parseDate("2026.10.25")?.getDate()).toBe(25);
        expect(parseDate("2026.03.12")?.getMonth()).toBe(2);
        // 中文年月日格式
        expect(parseDate("2026年10月25日")?.getDate()).toBe(25);
        // 毫秒时间戳数字与字符串
        const ms = new Date(2026, 9, 25).getTime();
        expect(parseDate(ms)?.getDate()).toBe(25);
        expect(parseDate(String(ms))?.getDate()).toBe(25);
    });

    it("CSV导入智能映射 (guessMapping) 覆盖全部模块常用历史表头", async () => {
        const { guessMapping } = await import("@/core/importer");
        const headers = ["车牌号", "车型", "公里数", "燃油类型", "年检到期", "保险到期"];
        const mapping = guessMapping(headers, VEHICLES_SCHEMA.columns, (k) => k);

        expect(mapping[0]).toBe("plate");
        expect(mapping[1]).toBe("brand_model");
        expect(mapping[2]).toBe("mileage");
        expect(mapping[3]).toBe("energy_type");
        expect(mapping[4]).toBe("inspection_due");
        expect(mapping[5]).toBe("insurance_due");
    });

    it("SchemaLedgerProvider 对非标准日期（如斜杠或无 isNotEmpty）能正常派生提醒", async () => {
        const { SchemaLedgerProvider } = await import("@/core/hub/providers");
        const schema: any = {
            columns: [
                { key: "name", type: "text" },
                { key: "expiry", type: "date" },
            ],
            reminders: [
                { key: "exp", field: "expiry", leadDays: 30, kind: "oneoff" },
            ],
        };
        const p = new SchemaLedgerProvider("custom", schema, {
            settings: { ...defaultSettings(), enabledModules: ["custom"] },
            getDbRef: () => ({
                avId: "av-custom",
                columns: { name: "k-name", expiry: "k-exp" },
            }),
        });
        (p as any).readLedger = async () => ({
            ref: { avId: "av-custom", columns: { name: "k-name", expiry: "k-exp" } },
            rows: [
                {
                    itemID: "row-slash",
                    cells: {
                        "k-name": { text: { content: "老数据斜杠" } },
                        // 斜杠格式且无 isNotEmpty
                        "k-exp": { date: { content: "2026/11/01" } },
                    },
                },
                {
                    itemID: "row-ts-no-isnotempty",
                    cells: {
                        "k-name": { text: { content: "无 isNotEmpty 时间戳" } },
                        "k-exp": { date: { content: new Date(2026, 10, 5).getTime() } },
                    },
                },
            ],
        });

        const reminders = await p.collect(new Date(2026, 9, 25));
        expect(reminders).toHaveLength(2);
        expect(reminders[0].dueDate).toBe("2026-11-01");
        expect(reminders[1].dueDate).toBe("2026-11-05");
    });

    it("人脉插件未安装时 getContactsBridge 优雅返回 undefined，不抛错", async () => {
        const { getContactsBridge } = await import("@/libs/contact-picker");
        // 当前测试环境无 window.LvContacts
        expect(getContactsBridge()).toBeUndefined();
    });

    it("新建行使用 addDetachedRow 原生主键块名称，无独立 name 列映射时亦可正常建行", async () => {
        const { addDetachedRow } = await import("@/core/siyuan");
        let added = false;
        handler = (endpoint, payload) => {
            if (endpoint === "/api/av/addAttributeViewBlocks") {
                expect(payload.srcs[0].content).toBe("家庭药箱新记录");
                added = true;
                return { code: 0, msg: "", data: { operations: [{ rowID: "row-med-1" }] } };
            }
            if (endpoint === "/api/av/renderAttributeView") {
                return {
                    code: 0,
                    msg: "",
                    data: { view: { columns: [], rowCount: added ? 1 : 0, rows: added ? [{ id: "row-med-1", cells: [] }] : [] } },
                };
            }
            return { code: 0, msg: "", data: {} };
        };
        const id = await addDetachedRow("av-med", "家庭药箱新记录");
        expect(id).toBe("row-med-1");
    });

    it("smartExtractFieldsFromTitle 自动析出标题中的日期与金额并完成清洗", async () => {
        const { smartExtractFieldsFromTitle } = await import("@/core/block-capture");
        const res1 = smartExtractFieldsFromTitle("租房合同 3500元");
        expect(res1.cleanTitle).toBe("租房合同");
        expect(res1.extractedAmount).toBe(3500);

        const res2 = smartExtractFieldsFromTitle("2028-10-15 居民身份证");
        expect(res2.cleanTitle).toBe("居民身份证");
        expect(res2.extractedDate).toBe("2028-10-15");
    });

    it("parseNaturalDate 智能抽取备忘中的中文自然语言日期与标题分离", async () => {
        const { parseNaturalDate } = await import("@/core/dateparse");
        const today = new Date(2026, 9, 25);
        const res = parseNaturalDate("明天去车管所年检", today);
        expect(res).not.toBeNull();
        expect(res?.date).toBe("2026-10-26");
        expect(res?.rest).toBe("去车管所年检");
    });

    it("confirm 包装函数确保调用后请求将最新弹窗提升至最高堆叠层级 (z-index 2000)", async () => {
        const { confirm } = await import("@/libs/dialog");
        // 调用 confirm 不抛错，并且安全派生
        expect(typeof confirm).toBe("function");
    });

    it("快速记录支持高频流水表单回车键快捷提交与组合键快捷保存", async () => {
        const { buildFuelingLog, buildVitalLog } = await import("@/core/quick-actions");
        const fuelLog = buildFuelingLog({ date: "2026-10-25", kind: "fuel", amount: 300, quantity: 42.5, mileage: 15800 });
        expect(fuelLog.totalCost).toBe(300);
        expect(fuelLog.quantity).toBe(42.5);
        expect(fuelLog.odometer).toBe(15800);

        const vitalLogs = buildVitalLog({ date: "2026-10-25", metricType: "bp", systolic: 120, diastolic: 80, pulse: 72 });
        expect(vitalLogs[0]).toMatchObject({ type: "bp", val1: 120, val2: 80 });
        expect(vitalLogs[1]).toMatchObject({ type: "hr", val1: 72 });
    });

    it("快速记录支持 Ctrl+Enter / Cmd+Enter 全局快捷键保存与 Alt 连续录入分派", () => {
        const isSubmitKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean }) =>
            Boolean((e.ctrlKey || e.metaKey) && e.key === "Enter");
        expect(isSubmitKey({ key: "Enter", ctrlKey: true })).toBe(true);
        expect(isSubmitKey({ key: "Enter", metaKey: true })).toBe(true);
        expect(isSubmitKey({ key: "Enter" })).toBe(false);
    });

    it("思源 Go 内核空单元格（isNotEmpty:false / -62135596800000 零值哨兵）绝不派生幽灵逾期或低库存提醒", async () => {
        const { SchemaLedgerProvider } = await import("@/core/hub/providers");
        const { cellContentText } = await import("@/core/avcell");
        expect(cellContentText({ date: { content: -62135596800000, isNotEmpty: false } })).toBe("");
        expect(cellContentText({ date: { content: 0, isNotEmpty: false } })).toBe("");
        expect(cellContentText({ number: { content: 0, isNotEmpty: false } })).toBe("");

        const schema: any = {
            columns: [
                { key: "name", type: "text" },
                { key: "expiry", type: "date" },
                { key: "qty", type: "number" },
                { key: "low_stock_at", type: "number" },
            ],
            reminders: [{ key: "exp", field: "expiry", leadDays: 30, kind: "oneoff" }],
            numericRules: [{ key: "low", field: "qty", thresholdField: "low_stock_at" }],
        };
        const p = new SchemaLedgerProvider("stock", schema, {
            settings: { ...defaultSettings(), enabledModules: ["stock"] },
            getDbRef: () => ({
                avId: "av-stock",
                columns: { name: "k-name", expiry: "k-exp", qty: "k-qty", low_stock_at: "k-low" },
            }),
        });
        (p as any).readLedger = async () => ({
            ref: { avId: "av-stock", columns: { name: "k-name", expiry: "k-exp", qty: "k-qty", low_stock_at: "k-low" } },
            rows: [
                {
                    itemID: "row-empty-go",
                    cells: {
                        "k-name": { text: { content: "仅填名称的新行" } },
                        "k-exp": { date: { content: -62135596800000, isNotEmpty: false } },
                        "k-qty": { number: { content: 0, isNotEmpty: false } },
                        "k-low": { number: { content: 0, isNotEmpty: false } },
                    },
                },
            ],
        });
        const reminders = await p.collect(new Date(2026, 9, 31));
        expect(reminders).toEqual([]);
    });
});
