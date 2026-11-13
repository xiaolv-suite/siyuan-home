/**
 * 小驴管家 31 个标准家庭生活模块的声明式数据库 Schema 与字段定义目录
 * 解耦自 schema.ts，保持模型层精炼与契约验证专注性
 */

import type { ReminderRuleSpec } from "@/types";
import type { ColumnDef, ViewDef, ModuleSchema } from "./schema";
import { CERTIFICATE_CATEGORY_OPTIONS, CERT_PROFILE_COLUMNS } from "./certificate-profiles";

// ── 字段定义与声明工厂函数 ────────────────────────────────────

const fld = (key: string, type: any, extra?: any): ColumnDef => (extra ? { key, type, labelKey: `field.${key}`, ...extra } : { key, type, labelKey: `field.${key}` });
const txt = (k: string) => fld(k, "text");
const dat = (k: string) => fld(k, "date");
const ast = (k: string) => fld(k, "mAsset");
const chk = (k: string) => fld(k, "checkbox");
const num = (k: string, extra?: Partial<ColumnDef>) => fld(k, "number", extra);
const sel = (k: string, options?: string[], def?: string) => fld(k, "select", options ? (def ? { options, default: def } : { options }) : (def ? { default: def } : undefined));
const rem = (key: string, field: string, leadDays = 30, kind: "oneoff" | "recurring" | "anniversary" | "after" = "oneoff", extra?: Partial<ReminderRuleSpec>): ReminderRuleSpec => ({ key, field, kind, leadDays, ...extra });
const rem60 = (k: string, f: string) => rem(k, f, 60);
const remVeh = (k: string, f: string) => rem(k, f, 60, "oneoff", { leadStages: [60, 30, 7] });
const act = (detailFields: string[], dateField = "date") => ({ dateField, detailFields });
const REM_EXP_30 = rem("expiry", "expiry", 30);

// ── 字段字典（02 §2）────────────────────────────────────────

const FIELD_DICT: Record<string, ColumnDef> = {
    name:          { key: "name", type: "text", required: true },
    member:        { key: "member", type: "relation", labelKey: "field.member" },
    category:      sel("category"),
    status:        sel("status"),
    date:          dat("date"),
    expiry:        dat("expiry"),
    remind_before: num("remind_before"),
    amount:        num("amount", { min: 0, step: 0.01, unitKey: "capture.unitCny" }),
    cycle:         sel("cycle", ["day", "week", "month", "quarter", "year"]),
    location:      txt("location"),
    attachments:   ast("attachments"),
    url:           { key: "url", type: "url", labelKey: "field.url" },
    contact:       txt("contact"),
    tags:          { key: "tags", type: "mSelect", labelKey: "field.tags" },
    note:          txt("note"),
    due:           dat("due"), // 中枢写回的下次发生日
};

const d = (...keys: string[]): ColumnDef[] => keys.map((k) => FIELD_DICT[k]);
const cat = (options: string[]): ColumnDef => ({ ...FIELD_DICT.category, options });
const sta = (options: string[], def = options[0]): ColumnDef => ({ ...FIELD_DICT.status, options, default: def });
const tbl = (key: string, extra?: Partial<ViewDef>): ViewDef => ({ key, type: "table", ...extra });
const grp = (key: string, groupBy: string): ViewDef => tbl(key, { groupBy });
const srt = (key: string, keyCol: string): ViewDef => tbl(key, { sortBy: { key: keyCol, asc: true } });
const VIEW_EXPIRING: ViewDef = srt("expiring", "expiry");
const VIEW_BY_MEMBER: ViewDef = grp("by_member", "member");

// ── certs 证件管理（02 §4.2①）──────────────────────────────


const CERT_PRIVATE: ColumnDef[] = [
    txt("x_cert_holder_name"),
    txt("holder_no"), // 完整证件号码，界面默认脱敏展示
    dat("issue_date"),
    dat("x_cert_valid_from"),
    sel("issuance_rule", ["y6", "y10", "longterm", "endorsement"]),
    txt("store_place"),
];


