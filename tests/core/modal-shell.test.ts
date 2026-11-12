import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReadTracker, escapeHtml, modalWarningHtml } from "@/core/modal-shell";

describe("modal-shell 弹窗底座与跨库读取诚实度", () => {
    it("escapeHtml 转义全部 5 类 HTML 敏感字符", () => {
        expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
            "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
        );
    });

    it("modalWarningHtml 空列表返回空串，非空列表渲染 role=alert 警告框并转义", () => {
        expect(modalWarningHtml([])).toBe("");
        const html = modalWarningHtml(["台账 <health> 未读完整"]);
        expect(html).toContain('role="alert"');
        expect(html).toContain("&lt;health&gt;");
    });

    it("createReadTracker 准确收集抛错与 !complete 的模块", async () => {
        const tracker = createReadTracker();
        const ok = await tracker.read("certs", async () => ({ complete: true, rows: [1] }));
        const partial = await tracker.read("stock", async () => ({ complete: false, rows: [2] }));
        const boom = await tracker.read("health", async () => {
            throw new Error("timeout");
        });
        expect(ok?.rows).toEqual([1]);
        expect(partial?.rows).toEqual([2]);
        expect(boom).toBeUndefined();
        expect(tracker.failed).toEqual(["stock", "health"]);
    });

    it("静态契约：src/core 下全部 new DialogCls 弹窗 100% 接入 bindDialogA11y 或 openModalShell", () => {
        const coreDir = path.resolve(__dirname, "../../src/core");
        const missing: string[] = [];
        for (const entry of fs.readdirSync(coreDir)) {
            if (!entry.endsWith(".ts") || entry === "mobile-controller.ts") continue;
            const src = fs.readFileSync(path.join(coreDir, entry), "utf8");
            const dialogCount = (src.match(/new (?:opts\.)?DialogCls\(/g) ?? []).length;
            const a11yCount = (src.match(/bindDialogA11y\(/g) ?? []).length;
            if (dialogCount > 0 && dialogCount !== a11yCount) {
                missing.push(`${entry} (DialogCls=${dialogCount}, bindDialogA11y=${a11yCount})`);
            }
        }
        expect(missing).toEqual([]);
    });
});
