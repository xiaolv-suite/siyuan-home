import { describe, it, expect, vi } from "vitest";
import { renderVehicleEnergySection } from "@/core/vehicle-energy-section";

describe("vehicle-energy-section (车辆能源能耗板块与图表分析)", () => {
    it("在非DOM环境下优雅跳过", async () => {
        const body = {} as any;
        const vehicleActionQueue = {
            register: vi.fn(),
            fail: vi.fn(),
            request: vi.fn(),
        };

        await expect(
            renderVehicleEnergySection({
                body,
                row: { itemID: "veh-1", cells: {} },
                ref: { avId: "av-1", columns: {} },
                active: "vehicles",
                plugin: { loadData: vi.fn().mockResolvedValue(null) },
                t: (k: string) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                selectContentFn: () => "gasoline",
                rawFromValueFn: () => "",
                vehicleActionQueue,
            })
        ).resolves.toBeUndefined();
    });

    it("具备DOM环境下安全挂载section并向队列注册快捷操作", async () => {
        const appendChild = vi.fn();
        const replaceChildren = vi.fn();
        const body = { appendChild, contains: vi.fn().mockReturnValue(true) } as any;

        const originalDoc = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: vi.fn().mockReturnValue({
                appendChild: vi.fn(),
                replaceChildren,
                append: vi.fn(),
                style: {},
                dataset: {},
                classList: { add: vi.fn() },
            }),
            createElementNS: vi.fn().mockReturnValue({
                setAttribute: vi.fn(),
                appendChild: vi.fn(),
                append: vi.fn(),
                style: {},
                dataset: {},
            }),
        };

        const vehicleActionQueue = {
            register: vi.fn(),
            fail: vi.fn(),
            request: vi.fn(),
        };

        try {
            await renderVehicleEnergySection({
                body,
                row: { itemID: "veh-1", cells: {} },
                ref: { avId: "av-1", columns: {} },
                active: "vehicles",
                plugin: { loadData: vi.fn().mockResolvedValue(null) },
                t: (k: string) => k,
                DialogCls: class {} as any,
                showMessageFn: vi.fn(),
                selectContentFn: () => "gasoline",
                rawFromValueFn: () => "",
                vehicleActionQueue,
            });

            expect(body.appendChild).toHaveBeenCalled();
            expect(vehicleActionQueue.register).toHaveBeenCalledWith("fuel", expect.any(Function));
            expect(vehicleActionQueue.register).toHaveBeenCalledWith("charging", expect.any(Function));
        } finally {
            if (originalDoc) (globalThis as any).document = originalDoc;
            else delete (globalThis as any).document;
        }
    });
});
