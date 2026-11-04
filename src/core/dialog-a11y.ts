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
            triggerEl?.focus?.();
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

    dlg.element?.addEventListener?.("keydown", handleKeydown);
    if (typeof window !== "undefined") {
        window.addEventListener("keydown", handleKeydown, true);
    }

    const scheduleFocus = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 0);

    const normalizeButtons = () => {
        try {
            dlg.element?.querySelectorAll?.<HTMLButtonElement>("button:not([type])").forEach((btn) => {
                btn.type = "button";
            });
        } catch { /* soft */ }
    };
    normalizeButtons();

    const observer = typeof MutationObserver !== "undefined" && dlg.element instanceof Node
        ? new MutationObserver(() => normalizeButtons())
        : null;
    try {
        observer?.observe(dlg.element, { childList: true, subtree: true });
    } catch { /* soft */ }

    scheduleFocus(() => {
        try {
            normalizeButtons();
            if (defaultFocus) {
                const target = typeof defaultFocus === "string"
                    ? dlg.element?.querySelector?.<HTMLElement>(defaultFocus)
                    : defaultFocus;
                target?.focus?.();
            } else {
                const cancelBtn = dlg.element?.querySelector?.<HTMLElement>(".b3-button--cancel, #lv-detail-close, #lv-loc-close, #lv-favors-close, #lv-life-index-close, #lv-sub-stats-close, #lv-util-tiers-close, #lv-asset-val-close, #lv-store-close, #lv-mealplan-close, #lv-med-supply-close, #lv-em-close, #lv-member-timeline-close, #lv-rewards-close, #lv-sc-close");
                const fallback = dlg.element?.querySelector?.<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
                (cancelBtn ?? fallback)?.focus?.();
            }
        } catch { /* soft */ }
    });

    const originalDestroy = typeof dlg.destroy === "function" ? dlg.destroy.bind(dlg) : () => undefined;
    let destroyed = false;
    dlg.destroy = () => {
        if (destroyed) return;
        destroyed = true;
        observer?.disconnect();
        dlg.element?.removeEventListener?.("keydown", handleKeydown);
        if (typeof window !== "undefined") {
            window.removeEventListener("keydown", handleKeydown, true);
        }
        originalDestroy();
        onClose?.();
        restoreFocus();
    };

    return { restoreFocus, destroy: dlg.destroy };
}
