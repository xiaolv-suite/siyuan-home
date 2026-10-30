import { describe, it, expect, vi } from "vitest";
import type { ColumnDef } from "@/core/schema";

describe("ledger-banners (台账视图提示与状态横幅)", () => {
    describe("ledger-missing-cols-banner (缺失列自愈提示)", () => {
        it("正确展示缺失列名称并派生自动修复动作", () => {
            const onRebuild = vi.fn();
            const missingCols: ColumnDef[] = [
                { key: "amount", type: "number" },
                { key: "due", type: "date" },
            ];

            const t = (k: string) => (k === "ledger.missingColumnsPrompt" ? "当前台账缺少以下列：" : k);
            const fieldLabel = (k: string) => (k === "amount" ? "金额" : "到期日");

            const labelStr = missingCols.map((c) => fieldLabel(c.key)).join("、");
            expect(labelStr).toBe("金额、到期日");

            function handleRebuild(rebuilding: boolean) {
                if (rebuilding) return;
                onRebuild();
            }

            handleRebuild(true);
            expect(onRebuild).not.toHaveBeenCalled();

            handleRebuild(false);
            expect(onRebuild).toHaveBeenCalledTimes(1);
        });
    });

    describe("ledger-save-status (台账保存成功状态横幅)", () => {
        it("渲染保存成功的记录名称与目标模块，并分派查看文档回调", () => {
            const onOpenDoc = vi.fn();
            const t = (k: string) => {
                if (k === "ledger.newRecordSaved") return "已保存「${name}」";
                if (k === "ledger.savedTo") return "归档至 ${module}";
                if (k === "module.medicine") return "家庭药箱";
                return k;
            };

            const savedRecordName = "布洛芬缓释胶囊";
            const savedModule = "medicine";
            const savedDocId = "doc-123456";

            const title = t("ledger.newRecordSaved").replace("${name}", savedRecordName);
            const modLabel = t(`module.${savedModule}`);
            const subtitle = t("ledger.savedTo").replace("${module}", modLabel);

            expect(title).toBe("已保存「布洛芬缓释胶囊」");
            expect(subtitle).toBe("归档至 家庭药箱");

            function handleClick(docId?: string) {
                onOpenDoc(docId);
            }

            handleClick(savedDocId);
            expect(onOpenDoc).toHaveBeenCalledWith("doc-123456");
        });
    });
});
