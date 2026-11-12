import { describe, it, expect, afterEach } from "vitest";
import {
    LIFELOG_MARKER_RE,
    sectionBlockId,
    formatRowLogEntryLine,
    formatModuleRowLogsMarkdown,
    formatDailyJournalMarkdown,
    upsertDocSection,
    replaceJournalDocPreservingFolds,
} from "@/core/doc-sync";
import { setTransport } from "@/core/siyuan";
import { projectRowLogActivities } from "@/core/activity";

describe("doc-sync (LifeLog 标准语法、年/月/日倒序可折叠大纲与思源文档同步契约)", () => {
    afterEach(() => {
        setTransport(undefined);
    });

    it("sectionBlockId 派生符合思源规范的稳定块 ID", () => {
        const docId = "20261031125039-kr6hkw0";
        const id1 = sectionBlockId(docId, "rowlogs");
        const id2 = sectionBlockId(docId, "rowlogs");
        const id3 = sectionBlockId(docId, "journal");
        expect(id1).toBe(id2);
        expect(id1).not.toBe(id3);
        expect(id1).toMatch(/^\d{14}-[0-9a-z]{7}$/);
    });

    it("formatRowLogEntryLine 输出严格匹配思源生态 LifeLog 识别正则 (HH:mm 类型：内容)", () => {
        const members = [
            { id: "m-kid", avItemId: "20261031000000-kid0001", name: "小宝", role: "child" as const },
        ];
        const fuel = formatRowLogEntryLine("fuelings", {
            date: "2026-10-31",
            time: "14:35",
            quantity: 42,
            totalCost: 325,
            odometer: 15500,
        }, members, "家用SUV");
        expect(fuel).toMatch(LIFELOG_MARKER_RE);
        expect(fuel.startsWith("14:35 车辆加油：")).toBe(true);
        expect(fuel).toContain("家用SUV");
        expect(fuel).toContain("42 L");
        expect(fuel).toContain("¥325");
        expect(fuel).toContain("15500 km");
        expect(fuel).toContain("#车辆");

        const bp = formatRowLogEntryLine("vitals", {
            date: "2026-10-31",
            time: "08:15",
            type: "bp",
            val1: 138,
            val2: 88,
            pulse: 74,
        }, members, "外婆健康档案");
        expect(bp).toMatch(LIFELOG_MARKER_RE);
        expect(bp.startsWith("08:15 血压监测：")).toBe(true);
        expect(bp).toContain("138/88 mmHg");
        expect(bp).toContain("74 bpm");

        const chore = formatRowLogEntryLine("chexecs", {
            date: "2026-10-31",
            time: "16:10",
            memberId: "m-kid",
            points: 30,
            note: "主动收拾绘本",
        }, members, "周末整理绘本角");
        expect(chore).toMatch(LIFELOG_MARKER_RE);
        expect(chore.startsWith("16:10 家务打卡：")).toBe(true);
        expect(chore).toContain("小宝");
        expect(chore).toContain("+30 积分");
        expect(chore).toContain("主动收拾绘本");

        const multiChore = formatRowLogEntryLine("chexecs", {
            date: "2026-10-31",
            time: "17:00",
            memberId: "m-dad,m-mom",
            points: 50,
            note: "一家人一起大扫除",
        }, [
            { id: "m-dad", avItemId: "20261031000000-dad0001", name: "爸爸", role: "self" as const },
            { id: "m-mom", avItemId: "20261031000000-mom0001", name: "妈妈", role: "spouse" as const },
        ], "全屋深度清洁");
        expect(multiChore).toContain("执行人 爸爸、妈妈");
        expect(multiChore).toContain("一家人一起大扫除");
    });

    it("formatModuleRowLogsMarkdown 按日期倒序输出标准 LifeLog 段落并合并同时刻血压与心率", () => {
        const avId = "20261031120000-avveh01";
        const rowId = "20261031120000-rowveh1";
        const md = formatModuleRowLogsMarkdown({
            moduleTitle: "病历与健康",
            avId,
            columns: { name: "col-name" },
            rows: [
                {
                    itemID: rowId,
                    cells: { "col-name": { type: "text", text: { content: "外婆健康档案" } } },
                },
            ],
            logs: {
                [`${avId}|${rowId}`]: {
                    vitals: [
                        { date: "2026-10-15", time: "08:00", type: "bp", val1: 130, val2: 85, at: "2026-10-15T00:00:00Z" },
                        { date: "2026-10-31", time: "09:20", type: "bp", val1: 138, val2: 88, at: "2026-10-31T01:20:00Z" },
                        { date: "2026-10-31", time: "09:20", type: "hr", val1: 74, at: "2026-10-31T01:20:00Z" },
                    ],
                },
            },
            renewHistory: {
                [rowId]: [{ from: "2026-10-01", to: "2027-10-01", at: "2026-10-20T10:00:00Z" }],
            },
        });
        expect(md).toContain("## 📋 日常流水与附属记录（LifeLog）");
        // 日期严格倒序：2026-10-31 -> 2026-10-20 -> 2026-10-15
        const i31 = md.indexOf("### 2026-10-31");
        const i20 = md.indexOf("### 2026-10-20");
        const i15 = md.indexOf("### 2026-10-15");
        expect(i31).toBeGreaterThan(-1);
        expect(i20).toBeGreaterThan(i31);
        expect(i15).toBeGreaterThan(i20);
        // 血压与同时刻心率已合并为单条标准 LifeLog
        expect(md).toContain("09:20 血压监测：外婆健康档案 · 138/88 mmHg · 心率 74 bpm #健康 #血压");
        expect(md).not.toContain("09:20 心率监测");
    });

    it("describeRowLogAsLifelog 与 formatModuleRowLogsMarkdown 自动建立主体/成员/流水总账双向双链 ((id \"锚文本\"))", () => {
        const avId = "20261031120000-avcho01";
        const rowId = "20261031120000-rowcho1";
        const journalDocId = "20261031135413-ky39ksv";
        const membersDocId = "20261031125025-0o5d2xw";
        const members = [
            { id: "m-kid", avItemId: "20261031000000-kid0001", name: "小宝", role: "child" as const },
        ];
        const md = formatModuleRowLogsMarkdown({
            moduleTitle: "家务与周期",
            avId,
            columns: { name: "col-name" },
            rows: [
                {
                    itemID: rowId,
                    cells: { "col-name": { type: "text", text: { content: "周末整理绘本角" } } },
                },
            ],
            logs: {
                [`${avId}|${rowId}`]: {
                    chexecs: [
                        { date: "2026-10-31", time: "16:10", memberId: "m-kid", points: 30, note: "参考 ((20261031125025-0nkr8tn \"绘本清单\"))", at: "2026-10-31T08:10:00Z" },
                    ],
                },
            },
            members,
            journalDocId,
            membersDocId,
        });
        // 1. 头部双链指向《📒 日常流水与备忘》
        expect(md).toContain(`((${journalDocId} "📒 日常流水与备忘"))`);
        // 2. 成员姓名自动转为指向成员台账的双链
        expect(md).toContain(`((${membersDocId} "小宝"))`);
        // 3. 用户在备注中手写的双链完整保留
        expect(md).toContain('((20261031125025-0nkr8tn "绘本清单"))');
        // 4. 反向链接到流水总账对应段落块 ID
        expect(md).toMatch(/\(\(\d{14}-[0-9a-z]{7} "📒 流水总账"\)\)/);
    });

    it("formatDailyJournalMarkdown 按【年(H2) ➔ 月(H3) ➔ 日期(H4)】全层级倒序生成可折叠大纲与独立 LifeLog 段落", () => {
        const md = formatDailyJournalMarkdown({
            docId: "20261031125000-jdoc001",
            memos: [
                {
                    id: "m1",
                    title: "清洗空调滤网",
                    dueDate: "2026-11-01",
                    priority: "high",
                    category: "家务",
                    cycle: "14d",
                    recurrenceAnchor: "completion",
                },
            ],
            flowItems: [
                {
                    idKey: "f-2025-12",
                    date: "2025-12-28",
                    time: "11:00",
                    sortKey: "2025-12-28T11:00",
                    lifelogType: "车辆加油",
                    detailText: "家用SUV · 38 L · ¥290",
                    tags: ["#车辆"],
                },
                {
                    idKey: "f-2026-09",
                    date: "2026-09-15",
                    time: "15:20",
                    sortKey: "2026-09-15T15:20",
                    lifelogType: "家务打卡",
                    detailText: "周末整理绘本角 · +20 积分",
                    tags: ["#家务"],
                },
                {
                    idKey: "f-2026-10-01",
                    date: "2026-10-01",
                    time: "09:10",
                    sortKey: "2026-10-01T09:10",
                    lifelogType: "车辆加油",
                    detailText: "家用SUV · 40 L · ¥310",
                    tags: ["#车辆"],
                },
                {
                    idKey: "f-2026-10-31-am",
                    date: "2026-10-31",
                    time: "08:30",
                    sortKey: "2026-10-31T08:30",
                    lifelogType: "血压监测",
                    detailText: "外婆健康档案 · 138/88 mmHg",
                    tags: ["#健康"],
                },
                {
                    idKey: "f-2026-10-31-pm",
                    date: "2026-10-31",
                    time: "18:05",
                    sortKey: "2026-10-31T18:05",
                    lifelogType: "待买清单",
                    detailText: "有机纯牛奶 · 数量 2",
                    tags: ["#待买"],
                    docId: "20261031125038-9asdrbu",
                    moduleTitle: "台账 · 购物记录",
                },
            ],
        });

        // 1. 年倒序：## 2026 年 在 ## 2025 年 之前
        const y2026 = md.indexOf("## 2026 年");
        const y2025 = md.indexOf("## 2025 年");
        expect(y2026).toBeGreaterThan(-1);
        expect(y2025).toBeGreaterThan(y2026);

        // 2. 月倒序：### 10 月 在 ### 09 月 之前
        const m10 = md.indexOf("### 10 月");
        const m09 = md.indexOf("### 09 月");
        expect(m10).toBeGreaterThan(y2026);
        expect(m09).toBeGreaterThan(m10);

        // 3. 日期倒序：#### 2026-10-31 在 #### 2026-10-01 之前
        const d1031 = md.indexOf("#### 2026-10-31");
        const d1001 = md.indexOf("#### 2026-10-01");
        expect(d1031).toBeGreaterThan(m10);
        expect(d1001).toBeGreaterThan(d1031);

        // 4. 同日时间倒序：18:05 在 08:30 之前，且每行均符合标准 LifeLog 语法
        const t1805 = md.indexOf("18:05 待买清单：");
        const t0830 = md.indexOf("08:30 血压监测：");
        expect(t1805).toBeGreaterThan(d1031);
        expect(t0830).toBeGreaterThan(t1805);

        const lifelogLines = md
            .split("\n")
            .filter((line) => /^\d{2}:\d{2}\s/.test(line));
        expect(lifelogLines).toHaveLength(5);
        for (const line of lifelogLines) {
            expect(line).toMatch(LIFELOG_MARKER_RE);
        }
    });

    it("replaceJournalDocPreservingFolds 更新文档后自动保留用户手写双链段落并重放已折叠标题块 ID", async () => {
        const calls: Array<{ url: string; body: any }> = [];
        const docId = "20261031150000-jdoc123";
        const foldedMonthId = "20261031150000-ym202609";
        const userNoteBlock = `我的手写家庭笔记关联 ((20261031125025-0nkr8tn "本人居民身份证"))\n{: id="20261031150000-usrblk1" updated="20261031"}`;

        setTransport(async (url, body: any) => {
            calls.push({ url, body });
            if (url === "/api/block/getBlockKramdown") {
                return {
                    code: 0,
                    msg: "",
                    data: {
                        id: docId,
                        kramdown: `### 09 月\n{: id="${foldedMonthId}" updated="20261031" custom-lvhome="1" fold="1"}\n\n${userNoteBlock}`,
                    },
                };
            }
            return { code: 0, msg: "", data: null };
        });

        await replaceJournalDocPreservingFolds(
            docId,
            `## 2026 年\n{: id="20261031150000-yr2026a" custom-lvhome="1"}\n\n### 09 月\n{: id="${foldedMonthId}" custom-lvhome="1"}`,
        );

        const updateCall = calls.find((c) => c.url === "/api/block/updateBlock" && c.body.id === docId);
        expect(updateCall).toBeDefined();
        expect(updateCall!.body.data).toContain('((20261031125025-0nkr8tn "本人居民身份证"))');
        expect(calls.some((c) => c.url === "/api/block/foldBlock" && c.body.id === foldedMonthId)).toBe(true);
    });

    it("upsertDocSection 首次追加超级块、二次原地更新不重复追加", async () => {
        const calls: Array<{ url: string; body: any }> = [];
        const storedBlocks = new Set<string>();

        setTransport(async (url, body: any) => {
            calls.push({ url, body });
            if (url === "/api/block/getBlockKramdown") {
                if (storedBlocks.has(body.id)) {
                    return { code: 0, msg: "", data: { id: body.id, kramdown: "{{{row\nold\n}}}" } };
                }
                return { code: -1, msg: "invalid ID argument", data: null };
            }
            if (url === "/api/block/appendBlock") {
                const m = String(body.data ?? "").match(/id="(\d{14}-[0-9a-z]{7})"/);
                if (m) storedBlocks.add(m[1]);
                return { code: 0, msg: "", data: [{ doOperations: [{ id: m?.[1] ?? "" }] }] };
            }
            if (url === "/api/block/updateBlock") {
                return { code: 0, msg: "", data: [{ doOperations: [{ id: body.id }] }] };
            }
            return { code: 0, msg: "", data: null };
        });

        const docId = "20261031150000-testdoc";
        const secId1 = await upsertDocSection(docId, "unit_sec", "## 第一次写入");
        const secId2 = await upsertDocSection(docId, "unit_sec", "## 第二次更新");

        expect(secId1).toBe(secId2);
        expect(calls.filter((c) => c.url === "/api/block/appendBlock")).toHaveLength(1);
        expect(calls.filter((c) => c.url === "/api/block/updateBlock")).toHaveLength(1);
    });

    it("projectRowLogActivities 完整投影家务打卡 (chexecs) 与生理体征 (vitals) 流水", () => {
        const avId = "20261031120000-avcho01";
        const rowId = "20261031120000-rowcho1";
        const projected = projectRowLogActivities({
            moduleId: "chores",
            avId,
            columns: { name: "c-name" },
            rows: [
                {
                    itemID: rowId,
                    cells: { "c-name": { type: "text", text: { content: "周末整理绘本角" } } },
                },
            ],
            logs: {
                [`${avId}|${rowId}`]: {
                    chexecs: [
                        { date: "2026-10-31", memberId: "m-kid", points: 30, note: "整齐", at: "2026-10-31T10:00:00Z" },
                    ],
                },
            },
        });
        expect(projected.records).toHaveLength(1);
        expect(projected.records[0].logKind).toBe("chexecs");
        expect(projected.records[0].memberId).toBe("m-kid");
        expect(projected.records[0].details.some((d) => d.key === "points" && d.value === "30")).toBe(true);
    });
});
