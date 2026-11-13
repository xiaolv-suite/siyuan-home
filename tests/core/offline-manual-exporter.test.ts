import { describe, it, expect } from "vitest";
import { generateOfflineHtmlManual } from "@/core/offline-manual-exporter";

describe("offline-manual-exporter (POOL-FEAT-09: 离线静态 HTML 全景手册导出器)", () => {
    const mockData = {
        title: "小驴管家 · 家庭全景离线速查手册",
        generatedAt: "2026-11-01 12:00:00",
        version: "0.5.191",
        members: [
            { id: "m-1", name: "张三 & 李四", role: "self" as const, sex: "male" as const, birthday: "1988-08-08", notes: "一家之主 <安全备忘>" },
            { id: "m-2", name: "王五", role: "spouse" as const, sex: "female" as const, birthday: "1990-05-05", lunarBirthday: true },
        ],
        reminders: [
            { id: "r-1", moduleId: "house", ruleKey: "rent", rowId: "b-1", title: "交房租 & 水电", dueDate: "2026-11-05", daysLeft: 4, level: "soon" as const, priority: "high" as const },
            { id: "r-2", moduleId: "vehicles", ruleKey: "insurance", rowId: "b-2", title: "车险续保", dueDate: "2026-10-25", daysLeft: -7, level: "overdue" as const },
        ],
        enabledModules: ["members", "house", "vehicles", "certs"],
        t: (k: string) => k,
    };

    it("生成完整离线 HTML 文档且包含合法 DOCTYPE 与 UTF-8 声明", () => {
        const html = generateOfflineHtmlManual(mockData);
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain('<meta charset="utf-8">');
        expect(html).toContain("小驴管家 · 家庭全景离线速查手册");
    });

    it("零外部外链铁律：不引用任何外部 http/https 脚本、样式或字体", () => {
        const html = generateOfflineHtmlManual(mockData);
        // 不含 http/https 外链
        expect(html).not.toMatch(/href=["']https?:\/\//i);
        expect(html).not.toMatch(/src=["']https?:\/\//i);
        expect(html).not.toMatch(/@import\s+url\(["']https?:\/\//i);
    });

    it("用户数据安全转义：对 HTML 特殊字符进行严格转义（杜绝 XSS 风险）", () => {
        const html = generateOfflineHtmlManual(mockData);
        expect(html).toContain("张三 &amp; 李四");
        expect(html).toContain("&lt;安全备忘&gt;");
        expect(html).not.toContain("<安全备忘>");
    });

    it("包含家庭成员档案与待办事项明细", () => {
        const html = generateOfflineHtmlManual(mockData);
        expect(html).toContain("交房租 &amp; 水电");
        expect(html).toContain("车险续保");
        expect(html).toContain("逾期 7 天");
        expect(html).toContain("4 天后");
        expect(html).toContain("🌙 农历");
    });

    it("具备快捷打印按钮与打印样式自适应", () => {
        const html = generateOfflineHtmlManual(mockData);
        expect(html).toContain("window.print()");
        expect(html).toContain("@media print");
    });
});
