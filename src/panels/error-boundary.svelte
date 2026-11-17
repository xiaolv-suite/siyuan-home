<script lang="ts">
    // 32 组：Svelte 错误边界——单屏崩溃不拖垮管家面板，提供重试按钮
    import type { Snippet } from "svelte";
    import { compactUserMessage } from "@/core/auth";
    import UiIcon from "@/ui/icon.svelte";
    type Props = {
        children: Snippet;
        /** 重试回调（可选：切换页签时自动重置） */
        onretry?: () => void;
        t?: (key: string) => string;
    };
    let { children, onretry, t }: Props = $props();

    function retry(resetBoundary: () => void) {
        onretry?.();
        resetBoundary();
    }

    function errorKind(error: unknown): "permission" | "auth" | "other" {
        const text = error instanceof Error ? error.message : String(error ?? "");
        if (/forbidden|permission denied|无权限|没有权限|权限不足/i.test(text)) return "permission";
        if (/unauthori[sz]ed|token.{0,24}(expired|invalid|失效|过期)|登录状态|会话失效|未登录/i.test(text)) return "auth";
        return "other";
    }
</script>

<svelte:boundary>
    {@render children()}
    {#snippet failed(error, resetBoundary)}
        <div class="lv-card lv-error-boundary-card" role="alert" aria-live="assertive">
            <div class="lv-error-boundary-icon"><UiIcon name="alert" size={28} /></div>
            {#if errorKind(error) === "permission"}
                <b>{t?.("permission.title") || "Access is not permitted"}</b>
                <p class="lv-caption lv-error-boundary-msg">{t?.("permission.body") || "The current account cannot access this data. Check permissions and retry."}</p>
            {:else if errorKind(error) === "auth"}
                <b>{t?.("auth.expired") || "Your session has expired"}</b>
                <p class="lv-caption lv-error-boundary-msg">{t?.("error.retryHint") || "请重新登录后再重试。"}</p>
            {:else}
                <b>{compactUserMessage(error instanceof Error ? error.message : error, t?.("error.unknown") || "An unexpected error occurred")}</b>
                <p class="lv-caption lv-error-boundary-msg">{t?.("error.retryHint") || "请重试；如果问题持续，请重新扫描或检查设置。"}</p>
            {/if}
            <button type="button" class="b3-button b3-button--outline lv-mt-8" onclick={() => retry(resetBoundary)}>
                {t?.("error.retry") || "Retry"}
            </button>
        </div>
    {/snippet}
</svelte:boundary>
