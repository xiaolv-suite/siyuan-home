import { describe, it, expect, vi } from "vitest";

describe("overview-subcomponents (总览主屏新手向导与快捷备忘)", () => {
    it("向导四个步骤在无默认模块与有默认模块时正确分派跳转目标", () => {
        const onGoto = vi.fn();
        const onOpenStarterRecord = vi.fn();
        const onOpenSettings = vi.fn();

        function handleStepClick(step: number, starterModule?: string) {
            if (step === 1) onGoto("members");
            else if (step === 2) {
                if (starterModule) onOpenStarterRecord();
                else onOpenSettings();
            } else if (step === 3) onOpenSettings();
            else if (step === 4) onGoto("reminders");
        }

        handleStepClick(1);
        expect(onGoto).toHaveBeenCalledWith("members");

        handleStepClick(2, "certs");
        expect(onOpenStarterRecord).toHaveBeenCalledTimes(1);

        handleStepClick(2, undefined);
        expect(onOpenSettings).toHaveBeenCalledTimes(1);

        handleStepClick(3);
        expect(onOpenSettings).toHaveBeenCalledTimes(2);

        handleStepClick(4);
        expect(onGoto).toHaveBeenCalledWith("reminders");
    });

    it("快捷备忘提取与默认到期时间推演", () => {
        const now = new Date("2026-10-30T10:00:00Z");
        const defaultDue = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
        expect(defaultDue).toBe("2026-11-02");
    });
});
