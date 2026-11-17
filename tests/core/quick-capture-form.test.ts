import { describe, it, expect, vi } from "vitest";
import { localDateKey } from "@/core/hub/rule";
import { smartExtractFieldsFromTitle } from "@/core/block-capture";

describe("quick-capture-form (快速记录表单字段区与预设交互)", () => {
    it("日期预设算法准确计算并输出 YYYY-MM-DD", () => {
        function computeDatePreset(daysAhead: number): string {
            const d = new Date("2026-10-29T10:00:00");
            d.setDate(d.getDate() + daysAhead);
            return localDateKey(d);
        }

        expect(computeDatePreset(0)).toBe("2026-10-29");
        expect(computeDatePreset(1)).toBe("2026-10-30");
        expect(computeDatePreset(7)).toBe("2026-11-05");
        expect(computeDatePreset(30)).toBe("2026-11-28");
        expect(computeDatePreset(365)).toBe("2027-10-29");
    });

    it("常见存放地点预设快速填充与清除错误", () => {
        const values: Record<string, any> = {};
        const fieldErrors: Record<string, string> = { location: "必填项" };
        const onClearFieldError = vi.fn((key: string) => {
            delete fieldErrors[key];
        });

        function applyLocationPreset(key: string, loc: string) {
            values[key] = loc;
            onClearFieldError(key);
        }

        applyLocationPreset("location", "客厅药箱");
        expect(values.location).toBe("客厅药箱");
        expect(onClearFieldError).toHaveBeenCalledWith("location");
        expect(fieldErrors.location).toBeUndefined();
    });

    it("标题失焦时智能分离名称与日期金额", () => {
        const values: Record<string, any> = { name: "体检套餐 2026-12-01 880元" };
        const captureFields = [
            { key: "name", type: "text" },
            { key: "due", type: "date" },
            { key: "amount", type: "number" },
        ];
        const onClearFieldError = vi.fn();

        function handleNameBlur() {
            if (!values.name || typeof values.name !== "string") return;
            const res = smartExtractFieldsFromTitle(values.name);
            if (res.cleanTitle !== values.name) {
                values.name = res.cleanTitle;
                const dateField = captureFields.find((f) => f.type === "date");
                if (dateField && res.extractedDate && !values[dateField.key]) {
                    values[dateField.key] = res.extractedDate;
                    onClearFieldError(dateField.key);
                }
                const numField = captureFields.find((f) => f.type === "number" && ["amount", "price", "cost"].includes(f.key));
                if (numField && res.extractedAmount !== undefined && !values[numField.key]) {
                    values[numField.key] = res.extractedAmount;
                    onClearFieldError(numField.key);
                }
            }
        }

        handleNameBlur();
        expect(values.name).toBe("体检套餐");
        expect(values.due).toBe("2026-12-01");
        expect(values.amount).toBe(880);
        expect(onClearFieldError).toHaveBeenCalledWith("due");
        expect(onClearFieldError).toHaveBeenCalledWith("amount");
    });

    it("表单已填充字段统计计算准确", () => {
        const captureFields = [
            { key: "name", type: "text" },
            { key: "member", type: "relation" },
            { key: "date", type: "date" },
            { key: "note", type: "text" },
        ];
        const values: Record<string, any> = {
            name: "处方药",
            member: "av-item-1",
            date: "",
            note: undefined,
        };

        const filledCount = captureFields.filter((field) => {
            const value = values[field.key];
            return value !== undefined && value !== null && value !== "" && value !== false;
        }).length;

        expect(filledCount).toBe(2);
    });
});
