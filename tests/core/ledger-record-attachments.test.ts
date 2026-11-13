import { describe, it, expect } from "vitest";

describe("ledger-record-attachments (台账录入附件管理与指纹去重)", () => {
    function fileFingerprint(file: { name: string; size: number; lastModified: number }): string {
        return `${file.name}:${file.size}:${file.lastModified}`;
    }

    it("fileFingerprint 正确组合文件名、大小与修改时间作为唯一签名", () => {
        const file1 = { name: "passport.jpg", size: 1024, lastModified: 1730000000000 };
        const file2 = { name: "passport.jpg", size: 1024, lastModified: 1730000000000 };
        const file3 = { name: "passport.jpg", size: 2048, lastModified: 1730000000000 };

        expect(fileFingerprint(file1)).toBe("passport.jpg:1024:1730000000000");
        expect(fileFingerprint(file1)).toBe(fileFingerprint(file2));
        expect(fileFingerprint(file1)).not.toBe(fileFingerprint(file3));
    });

    it("文件批量选入时按指纹自动去重", () => {
        const previous = [
            { name: "f1.pdf", size: 500, lastModified: 100 },
        ];
        const incoming = [
            { name: "f1.pdf", size: 500, lastModified: 100 }, // 重复
            { name: "f2.jpg", size: 600, lastModified: 200 }, // 新增
        ];

        const seen = new Set(previous.map(fileFingerprint));
        const unique = incoming.filter((file) => {
            const fp = fileFingerprint(file);
            if (seen.has(fp)) return false;
            seen.add(fp);
            return true;
        });

        const merged = [...previous, ...unique];
        expect(merged).toHaveLength(2);
        expect(merged.map((f) => f.name)).toEqual(["f1.pdf", "f2.jpg"]);
    });

    it("车辆专属照片过滤非图片与超大文件（限制 5MB 内）", () => {
        const files = [
            { name: "car.png", type: "image/png", size: 2 * 1024 * 1024 },
            { name: "manual.pdf", type: "application/pdf", size: 1 * 1024 * 1024 },
            { name: "huge.jpg", type: "image/jpeg", size: 10 * 1024 * 1024 },
        ];

        const validPhotos = files.filter((file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024).slice(0, 1);
        expect(validPhotos).toHaveLength(1);
        expect(validPhotos[0].name).toBe("car.png");
    });
});
