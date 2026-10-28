import { describe, it, expect, vi } from "vitest";

describe("ledger-vehicle-grid (车辆专属大屏卡片网格)", () => {
    const mockVehicleRows = [
        {
            itemID: "veh-1",
            cells: {
                c_name: { text: { content: "特斯拉 Model Y" } },
                c_brand: { text: { content: "特斯拉" } },
                c_plate: { text: { content: "京AD12345" } },
                c_energy: { text: { content: "纯电" } },
                c_mileage: { number: { content: 24000 } },
            },
        },
    ];

    it("车辆属性格式化与详情回调分发", () => {
        const onOpenDetail = vi.fn();
        expect(mockVehicleRows).toHaveLength(1);

        onOpenDetail(mockVehicleRows[0], "charging");
        expect(onOpenDetail).toHaveBeenCalledWith(mockVehicleRows[0], "charging");
    });
});
