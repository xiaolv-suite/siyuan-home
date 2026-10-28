import { Dialog } from "siyuan";
import { mount } from "svelte";

export interface MobileControllerOptions {
    plugin: any;
    t: (k: string) => string;
    isMobileFrontend: boolean;
    scheduleTimeout?: (fn: () => void, ms: number) => number;
}

export interface MobileController {
    ensureMobileTopBarButton(): void;
    openMobilePanel(): void;
    dispose(): void;
}

export function createMobileController(options: MobileControllerOptions): MobileController {
    const { plugin, t, isMobileFrontend, scheduleTimeout } = options;

    let mobileTopBarBtn: HTMLElement | undefined;
    let mobileTopBarRetry: number | undefined;
    let mobileDialog: Dialog | undefined;
    let mobileDialogUnmount: (() => void) | undefined;

    const runTimeout = (fn: () => void, ms: number): number => {
        if (scheduleTimeout) return scheduleTimeout(fn, ms);
        return typeof window !== "undefined" ? window.setTimeout(fn, ms) : 0;
    };

    const clearRunTimeout = (id?: number): void => {
        if (id !== undefined && typeof window !== "undefined") {
            window.clearTimeout(id);
        }
    };

    const openMobilePanel = (): void => {
        if (typeof document === "undefined") return;
        if (mobileDialog) {
            mobileDialog.destroy();
            return;
        }

        const dialog = new Dialog({
            title: t("butler"),
            content: `<div class="lv-mobile-host"></div>`,
            width: "100vw",
            height: "100dvh",
            destroyCallback: () => {
                if (mobileDialogUnmount) {
                    try { mobileDialogUnmount(); } catch { /* 已卸载 */ }
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
        import("@/panels/tab-panel.svelte").then(({ default: TabPanel }) => {
            if (!mobileDialog) return;
            mobileDialogUnmount = mount(TabPanel, {
                target: host,
                props: { plugin, onMobileClose: () => dialog.destroy() },
            }) as () => void;
        }).catch((e) => console.warn("[LvHome] mobile panel mount failed:", e));
        mobileDialog = dialog;
    };

    const ensureMobileTopBarButton = (): void => {
        if (!isMobileFrontend || typeof document === "undefined") return;
        const topBar = document.getElementById("mobileTopBar");
        if (!topBar) {
            mobileTopBarRetry = runTimeout(() => {
                mobileTopBarRetry = undefined;
                ensureMobileTopBarButton();
            }, 800);
            return;
        }

        const existing = topBar.querySelectorAll("#lvHomeMobileTopBarButton");
        if (existing.length > 1) {
            for (let i = 1; i < existing.length; i++) existing[i].remove();
            mobileTopBarBtn = existing[0] as HTMLElement;
            return;
        }
        if (existing.length === 1) {
            mobileTopBarBtn = existing[0] as HTMLElement;
            return;
        }
        if (mobileTopBarBtn?.isConnected) return;

        const button = document.createElement("button");
        button.type = "button";
        button.id = "lvHomeMobileTopBarButton";
        button.className = "toolbar__button";
        const label = t("entry.mobile");
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        button.innerHTML = `<svg aria-hidden="true"><use xlink:href="#iconLvHome"></use></svg>`;
        button.addEventListener("click", () => openMobilePanel());
        topBar.appendChild(button);
        mobileTopBarBtn = button;

        for (const delay of [1500, 4000, 10000, 20000, 30000]) {
            runTimeout(() => ensureMobileTopBarButton(), delay);
        }
    };

    return {
        ensureMobileTopBarButton,
        openMobilePanel,
        dispose: () => {
            clearRunTimeout(mobileTopBarRetry);
            mobileTopBarRetry = undefined;
            mobileTopBarBtn?.remove();
            mobileTopBarBtn = undefined;
            if (typeof document !== "undefined") {
                document.querySelectorAll("#lvHomeMobileTopBarButton").forEach((b) => b.remove());
            }
            if (mobileDialog) {
                try { mobileDialog.destroy(); } catch { /* ignore */ }
                mobileDialog = undefined;
            }
        },
    };
}
