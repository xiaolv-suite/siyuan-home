import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCaptureTo } from "@/core/quick-capture-action";
import * as siyuan from "@/core/siyuan";
import * as siyuanPkg from "siyuan";

describe("quick-capture-action (划选文字快速收录动作执行器)", () => {
    let mockPlugin: any;
    let captureDedupe: Map<string, number>;
    const t = (k: string) => k;

    beforeEach(() => {
        captureDedupe = new Map<string, number>();
        mockPlugin = {
            settings: {
                enabledModules: ["snippets", "bookmarks", "address"],
                dbRefs: {
                    snippets: { avId: "av-snippets", columns: { content: "col-content" } },
                    bookmarks: { avId: "av-bookmarks", columns: { url: "col-url" } },
                    address: { avId: "av-address", columns: { address_full: "col-addr" } },
                },
            },
            ensureCoreLedgers: vi.fn().mockResolvedValue(undefined),
        };
        vi.spyOn(siyuanPkg, "showMessage").mockImplementation(() => undefined);
        vi.spyOn(siyuan, "addDetachedRow").mockResolvedValue("row-123");
        vi.spyOn(siyuan, "setCell").mockResolvedValue(undefined);
    });

    it("空文本时静默提示并优雅返回", async () => {
        await executeCaptureTo({
            plugin: mockPlugin,
            moduleId: "snippets",
            text: "   ",
            captureDedupe,
            t,
        });

        expect(siyuanPkg.showMessage).toHaveBeenCalledWith("capture.empty", 3000, "info");
        expect(mockPlugin.ensureCoreLedgers).not.toHaveBeenCalled();
    });

    it("目标模块未启用时提示引导", async () => {
        mockPlugin.settings.enabledModules = [];
        await executeCaptureTo({
            plugin: mockPlugin,
            moduleId: "bookmarks",
            text: "https://b3log.org/siyuan",
            captureDedupe,
            t,
        });

        expect(siyuanPkg.showMessage).toHaveBeenCalled();
        expect(mockPlugin.ensureCoreLedgers).not.toHaveBeenCalled();
    });

    it("成功存入常用语片段并完成原子建行与落盘", async () => {
        await executeCaptureTo({
            plugin: mockPlugin,
            moduleId: "snippets",
            text: "常用快递地址：朝阳区",
            captureDedupe,
            t,
        });

        expect(mockPlugin.ensureCoreLedgers).toHaveBeenCalled();
        expect(siyuan.addDetachedRow).toHaveBeenCalledWith(
            "av-snippets",
            "常用快递地址：朝阳区",
            expect.objectContaining({ idempotencyKey: expect.stringContaining("capture:snippets") })
        );
        expect(siyuan.setCell).toHaveBeenCalledWith(
            "av-snippets",
            "col-content",
            "row-123",
            { type: "text", text: { content: "常用快递地址：朝阳区" } },
            expect.objectContaining({ idempotencyKey: expect.stringContaining("capture:snippets") })
        );
        expect(siyuanPkg.showMessage).toHaveBeenCalledWith("capture.saved", 3000, "info");
    });

    it("短时间内重复触发去重防重入", async () => {
        const text = "https://example.com/unique";
        await executeCaptureTo({
            plugin: mockPlugin,
            moduleId: "bookmarks",
            text,
            captureDedupe,
            t,
        });
        expect(siyuan.addDetachedRow).toHaveBeenCalledTimes(1);

        // 立即再次触发同样文本
        await executeCaptureTo({
            plugin: mockPlugin,
            moduleId: "bookmarks",
            text,
            captureDedupe,
            t,
        });
        // 不应重复发起建行
        expect(siyuan.addDetachedRow).toHaveBeenCalledTimes(1);
    });
});
