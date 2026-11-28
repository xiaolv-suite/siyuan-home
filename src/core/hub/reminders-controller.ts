/**
 * 提醒与备忘动作控制器 (RemindersController)
 * 从 index.ts 上帝类中剥离的待办核销、延后、静音、续期与快速备忘业务流转逻辑。
 */

import {
    complete,
    snooze,
    mute,
    unmute,
    renew,
    restore,
    addMemoWithMeta,
    removeMemo,
    updateMemo,
    withRuntime,
} from "./actions";
import { lvLaunchpad, lvActivity } from "@/libs/lv-notice-kit";
import { homeNotify } from "@/libs/notice";
import { localDateKey } from "./rule";
import { logCheckinEventSafely } from "@/libs/ecosystem-bridge-kit";
import { listHandled } from "./runtime";

export class RemindersController {
    private readonly plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async markReminderDoneByBlockId(blockId: string): Promise<boolean> {
        if (!blockId) return false;
        const bid = String(blockId).trim();
        const target = (this.plugin.scan?.reminders ?? []).find(
            (r: any) => r.rowId === bid || r.id === bid || (r.id && r.id.includes(bid)),
        );
        if (target) {
            await this.complete(target);
            return true;
        }
        return false;
    }

    async complete(r: any): Promise<void> {
        await complete(this.plugin, r);

        // 手机端触感反馈
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* 优雅降级 */
        }

        // 待办完成活动广播 (lvActivity)
        try {
            const taskTitle = r?.title || (r?.moduleId ? `事项（${r.moduleId}）` : "家庭事项");
            lvActivity.record({
                source: "管家",
                category: "task",
                title: `完成待办: ${taskTitle}`,
                detail: r?.dueDate ? `到期日: ${r.dueDate}` : undefined,
                linkBlockId: r?.rowId || r?.id,
            });
        } catch {
            /* 优雅降级 */
        }

        // 事务完成联动打卡
        try {
            const today = localDateKey(new Date());
            const rowId = r.rowId || r.id || "item";
            const modId = r.moduleId || "general";
            const matchedBinding = (this.plugin.settings.checkinBindings ?? []).find(
                (b: any) => !b.memberId || b.memberId === r.memberId,
            );
            const targetItemId = matchedBinding?.itemId || `home_${modId}`;
            await logCheckinEventSafely({
                itemId: targetItemId,
                externalRef: `home:${modId}:${rowId}:${today}`,
                note: r.title ? `办结家庭事项：${r.title}` : `办结家庭事项（${modId}）`,
            });
        } catch {
            /* 优雅降级 */
        }

        await this.plugin.notifyHubChanged();

        if (r?.moduleId === "adhoc") {
            try {
                const { markMemoDoneInDailyNote } = await import("@/core/doc-sync");
                await markMemoDoneInDailyNote(this.plugin, r);
            } catch {
                /* soft */
            }
        }
    }

    async snooze(id: string, days: number): Promise<void> {
        await snooze(this.plugin, id, days);
        await this.plugin.notifyHubChanged();
    }

    async snoozeToDate(id: string, targetDate: string): Promise<void> {
        const { snoozeToDate } = await import("@/core/hub/actions");
        await snoozeToDate(this.plugin, id, targetDate);
        await this.plugin.notifyHubChanged();
    }

    async batchSnooze(ids: string[], targetDate: string): Promise<Record<string, string | undefined>> {
        const { batchSnooze } = await import("@/core/hub/actions");
        const prev = await batchSnooze(this.plugin, ids, targetDate);
        try {
            lvLaunchpad.haptic(10);
        } catch {
            /* soft */
        }
        await this.plugin.notifyHubChanged();
        return prev;
    }

    async undoBatchSnooze(previousMap: Record<string, string | undefined>): Promise<void> {
        const { undoBatchSnooze } = await import("@/core/hub/actions");
        await undoBatchSnooze(this.plugin, previousMap);
        await this.plugin.notifyHubChanged();
    }

    async mute(id: string): Promise<void> {
        await mute(this.plugin, id);
        await this.plugin.notifyHubChanged();
    }

    async unmute(id: string): Promise<void> {
        await unmute(this.plugin, id);
        await this.plugin.notifyHubChanged();
    }

    async restore(id: string): Promise<void> {
        await restore(this.plugin, id);
        await this.plugin.notifyHubChanged();
    }

    renew(r: any, iso: string): Promise<unknown> {
        const rule = (this.plugin.schemaCatalog[r.moduleId]?.reminders ?? []).find(
            (x: any) => x.key === r.ruleKey,
        );
        return renew(
            this.plugin,
            r,
            iso,
            this.plugin.settings.dbRefs[r.moduleId] ?? {},
            rule?.field ?? "expiry",
        ).then(async () => {
            if (this.plugin.app && r?.moduleId) {
                try {
                    const { syncModuleDocSection } = await import("@/core/doc-sync");
                    await syncModuleDocSection(this.plugin, r.moduleId);
                } catch {
                    /* soft */
                }
            }
            return this.plugin.refreshHub(r.moduleId);
        });
    }

    async addMemo(title: string, due: string, options?: any): Promise<void> {
        const res = await addMemoWithMeta(this.plugin, title, due, options);
        await this.plugin.notifyHubChanged();
        if (!res.inserted) return;
        try {
            const { appendMemoToDailyNote } = await import("@/core/doc-sync");
            await appendMemoToDailyNote(this.plugin, {
                title,
                dueDate: due,
                id: res.memoId,
                ...options,
            });
        } catch {
            /* soft */
        }
    }

    async updateMemo(
        id: string,
        patch: { title?: string; dueDate?: string; priority?: "high" | "low" | "medium"; category?: string },
    ): Promise<void> {
        await updateMemo(this.plugin, id, patch);
        await this.plugin.notifyHubChanged();
        try {
            const { updateMemoInDailyNote } = await import("@/core/doc-sync");
            await updateMemoInDailyNote(this.plugin, id, patch);
        } catch {
            /* soft */
        }
    }

    async removeMemo(id: string): Promise<void> {
        await removeMemo(this.plugin, id);
        await this.plugin.notifyHubChanged();
        try {
            const { deleteMemoFromDailyNote } = await import("@/core/doc-sync");
            await deleteMemoFromDailyNote(this.plugin, id);
        } catch {
            /* soft */
        }
    }

    async toggleTodaySilent(): Promise<void> {
        const today = localDateKey(new Date());
        const nextRt = await withRuntime(this.plugin, (rt) => {
            rt.todaySilent = rt.todaySilent === today ? "" : today;
        });
        homeNotify(
            this.plugin.i18nText(
                nextRt.todaySilent ? "hub.todaySilentOn" : "hub.todaySilentOff",
            ),
            3000,
            "info",
        );
        await this.plugin.notifyHubChanged();
    }

    listHandled(): any[] {
        return listHandled(this.plugin.runtime, this.plugin.runtime.cache?.derived ?? []);
    }
}
