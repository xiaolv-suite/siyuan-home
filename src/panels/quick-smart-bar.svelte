<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import type { ParsedCaptureResult } from "@/core/block-capture";
    import type { QuickRecordTemplate } from "@/core/quick-templates";

    let {
        moduleId = $bindable(""),
        smartInputText = $bindable(""),
        smartParsed = $bindable<ParsedCaptureResult | null>(null),
        frequentModules = [] as string[],
        currentTemplates = [] as QuickRecordTemplate[],
        saving = false,
        identityPending = false,
        t,
        modLabel,
        moduleIcon,
        onApplySmartParse,
        onApplyTemplate,
    }: {
        moduleId?: string;
        smartInputText?: string;
        smartParsed?: ParsedCaptureResult | null;
        frequentModules?: string[];
        currentTemplates?: QuickRecordTemplate[];
        saving?: boolean;
        identityPending?: boolean;
        t: (k: string) => string;
        modLabel: (mid: string) => string;
        moduleIcon: (mid: string) => string;
        onApplySmartParse?: () => void;
        onApplyTemplate?: (tpl: QuickRecordTemplate) => void;
    } = $props();

    async function handleSmartInput() {
        if (!smartInputText.trim()) {
            smartParsed = null;
            return;
        }
        const { smartParseNoteContent } = await import("@/core/block-capture");
        const res = smartParseNoteContent(smartInputText);
        smartParsed = res?.title ? res : null;
    }
</script>

<div class="lv-smart-capture-bar">
    <div class="lv-smart-input-row">
        <input class="b3-text-field lv-smart-input"
            placeholder={t("capture.smartHint")}
            aria-label={t("capture.smartHint")}
            bind:value={smartInputText}
            oninput={handleSmartInput}
            disabled={saving}
        />
        {#if smartParsed && smartParsed.title}
            <button type="button" class="b3-button b3-button--outline lv-smart-detect-btn"
                aria-label={t("capture.smartDetected").replace("${module}", modLabel(smartParsed.suggestedModule || moduleId))}
                onclick={onApplySmartParse}>
                {t("capture.smartDetected").replace("${module}", modLabel(smartParsed.suggestedModule || moduleId))}
            </button>
        {/if}
    </div>
</div>

{#if frequentModules.length > 0}
    <div class="lv-quick-chips">
        {#each frequentModules as fId (fId)}
            <button type="button" class="lv-quick-chip" class:active={moduleId === fId}
                aria-pressed={moduleId === fId}
                onclick={() => { moduleId = fId; }}
                disabled={saving || identityPending}
                title={modLabel(fId)}>
                <span>{moduleIcon(fId)}</span>
                <span>{modLabel(fId)}</span>
            </button>
        {/each}
    </div>
{/if}

{#if currentTemplates.length > 0}
    <div class="lv-template-bar">
        <span class="lv-caption lv-tx-muted"><UiIcon name="sparkle" size={13} /> {t("capture.frequentTemplates") || "常用模板"}:</span>
        {#each currentTemplates as tpl (tpl.id)}
            <button type="button" class="lv-preset-tag lv-template-tag" onclick={() => onApplyTemplate?.(tpl)} disabled={saving}>
                {#if tpl.icon}<span>{tpl.icon}</span>{/if}
                <span>{tpl.label}</span>
            </button>
        {/each}
    </div>
{/if}
