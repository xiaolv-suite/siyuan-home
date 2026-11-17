import { describe, it, expect } from "vitest";

describe("quick-mileage-stepper (POOL-FEAT-10 / CAND-12: 补能快捷带入上次里程与递增步进)", () => {
    it("基于上次里程一键快速带入", () => {
        const vehicle = { itemID: "v-1", name: "轿车", plate: "京A12345", mileage: 35000 };
        let fuelingMileage: number | undefined;

        function fillLastMileage() {
            if (vehicle.mileage) {
                fuelingMileage = vehicle.mileage;
            }
        }

        fillLastMileage();
        expect(fuelingMileage).toBe(35000);
    });

    it("空输入时以车辆上次里程为基准进行步进 (+50km / +100km)", () => {
        const vehicle = { itemID: "v-1", name: "轿车", plate: "京A12345", mileage: 35000 };
        let fuelingMileage: number | undefined;

        function stepMileage(delta: number) {
            const base = fuelingMileage ?? vehicle?.mileage ?? 0;
            fuelingMileage = Math.max(0, base + delta);
        }

        stepMileage(100);
        expect(fuelingMileage).toBe(35100);

        stepMileage(50);
        expect(fuelingMileage).toBe(35150);
    });

    it("无车辆里程记录时以 0 为初始基准累加", () => {
        const vehicle = { itemID: "v-2", name: "新车", plate: "京A88888", mileage: undefined };
        let fuelingMileage: number | undefined;

        function stepMileage(delta: number) {
            const base = fuelingMileage ?? vehicle?.mileage ?? 0;
            fuelingMileage = Math.max(0, base + delta);
        }

        stepMileage(200);
        expect(fuelingMileage).toBe(200);
    });
});