export const CERTS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat([...CERTIFICATE_CATEGORY_OPTIONS]),
        sta(["valid", "expired", "renewed", "void"]),
        ...d("date"),
        ...CERT_PRIVATE,
        ...d("expiry", "due", "remind_before", "location", "attachments", "note"),
        txt("copy_location"), // 16 组：复印件/电子版存放位置
        { key: "renewed_to", type: "relation", labelKey: "field.renewed_to" }, // 16 组：换证链——旧证行 → 新证行
        ...CERT_PROFILE_COLUMNS,
    ],
    capture: ["name", "member", "category", "expiry", "attachments"],
    views: [
        VIEW_BY_MEMBER,
        VIEW_EXPIRING,
    ],
    reminders: [
        rem("expiry", "expiry", 90),
        // 签注/下次审验日（港澳台通行证签注另计）——due 列已在 columns 中（契约 33.2）
        rem60("endorsement", "due"),
        rem60("permit_endorsement", "x_cert_permit_endorsement_expiry"),
        rem60("hkmo_endorsement", "x_cert_hkmo_endorsement_expiry"),
        rem60("tw_endorsement", "x_cert_tw_endorsement_expiry"),
        rem60("driver_review", "x_cert_driver_review_due"),
        rem60("vocational_education", "x_cert_vocational_education_due"),
        rem60("professional_education", "x_cert_professional_education_due"),
        rem60("title_review", "x_cert_title_review_due"),
    ],
};

// ── members 家庭成员库（02 §3）──────────────────────────────

const MEMBERS_PRIVATE: ColumnDef[] = [
    { key: "role", type: "select", required: true,
      options: ["self", "spouse", "partner", "child", "elder", "kin", "other"] },
    { key: "birthday", type: "date" },
    { key: "lunar", type: "checkbox" },
    { key: "relation_note", type: "text" },
    { key: "size_top", type: "text" },
    { key: "size_bottom", type: "text" },
    { key: "size_shoe", type: "text" },
    { key: "dislike", type: "text" },
    // 192 波 E14：内核 addAttributeViewKey 不支持 asset 单资源列（思源只有多资源 mAsset）——头像用 mAsset 单值承载
    { key: "avatar", type: "mAsset" },
];

export const MEMBERS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        ...MEMBERS_PRIVATE,
        sta(["active", "archived"]),
        ...d("note"),
    ],
    capture: ["name", "role", "birthday", "lunar"],
    views: [grp("by_role", "role")],
    // 生日周年提醒由 members provider 声明（lunarField 指向 lunar 列）
    reminders: [
        rem("birthday", "birthday", 7, "anniversary", { lunarField: "lunar" }),
    ],
};

// ── v0.3 模块 schema（02 §4.3，SchemaLedgerProvider 通用派生）──────────

export const MEDICINE_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["rx", "otc", "external", "device", "supplement"]),
        sta(["inuse", "standby", "med_expired", "discarded"]),
        ...d("expiry", "remind_before"),
        num("stock_qty", { min: 0, unitKey: "capture.unitCount" }),
        num("low_stock_at", { min: 0, unitKey: "capture.unitCount" }),
        ...d("location", "note"),
    ],
    capture: ["name", "category", "expiry", "stock_qty", "location"],
    views: [VIEW_EXPIRING],
    reminders: [REM_EXP_30],
    // H15：低库存双规则之数值侧（效期侧由 expiry 规则承担；阈值逐行 low_stock_at）
    numericRules: [{ key: "low_stock", field: "stock_qty", thresholdField: "low_stock_at" }],
};

export const MEMBERSHIPS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["member_card", "prepaid", "subscription", "coupon", "points"]),
        sta(["active", "m_expired", "refunded"]),
        ...d("expiry", "cycle", "amount", "note"),
        dat("next_pay"),
        dat("trial_end"),
        chk("auto_renew"),
        txt("credentials_note"),
        sel("seat_role", ["holder", "member"], "holder"), // 16 组：家庭共享账号主卡/成员位
        { key: "cancel_guide", type: "url", labelKey: "field.cancel_guide" }, // 16 组：取消自动续费指引链接
    ],
    capture: ["name", "category", "amount", "cycle", "next_pay"],
    views: [srt("renewing", "next_pay")],
    reminders: [
        rem("next_pay", "next_pay", 14, "recurring", { cycleField: "cycle", autoRenewField: "auto_renew" }),
        rem("trial_end", "trial_end", 3),
        rem("expiry", "expiry", 14),
    ],
};

