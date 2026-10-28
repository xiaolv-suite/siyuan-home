import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeQuickCaptureSave } from "@/core/quick-capture-saver";
import * as siyuan from "@/core/siyuan";
import * as siyuanPkg from "siyuan";

describe("quick-capture-saver (快速记录提交事务保存引擎)", () => {
    let mockPlugin: any;
    const t = (k: string) => k;
    const fieldLabel = (f: any) => f.label ?? f.key;
    const modLabel = (m: string) => m;

    beforeEach(() => {
        mockPlugin = {
            settings: {
                members: [{ id: "mem-1", avItemId: "av-mem-1" }],
                dbRefs: {
                    certs: {
                        avId: "av-certs",
                        columns: { name: "col-name", category: "col-cat" },
                    },
                },
            },
            runtime: {},
            saveData: vi.fn().mockResolvedValue(undefined),
            refreshHub: vi.fn().mockResolvedValue(undefined),
        };
        vi.spyOn(siyuanPkg, "showMessage").mockImplementation(() => undefined);
        vi.spyOn(siyuan, "addDetachedRow").mockResolvedValue("new-row-id");
        vi.spyOn(siyuan, "setCell").mockResolvedValue(undefined);
    });

    it("必填项缺失时拦截并返回对应字段错误", async () => {
        const result = await executeQuickCaptureSave({
            plugin: mockPlugin,
            moduleId: "certs",
            values: { name: "" },
            captureFields: [{ key: "name", type: "text", required: true } as any],
            saveOperationKey: "test:op:1",
            t,
            fieldLabel,
            modLabel,
            ensureTargetRef: vi.fn(),
        });

        expect(result.success).toBe(false);
        expect(result.focusFieldKey).toBe("name");
        expect(result.fieldErrors?.name).toBeDefined();
    });

    it("成员关系字段关联失效时拦截提示", async () => {
        const result = await executeQuickCaptureSave({
            plugin: mockPlugin,
            moduleId: "certs",
            values: { name: "护照", member: "invalid-av-id" },
            captureFields: [
                { key: "name", type: "text" } as any,
                { key: "member", type: "relation" } as any,
            ],
            saveOperationKey: "test:op:2",
            t,
            fieldLabel,
            modLabel,
            ensureTargetRef: vi.fn(),
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("members.notLinked");
    });

    it("正常提交成功创建新行并原子写入单元格", async () => {
        const ensureTargetRef = vi.fn().mockResolvedValue({
            avId: "av-certs",
            columns: { name: "col-name", category: "col-cat" },
        });

        const result = await executeQuickCaptureSave({
            plugin: mockPlugin,
            moduleId: "certs",
            values: { name: "护照", category: "passport" },
            captureFields: [
                { key: "name", type: "text" } as any,
                { key: "category", type: "select" } as any,
            ],
            saveOperationKey: "test:op:3",
            t,
            fieldLabel,
            modLabel,
            ensureTargetRef,
        });

        expect(result.success).toBe(true);
        expect(result.pendingRowId).toBe("new-row-id");
        expect(siyuan.addDetachedRow).toHaveBeenCalledWith(
            "av-certs",
            "护照",
            expect.objectContaining({ idempotencyKey: "test:op:3:row" })
        );
        expect(siyuan.setCell).toHaveBeenCalled();
        expect(mockPlugin.runtime.hubQuickModule).toBe("certs");
        expect(mockPlugin.refreshHub).toHaveBeenCalledWith(undefined, true);
    });

    it("建行遭遇 RowIdentityPendingError 时捕获并返回待确认状态", async () => {
        vi.spyOn(siyuan, "addDetachedRow").mockRejectedValue(new siyuan.RowIdentityPendingError([]));

        const ensureTargetRef = vi.fn().mockResolvedValue({
            avId: "av-certs",
            columns: { name: "col-name" },
        });

        const result = await executeQuickCaptureSave({
            plugin: mockPlugin,
            moduleId: "certs",
            values: { name: "待确认证件" },
            captureFields: [{ key: "name", type: "text" } as any],
            saveOperationKey: "test:op:4",
            t,
            fieldLabel,
            modLabel,
            ensureTargetRef,
        });

        expect(result.success).toBe(false);
        expect(result.identityPending).toBe(true);
        expect(result.pendingModuleId).toBe("certs");
    });
});
