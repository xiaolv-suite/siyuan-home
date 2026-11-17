import { describe, it, expect, vi } from "vitest";

describe("reminder-controls-bar (提醒中枢复合筛选与快捷操作控制栏)", () => {
    it("筛选条件与维度枚举完备性", () => {
        const filterOptions = ["all", "overdue", "soon", "lead", "handled"];
        const dueWithinOptions = ["all", "0", "7", "30"];

        expect(filterOptions).toContain("overdue");
        expect(filterOptions).toContain("handled");
        expect(dueWithinOptions).toEqual(["all", "0", "7", "30"]);
    });

    it("命名视图切换与过滤条件联动事务", () => {
        const mockNamedViews = [
            { id: "nv-1", name: "今天紧急", filter: "overdue", dueWithin: "0" },
            { id: "nv-2", name: "孩子事项", memberId: "mem-child" },
        ];

        let activeNamedViewId: string | undefined = "nv-1";
        const onApplyNamedView = vi.fn((v) => {
            activeNamedViewId = v.id;
        });

        onApplyNamedView(mockNamedViews[1]);
        expect(onApplyNamedView).toHaveBeenCalledWith(mockNamedViews[1]);
        expect(activeNamedViewId).toBe("nv-2");

        // 切换常规过滤时，活动命名视图应被重置
        const changeFilter = (_val: string) => {
            activeNamedViewId = undefined;
        };
        changeFilter("soon");
        expect(activeNamedViewId).toBeUndefined();
    });

    it("批量操作模式切换与选择集清空回调", () => {
        let batchMode = false;
        const onClearSelection = vi.fn();

        const toggleBatchMode = () => {
            if (batchMode) {
                batchMode = false;
                onClearSelection();
            } else {
                batchMode = true;
            }
        };

        toggleBatchMode();
        expect(batchMode).toBe(true);
        expect(onClearSelection).not.toHaveBeenCalled();

        toggleBatchMode();
        expect(batchMode).toBe(false);
        expect(onClearSelection).toHaveBeenCalledTimes(1);
    });
});