export const INSURANCE_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["health", "critical", "accident", "life", "vehicle", "property", "other_ins"]),
        sta(["in_force", "paying", "ins_expired", "surrendered"]),
        txt("insurer"),
        txt("contact"), // EC13：对接人（人脉快照）
        txt("policy_no"),
        num("premium"),
        sel("pay_cycle", ["month", "quarter", "year"]),
        dat("next_pay"),
        num("coverage"),
        // 16 组：理赔记录状态机（报案→材料→到账；无日期驱动，v1 仅记录）
        sel("claim_status", ["none", "filing", "docs", "paid"], "none"),
        dat("claim_date"),
        num("claim_amount"),
        ...d("expiry", "attachments", "note"),
    ],
    capture: ["name", "category", "insurer", "premium", "next_pay"],
    activity: act(["claim_status", "claim_amount", "insurer"], "claim_date"),
    views: [grp("paying", "member")],
    reminders: [
        rem("next_pay", "next_pay", 30, "recurring", { cycleField: "pay_cycle" }),
        REM_EXP_30,
    ],
};

// ── v0.4/v0.6 批量 schema（02 §4.3 紧凑规格落地）─────────────────

export const ASSETS_REAL_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["appliance", "furniture", "digital", "toy", "apparel", "jewelry", "collection", "sports", "other_ar"]),
        sta(["inuse", "idle", "lent", "repairing", "disposed"]),
        ...d("date", "amount", "expiry", "location", "attachments", "tags", "note"),
        txt("brand_model"),
        dat("warranty_expiry"),
        txt("channel"),
    ],
    capture: ["name", "category", "amount", "date", "attachments"],
    activity: act(["category", "amount", "location"]),
    views: [grp("by_location", "location")],
    reminders: [rem("warranty", "warranty_expiry", 30)],
};

export const HEALTH_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["visit", "report", "vaccine", "medication", "allergy", "checkup"]),
        sta(["following", "closed"]),
        ...d("date", "attachments", "note"),
        txt("hospital"),
        txt("department"),
        txt("diagnosis"),
        dat("followup_date"),
    ],
    capture: ["name", "member", "category", "date", "attachments"],
    activity: act(["category", "hospital", "department", "diagnosis"]),
    templates: [{ key: "checkup_plan", nameKey: "tpl.checkupPlan", file: "health/checkup-plan.tpl" }],
    views: [VIEW_BY_MEMBER],
    reminders: [rem("followup", "followup_date", 7)],
};

export const SHOPPING_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["daily", "digital", "apparel", "food_sh", "other_sh", "wish"]),
        ...d("date", "amount", "url", "note"),
        txt("channel"),
        txt("tracking_no"),
        txt("pickup_code"),
        num("qty", { min: 0, unitKey: "capture.unitCount" }), // 16 组：数量（购入→囤货联动用）
        // 提案 A/210 波：愿望（wish 类别行）的目标金额——存钱流水在 rowlog deposits，进度在抽屉分区
        num("target_amount"),
        // 16 组：退货/退款记录
        sel("return_status", ["none", "requested", "returned", "refunded"], "none"),
        dat("return_date"),
        num("refund_amount"),
    ],
    capture: ["name", "amount", "date", "channel"],
    activity: act(["category", "amount", "channel", "qty"]),
};

export const CONTRACTS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["rent", "renovation", "purchase", "labor", "property_ct", "other_ct"]),
        sta(["ct_active", "ct_expired", "terminated"]),
        ...d("date", "expiry", "remind_before", "attachments", "note"),
        txt("party"),
        txt("contact"), // EC13：对接人（人脉快照）
        num("deposit"),
        chk("auto_renew"), // 16 组：自动续约条款 → 到期升级为续约决策提醒
        chk("deposit_returned"), // 16 组：押金退还记录
        dat("deposit_return_date"),
    ],
    capture: ["name", "category", "expiry", "attachments"],
    activity: act(["category", "party", "deposit"]),
    reminders: [rem("expiry", "expiry", 30, "oneoff", { autoRenewField: "auto_renew" })],
};

export const EXAMS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["vocational", "title", "language", "academic", "other_ex"]),
        sta(["preparing", "passed", "ex_expired"]),
        ...d("expiry", "attachments", "note"),
        txt("issuer"),
        txt("contact"), // EC13：对接人（人脉快照）
        dat("exam_date"),
    ],
    capture: ["name", "member", "exam_date", "expiry"],
    activity: act(["category", "status", "issuer"], "exam_date"),
    reminders: [rem("expiry", "expiry", 60)],
};

