/**
 * 模态对话框无障碍增强辅助工具（WCAG 2.2 AA / APG Modal Dialog 模式）
 * 1. 记忆触发元素并在弹窗销毁后恢复焦点
 * 2. 默认聚焦非破坏操作（取消按钮）或指定输入框
 * 3. 独立捕获 Escape 按键阻断式关闭弹窗
 * 4. 键盘 Tab / Shift+Tab 焦点环（Focus Trap），防止焦点泄露到底层界面
 */

export interface DialogA11yOptions {
    dlg: { element: HTMLElement; destroy: () => void };
    defaultFocus?: HTMLElement | string | null;
    onClose?: () => void;
    trapFocus?: boolean;
}

export function bindDialogA11y(options: DialogA11yOptions): { restoreFocus: () => void; destroy: () => void } {
    const { dlg, defaultFocus, onClose, trapFocus = true } = options;
    const triggerEl = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;

    const restoreFocus = () => {
        try {
            triggerEl?.focus();
        } catch { /* soft */ }
    };

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dlg.destroy();
            return;
        }

        if (trapFocus && e.key === "Tab") {
            const focusables = Array.from(
                dlg.element.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
            ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

            if (focusables.length > 0) {
                const first = focusables[0];
                const last = focusables[focusables.length - 1];

                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    };

    dlg.element.addEventListener("keydown", handleKeydown);

    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            if (defaultFocus) {
                const target = typeof defaultFocus === "string"
                    ? dlg.element.querySelector<HTMLElement>(defaultFocus)
                    : defaultFocus;
                target?.focus();
            } else {
                const cancelBtn = dlg.element.querySelector<HTMLElement>(".b3-button--cancel, #lv-detail-close, #lv-loc-close, #lv-favors-close, #lv-life-index-close");
                cancelBtn?.focus();
            }
        });
    }

    const originalDestroy = dlg.destroy.bind(dlg);
    let destroyed = false;
    dlg.destroy = () => {
        if (destroyed) return;
        destroyed = true;
        dlg.element.removeEventListener("keydown", handleKeydown);
        originalDestroy();
        onClose?.();
        restoreFocus();
    };

    return { restoreFocus, destroy: dlg.destroy };
}
