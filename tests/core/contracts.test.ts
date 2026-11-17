import { describe, it, expect } from "vitest";
import { matchHouseContracts, calculateContractRenewalWindow } from "@/core/contracts";
import type { AvRow } from "@/core/siyuan";

describe("contracts.matchHouseContracts（§16 房屋保修联动核对）", () => {
    const houseCols = { name: "h-name", member: "h-member" };
    const contractCols = {
        name: "c-name",
        category: "c-cat",
        party: "c-party",
        contact: "c-contact",
        expiry: "c-expiry",
        note: "c-note",
        member: "c-member",
    };

    const makeHouse = (name: string, memberId?: string): AvRow => ({
        itemID: "house-1",
        cells: {
            "h-name": { type: "text", text: { content: name } },
            "h-member": memberId ? { type: "relation", relation: { blockIDs: [memberId] } } : {},
        },
    });

    const makeContract = (
        id: string,
        name: string,
        category: string,
        expiry?: string,
        opts?: { party?: string; contact?: string; note?: string; memberId?: string },
    ): AvRow => ({
        itemID: id,
        cells: {
            "c-name": { type: "text", text: { content: name } },
            "c-cat": { type: "select", select: { content: category } },
            "c-party": opts?.party ? { type: "text", text: { content: opts.party } } : {},
            "c-contact": opts?.contact ? { type: "text", text: { content: opts.contact } } : {},
            "c-expiry": expiry ? { type: "date", date: { content: expiry } } : {},
            "c-note": opts?.note ? { type: "text", text: { content: opts.note } } : {},
            "c-member": opts?.memberId ? { type: "relation", relation: { blockIDs: [opts.memberId] } } : {},
        },
    });

    it("按名称关联匹配房屋保修与租赁合同", () => {
        const house = makeHouse("阳光花园3栋502");
        const contracts = [
            makeContract("c-1", "阳光花园3栋502装修维保协议", "renovation", "2026-12-01", { party: "阔达装饰" }),
            makeContract("c-2", "车辆保养协议", "other_ct", "2026-11-01"),
            makeContract("c-3", "阳光花园物业服务合同", "property_ct", "2026-10-25"),
        ];

        const matches = matchHouseContracts(house, houseCols, contracts, contractCols, "2026-10-19");
        expect(matches.map((m) => m.id)).toEqual(["c-3", "c-1"]);
        expect(matches[0].warrantyStatus).toBe("expiring"); // 2026-10-25 距今 6 天
        expect(matches[0].daysLeft).toBe(6);
        expect(matches[1].warrantyStatus).toBe("valid"); // 2026-12-01 在保
    });

    it("备注包含房屋名称或同成员房产合同可匹配", () => {
        const house = makeHouse("翡翠城A座", "mem-self");
        const contracts = [
            makeContract("c-1", "精装保修单", "renovation", "2025-01-01", { note: "对应翡翠城A座房屋工程" }),
            makeContract("c-2", "租房协议", "rent", "2026-11-15", { memberId: "mem-self" }),
            makeContract("c-3", "劳动合同", "labor", "2026-12-31", { memberId: "mem-self" }), // 非房产合同类别不自动串联
        ];

        const matches = matchHouseContracts(house, houseCols, contracts, contractCols, "2026-10-19");
        expect(matches.map((m) => m.id)).toEqual(["c-2", "c-1"]);
        expect(matches[0].warrantyStatus).toBe("expiring"); // 27 天到期
        expect(matches[1].warrantyStatus).toBe("expired"); // 去年已过保
    });

    it("未填到期日的合同标记为 unknown", () => {
        const house = makeHouse("云栖小院");
        const contracts = [
            makeContract("c-1", "云栖小院防水维保协议", "renovation"),
        ];
        const matches = matchHouseContracts(house, houseCols, contracts, contractCols, "2026-10-19");
        expect(matches).toHaveLength(1);
        expect(matches[0].warrantyStatus).toBe("unknown");
        expect(matches[0].daysLeft).toBeUndefined();
    });

    it("calculateContractRenewalWindow 准确测算提前30天解约通知截止日与阶段", () => {
        const today = "2026-10-27";

        // 1. 履行中：2027-01-31 到期，提前30天为 2027-01-01（距通知截止日还有66天）
        const inForce = calculateContractRenewalWindow({
            expiryDate: "2027-01-31",
            noticeDays: 30,
            today,
        });
        expect(inForce?.phase).toBe("in_force");
        expect(inForce?.noticeDeadlineDate).toBe("2027-01-01");
        expect(inForce?.daysUntilDeadline).toBe(66);

        // 2. 最后解约通知窗口：2026-11-30 到期，提前30天截止日为 2026-10-31（距截止日仅剩 4 天）
        const noticeWindow = calculateContractRenewalWindow({
            expiryDate: "2026-11-30",
            noticeDays: 30,
            today,
        });
        expect(noticeWindow?.phase).toBe("notice_window");
        expect(noticeWindow?.daysUntilDeadline).toBe(4);
        expect(noticeWindow?.phaseLabel).toContain("解约");

        // 3. 错过通知期：2026-11-10 到期，提前30天截止日为 2026-10-11（已过截止日）
        const missed = calculateContractRenewalWindow({
            expiryDate: "2026-11-10",
            noticeDays: 30,
            today,
        });
        expect(missed?.phase).toBe("expiring_soon");

        // 4. 已终止：2026-09-01 到期
        const expired = calculateContractRenewalWindow({
            expiryDate: "2026-09-01",
            noticeDays: 30,
            today,
        });
        expect(expired?.phase).toBe("expired");
    });
});
