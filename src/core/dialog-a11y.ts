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
            // 自动绑定所有取消/关闭按钮，杜绝无点击行为的假关闭钮
            const cancels = dlg.element?.querySelectorAll?.<HTMLButtonElement>(
                ".b3-button--cancel, [data-type='cancel'], [data-role='close'], .lv-modal-close"
            );
            cancels?.forEach((btn) => {
                if (!btn.getAttribute("data-lv-close-bound")) {
                    btn.setAttribute("data-lv-close-bound", "1");
                    btn.addEventListener("click", () => dlg.destroy());
                }
            });

            // 顶栏 44x44 关闭按钮与移动端 Esc-only 强制关闭面保障（真机教训：手机无 Esc 键且思源 Dialog 默认无关闭叉号或过小）
            if (typeof document !== "undefined" && dlg.element && typeof document.createElement === "function") {
                const header = dlg.element.querySelector?.(".b3-dialog__header");
                const existingHeaderClose = header?.querySelector?.(".lv-dialog-mobile-close-btn, .b3-dialog__close, .lv-modal-close")
                    || dlg.element.querySelector?.(".b3-dialog__close");
                if (header && !existingHeaderClose) {
                    const closeBtn = document.createElement("button");
                    closeBtn.type = "button";
                    closeBtn.className = "lv-dialog-mobile-close-btn";
                    closeBtn.setAttribute("aria-label", "关闭");
                    closeBtn.setAttribute("title", "关闭");
                    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
                    closeBtn.onclick = () => dlg.destroy();
                    header.appendChild(closeBtn);
                } else {
                    const isMobile = Boolean(
                        (window as any)?.siyuan?.config?.system?.isMobile ||
                        document.body?.classList?.contains?.("body--mobile") ||
                        (typeof window !== "undefined" && window.innerWidth <= 640)
                    );
                    if (isMobile) {
                        const hasClose = dlg.element.querySelector(
                            ".b3-button--cancel, [data-type='cancel'], .lv-modal-close, .lv-mobile-close, .lv-dialog-mobile-close-btn, [aria-label*='关闭'], [aria-label*='close']"
                        );
                        if (!hasClose) {
                            const container = dlg.element.querySelector(".b3-dialog__container") || dlg.element;
                            const closeBtn = document.createElement("button");
                            closeBtn.type = "button";
                            closeBtn.className = "lv-dialog-mobile-close-btn";
                            closeBtn.setAttribute("aria-label", "关闭");
                            closeBtn.setAttribute("title", "关闭");
                            closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
                            closeBtn.onclick = () => dlg.destroy();
                            container.appendChild?.(closeBtn);
                        }
                    }
                }
            }
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
