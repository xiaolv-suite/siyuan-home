/**
 * QR 工具层单测：dataURL 生成、PNG 无损解码与 ISO 18004 矩阵位级对照验证。
 */
import zlib from "node:zlib";
import QRCode from "qrcode";
import { describe, it, expect } from "vitest";
import { encodeQrMatrix, generateQRDataUrl, blockDeepLink } from "@/core/qr";

describe("qr.encodeQrMatrix 与参考库位级对齐", () => {
    const samples = [
        "hello",
        "siyuan://blocks/20261031090000-abcdefg",
        "小驴管家 · 家庭收纳箱 #A-03（书房顶柜）",
        "https://github.com/xiaolv-suite/siyuan-home/releases/tag/v0.5.184?ref=qr-label-verification-v7-version-info-test-string-1234567890",
        "L".repeat(310), // Version 13/14 (>255 bytes, 16-bit byte count indicator)
    ];

    for (const sample of samples) {
        it(`矩阵 100% 匹配 ISO 18004 Byte/M 参考实现（len=${sample.length}）`, () => {
            const bytes = new TextEncoder().encode(sample);
            const ref = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: "M" });
            const ours = encodeQrMatrix(sample);
            expect(ours.size).toBe(ref.modules.size);
            expect(Array.from(ours.data)).toEqual(Array.from(ref.modules.data));
        });
    }
});

describe("qr.generateQRDataUrl", () => {
    it("返回合法可解压 PNG data URL", async () => {
        const url = await generateQRDataUrl("siyuan://blocks/test-123", 160);
        expect(url.startsWith("data:image/png;base64,")).toBe(true);
        const buf = Buffer.from(url.slice("data:image/png;base64,".length), "base64");
        expect(buf.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const idatPos = buf.indexOf(Buffer.from("IDAT"));
        expect(idatPos).toBeGreaterThan(8);
        const idatLen = buf.readUInt32BE(idatPos - 4);
        const rawScanlines = zlib.inflateSync(buf.subarray(idatPos + 4, idatPos + 4 + idatLen));
        expect(rawScanlines.length).toBeGreaterThan(100);
    });

    it("尺寸参数影响输出大小（大图非更小）", async () => {
        const small = await generateQRDataUrl("hello", 128);
        const large = await generateQRDataUrl("hello", 512);
        expect(large.length).toBeGreaterThan(small.length);
    });
});

describe("qr.blockDeepLink", () => {
    it("生成思源块深链", () => {
        expect(blockDeepLink("20260101120000-abc1234")).toBe("siyuan://blocks/20260101120000-abc1234");
    });
});
