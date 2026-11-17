import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/siyuan", () => ({ addDetachedRow: vi.fn(), setCell: vi.fn() }));

import { resolveMemberItemId, toLedgerCell, writeLedgerRow } from "@/core/ledger-writer";

describe("ledger-writer 写入网关", () => {
    const members = [{ id: "m-self", avItemId: "av-self" }, { id: "m-kid", avItemId: "av-kid" }, { id: "m-unlinked" }];

    it("成员引用：settings id 与 avItemId 都换成 avItemId，未关联成员返回 undefined", () => {
        expect(resolveMemberItemId("m-kid", members)).toBe("av-kid");
        expect(resolveMemberItemId("av-self", members)).toBe("av-self");
        expect(resolveMemberItemId("m-unlinked", members)).toBeUndefined();
        expect(resolveMemberItemId("", members)).toBeUndefined();
        expect(resolveMemberItemId("raw-id", undefined)).toBe("raw-id");
    });

    it("按列类型产出内核载荷：select 双形态、日期转毫秒时间戳", () => {
        expect(toLedgerCell("select", "reward")).toEqual({ type: "select", select: { content: "reward" }, mSelect: [{ content: "reward" }] });
        const date = toLedgerCell("date", "2026-10-31") as { date: { content: number; isNotEmpty: boolean } };
        expect(typeof date.date.content).toBe("number");
        expect(date.date.isNotEmpty).toBe(true);
        expect(toLedgerCell("number", "12.5")).toEqual({ type: "number", number: { content: 12.5 } });
        expect(toLedgerCell("number", "abc")).toBeNull();
        expect(toLedgerCell("relation", "m-kid", members)).toEqual({ type: "relation", relation: { blockIDs: ["av-kid"], contents: null } });
        expect(toLedgerCell("relation", "m-unlinked", members)).toBeNull();
    });

    it("建行后显式写名称列，并按 schema 类型写各字段；跳过空值", async () => {
        const addRowFn = vi.fn(async () => "row-1");
        const writes: Array<[string, unknown]> = [];
        const setCellFn = vi.fn(async (_av: string, key: string, _item: string, value: unknown) => { writes.push([key, value]); });
        const result = await writeLedgerRow({
            moduleId: "allowance",
            target: { avId: "av-allow", columns: { name: "k-name", amount: "k-amount", date: "k-date", member: "k-member", category: "k-cat", note: "k-note" } },
            name: "小明家务积分兑换零花钱",
            fields: { amount: 3.5, date: "2026-10-31", member: "m-kid", category: "reward", note: "" },
            members,
            addRowFn,
            setCellFn,
        });
        expect(result).toEqual({ itemID: "row-1", failed: [] });
        const byKey = Object.fromEntries(writes);
        expect(byKey["k-name"]).toEqual({ type: "text", text: { content: "小明家务积分兑换零花钱" } });
        expect(byKey["k-amount"]).toEqual({ type: "number", number: { content: 3.5 } });
        expect((byKey["k-date"] as any).date.content).toBeTypeOf("number");
        expect(byKey["k-member"]).toEqual({ type: "relation", relation: { blockIDs: ["av-kid"], contents: null } });
        expect((byKey["k-cat"] as any).mSelect).toEqual([{ content: "reward" }]);
        expect(byKey["k-note"]).toBeUndefined();
    });

    it("缺列、无法转换与内核写失败都如实计入 failed，不抛出", async () => {
        const setCellFn = vi.fn(async (_av: string, key: string) => { if (key === "k-amount") throw new Error("kernel"); });
        const result = await writeLedgerRow({
            moduleId: "allowance",
            target: { avId: "av", columns: { amount: "k-amount", member: "k-member" } },
            name: "x",
            fields: { amount: 1, member: "m-unlinked", source: "家务激励" },
            members,
            addRowFn: async () => "row-2",
            setCellFn,
        });
        expect(result.failed.sort()).toEqual(["amount", "member", "source"]);
    });

    it("台账未建库直接报错，不新建行", async () => {
        const addRowFn = vi.fn();
        await expect(writeLedgerRow({ moduleId: "stock", target: {}, name: "x", addRowFn })).rejects.toThrow();
        expect(addRowFn).not.toHaveBeenCalled();
    });
});
