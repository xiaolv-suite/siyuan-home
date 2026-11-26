/**
 * 插件启动引导与外部服务切面装配 (PluginBootstrap)
 * 从 index.ts 上帝类中剥离的全局遮罩监听、时钟订阅、生态联动与灾备挂载逻辑。
 */

import { openTab, openMobileFileById } from "siyuan";
import { lvNotify, lvTicker, lvBackup, lvLaunchpad, lvOmnisearch } from "@/libs/lv-notice-kit";
import { homeNotify } from "@/libs/notice";
import { registerPluginContextMenus } from "@/core/plugin-context-menus";
import { initEcosystemIntegration } from "@/core/ecosystem-integration";

export function initPluginBootstrap(plugin: any): void {
    // 1. 全端入口接入小驴罗盘统一管理
    try {
        plugin.disposer.add(lvLaunchpad.ensureUnifiedEntry(plugin));
        lvLaunchpad.registerHostApi({ openTab, openMobileFileById, app: plugin.app });
    } catch {
        /* 优雅降级 */
    }

    // 2. 全局遮罩点击即关
    const onHomeScrimClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && target.classList?.contains("b3-dialog__scrim")) {
            const dialogEl = target.closest(".b3-dialog");
            if (dialogEl && (dialogEl.classList.contains("lv-home-dialog") || dialogEl.querySelector('[id^="lv-home-"], #lv-detail-body, .lv-home, .lv-butler'))) {
                const closeBtn = dialogEl.querySelector<HTMLElement>(
                    ".b3-dialog__close, [data-action='close'], .b3-button--cancel",
                );
                if (closeBtn) {
                    if (typeof closeBtn.click === "function") closeBtn.click();
                    else closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                }
            }
        }
    };
    window.addEventListener("click", onHomeScrimClick, true);
    plugin.disposer.add(() => window.removeEventListener("click", onHomeScrimClick, true));

    // 3. 初次引导与设置校验提示
    const isFreshInstall =
        !plugin.settings.onboarded &&
        plugin.settings.members.length === 0 &&
        Object.keys(plugin.settings.dbRefs).length === 0;
    if (isFreshInstall && !plugin.runtime?.firstRunWelcomed) {
        if (plugin.runtime) plugin.runtime.firstRunWelcomed = true;
        homeNotify(plugin.i18nText("firstRun"), 5000, "info");
    }

    if (plugin.settings.corruptedSettings) {
        const reason = plugin.settings.corruptedSettings;
        const detail = typeof reason === "string" ? `（${reason}）` : "";
        homeNotify(plugin.i18nText("settings.corrupted") + detail, 10000, "error");
    }

    // 4. 心跳与零点跨日刷新
    plugin.disposer.add(
        lvTicker.subscribe("siyuan-home", 30 * 60 * 1000, () => {
            plugin.refreshHub().catch((e: unknown) => console.warn("[LvHome] heartbeat scan failed:", e));
        }),
    );

    plugin.disposer.add(
        lvTicker.onDateCross("siyuan-home", (todayKey: string) => {
            plugin
                .refreshHub(undefined, true)
                .then(() => console.debug("[LvHome] date-cross-refresh:", todayKey))
                .catch((e: unknown) => console.warn("[LvHome] date cross refresh failed:", e));
        }),
    );

    // 5. 原生上下文菜单与生态联动控制器
    plugin.contextMenusController = registerPluginContextMenus({
        plugin,
        eventBus: plugin.eventBus,
        t: (k: string) => plugin.i18nText(k),
        i18n: plugin.i18n,
        quickCapture: (text: string) => plugin.quickCapture(text),
        captureTo: (moduleId: any, text: string) => plugin.captureTo(moduleId, text),
        showTab: () => plugin.showTab(),
        openRemindersScreen: () => plugin.openRemindersScreen(),
        setActiveLedger: (mod: string) => plugin.setActiveLedger(mod),
        refreshHub: (only: any, force: boolean) => plugin.refreshHub(only, force),
    });
    plugin.disposer.add(plugin.contextMenusController);

    plugin.ecosystemController = initEcosystemIntegration({
        plugin,
        t: (k: string) => plugin.i18nText(k),
        showTab: () => plugin.showTab(),
        openRemindersScreen: () => plugin.openRemindersScreen(),
        openModuleTab: (m: string) => plugin.openModuleTab(m),
        addMemo: (title: string, due: string) => plugin.addMemo(title, due),
        complete: (r: any) => plugin.complete(r),
        markReminderDoneByBlockId: (bId: string) => plugin.markReminderDoneByBlockId(bId),
        emitHubChanged: () => plugin.emitHubChanged(),
    });
    plugin.disposer.add(plugin.ecosystemController);

    // 6. 全生态通知、联合灾备、罗盘与检索
    try {
        plugin.disposer.add(lvNotify.registerPlugin("siyuan-home"));
    } catch {
        /* soft */
    }
    try {
        plugin.disposer.add(
            lvBackup.register(
                "siyuan-home",
                async () => plugin.dumpEcosystemBackupData(),
                async (data: any) => plugin.restoreEcosystemBackupData(data),
            ),
        );
    } catch {
        /* soft */
    }

    plugin.registerLaunchpadEntry();

    try {
        plugin.disposer.add(
            lvOmnisearch.registerProvider("siyuan-home", (keyword: string) => plugin.searchHomeItems(keyword)),
        );
    } catch {
        /* soft */
    }
}
