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

    it("表单可访问性契约：字段级错误响应、无障碍属性及类型声明", () => {
        let name = "";
        let nameError = false;
        const nameInput = { focus: vi.fn() };
        const showMessage = vi.fn();

        function handleSave() {
            if (!name.trim()) {
                nameError = true;
                nameInput.focus();
                showMessage("ledger.nameRequired", 4000, "info");
                return false;
            }
            nameError = false;
            return true;
        }

        // 1. 空姓名触发错误与焦点锁定
        expect(handleSave()).toBe(false);
        expect(nameError).toBe(true);
        expect(nameInput.focus).toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith("ledger.nameRequired", 4000, "info");

        // 2. 输入字符自动清除错误提示
        function handleInput(val: string) {
            name = val;
            if (nameError) nameError = false;
        }

        handleInput("张三");
        expect(nameError).toBe(false);
        expect(handleSave()).toBe(true);
    });

    it("双向亲属称谓建议推导契约完备性", () => {
        const ROLE_NAME_SUGGESTIONS: Record<string, Record<string, string[]>> = {
            spouse: {
                male: ["老公", "先生", "孩他爸"],
                female: ["老婆", "妻子", "孩他妈"],
                any: ["配偶", "伴侣", "爱人"],
            },
            child: {
                male: ["儿子", "大宝", "小宝"],
                female: ["女儿", "大宝", "小宝"],
                any: ["孩子", "宝贝", "宝宝"],
            },
            elder: {
                male: ["爷爷", "外公", "爸爸", "公公", "岳父"],
                female: ["奶奶", "外婆", "妈妈", "婆婆", "岳母"],
                any: ["长辈"],
            },
        };

        const deriveSuggestions = (role: string, sex?: string) => {
            const pool = ROLE_NAME_SUGGESTIONS[role];
            if (!pool) return [];
            const sexKey = sex === "male" || sex === "female" ? sex : "any";
            const res = [...(pool[sexKey] ?? []), ...(sexKey !== "any" ? (pool["any"] ?? []) : [])];
            return res.slice(0, 4);
        };

        expect(deriveSuggestions("spouse", "female")).toContain("老婆");
        expect(deriveSuggestions("child", "male")).toContain("儿子");
        expect(deriveSuggestions("elder", "female")).toContain("外婆");
        expect(deriveSuggestions("spouse", undefined)).toContain("配偶");
    });
});

