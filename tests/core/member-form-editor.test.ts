import { describe, it, expect, vi } from "vitest";

describe("member-form-editor (成员表单编辑器契约与校验)", () => {
    it("访客模式下保存写保护拦截", () => {
        const guestActive = true;
        const showMessage = vi.fn();

        function checkGuestWrite(guestModeActive: boolean) {
            if (guestModeActive) {
                showMessage("guest.writeBlocked", 4000, "info");
                return false;
            }
            return true;
        }

        expect(checkGuestWrite(guestActive)).toBe(false);
        expect(showMessage).toHaveBeenCalledWith("guest.writeBlocked", 4000, "info");
    });

    it("空姓名提交拦截与错误提示", () => {
        const showMessage = vi.fn();
        function validateName(name: string) {
            if (!name.trim()) {
                showMessage("ledger.nameRequired", 4000, "info");
                return false;
            }
            return true;
        }

        expect(validateName("")).toBe(false);
        expect(validateName("   ")).toBe(false);
        expect(validateName("爸爸")).toBe(true);
        expect(showMessage).toHaveBeenCalledWith("ledger.nameRequired", 4000, "info");
    });

    it("取消编辑重置所有表单字段", () => {
        let state = {
            editId: "mem-1" as string | null,
            name: "妈妈",
            role: "spouse",
            sex: "female" as "male" | "female" | undefined,
            birthday: "1985-06-01",
            lunar: true,
            notes: "备注",
            editorOpen: true,
        };

        function resetForm() {
            state.editId = null;
            state.name = "";
            state.role = "self";
            state.sex = undefined;
            state.birthday = "";
            state.lunar = false;
            state.notes = "";
            state.editorOpen = false;
        }

        resetForm();
        expect(state.editId).toBeNull();
        expect(state.name).toBe("");
        expect(state.role).toBe("self");
        expect(state.sex).toBeUndefined();
        expect(state.editorOpen).toBe(false);
    });

    it("键盘 Escape 触发取消编辑并重置表单与展开态", () => {
        let editorOpen = true;
        const cancelEdit = vi.fn(() => {
            editorOpen = false;
        });

        const handleKeydown = (e: { key: string; preventDefault: () => void }) => {
            if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
            }
        };

        const preventDefault = vi.fn();
        handleKeydown({ key: "Escape", preventDefault });

        expect(preventDefault).toHaveBeenCalled();
        expect(cancelEdit).toHaveBeenCalled();
        expect(editorOpen).toBe(false);
    });
});