export const ALLOWANCE_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["lucky", "allowance_al", "reward", "interest_al"]),
        sel("direction", ["in", "out"]),
        ...d("amount", "date", "note"),
        txt("source"),
    ],
    capture: ["name", "category", "amount", "direction", "date"],
    activity: act(["category", "direction", "amount", "source"]),
    views: [VIEW_BY_MEMBER],
};

export const FAVORS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        cat(["wedding", "full_moon", "housewarming", "graduation", "birthday_fv", "other_fv"]),
        sel("direction", ["in", "out"]),
        txt("person"),
        ...d("amount", "date", "note"),
    ],
    capture: ["name", "direction", "person", "amount", "date"],
    activity: act(["category", "direction", "person", "amount"]),
    // 16 组/190 波：回礼提醒——收礼（direction=in）30 天后一次性（leadDays 0=到期当天起提醒）；提醒卡带「回礼」标记（rule.reciprocate）
    reminders: [rem("reciprocate", "date", 0, "after", { offsetDays: 30, onlyIf: { field: "direction", equals: "in" } })],
    views: [grp("by_person", "person")],
};

export const STOCK_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["food_st", "daily_chem", "paper", "medical_st", "emergency_st", "other_st"]),
        ...d("expiry", "location", "note"),
        num("qty", { min: 0, unitKey: "capture.unitCount" }),
        num("low_stock_at", { min: 0, unitKey: "capture.unitCount" }),
    ],
    capture: ["name", "qty", "low_stock_at", "expiry"],
    // 品类分区（Apple Reminders Grocery 印证，26.6）：囤货按品类自动归组
    views: [
        grp("by_category", "category"),
        VIEW_EXPIRING,
    ],
    templates: [{ key: "emergency_kit", nameKey: "tpl.emergencyKit", file: "stock/emergency-kit.tpl" }],
    reminders: [REM_EXP_30],
    // H15：囤货低库存（阈值逐行 low_stock_at）
    numericRules: [{ key: "low_stock", field: "qty", thresholdField: "low_stock_at" }],
};

export const CHORES_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["housework", "maintenance", "care", "other_ch"]),
        ...d("cycle", "due", "note"),
        dat("last_done"),
    ],
    capture: ["name", "member", "cycle", "due"],
    activity: act(["category"], "last_done"),
    // v0.2：due 作为一次性提醒；周期写回（中枢重算）见 03 §5 recurring 完整版
    reminders: [rem("due", "due", 7)],
};

export const HOUSE_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["payment", "maintenance_h", "anniversary", "emergency"]),
        ...d("cycle", "note"),
        dat("pay_day"),
        chk("lunar"),
    ],
    capture: ["name", "category", "pay_day", "cycle"],
    reminders: [rem("pay_day", "pay_day", 7, "anniversary", { lunarField: "lunar" })],
};

// ── 最后一批轻模块（31/31 全覆盖）────────────────────────────

export const FOOD_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["home_cook", "restaurant", "takeout"]),
        num("rating", { min: 0, max: 5, step: 0.5 }),
        ...d("date", "url", "note"),
        chk("dislike_safe"),
        // grocy 印证（26.6）：食材摘要（换行分隔）——采购时可对照 stock 采购建议手动补货；自动联动留 v0.8
        txt("ingredients"),
    ],
    capture: ["name", "category", "rating", "date"],
    activity: act(["category", "rating"]),
};

export const ADDRESS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["home", "shipping", "id_addr", "org"]),
        txt("address_full"),
        ...d("url", "note"),
    ],
    capture: ["name", "category", "address_full"],
};

export const BOOKMARKS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        cat(["gov", "payment_bm", "shopping_bm", "learning", "work", "other_bm"]),
        ...d("url", "note"),
        { key: "account_note", type: "text", labelKey: "field.account_name" },
    ],
    capture: ["name", "category", "url"],
};

export const SNIPPETS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        cat(["greeting", "address_sn", "intro", "reply", "other_sn"]),
        txt("content"),
        ...d("tags"),
    ],
    capture: ["name", "content"],
};

