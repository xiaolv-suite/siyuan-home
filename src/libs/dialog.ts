/*
 * Copyright (c) 2024 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @FilePath     : /src/libs/dialog.ts
 * @Description  : Dialog kits（204 波循环 A 清除死导出：inputDialog/inputDialogSync/
 *                 confirmDialog/confirmDialogSync 零调用移除——仅保留在用的
 *                 simpleDialog + svelteDialog；确认类交互统一走 siyuan confirm()）
 */
import { Dialog, confirm as siyuanConfirm } from "siyuan";
import { Component, mount, unmount } from "svelte";
import { lvSurfaceStack } from "./lv-notice-kit";

/**
 * 具有最高堆叠层级的确认弹窗，彻底杜绝被前置抽屉或已有模态框遮挡在后面。
 */
export const confirm = (
    title: string,
    text: string,
    confirmCallback?: () => void,
    cancelCallback?: () => void,
) => {
    siyuanConfirm(title, text, confirmCallback, cancelCallback);
    // 立即提升最新弹出的确认对话框至最高层级，杜绝层级倒挂
    if (typeof requestAnimationFrame === "function" && typeof document !== "undefined") {
        requestAnimationFrame(() => {
            const dialogs = document.querySelectorAll<HTMLElement>(".b3-dialog");
            if (dialogs.length > 0) {
                const top = dialogs[dialogs.length - 1];
                top.classList.add("lv-top-confirm");
                top.style.setProperty("z-index", "2000", "important");
                const cancelBtn = top.querySelector<HTMLButtonElement>(".b3-button--cancel");
                cancelBtn?.focus();
            }
        });
    }
};

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    width?: string, height?: string,
    callback?: () => void;
}) => {
    let closed = false;
    const surfaceId = `dialog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const popSurface = lvSurfaceStack.push({
        id: surfaceId,
        type: "dialog",
        dismiss: () => {
            if (closed) return false;
            closed = true;
            dialog.destroy();
            return true;
        },
    });

    /** 移动端软键盘视口守卫：键盘弹起时同步 --lv-vv-h 并标记 lv-keyboard-open，
     *  供 CSS 将弹窗高度收缩到可视区，保证焦点输入框始终可见。 */
    let vvCleanup: (() => void) | undefined;
    const bindKeyboardViewport = (target: HTMLElement | null | undefined) => {
        if (!target || typeof window === "undefined" || !window.visualViewport) return;
        const vv = window.visualViewport;
        let baseHeight = Math.max(window.innerHeight || 0, Math.round(vv.height || 0));
        const sync = () => {
            if (!target.isConnected) return;
            const currentInner = window.innerHeight || 0;
            const currentH = Math.round(vv.height || currentInner);
            if (currentH > baseHeight) baseHeight = currentH;
            target.style.setProperty("--lv-vv-h", `${currentH}px`);
            const keyboardOpen = Math.max(baseHeight, currentInner) - currentH > 110;
            target.classList.toggle("lv-keyboard-open", keyboardOpen);
        };
        sync();
        vv.addEventListener("resize", sync);
        vv.addEventListener("scroll", sync, { passive: true });
        window.addEventListener("resize", sync, { passive: true });
        vvCleanup = () => {
            vv.removeEventListener("resize", sync);
            vv.removeEventListener("scroll", sync);
            window.removeEventListener("resize", sync);
        };
    };

    const dialog = new Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; flex-direction: column; align-items: stretch; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box;"/>`,
        width: args.width,
        height: args.height,
        destroyCallback: () => {
            if (!closed) {
                closed = true;
                popSurface();
            }
            vvCleanup?.();
            vvCleanup = undefined;
            args.callback?.();
        }
    });
    // 点击遮罩背景快速关闭
    dialog.element.addEventListener("click", (e) => {
        if (e.target === dialog.element || (e.target as HTMLElement).classList?.contains("b3-dialog__scrim")) {
            if (!closed) {
                closed = true;
                popSurface();
                dialog.destroy();
            }
        }
    });
    dialog.element.querySelector(".dialog-content").appendChild(args.ele);
    const closeDialog = () => {
        if (!closed) {
            closed = true;
            popSurface();
            dialog.destroy();
        }
    };
    try {
        dialog.element?.classList?.add?.("lv-home-dialog");
        dialog.element?.querySelector?.(".b3-dialog")?.classList?.add?.("lv-home-dialog");
        // 移动端软键盘视口守卫：挂在弹窗根节点上，CSS 按 --lv-vv-h 收缩高度
        bindKeyboardViewport(dialog.element);
        const outerClose = dialog.element?.querySelector?.(".b3-dialog__container > .b3-dialog__close") as HTMLElement | SVGElement | null;
        if (outerClose && outerClose.style) {
            outerClose.style.setProperty("display", "none", "important");
        }
        const header = dialog.element?.querySelector?.(".b3-dialog__header");
        const existingClose = header?.querySelector?.(".lv-dialog-mobile-close-btn, .b3-dialog__close");
        if (header && !existingClose && typeof document !== "undefined" && typeof document.createElement === "function") {
            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "lv-dialog-mobile-close-btn";
            closeBtn.setAttribute("aria-label", "关闭");
            closeBtn.setAttribute("title", "关闭");
            closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
            closeBtn.onclick = closeDialog;
            header.appendChild(closeBtn);
        }
    } catch { /* soft */ }
    return {
        dialog,
        close: closeDialog
    };
}

export const svelteDialog = (args: {
    title: string,
    component: Component<any>, // Svelte 5 component constructor
    props?: Record<string, any>,
    width?: string,
    height?: string,
    callback?: () => void;
}) => {
    let container = document.createElement('div')
    container.style.display = 'contents';
    let closeRef: () => void = () => {};

    // 内部处理 mount
    let componentInstance = mount(args.component, {
        target: container,
        props: { ...(args.props || {}), onClose: () => closeRef() }
    });

    const { dialog, close } = simpleDialog({
        ...args,
        ele: container,
        callback: () => {
            // 内部处理 unmount
            unmount(componentInstance);
            if (args.callback) args.callback();
        }
    });
    closeRef = close;

    return {
        component: componentInstance,
        dialog,
        close
    }
}
