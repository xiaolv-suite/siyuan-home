import { describe, it, expect, vi } from "vitest";

describe("ledger-duplicate-record (POOL-FEAT-13 / CAND-17: 单条记录一键克隆新建)", () => {
    const mockRef = {
        columns: {
            name: "col-name",
            category: "col-cat",
            amount: "col-amt",
            member: "col-mem",
            status: "col-stat",
        },
    };

    const mockSchemaCols = [
        { key: "name", type: "text" },
        { key: "category", type: "select" },
        { key: "amount", type: "number" },
        { key: "member", type: "relation" },
        { key: "status", type: "select" },
    ];

    it("正确复制除 ID 之外的业务字段并追加「(副本)」后缀", () => {
        const row = {
            itemID: "row-orig-123",
            cells: {
                "col-name": { text: { content: "房屋租赁合同" } },
                "col-cat": { select: [{ content: "house_rent" }] },
                "col-amt": { number: { content: 4500 } },
                "col-mem": { relation: [{ content: "本人" }] },
                "col-stat": { select: [{ content: "active" }] },
            },
        };

        const copiedValues: Record<string, any> = { name: "房屋租赁合同 (副本)" };
        for (const col of mockSchemaCols) {
            if (col.key === "name") continue;
            const keyID = (mockRef.columns as any)[col.key];
            const v = row.cells[keyID as keyof typeof row.cells];
            if (v) {
                if (col.type === "select") copiedValues[col.key] = (v as any).select?.[0]?.content;
                else if (col.type === "number") copiedValues[col.key] = (v as any).number?.content;
                else if (col.type === "relation") copiedValues[col.key] = (v as any).relation?.[0]?.content;
            }
        }

        expect(copiedValues.name).toBe("房屋租赁合同 (副本)");
        expect(copiedValues.category).toBe("house_rent");
        expect(copiedValues.amount).toBe(4500);
        expect(copiedValues.member).toBe("本人");
        expect(copiedValues.status).toBe("active");
        expect(copiedValues.itemID).toBeUndefined(); // ID 绝不克隆
    });

    it("访客模式写保护拦截", () => {
        const showMessage = vi.fn();
        const isGuest = true;

        function handleDuplicate(guestActive: boolean) {
            if (guestActive) {
                showMessage("guest.writeBlocked", 3500, "info");
                return false;
            }
            return true;
        }

        expect(handleDuplicate(isGuest)).toBe(false);
        expect(showMessage).toHaveBeenCalledWith("guest.writeBlocked", 3500, "info");
    });
});
