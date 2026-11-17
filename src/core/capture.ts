import { selectCellValue } from "@/core/avcell";
import type { ColumnDef, ModuleSchema } from "@/core/schema";

export type CaptureInputError = "required" | "number" | "min" | "max" | "step" | "date" | "url" | "option";

export const CAPTURE_INPUT_TYPES = new Set([
    "text", "number", "date", "select", "relation", "url", "checkbox",
]);

export function getCaptureFields(schema?: Pick<ModuleSchema, "columns" | "capture">): ColumnDef[] {
    if (!schema?.capture?.length) return [];
    return schema.capture
        .map((key) => schema.columns.find((column) => column.key === key))
        .filter((column): column is ColumnDef => !!column && CAPTURE_INPUT_TYPES.has(column.type));
}

/** Full scalar form set; capture remains only the compact, high-frequency subset. */
export function getFormFields(schema?: Pick<ModuleSchema, "columns">): ColumnDef[] {
    return schema?.columns.filter((column) => CAPTURE_INPUT_TYPES.has(column.type)) ?? [];
}

function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === "" || (typeof value === "string" && value.trim() === "");
}

function isValidDateKey(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const date = new Date(0);
    date.setFullYear(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function validateCaptureInput(field: ColumnDef, value: unknown): CaptureInputError | undefined {
    if (field.required && (isEmpty(value) || (field.type === "checkbox" && value !== true))) return "required";
    if (isEmpty(value)) return undefined;

    if (field.type === "number") {
        const number = Number(value);
        if (!Number.isFinite(number)) return "number";
        if (field.min !== undefined && number < field.min) return "min";
        if (field.max !== undefined && number > field.max) return "max";
        if (typeof field.step === "number") {
            const origin = field.min ?? 0;
            const steps = (number - origin) / field.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-8) return "step";
        }
    }
    if (field.type === "date" && !isValidDateKey(String(value))) return "date";
    if (field.type === "url") {
        try {
            const url = new URL(String(value));
            if (url.protocol !== "http:" && url.protocol !== "https:") return "url";
        } catch {
            return "url";
        }
    }
    if (field.type === "select" && field.options?.length && !field.options.includes(String(value))) return "option";
    return undefined;
}

export function captureCellValue(field: ColumnDef, value: unknown): unknown | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    switch (field.type) {
        case "select": return selectCellValue(String(value));
        case "relation": {
            const id = String(value).trim();
            return id ? { type: "relation", relation: { blockIDs: [id], contents: null } } : undefined;
        }
        case "date": {
            const date = new Date(`${String(value)}T00:00:00`);
            return { type: "date", date: { content: date.getTime(), isNotEmpty: true, isNotTime: true } };
        }
        case "number": return { type: "number", number: { content: Number(value), isNotEmpty: true } };
        case "url": return { type: "url", url: { content: String(value) } };
        case "checkbox": return { type: "checkbox", checkbox: { checked: value === true } };
        default: return { type: "text", text: { content: String(value) } };
    }
}

