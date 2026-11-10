/**
 * 小驴管家 · 全生态统一通知出口包装器 (Lv Ecosystem Notice Wrapper)
 * 基于 Lv Ecosystem Unified Notice Kit (Epoch 7)
 *
 * 渐进降噪矩阵：
 * 1. inline  - 原位微反馈（复制/收藏/点选，零弹窗打扰）
 * 2. capsule - 瞬时微胶囊（2.5s 轻提示，余光自然感知）
 * 3. card    - 现代交互卡片（重点到期、错误警报，带操作跳转与稍后提醒/今日免打扰）
 * 4. silent  - 静默入库（后台扫描、自动同步、巡检、备份检查，仅入历史记录）
 */
import { showMessage as siyuanShowMessage } from "siyuan";
import {
    lvNotify,
    type CardNoticeOptions,
    type CapsuleNoticeOptions,
    type SilentNoticeOptions,
    type LvNoticeLevel,
    type LvNoticeAction,
    type LvNoticeSnoozeOption,
    lvTicker,
    withDocLock,
    lvSurfaceStack,
    lvAi,
    lvActivity,
    lvBackup,
    lvEcosystem,
    lvLaunchpad,
    lvOmnisearch,
    lvAutomation,
    type LvActivityRecord,
    type LvAiConfig,
    type LvAiRequestOptions,
    type LvAiResponse,
    type LvEcosystemFullBackup,
    type LvEcosystemDiagnostics,
    type LvLaunchpadItem,
    type LvSearchResultItem,
    type LvSearchProvider,
    type LvAutomationRule,
} from "./lv-notice-kit";

export {
    lvNotify,
    lvTicker,
    withDocLock,
    lvSurfaceStack,
    lvAi,
    lvActivity,
    lvBackup,
    lvEcosystem,
    lvLaunchpad,
    lvOmnisearch,
    lvAutomation,
    type CardNoticeOptions,
    type CapsuleNoticeOptions,
    type SilentNoticeOptions,
    type LvNoticeLevel,
    type LvNoticeAction,
    type LvNoticeSnoozeOption,
    type LvActivityRecord,
    type LvAiConfig,
    type LvAiRequestOptions,
    type LvAiResponse,
    type LvEcosystemFullBackup,
    type LvEcosystemDiagnostics,
    type LvLaunchpadItem,
    type LvSearchResultItem,
    type LvSearchProvider,
    type LvAutomationRule,
};

export interface NoticeOptions extends Partial<CardNoticeOptions> {
    /** 是否同时降级至思源原生 showMessage 弹窗（默认 false，优先保持纯净生态卡片/胶囊） */
    fallbackToNative?: boolean;
}

/**
 * 统一出口智能分流通知（适配 showMessage 语义）：
 * - error 级别：自动升级为现代交互卡片（停留至少 6 秒或常驻，醒目且可追溯）
 * - info/success/warn 级别：微胶囊瞬时轻提示（2.5 秒自然淡出，余光感知）
 */
export function homeNotify(
    message: string,
    timeout = 3000,
    type: "info" | "error" = "info",
    options?: NoticeOptions,
): void {
    const raw = String(message ?? "");
    const plain = raw.replace(/^\[小驴管家\]\s*/, "");

    try {
        if (type === "error") {
            lvNotify.card({
                source: "小驴管家",
                title: options?.title || "小驴管家提示",
                message: plain,
                level: "error",
                duration: Math.max(timeout, 6000),
                actions: options?.actions,
                snooze: options?.snooze,
                category: options?.category,
                onDismiss: options?.onDismiss,
            });
        } else {
            lvNotify.capsule({
                source: "小驴管家",
                message: plain,
                level: type === "info" ? "info" : "warn",
                duration: timeout,
            });
        }
    } catch {
        // 软降级
    }

    if (options?.fallbackToNative) {
        try {
            siyuanShowMessage(raw, type === "error" ? 6000 : timeout, type);
        } catch {
            // 兜底降级
        }
    }
}

/**
 * 后台扫描、自动同步、巡检、备份检查全面降级为静默通知
 * 零弹窗打扰用户，仅记入通知历史
 */
export function homeSilent(category: string, message: string, level: LvNoticeLevel = "info"): void {
    try {
        lvNotify.silent({
            source: "小驴管家",
            category,
            message,
            level,
        });
    } catch {
        // 软降级
    }
}

/**
 * 发送卡片式重点通知（支持交互按钮、稍后提醒与今日免打扰）
 */
export function homeCard(options: CardNoticeOptions): string | undefined {
    try {
        return lvNotify.card({
            source: "小驴管家",
            ...options,
        });
    } catch {
        return undefined;
    }
}

/**
 * 原位微动效（复制、快速操作等，坚决不弹窗）
 */
export function homeInline(target: HTMLElement | null | undefined, tipText?: string, isSuccess = true): void {
    try {
        lvNotify.inline(target, tipText, isSuccess);
    } catch {
        // 软降级
    }
}

/**
 * 判定某个分类今日是否已静音
 */
export function isHomeMutedToday(category: string): boolean {
    try {
        return lvNotify.isMutedToday(category);
    } catch {
        return false;
    }
}

/**
 * 设置某个分类今日免打扰
 */
export function muteHomeToday(category: string): void {
    try {
        lvNotify.muteToday(category);
    } catch {
        // 软降级
    }
}