export const PARENTING_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["vaccine_p", "growth", "feeding", "milestone"]),
        // due 必备：next_visit 规则引用此列（缺列会令 requireReminderColumns 抛错——第六十五轮修复）
        ...d("date", "due", "attachments", "note"),
        txt("vaccine_name"),
        num("dose_no"),
        txt("vaccine_batch"), // 16 组：接种追溯
        txt("vaccine_site"), // 16 组：接种点
        sel("metric_type", ["height", "weight"], "height"), // 生长曲线：指标类型
        num("metric_value"),
    ],
    capture: ["name", "member", "category", "date"],
    activity: act(["category", "vaccine_name", "dose_no", "metric_type", "metric_value"]),
    reminders: [rem("next_visit", "due", 7)],
};

export const SCHOOLING_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["kindergarten", "primary", "junior", "senior", "college", "grad_school", "extracurricular"]),
        sta(["applying", "enrolled", "graduated"]),
        txt("school"),
        txt("grade"),
        txt("teacher"),
        txt("contact"), // EC13：对接人（人脉快照）
        ...d("amount", "due", "note"),
        num("enroll_year"),
        dat("exam_date"), // 16 组：考试/重要日程（exams 模块管备考，这里管校内日程）
    ],
    capture: ["name", "school", "category", "amount", "due"],
    activity: act(["school", "category", "status"], "exam_date"),
    templates: [{ key: "parent_meeting", nameKey: "tpl.parentMeeting", file: "schooling/parent-meeting.tpl" }],
    reminders: [
        rem("tuition", "due", 14),
        rem("exam_date", "exam_date", 3),
    ],
};

export const SOCIAL_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["shebao", "gongjijin", "yibao", "resident_pension", "commercial_pension"]),
        ...d("note"),
        txt("account_no"),
        chk("retire_check"),
        num("retire_age"),
        num("balance_snapshot"),
        dat("snapshot_date"),
        dat("base_adjust_date"), // 16 组：缴费基数年度调整
    ],
    capture: ["name", "member", "category", "account_no"],
    reminders: [rem("base_adjust", "base_adjust_date", 14, "anniversary")],
};

export const MEDIA_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["movie", "tv", "variety", "book", "comic", "novel"]),
        sta(["wishlist", "consuming", "done", "dropped"]),
        num("rating"),
        txt("progress"),
        // 16 组/189 波：追更提醒——更新日手动登记，提醒中枢派生（oneoff，当天提醒）
        dat("next_update"),
        ...d("url", "date", "note"),
    ],
    capture: ["name", "category", "status", "next_update"],
    reminders: [rem("next_update", "next_update", 0)],
    // 海报墙（seerr 印证，26.6）：画廊视图以封面卡片呈现；思源 gallery 视图类型原生支持
    views: [
        { key: "wall", type: "gallery" },
        grp("consuming", "status"),
    ],
};

export const PETS_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        sel("species", ["cat", "dog", "other_pet"]),
        txt("breed"),
        dat("vaccine_due"),
        dat("deworm_due"),
        ...d("cycle"), // deworm recurring 的周期来源（缺失时规则按 oneoff 降级；旧库由补列续跑补齐）
        ...d("note"),
    ],
    capture: ["name", "species", "vaccine_due", "deworm_due", "cycle"],
    reminders: [
        rem("vaccine", "vaccine_due", 14),
        rem("deworm", "deworm_due", 7, "recurring", { cycleField: "cycle" }),
    ],
};

export const VEHICLES_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        txt("plate"),
        txt("brand_model"),
        txt("vin"),
        txt("color"),
        sel("energy_type", ["gasoline", "diesel", "hybrid", "electric", "other"], "gasoline"),
        ...d("expiry", "note", "attachments"),
        num("mileage", { min: 0, step: 1, unitKey: "capture.unitKm" }),
        dat("purchase_date"),
        num("purchase_price"),
        num("current_value"),
        dat("inspection_due"),
        txt("insurance_company"),
        dat("insurance_due"),
        dat("vehicle_tax_due"),
        num("battery_capacity"),
        // 电池更换（grocy 印证：铅酸 1.5-2 年/锂 5-8 年——用户按实际记录下次更换日）
        dat("battery_due"),
        // 违章手动记录（12123 功能面：日期/地点/行为/罚款 摘要，多条例以换行分隔；官方数据不做对接）
        txt("violations"),
    ],
    // Keep the quick form within the schema contract's five-field limit.
    // The vehicle attachment is surfaced by the dedicated photo control.
    capture: ["name", "plate", "brand_model", "energy_type", "mileage"],
    activity: act(["plate", "brand_model", "energy_type", "mileage"], "purchase_date"),
    reminders: [
        REM_EXP_30,
        // 311 波（G2）：车检/保险/车船税等国家级年审事项设为 60/30/7 三段提醒
        remVeh("inspection", "inspection_due"),
        remVeh("insurance", "insurance_due"),
        remVeh("vehicle_tax", "vehicle_tax_due"),
        rem("battery", "battery_due", 30),
    ],
};

