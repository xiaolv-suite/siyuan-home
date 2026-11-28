/**
 * UI 交互上下文契约 (IHomeUIContext)
 *
 * 遵循单向五层架构：Surfaces（交互表面层）仅依赖轻量 UI 契约，
 * 彻底解除 Svelte 组件对 Plugin 上帝类的私有实现依赖。
 */

import type { HomeSettings, Reminder } from "./index";
import type { HubRuntime, HandledEntry } from "@/core/hub/runtime";
import type { ScanResult } from "@/core/hub/scanner";
import type { ModuleSchema } from "@/core/schema";
import type { ProvisioningReport } from "@/core/provisioner";
import type { ActivityTarget } from "@/core/activity";

export interface IHomeUIContext {
    i18n: Record<string, any>;
    name: string;
    settings: HomeSettings;
    runtime: HubRuntime;
    scan?: ScanResult;
    /** moduleId → schema 目录（UI 按需读取列定义/枚举） */
    schemaCatalog: Record<string, ModuleSchema>;
    hubListeners: Set<() => void>;
    activeLedger: string;
    pendingScreen?: string;
    panelScreenSwitch?: (screen: string) => void;
    pendingActivityTarget?: ActivityTarget;
    openActivityTarget?: (target: Omit<ActivityTarget, "requestId">) => void;
    loadData(storage: string): Promise<any>;
    saveData(storage: string, data: any): Promise<void>;

    // 动作流转与派发
    emitHubChanged?(): void;
    refreshHub(only?: string | string[], force?: boolean): Promise<ScanResult>;
    ensureCoreLedgers(): Promise<ProvisioningReport>;
    adoptHistoryLedgers?(): Promise<any>;
    showTab(): void;
    showTabDocs(docId?: string, blockId?: string): void;
    repairModule?(moduleId: string): Promise<any>;
    openSetting(): void;
    setActiveLedger(id: string): void;
    listHandled(): HandledEntry[];
    finishOnboarding(household: { roles: string[]; children: number }, moduleIds: string[]): Promise<void>;
    complete(r: Reminder): Promise<void>;
    snooze(id: string, days: number): Promise<void>;
    snoozeToDate?(id: string, targetDate: string): Promise<void>;
    batchSnooze?(ids: string[], targetDate: string): Promise<Record<string, string | undefined>>;
    undoBatchSnooze?(previousMap: Record<string, string | undefined>): Promise<void>;
    mute(id: string): Promise<void>;
    unmute(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    renew(r: Reminder, iso: string): Promise<unknown>;
    addMemo(title: string, due: string, options?: any): Promise<void>;
    removeMemo(id: string): Promise<void>;
    updateMemo(id: string, patch: { title?: string; dueDate?: string }): Promise<void>;
    toggleTodaySilent(): Promise<void>;
    runLifeHealthAudit?: () => Promise<void>;
}
