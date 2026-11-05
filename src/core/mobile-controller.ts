import { Dialog } from "siyuan";
import { mount } from "svelte";
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
    let isDisposed = false;

    const closeMobilePanel = (): void => {
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
            // 宿主已打开时直接切屏聚焦，不重复弹层
            return;
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

        const host = dialog.element.querySelector(".lv-mobile-host") as HTMLElement;
        if (!host) {
            dialog.destroy();
            return;
        }

        dialog.element.classList.add("b3-dialog--lvmobile");

        // 下滑手势关闭支持（Mobile Spec v1 统一手势规范：下拉超过 80px 关坞）
        let touchStartY = 0;
        let touchStartX = 0;
        let isSwipingDown = false;

        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            touchStartY = touch.clientY;
            touchStartX = touch.clientX;
            isSwipingDown = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const deltaY = touch.clientY - touchStartY;
            const deltaX = Math.abs(touch.clientX - touchStartX);
            if (deltaY > 20 && deltaY > deltaX * 1.5) {
                const scrollEl = host.querySelector(".lv-home") as HTMLElement;
                if (!scrollEl || scrollEl.scrollTop <= 0) {
                    isSwipingDown = true;
                }
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!isSwipingDown) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            const deltaY = touch.clientY - touchStartY;
            if (deltaY > 80) {
                try {
                    lvLaunchpad.haptic(10);
                } catch {
                    /* soft */
                }
                closeMobilePanel();
            }
            isSwipingDown = false;
        };

        dialog.element.addEventListener("touchstart", onTouchStart, { passive: true });
        dialog.element.addEventListener("touchmove", onTouchMove, { passive: true });
        dialog.element.addEventListener("touchend", onTouchEnd, { passive: true });

        import("@/panels/tab-panel.svelte").then(({ default: TabPanel }) => {
            if (!mobileDialog) return;
            mobileDialogUnmount = mount(TabPanel, {
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
            }) as () => void;
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