export const TRANSIT_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["etc", "transit_card", "monthly", "senior"]),
        ...d("expiry", "note"),
        txt("card_no"),
    ],
    capture: ["name", "category", "expiry"],
    reminders: [REM_EXP_30],
};

export const TRAVEL_PLAN_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        sta(["planning", "ongoing", "finished"]),
        ...d("date", "expiry", "amount", "note"),
        txt("destination"),
    ],
    capture: ["name", "destination", "date", "expiry"],
    activity: act(["destination", "status"]),
    reminders: [rem("date", "date", 7)],
};

export const TRAVEL_BOOKING_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        cat(["flight", "hotel", "train", "ticket", "rental"]),
        ...d("date", "amount", "attachments", "note"),
        txt("order_no"),
    ],
    capture: ["name", "category", "date", "order_no"],
    activity: act(["category", "amount"]),
};

export const TRAVEL_PACKING_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name"),
        sta(["draft", "packed"]),
        ...d("date", "note"),
        txt("checklist_doc"),
    ],
    capture: ["name", "date", "status"],
    activity: act(["status"]),
};

export const TRAVEL_LOG_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        ...d("date", "amount", "attachments", "note"),
        txt("cities"),
    ],
    capture: ["name", "date", "amount"],
    activity: act(["cities", "amount"]),
};

export const ASSETS_VIRTUAL_SCHEMA: ModuleSchema = {
    columns: [
        ...d("name", "member"),
        cat(["account", "domain", "game", "nft", "license", "other_v"]),
        ...d("expiry", "note"),
        txt("platform"),
        txt("account_name"),
        txt("cred_loc"),
        txt("inherit_note"),
    ],
    capture: ["name", "category", "platform", "account_name", "cred_loc"],
    reminders: [REM_EXP_30],
};


/** 31 模块 schema 单源目录（193 波：index.ts 两份手工清单收口于此——12 波"清单漂移"教训的同类结构；
 * 消费方：schemaCatalog、ensureCoreLedgers 契约门禁、活体 IT-12 列类型矩阵） */
export const SCHEMA_CATALOG: Record<string, ModuleSchema> = {
    members: MEMBERS_SCHEMA, certs: CERTS_SCHEMA,
    "assets-real": ASSETS_REAL_SCHEMA, health: HEALTH_SCHEMA,
    medicine: MEDICINE_SCHEMA, memberships: MEMBERSHIPS_SCHEMA, insurance: INSURANCE_SCHEMA,
    shopping: SHOPPING_SCHEMA, contracts: CONTRACTS_SCHEMA, exams: EXAMS_SCHEMA,
    allowance: ALLOWANCE_SCHEMA, favors: FAVORS_SCHEMA, stock: STOCK_SCHEMA,
    chores: CHORES_SCHEMA, house: HOUSE_SCHEMA,
    media: MEDIA_SCHEMA, pets: PETS_SCHEMA, vehicles: VEHICLES_SCHEMA, transit: TRANSIT_SCHEMA,
    "travel-plan": TRAVEL_PLAN_SCHEMA, "travel-booking": TRAVEL_BOOKING_SCHEMA,
    "travel-packing": TRAVEL_PACKING_SCHEMA, "travel-log": TRAVEL_LOG_SCHEMA,
    "assets-virtual": ASSETS_VIRTUAL_SCHEMA,
    food: FOOD_SCHEMA, address: ADDRESS_SCHEMA, bookmarks: BOOKMARKS_SCHEMA, snippets: SNIPPETS_SCHEMA,
    parenting: PARENTING_SCHEMA, schooling: SCHOOLING_SCHEMA, social: SOCIAL_SCHEMA,
};

