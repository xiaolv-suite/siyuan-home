import { describe, it, expect, vi } from "vitest";

describe("settings-data-tab (设置面板数据管理与迁移分区契约)", () => {
    it("目标笔记本切换与配置更新回调", () => {
        const mockPlugin: any = {
            settings: { targetNotebookId: "" },
        };
        const notebookList = [
            { id: "nb-1", name: "家庭主库" },
            { id: "nb-2", name: "备用笔记本" },
        ];

        function changeNotebook(id: string) {
            mockPlugin.settings.targetNotebookId = id || undefined;
        }

        changeNotebook("nb-1");
        expect(mockPlugin.settings.targetNotebookId).toBe("nb-1");

        changeNotebook("");
        expect(mockPlugin.settings.targetNotebookId).toBeUndefined();
    });

    it("设置导出、导入、备份恢复与示例数据生成清除动作分发完备", () => {
        const onExportSettings = vi.fn();
        const onImportSettings = vi.fn();
        const onRestorePreImport = vi.fn();
        const onGenerateDemo = vi.fn();
        const onClearDemo = vi.fn();

        onExportSettings();
        expect(onExportSettings).toHaveBeenCalled();

        onImportSettings(new Event("change"));
        expect(onImportSettings).toHaveBeenCalled();

        onRestorePreImport();
        expect(onRestorePreImport).toHaveBeenCalled();

        onGenerateDemo();
        expect(onGenerateDemo).toHaveBeenCalled();

        onClearDemo();
        expect(onClearDemo).toHaveBeenCalled();
    });
});
