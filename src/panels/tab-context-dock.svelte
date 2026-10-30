<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { PluginScreen } from "./panel-session";

    let {
        screen,
        t,
        plugin,
        kpiUrgentCount,
        kpiMonthlyRatio,
        kpiRecordsTotal,
        kpiMemberCount,
        onToggleDock,
        onOpenCapture,
        onOpenSpotlight,
        onRefreshScan,
    }: {
        screen: PluginScreen;
        t: (k: string) => string;
        plugin: any;
        kpiUrgentCount: number;
        kpiMonthlyRatio: string;
        kpiRecordsTotal: number;
        kpiMemberCount: number;
        onToggleDock: () => void;
        onOpenCapture: (moduleId?: string) => void;
        onOpenSpotlight: () => void;
        onRefreshScan: () => void;
    } = $props();
</script>

<aside class="lv-context-dock" aria-label="上下文面板">
    <div class="lv-context-dock__head">
        <span>
            {#if screen === "overview"}
                <UiIcon name="layout" size={13} /> {t("dash.title") || "总览上下文"}
            {:else if screen === "reminders"}
                <UiIcon name="clock" size={13} /> {t("tab.reminders")}
            {:else if screen === "ledger"}
                <UiIcon name="archive" size={13} /> {t("tab.ledger")}
            {:else}
                <UiIcon name="users" size={13} /> {t("tab.members")}
            {/if}
        </span>
        <button type="button" class="b3-button b3-button--text lv-caption" aria-label={t("close")} onclick={onToggleDock}><UiIcon name="close" size={13} /></button>
    </div>
    <div class="lv-context-dock__body">
        {#if screen === "overview"}
            <div class="lv-context-card">
                <b><UiIcon name="bolt" size={13} /> 快捷指令</b>
                <p class="lv-caption">按 N 快速记录 · Ctrl+K 聚焦检索</p>
                <div class="lv-context-actions">
                    <button class="lv-btn ghost sm" onclick={() => onOpenCapture()}><UiIcon name="add" size={13} /> {t("dash.quickRecord")}</button>
                    <button class="lv-btn ghost sm" onclick={onOpenSpotlight}><UiIcon name="search" size={13} /> {t("spotlight.title")}</button>
                </div>
            </div>
            <div class="lv-context-card">
                <b><UiIcon name="shield" size={13} /> 家庭保障速览</b>
                <p class="lv-caption">已收录家庭档案 {kpiMemberCount} 位，核心台账事实 {kpiRecordsTotal} 条。</p>
            </div>
        {:else if screen === "reminders"}
            <div class="lv-context-card">
                <b><UiIcon name="bookmark" size={13} /> 待办聚焦</b>
                <p class="lv-caption">当前急迫待办 {kpiUrgentCount} 项，当月已办进度 {kpiMonthlyRatio}。</p>
                <div class="lv-context-actions">
                    <button class="lv-btn ghost sm" onclick={onRefreshScan}><UiIcon name="repeat" size={13} /> {t("hub.rescan")}</button>
                </div>
            </div>
        {:else if screen === "ledger"}
            <div class="lv-context-card">
                <b><UiIcon name="archive" size={13} /> 台账事实库</b>
                <p class="lv-caption">已归集 31 大类生活结构化数据，共 {kpiRecordsTotal} 条记录沉淀。</p>
                <div class="lv-context-actions">
                    <button class="lv-btn ghost sm" onclick={() => onOpenCapture(plugin.activeLedger)}><UiIcon name="add" size={13} /> {t("ledger.newRecord")}</button>
                </div>
            </div>
        {:else}
            <div class="lv-context-card">
                <b><UiIcon name="users" size={13} /> 成员中心</b>
                <p class="lv-caption">当前已登记 {kpiMemberCount} 位家庭成员与宠物档案，支持公农双历生日推演。</p>
            </div>
        {/if}
    </div>
</aside>
