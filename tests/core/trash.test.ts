import { describe, it, expect, vi } from "vitest";
import { restoreTrashItem } from "@/core/trash";

describe("trash (回收站安全恢复引擎)", () => {
    it("回收站中不存在指定 ID 时返回失败", async () => {
        const mockPlugin: any = {
            settings: { dbRefs: {} },
            runtime: { trash: [] },
        };
        const res = await restoreTrashItem(mockPlugin, "non-existent");
        expect(res.success).toBe(false);
        expect(res.error).toContain("未找到");
    });

    it("目标模块未开通时返回失败并提示原因", async () => {
        const mockPlugin: any = {
            settings: { dbRefs: {} },
            runtime: {
                trash: [
                    {
                        id: "item-1",
                        moduleId: "certs",
                        title: "护照",
                        deletedAt: "2026-10-29T10:00:00Z",
                        rowSnapshot: {},
                    },
                ],
            },
        };
        const res = await restoreTrashItem(mockPlugin, "item-1");
        expect(res.success).toBe(false);
        expect(res.error).toContain("未初始化");
    });
});
