import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    sectionBlockId,
    formatRowLogEntryLine,
    formatModuleRowLogsMarkdown,
    formatDailyJournalMarkdown,
    upsertDocSection,
} from "@/core/doc-sync";
import { setTransport } from "@/core/siyuan";
import { projectRowLogActivities } from "@/core/activity";

describe("doc-sync (日常流水、临时备忘与行级子记录同步思源文档契约)", () => {
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

    it("formatRowLogEntryLine 正确格式化加油、血压、血糖与家务打卡流水", () => {
        const members = [
            { id: "m-kid", avItemId: "20261031000000-kid0001", name: "小宝", role: "child" as const },
        ];
        const fuel = formatRowLogEntryLine("fuelings", {
            date: "2026-10-31",
            quantity: 42,
            totalCost: 325,
            odometer: 15500,
        });
        expect(fuel).toContain("2026-10-31");
        expect(fuel).toContain("42 L");
        expect(fuel).toContain("¥325");
        expect(fuel).toContain("15500 km");

        const bp = formatRowLogEntryLine("vitals", {
            date: "2026-10-31",
            type: "bp",
            val1: 138,
            val2: 88,
            pulse: 74,
        });
        expect(bp).toContain("138/88 mmHg");
        expect(bp).toContain("74 bpm");

        const chore = formatRowLogEntryLine("chexecs", {
            date: "2026-10-31",
            memberId: "m-kid",
            points: 30,
            note: "主动收拾绘本",
        }, members);
        expect(chore).toContain("小宝");
        expect(chore).toContain("+30 积分");
        expect(chore).toContain("主动收拾绘本");
    });

    it("formatModuleRowLogsMarkdown 按行聚合子记录与续期历史", () => {
        const avId = "20261031120000-avveh01";
        const rowId = "20261031120000-rowveh1";
        const md = formatModuleRowLogsMarkdown({
            moduleTitle: "车辆",
            avId,
            columns: { name: "col-name" },
            rows: [
                {
                    itemID: rowId,
                    cells: { "col-name": { type: "text", text: { content: "家用SUV" } } },
                },
            ],
            logs: {
                [`${avId}|${rowId}`]: {
                    fuelings: [
                        { date: "2026-10-20", quantity: 42, totalCost: 325, odometer: 15500, at: "2026-10-20T10:00:00Z" },
                    ],
                },
            },
            renewHistory: {
                [rowId]: [{ from: "2026-10-01", to: "2027-10-01", at: "2026-10-02T08:00:00Z" }],
            },
        });
        expect(md).toContain("## 📋 日常流水与附属记录");
        expect(md).toContain("### 📌 家用SUV");
        expect(md).toContain("42 L");
        expect(md).toContain("效期续期 **2026-10-01 ➔ 2027-10-01**");
    });

    it("formatDailyJournalMarkdown 生成带思源块引用的日常流水与任务清单备忘", () => {
        const md = formatDailyJournalMarkdown({
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
                {
                    id: "m2",
                    title: "买电池",
                    dueDate: "2026-10-28",
                    doneAt: "2026-10-29T09:00:00Z",
                },
            ],
            flowItems: [
                {
                    date: "2026-10-31",
                    sortKey: "2026-10-31T08:00:00Z",
                    moduleId: "vehicles",
                    moduleTitle: "车辆",
                    docId: "20261031125039-kr6hkw0",
                    rowTitle: "家用SUV",
                    summaryLine: "- **2026-10-31** · ⛽ 加油 **42 L** · **¥325**",
                },
            ],
            quickItems: [
                {
                    date: "2026-10-31",
                    kindLabel: "🛒 待买清单",
                    title: "有机纯牛奶",
                    detail: "数量 2",
                    docId: "20261031125038-9asdrbu",
                    moduleTitle: "台账 · 购物记录",
                },
            ],
        });
        expect(md).toContain("## ⚡ 日常流水记录");
        expect(md).toContain('((20261031125039-kr6hkw0 "台账 · 车辆"))');
        expect(md).toContain("有机纯牛奶");
        expect(md).toContain("- [ ] **清洗空调滤网**");
        expect(md).toContain("#家务");
        expect(md).toContain("- [x] ~~买电池~~");
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
        const appends = calls.filter((c) => c.url === "/api/block/appendBlock");
        const updates = calls.filter((c) => c.url === "/api/block/updateBlock");
        expect(appends).toHaveLength(1);
        expect(updates).toHaveLength(1);
        expect(updates[0].body.data).toContain("## 第二次更新");
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
