import { describe, it, expect, vi, afterEach } from "vitest";
import {
    setUploadTransport,
    uploadAsset,
    getOCRConfig,
    getImageOCRText,
    recognizeAsset,
} from "@/core/siyuan-asset-ocr";
import { setTransport } from "@/core/siyuan";

describe("siyuan-asset-ocr (思源笔记资产上传与 OCR 智能识别独立模块)", () => {
    afterEach(() => {
        setUploadTransport(null);
        setTransport(null);
    });

    it("通过 setUploadTransport 自定义传输上传文件并解析 succMap", async () => {
        setUploadTransport(async () => ({
            code: 0,
            msg: "",
            data: {
                succMap: {
                    "test-image.png": "/assets/siyuan-home/test-image-20261028.png",
                },
            },
        }));

        const fakeFile = {
            name: "test-image.png",
            size: 1024,
            lastModified: 1730000000000,
            type: "image/png",
        } as unknown as File;

        const res = await uploadAsset(fakeFile, "/assets/siyuan-home/");
        expect(res.name).toBe("test-image.png");
        expect(res.path).toBe("/assets/siyuan-home/test-image-20261028.png");
    });

    it("getOCRConfig / getImageOCRText / recognizeAsset 正常读取响应", async () => {
        setTransport(async (endpoint: string) => {
            if (endpoint === "/api/asset/getOCRConfig") {
                return {
                    code: 0,
                    msg: "",
                    data: {
                        config: { provider: "siyuan", model: "default", auto: true },
                        providers: [{ id: "siyuan", available: true }],
                        models: [{ id: "default", name: "内置", builtIn: true }],
                        aiModels: [],
                    },
                };
            }
            if (endpoint === "/api/asset/getImageOCRText") {
                return { code: 0, msg: "", data: { text: "身份证号码：110101199003072345" } };
            }
            if (endpoint === "/api/asset/ocr") {
                return {
                    code: 0,
                    msg: "",
                    data: {
                        text: "OCR 识别结果",
                        ocrJSON: [{ text: "行1" }],
                    },
                };
            }
            return { code: 0, msg: "", data: {} };
        });

        const config = await getOCRConfig();
        expect(config.config.provider).toBe("siyuan");
        expect(config.providers).toHaveLength(1);

        const ocrText = await getImageOCRText("/assets/demo.png");
        expect(ocrText).toContain("110101199003072345");

        const ocrResult = await recognizeAsset("/assets/demo.png");
        expect(ocrResult.text).toBe("OCR 识别结果");
        expect(ocrResult.ocrJSON).toHaveLength(1);
    });
});
