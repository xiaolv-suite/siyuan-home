import { Dialog } from "siyuan";
import { mount, unmount } from "svelte";
import { lvLaunchpad } from "@/libs/notice";

export interface MobileControllerOptions {
    plugin: any;
    t: (k: string) => string;
    isMobileFrontend?: boolean;
    scheduleTimeout?: (fn: () => void, ms: number) => number;
}

export interface MobileController {
    /** 打开手机端全屏 TabPanel 宿主 */
    openMobilePanel(targetScreen?: string): void;
    /** 关闭手机端面板 */
    closeMobilePanel(): void;
    /** 检查手机端面板是否当前已打开 */
    isOpen(): boolean;
    /** 卸载清理 */
    dispose(): void;
    /** 兼容旧接口（自建顶栏已由生态规范统一收口至 lvLaunchpad.ensureMobileEntry，此处为 no-op） */
    ensureMobileTopBarButton?: () => void;
}

export function createMobileController(options: MobileControllerOptions): MobileController {
    const { plugin, t } = options;

    let mobileDialog: Dialog | undefined;
    let mobileDialogUnmount: (() => void) | undefined;
    let mobileViewportCleanup: (() => void) | undefined;
    let isDisposed = false;

    const closeMobilePanel = (): void => {
        if (mobileViewportCleanup) {
            try {
                mobileViewportCleanup();
            } catch {
                /* soft cleanup */
            }
            mobileViewportCleanup = undefined;
        }
        if (mobileDialogUnmount) {
            try {
                mobileDialogUnmount();
            } catch {
                /* soft cleanup */
            }
            mobileDialogUnmount = undefined;
        }
        if (mobileDialog) {
            try {
                mobileDialog.destroy();
            } catch {
                /* soft cleanup */
            }
            mobileDialog = undefined;
        }
    };

    const openMobilePanel = (targetScreen?: string): void => {
        if (targetScreen) {
            plugin.pendingScreen = targetScreen;
            if (plugin.panelScreenSwitch) {
                plugin.panelScreenSwitch(targetScreen);
            }
        }
        if (typeof document === "undefined" || isDisposed) return;
        if (mobileDialog) {
            if (mobileDialog.element && mobileDialog.element.isConnected === false) {
                closeMobilePanel();
            } else {
                // 宿主已打开时直接切屏聚焦，不重复弹层
                return;
            }
        }

        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }

        const dialog = new Dialog({
            title: t("butler"),
            content: `<div class="lv-mobile-host" data-testid="lv-mobile-host"></div>`,
            width: "100vw",
            height: "100dvh",
            destroyCallback: () => {
                if (mobileViewportCleanup) {
                    try {
                        mobileViewportCleanup();
                    } catch {
                        /* 已清理 */
                    }
                    mobileViewportCleanup = undefined;
                }
                if (mobileDialogUnmount) {
                    try {
                        mobileDialogUnmount();
                    } catch {
                        /* 已卸载 */
                    }
                    mobileDialogUnmount = undefined;
                }
                if (mobileDialog === dialog) mobileDialog = undefined;
            },
        });

        const host = dialog.element?.querySelector?.(".lv-mobile-host") as HTMLElement | undefined;
        if (!host) {
            dialog.destroy?.();
            return;
        }

        dialog.element.classList.add("b3-dialog--lvmobile");
        dialog.element.querySelector?.(".b3-dialog")?.classList.add("b3-dialog--lvmobile");

        // visualViewport 动态高度与软键盘自适应监听
        if (typeof window !== "undefined") {
            let baseHeight = Math.max(window.innerHeight || 0, window.visualViewport?.height || 0);
            const syncViewport = () => {
                const vv = window.visualViewport;
                const currentH = Math.round(vv ? vv.height : (window.innerHeight || 0));
                if (currentH > baseHeight) {
                    baseHeight = currentH;
                }
                if (currentH > 0) {
                    dialog.element.style.setProperty("--lv-vv-h", `${currentH}px`);
                    host.style.setProperty("--lv-vv-h", `${currentH}px`);
                }
                const refHeight = Math.max(baseHeight, window.innerHeight || 0);
                const keyboardOpen = refHeight > 0 && refHeight - currentH > 110;
                if (keyboardOpen) {
                    dialog.element.setAttribute("data-keyboard-open", "true");
                    host.setAttribute("data-keyboard-open", "true");
                } else {
                    dialog.element.removeAttribute("data-keyboard-open");
                    host.removeAttribute("data-keyboard-open");
                }
            };

            syncViewport();
            const vv = window.visualViewport;
            vv?.addEventListener("resize", syncViewport);
            vv?.addEventListener("scroll", syncViewport, { passive: true });
            window.addEventListener("resize", syncViewport, { passive: true });
            mobileViewportCleanup = () => {
                vv?.removeEventListener("resize", syncViewport);
                vv?.removeEventListener("scroll", syncViewport);
                window.removeEventListener("resize", syncViewport);
            };
        }

        // 下滑手势关闭支持（Mobile Spec v1 统一手势规范：仅限顶栏/把手区下拉，严防输入与内容滚动误触）
        let touchStartY = 0;
        let touchStartX = 0;
        let isSwipingDown = false;
        let isValidHeaderStart = false;

        const isInputInteracting = (target: EventTarget | null): boolean => {
            if (dialog.element.getAttribute("data-keyboard-open") === "true") return true;
            if (typeof document !== "undefined" && document.activeElement) {
                const tag = document.activeElement.tagName?.toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select" || document.activeElement.getAttribute("contenteditable") === "true") {
                    return true;
                }
            }
            if (target instanceof HTMLElement) {
                if (target.closest("input, textarea, select, [contenteditable='true'], .lv-modal, .lv-sheet, .lv-drawer, .lv-record-modal, .b3-dialog, form")) {
                    return true;
                }
            }
            return false;
        };

        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            touchStartY = touch.clientY;
            touchStartX = touch.clientX;
            isSwipingDown = false;

            // 守卫 1：表单输入、软键盘弹起或在次级弹窗内，绝对严禁启动整页关闭手势
            if (isInputInteracting(e.target)) {
                isValidHeaderStart = false;
                return;
            }

            // 守卫 2：手势必须起始于顶栏/把手操作区（.b3-dialog__header, .lv-header, .lv-mobile-topbar, .lv-sheet-handle），杜绝内容列表滚动误判
            const targetEl = e.target as HTMLElement | null;
            isValidHeaderStart = Boolean(targetEl?.closest?.(".b3-dialog__header, .lv-header, .lv-mobile-topbar, .lv-sheet-handle, .lv-tab-header"));
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!isValidHeaderStart) return;
            const touch = e.touches[0];
            if (!touch) return;
            if (isInputInteracting(e.target)) {
                isValidHeaderStart = false;
                isSwipingDown = false;
                return;
            }
            const deltaY = touch.clientY - touchStartY;
            const deltaX = Math.abs(touch.clientX - touchStartX);
            // 严格要求：纯下拉、垂直位移至少是水平位移的 2 倍
            if (deltaY > 30 && deltaY > deltaX * 2) {
                isSwipingDown = true;
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!isValidHeaderStart || !isSwipingDown) {
                isValidHeaderStart = false;
                isSwipingDown = false;
                return;
            }
            const touch = e.changedTouches[0];
            if (touch && !isInputInteracting(e.target)) {
                const deltaY = touch.clientY - touchStartY;
                const deltaX = Math.abs(touch.clientX - touchStartX);
                // 下拉位移超过 100px 且为纯垂直下拉
                if (deltaY > 100 && deltaY > deltaX * 2) {
                    try {
                        lvLaunchpad.haptic(10);
                    } catch {
                        /* soft */
                    }
                    closeMobilePanel();
                }
            }
            isValidHeaderStart = false;
            isSwipingDown = false;
        };

        dialog.element.addEventListener("touchstart", onTouchStart, { passive: true });
        dialog.element.addEventListener("touchmove", onTouchMove, { passive: true });
        dialog.element.addEventListener("touchend", onTouchEnd, { passive: true });

        import("@/panels/tab-panel.svelte").then(({ default: TabPanel }) => {
            if (!mobileDialog) return;
            const inst = mount(TabPanel, {
                target: host,
                props: {
                    plugin,
                    onMobileClose: () => {
                        try {
                            lvLaunchpad.haptic(10);
                        } catch {
                            /* soft */
                        }
                        closeMobilePanel();
                    },
                },
            });
            mobileDialogUnmount = () => {
                if (typeof inst === "function") (inst as () => void)();
                else if (inst) void unmount(inst);
            };
        }).catch((e) => console.warn("[LvHome] mobile panel mount failed:", e));

        mobileDialog = dialog;
    };

    return {
        openMobilePanel,
        closeMobilePanel,
        isOpen: () => Boolean(mobileDialog),
        ensureMobileTopBarButton: () => {},
        dispose: () => {
            isDisposed = true;
            closeMobilePanel();
        },
    };
}
