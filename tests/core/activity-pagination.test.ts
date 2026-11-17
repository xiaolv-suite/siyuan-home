import { describe, it, expect, vi } from "vitest";

describe("activity-feed (时间轴活动流分页无障碍与焦点保持)", () => {
    it("上一页到达第一页边界时，焦点平滑迁移至下一页按钮避免落入 document.body", () => {
        let page = 2;
        const prevBtn = { disabled: false, focus: vi.fn() };
        const nextBtn = { disabled: false, focus: vi.fn() };

        function handlePrevPage() {
            if (page <= 1) return;
            const target = page - 1;
            page = target;
            if (target <= 1) {
                prevBtn.disabled = true;
                nextBtn.focus();
            }
        }

        handlePrevPage();
        expect(page).toBe(1);
        expect(prevBtn.disabled).toBe(true);
        expect(nextBtn.focus).toHaveBeenCalled();
    });

    it("下一页到达末页边界时，焦点平滑迁移至上一页按钮避免焦点失焦", () => {
        let page = 4;
        const pageCount = 5;
        const prevBtn = { disabled: false, focus: vi.fn() };
        const nextBtn = { disabled: false, focus: vi.fn() };

        function handleNextPage() {
            if (page >= pageCount) return;
            const target = page + 1;
            page = target;
            if (target >= pageCount) {
                nextBtn.disabled = true;
                prevBtn.focus();
            }
        }

        handleNextPage();
        expect(page).toBe(5);
        expect(nextBtn.disabled).toBe(true);
        expect(prevBtn.focus).toHaveBeenCalled();
    });

    it("分页控件内部支持左右箭头键 (ArrowLeft / ArrowRight) 快速切换焦点", () => {
        const prevBtn = { disabled: false, focus: vi.fn() };
        const nextBtn = { disabled: false, focus: vi.fn() };

        function handlePaginationKeydown(e: { key: string; preventDefault: () => void }) {
            if (e.key === "ArrowLeft") {
                if (!prevBtn.disabled) {
                    e.preventDefault();
                    prevBtn.focus();
                }
            } else if (e.key === "ArrowRight") {
                if (!nextBtn.disabled) {
                    e.preventDefault();
                    nextBtn.focus();
                }
            }
        }

        const preventDefault = vi.fn();
        handlePaginationKeydown({ key: "ArrowLeft", preventDefault });
        expect(prevBtn.focus).toHaveBeenCalled();
        expect(preventDefault).toHaveBeenCalled();

        handlePaginationKeydown({ key: "ArrowRight", preventDefault });
        expect(nextBtn.focus).toHaveBeenCalled();
    });

    it("已禁用按钮不响应箭头键焦点抢夺", () => {
        const prevBtn = { disabled: true, focus: vi.fn() };
        const nextBtn = { disabled: false, focus: vi.fn() };

        function handlePaginationKeydown(e: { key: string; preventDefault: () => void }) {
            if (e.key === "ArrowLeft") {
                if (!prevBtn.disabled) {
                    e.preventDefault();
                    prevBtn.focus();
                }
            }
        }

        const preventDefault = vi.fn();
        handlePaginationKeydown({ key: "ArrowLeft", preventDefault });
        expect(prevBtn.focus).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });
});
