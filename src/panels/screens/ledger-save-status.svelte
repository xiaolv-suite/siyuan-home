<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";

    let {
        savedRecordName,
        savedModule,
        savedDocId,
        t,
        onOpenDoc,
    }: {
        savedRecordName: string;
        savedModule: string;
        savedDocId: string;
        t: (k: string) => string;
        onOpenDoc: (docId?: string) => void;
    } = $props();
</script>

<div class="lv-record-save-status" role="status">
    {t("ledger.newRecordSaved").replace("${name}", savedRecordName)} · {t("ledger.savedTo").replace("${module}", t(`module.${savedModule}`) !== `module.${savedModule}` ? t(`module.${savedModule}`) : savedModule)}
    <button type="button" class="b3-button b3-button--text" onclick={() => onOpenDoc(savedDocId || undefined)}>
        <span>{t("ledger.openDoc")}</span> <UiIcon name="forward" size={12} />
    </button>
</div>
