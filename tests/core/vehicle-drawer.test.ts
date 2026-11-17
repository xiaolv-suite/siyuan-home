import { describe, it, expect, vi } from "vitest";
import { renderVehicleDetailSections } from "@/core/vehicle-drawer";
import { createVehicleActionQueue } from "@/core/vehicle";

describe("vehicle-drawer (车辆详情抽屉费用总览、能耗趋势与维保记录)", () => {
    it("renderVehicleDetailSections 安全防御与挂载调用", async () => {
        const queue = createVehicleActionQueue();
        const mockRow = {
            itemID: "veh-1",
            cells: {
                c_name: { type: "text", text: { content: "别克君越" } },
                c_plate: { type: "text", text: { content: "京A12345" } },
                c_energy: { type: "select", select: { content: "gasoline" } },
                c_mileage: { type: "number", number: { content: 15000 } },
            },
        };

        await expect(
            renderVehicleDetailSections({
                body: { appendChild: vi.fn(), contains: vi.fn() } as any,
                row: mockRow,
                ref: {
                    avId: "av-veh",
                    columns: {
                        name: "c_name",
                        plate: "c_plate",
                        energy_type: "c_energy",
                        mileage: "c_mileage",
                    },
                },
                active: "vehicles",
                plugin: {
                    loadData: vi.fn().mockResolvedValue({}),
                    saveData: vi.fn().mockResolvedValue({}),
                    refreshHub: vi.fn(),
                },
                t: (k: string) => k,
                DialogCls: class {
                    element = { querySelector: vi.fn() };
                    destroy = vi.fn();
                } as any,
                showMessageFn: vi.fn(),
                cellTextFn: (cell: any) => cell?.text?.content || String(cell?.number?.content || ""),
                selectContentFn: (cell: any) => cell?.select?.content,
                rawFromValueFn: () => "",
                vehicleActionQueue: queue,
            })
        ).resolves.not.toThrow();
    });
});