/** 字段自然语言示范占位符库（高保真实用引导，告别机械标签重复） */
export const EXAMPLE_PLACEHOLDERS: Record<string, string> = {
    // 车辆
    plate: "例如：京A12345 / 粤B88888",
    brand_model: "例如：别克君越 / 特斯拉 Model Y",
    mileage: "例如：15000（公里）",
    vin: "17位车辆识别代号（车架号）",
    insurance_company: "例如：中国人保 / 平安车险",
    // 医药健康
    spec: "例如：0.3g*24粒/盒",
    dosage: "例如：一次1粒，一日2次，饭后温水送服",
    indication: "例如：感冒发热、头痛、肌肉酸痛",
    contraindication: "例如：严重肝肾功能不全者禁用",
    batch: "例如：批号 20260301A",
    // 仓储与位置
    location: "例如：主卧衣柜 / 客厅电视柜 / 冰箱冷藏室",
    store_place: "例如：主卧衣柜 / 客厅电视柜 / 冰箱冷藏室",
    copy_location: "例如：书房保险箱 / 主卧抽屉",
    low_stock_at: "例如：2（低于此数量自动提醒补货）",
    qty: "例如：1",
    stock_qty: "例如：10",
    // 金额与账务
    amount: "例如：300（元）",
    price: "例如：199.9（元）",
    cost: "例如：260（元）",
    deposit: "例如：2000（元）",
    premium: "例如：365（元/年）",
    covered_amount: "例如：1000000（元）",
    target_amount: "例如：50000（元）",
    initial_deposit: "例如：10000（元）",
    // 证件与契约
    cert_no: "例如：身份证号 / 护照号 / 驾照号",
    authority: "例如：北京市公安局海淀分局",
    contract_no: "例如：HT-2026-0888",
    party: "例如：房东张先生 / 链家自如",
    policy_no: "例如：保单合同编号",
    insurer: "例如：中国人寿 / 众安保险",
    // 家电与数码
    brand: "例如：海尔 / 索尼 / 戴森 / 苹果",
    model: "例如：BCD-535WGHS / V12 Slim",
    serial_no: "例如：机身SN序列号",
    // 房产与宠物
    address: "例如：XX市XX区XX路128号",
    area: "例如：118.5（平方米）",
    property_cert: "例如：不动产权第00123456号",
    breed: "例如：柯基犬 / 英国短毛猫",
    microchip: "15位动物芯片识别码",
    vet: "例如：瑞鹏宠物医院",
    // 联系与其它
    phone: "例如：13800138000",
    url: "例如：https://...",
    note: "补充备注说明...",
};

/** 核心模块名称字段专属示范 */
export const MODULE_NAME_PLACEHOLDERS: Record<string, string> = {
    vehicles: "例如：别克君越 28T 尊享型",
    medicine: "例如：布洛芬缓释胶囊 / 阿莫西林",
    stock: "例如：心相印抽纸24包 / 洗衣液3kg",
    shopping: "例如：维达无芯卷纸 / 纯牛奶",
    certs: "例如：居民身份证 / 中华人民共和国护照",
    contracts: "例如：商品房买卖合同 / 房屋租赁合同",
    insurance: "例如：百万医疗险 / 意外综合险",
    allowance: "例如：周末超市采购 / 考试进步奖励",
    favors: "例如：老李儿子结婚随礼 / 乔迁贺礼",
    chores: "例如：客厅吸尘拖地 / 更换床上四件套",
    pets: "例如：旺财（柴犬） / 咪咪（英短）",
    house: "例如：幸福家园 2栋1单元602",
    appliances: "例如：西门子滚筒洗衣机 / 戴森吸尘器",
    health: "例如：年度全面体检 / 口腔洁牙",
    feeding: "例如：母乳喂养 / 配方奶粉",
    schooling: "例如：春季学期学费 / 钢琴考级报名",
    subscriptions: "例如：iCloud 200GB / 宽带年费",
};

export function getFieldPlaceholder(
    field: ColumnDef,
    moduleId?: string,
    t?: (k: string) => string
): string {
    if (field.placeholderKey && t) {
        const custom = t(field.placeholderKey);
        if (custom !== field.placeholderKey) return custom;
    }
    if (field.key === "name") {
        if (moduleId && MODULE_NAME_PLACEHOLDERS[moduleId]) {
            return MODULE_NAME_PLACEHOLDERS[moduleId];
        }
        return t ? t("ledger.newName") : "名称";
    }
    if (EXAMPLE_PLACEHOLDERS[field.key]) {
        return EXAMPLE_PLACEHOLDERS[field.key];
    }
    if (t) {
        const key = field.labelKey ?? `field.${field.key}`;
        const label = t(key);
        return label !== key ? label : field.key;
    }
    return field.key;
}
