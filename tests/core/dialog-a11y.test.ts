import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bindDialogA11y } from "@/core/dialog-a11y";

describe("core/dialog-a11y 模态弹窗无障碍焦点与按键管理", () => {
    let originalDoc: any;

    beforeEach(() => {
        originalDoc = (globalThis as any).document;
    });

    afterEach(() => {
        (globalThis as any).document = originalDoc;
    });

    it("弹窗销毁时自动将焦点恢复至触发元素", () => {
        let activeEl: any = null;
        const trigger = {
            focus: vi.fn(() => { activeEl = trigger; }),
        };
        activeEl = trigger;

        const cancelBtn = {
            className: "b3-button--cancel",
            focus: vi.fn(() => { activeEl = cancelBtn; }),
            offsetWidth: 100,
            offsetHeight: 30,
        };

        const listeners: Record<string, ((e: any) => void)[]> = {};
        const element = {
            addEventListener: vi.fn((event: string, fn: (e: any) => void) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(fn);
            }),
            removeEventListener: vi.fn((event: string, fn: (e: any) => void) => {
                if (listeners[event]) listeners[event] = listeners[event].filter((f) => f !== fn);
            }),
            querySelector: vi.fn((selector: string) => {
                if (selector.includes("b3-button--cancel")) return cancelBtn;
                return null;
            }),
            querySelectorAll: vi.fn(() => [cancelBtn]),
        };

        (globalThis as any).document = {
            get activeElement() { return activeEl; },
        };

        const originalDestroy = vi.fn();
        const dlg = { element: element as any, destroy: originalDestroy };

        const { restoreFocus } = bindDialogA11y({ dlg });
        cancelBtn.focus();
        expect(activeEl).toBe(cancelBtn);

        dlg.destroy();
        expect(originalDestroy).toHaveBeenCalledTimes(1);
        expect(trigger.focus).toHaveBeenCalledTimes(1);
        expect(activeEl).toBe(trigger);
    });

    it("按下 Escape 键阻断事件并调用 destroy 关闭弹窗", () => {
        const listeners: Record<string, ((e: any) => void)[]> = {};
        const element = {
            addEventListener: vi.fn((event: string, fn: (e: any) => void) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(fn);
            }),
            removeEventListener: vi.fn((event: string, fn: (e: any) => void) => {
                if (listeners[event]) listeners[event] = listeners[event].filter((f) => f !== fn);
            }),
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        };

        (globalThis as any).document = { activeElement: null };

        const originalDestroy = vi.fn();
        const onClose = vi.fn();
        const dlg = { element: element as any, destroy: originalDestroy };

        bindDialogA11y({ dlg, onClose });

        const event = {
            key: "Escape",
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
        };

        for (const handler of listeners["keydown"] || []) {
            handler(event);
        }

        expect(event.stopPropagation).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(originalDestroy).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("键盘 Tab 键循环困在弹窗内首末焦点之间 (Focus Trap)", () => {
        let activeEl: any = null;
        const firstBtn = {
            focus: vi.fn(() => { activeEl = firstBtn; }),
            offsetWidth: 80,
            offsetHeight: 32,
        };
        const lastBtn = {
            focus: vi.fn(() => { activeEl = lastBtn; }),
            offsetWidth: 80,
            offsetHeight: 32,
        };

        const listeners: Record<string, ((e: any) => void)[]> = {};
        const element = {
            addEventListener: vi.fn((event: string, fn: (e: any) => void) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(fn);
            }),
            removeEventListener: vi.fn(),
            querySelector: vi.fn(() => firstBtn),
            querySelectorAll: vi.fn(() => [firstBtn, lastBtn]),
        };

        (globalThis as any).document = {
            get activeElement() { return activeEl; },
        };

        const dlg = { element: element as any, destroy: vi.fn() };
        bindDialogA11y({ dlg, trapFocus: true });

        // 末尾元素按下 Tab -> 循环回首个元素
        lastBtn.focus();
        const tabEvent = {
            key: "Tab",
            shiftKey: false,
            preventDefault: vi.fn(),
        };
        for (const handler of listeners["keydown"] || []) {
            handler(tabEvent);
        }
        expect(tabEvent.preventDefault).toHaveBeenCalled();
        expect(firstBtn.focus).toHaveBeenCalled();
        expect(activeEl).toBe(firstBtn);

        // 首个元素按下 Shift+Tab -> 倒退回末尾元素
        firstBtn.focus();
        const shiftTabEvent = {
            key: "Tab",
            shiftKey: true,
            preventDefault: vi.fn(),
        };
        for (const handler of listeners["keydown"] || []) {
            handler(shiftTabEvent);
        }
        expect(shiftTabEvent.preventDefault).toHaveBeenCalled();
        expect(lastBtn.focus).toHaveBeenCalled();
        expect(activeEl).toBe(lastBtn);
    });

    it("支持通过字符串选择器或直接节点聚焦 defaultFocus，缺省自动落焦取消按钮", async () => {
        const inputEl = { focus: vi.fn(), offsetWidth: 100, offsetHeight: 30 };
        const cancelBtn = { focus: vi.fn(), offsetWidth: 80, offsetHeight: 30 };

        const element = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelector: vi.fn((sel: string) => {
                if (sel === "#my-input") return inputEl;
                if (sel.includes("b3-button--cancel")) return cancelBtn;
                return null;
            }),
            querySelectorAll: vi.fn(() => [inputEl, cancelBtn]),
        };

        const dlg = { element: element as any, destroy: vi.fn() };
        bindDialogA11y({ dlg, defaultFocus: "#my-input" });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(inputEl.focus).toHaveBeenCalledTimes(1);

        const dlg2 = { element: element as any, destroy: vi.fn() };
        bindDialogA11y({ dlg: dlg2 });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(cancelBtn.focus).toHaveBeenCalledTimes(1);
    });
});
