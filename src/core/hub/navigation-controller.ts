/**
 * 界面导航与快速采集控制器 (NavigationController)
 * 从 index.ts 上帝类中剥离的页签开闭、多端分流定位与快捷文本收集逻辑。
 */

import { openTab, openMobileFileById, getFrontend, type TProtyleAction } from "siyuan";
import { lvLaunchpad } from "@/libs/lv-notice-kit";
import { homeNotify } from "@/libs/notice";
import { TAB_TYPE } from "@/core/plugin-entrypoints";

export class NavigationController {
    private readonly plugin: any;
    private readonly captureDedupe = new Map<string, number>();

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    isMobileView(): boolean {
        if (typeof getFrontend === "function") {
            const fe = getFrontend();
            if (fe === "mobile" || fe === "browser-mobile") return true;
        }
        return Boolean(typeof lvLaunchpad?.isMobileFrontend === "function" && lvLaunchpad.isMobileFrontend());
    }

    async quickCapture(text: string): Promise<void> {
        if (/^https?:\/\/\S+$/i.test(text)) return;
        await this.captureTo("snippets", text);
    }

    async captureTo(moduleId: "bookmarks" | "address" | "snippets", text: string): Promise<void> {
        const { executeCaptureTo } = await import("@/core/quick-capture-action");
        await executeCaptureTo({
            plugin: this.plugin,
            moduleId,
            text,
            captureDedupe: this.captureDedupe,
            t: (k) => this.plugin.i18nText(k),
        });
    }

    showTab(): void {
        void this.plugin.triggerDeferredWarmup();
        if (this.isMobileView()) {
            this.plugin.entrypointsController?.getMobileController()?.openMobilePanel();
            return;
        }

        const title = this.plugin.i18nText("butler");
        const heads = typeof document !== "undefined"
            ? Array.from(document.querySelectorAll<HTMLElement>(".layout-tab-bar .item"))
            : [];
        const mine = heads.filter((h) => h.querySelector(".item__text")?.textContent?.trim() === title);
        if (mine.length) {
            for (const h of mine.slice(0, -1)) {
                h.querySelector(".item__close")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
            mine[mine.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return;
        }

        openTab({
            app: this.plugin.app,
            custom: {
                id: `${this.plugin.name}${TAB_TYPE}`,
                title,
                icon: "iconHome",
            },
        });
    }

    openRemindersScreen(): void {
        this.plugin.pendingScreen = "reminders";
        if (this.isMobileView()) {
            void this.plugin.triggerDeferredWarmup();
            this.plugin.entrypointsController?.getMobileController()?.openMobilePanel("reminders");
            return;
        }
        this.showTab();
        this.plugin.panelScreenSwitch?.("reminders");
    }

    openModuleTab(moduleId: string): void {
        this.plugin.pendingScreen = moduleId;
        if (this.isMobileView()) {
            void this.plugin.triggerDeferredWarmup();
            this.plugin.entrypointsController?.getMobileController()?.openMobilePanel(moduleId);
            return;
        }
        this.showTab();
        this.plugin.panelScreenSwitch?.(moduleId);
    }

    showTabDocs(docId?: string, blockId?: string): void {
        void this.plugin.triggerDeferredWarmup();
        const resolvedDocId = docId ?? (blockId ? undefined : this.plugin.settings.dbRefs[this.plugin.activeLedger]?.docId);
        const primaryTarget = resolvedDocId ?? blockId;
        if (!primaryTarget) return;

        if (this.isMobileView()) {
            const action: TProtyleAction[] | undefined = primaryTarget === blockId && blockId ? ["cb-get-focus", "cb-get-hl"] : undefined;
            if (typeof openMobileFileById === "function") {
                if (!resolvedDocId && blockId) {
                    import("@/core/sql-coalescer").then(({ checkBlockExists }) =>
                        checkBlockExists(blockId)
                    ).then((exists) => {
                        if (exists) {
                            openMobileFileById(this.plugin.app, blockId, ["cb-get-focus", "cb-get-hl"]);
                        } else {
                            homeNotify(this.plugin.i18nText?.("ledger.detachedRowOpenedDoc") || "对应记录在思源中暂无独立块，已取消跳转", 2500, "info");
                        }
                    }).catch(() => undefined);
                } else {
                    openMobileFileById(this.plugin.app, primaryTarget, action);
                    if (blockId && resolvedDocId && blockId !== resolvedDocId) {
                        import("@/core/sql-coalescer").then(({ checkBlockExists }) =>
                            checkBlockExists(blockId)
                        ).then((exists) => {
                            if (exists) {
                                openMobileFileById(this.plugin.app, blockId, ["cb-get-focus", "cb-get-hl"]);
                            } else {
                                homeNotify(this.plugin.i18nText?.("ledger.detachedRowOpenedDoc") || "已打开台账所在文档（该数据行无独立块锚点）", 2500, "info");
                            }
                        }).catch(() => undefined);
                    }
                }
            }
            try {
                this.plugin.entrypointsController?.getMobileController()?.closeMobilePanel();
            } catch {
                /* soft close */
            }
            return;
        }

        openTab({
            app: this.plugin.app,
            doc: {
                id: primaryTarget,
                action: primaryTarget === blockId && blockId ? ["cb-get-focus", "cb-get-hl"] : ["cb-get-focus"],
            },
            keepCursor: false,
        });

        if (blockId && resolvedDocId && blockId !== resolvedDocId) {
            import("@/core/sql-coalescer").then(({ checkBlockExists }) =>
                checkBlockExists(blockId)
            ).then((exists) => {
                if (exists) {
                    openTab({
                        app: this.plugin.app,
                        doc: { id: blockId, action: ["cb-get-focus", "cb-get-hl"] },
                        keepCursor: false,
                    });
                }
            }).catch(() => undefined);
        }
    }
}
