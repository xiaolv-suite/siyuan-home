import { describe, it, expect, vi } from "vitest";
import { openGrowthChartDialog, openVaccineScheduleDialog } from "@/core/growth-dialog";
import type { FamilyMember } from "@/types";

class MockDialog {
    element: any;
    destroy = vi.fn();
    bodyEl = { innerHTML: "", appendChild: vi.fn(), querySelectorAll: () => [] };
    constructor(opts: { title: string; content: string; width?: string }) {
        this.element = {
            innerHTML: opts.content,
            querySelector: (sel: string) => {
                if (sel === "#lv-growth-body" || sel === "#lv-vaccine-sched-body") {
                    return this.bodyEl;
                }
                return null;
            },
        };
    }
}

describe("growth-dialog (儿童发育曲线与疫苗日程独立解耦弹窗)", () => {
    it("openGrowthChartDialog 空数据提示", () => {
        const showMessage = vi.fn();
        const t = (k: string) => k;

        let createdDlg: any;
        class CapturingMockDialog extends MockDialog {
            constructor(opts: any) {
                super(opts);
                createdDlg = this;
            }
        }

        openGrowthChartDialog({
            t,
            rows: [],
            columns: {},
            members: [],
            DialogCls: CapturingMockDialog as any,
            showMessageFn: showMessage,
        });

        const bodyEl = createdDlg?.element?.querySelector("#lv-growth-body");
        expect(bodyEl?.innerHTML).toContain("ledger.noGrowthData");
    });

    it("openVaccineScheduleDialog 无生日儿童时提示", async () => {
        const showMessage = vi.fn();
        const t = (k: string) => k;

        await openVaccineScheduleDialog({
            t,
            members: [{ id: "m1", name: "孩子", role: "child" } as FamilyMember],
            avId: "av-1",
            columns: {},
            DialogCls: MockDialog as any,
            showMessageFn: showMessage,
            cellTextFn: () => "",
        });

        expect(showMessage).toHaveBeenCalledWith("ledger.vaccineNoBirthdayChild", 4000, "info");
    });
});
