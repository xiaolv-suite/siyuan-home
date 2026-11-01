<script lang="ts">
    import UiIcon from "@/ui/icon.svelte";
    import { isImageAsset, assetHref } from "@/core/assets";
    import { COMMON_COLUMN_ALIASES } from "@/core/provisioner";

    let {
        visibleRows = [],
        filteredRows = [],
        renderLimit = $bindable(200),
        RENDER_PAGE = 200,
        ref,
        avCols = [],
        t,
        ledgerTone,
        toneCls,
        cellText,
        onOpenDetail,
    }: {
        visibleRows: any[];
        filteredRows: any[];
        renderLimit: number;
        RENDER_PAGE: number;
        ref?: { avId?: string; columns?: Record<string, string> };
        avCols?: any[];
        t: (k: string) => string;
        ledgerTone: (r: any) => any;
        toneCls: (tone: any) => string;
        cellText: (cell: any, key?: string) => string;
        onOpenDetail: (row: any, action?: "fuel" | "charging" | "maintenance" | "edit") => void;
    } = $props();

    let loadedImages = $state<Record<string, boolean>>({});

    function vehicleImageHref(row: any): string {
        if (!ref?.columns?.attachments) return "";
        const cell = row.cells?.[ref.columns.attachments];
        const asset = Array.isArray(cell?.mAsset) ? cell.mAsset.find((item: any) => isImageAsset(String(item?.content ?? ""))) : undefined;
        if (!asset?.content) return "";
        try { return assetHref(String(asset.content)); } catch { return ""; }
    }

    function vehicleText(row: any, key: string): string {
        const id = ref?.columns?.[key];
        let val = id ? cellText(row.cells?.[id], key) : "—";
        if ((!id || val === "—") && avCols.length > 0) {
            const aliases = ["name", "plate", "brand_model", "energy_type", "mileage"].includes(key)
                ? (COMMON_COLUMN_ALIASES[key] ?? [key])
                : [key];
            const matchedCol = avCols.find((c) => aliases.includes(c?.name) || aliases.includes(c?.keyName));
            if (matchedCol?.id && row.cells?.[matchedCol.id]) {
                const probed = cellText(row.cells[matchedCol.id], key);
                if (probed && probed !== "—") val = probed;
            }
        }
        if (key === "name" && (val === "—" || !val)) {
            if (row?.cells) {
                for (const cell of Object.values(row.cells) as any[]) {
                    if (cell?.block?.content) return String(cell.block.content).trim();
                }
                for (const cell of Object.values(row.cells) as any[]) {
                    if (cell?.text?.content) return String(cell.text.content).trim();
                }
            }
        }
        return val || "—";
    }
</script>

<div class="lv-vehicle-grid" aria-label={t("module.vehicles")}>
    {#each visibleRows as r (r.itemID)}
        {@const tone = ledgerTone(r)}
        {@const photo = vehicleImageHref(r)}
        <article class="lv-vehicle-card lv-card" role="group">
            <div class="lv-vehicle-photo" class:is-loading={photo && !loadedImages[r.itemID]}>
                {#if photo}
                    <img src={photo} alt={vehicleText(r, "name")} width="96" height="72" decoding="async" loading="lazy"
                        class="lv-vehicle-img"
                        class:is-loaded={loadedImages[r.itemID]}
                        onload={() => { loadedImages = { ...loadedImages, [r.itemID]: true }; }}
                        onerror={() => { loadedImages = { ...loadedImages, [r.itemID]: true }; }} />
                {:else}
                    <UiIcon name="car" size={28} />
                {/if}
            </div>
            <div class="lv-vehicle-main">
                <div class="lv-vehicle-head">
                    <button type="button" class="lv-vehicle-title" onclick={() => onOpenDetail(r)} aria-label={`${t("ledger.detail")}：${vehicleText(r, "name")}`}>
                        {vehicleText(r, "name")}
                    </button>
                    <span class="lv-sev {toneCls(tone)}" title={tone === "danger" ? t("level.overdue") : tone === "warn" ? t("level.soon") : ""}></span>
                </div>
                <div class="lv-vehicle-sub">{vehicleText(r, "brand_model")} · {vehicleText(r, "plate")}</div>
                <div class="lv-vehicle-meta">
                    <span>{vehicleText(r, "energy_type")}</span>
                    <span>{vehicleText(r, "mileage")} {t("fuel.km")}</span>
                    <span>{t("field.inspection_due")} · {vehicleText(r, "inspection_due")}</span>
                    <span>{t("field.insurance_due")} · {vehicleText(r, "insurance_due")}</span>
                </div>
                <div class="lv-vehicle-actions">
                    <button type="button" class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); onOpenDetail(r, "fuel"); }}>{t("vehicle.quick.fuel")}</button>
                    <button type="button" class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); onOpenDetail(r, "charging"); }}>{t("vehicle.quick.charging")}</button>
                    <button type="button" class="b3-button b3-button--outline" onclick={(e) => { e.stopPropagation(); onOpenDetail(r, "maintenance"); }}>{t("vehicle.quick.maintenance")}</button>
                    <button type="button" class="b3-button b3-button--text" onclick={(e) => { e.stopPropagation(); onOpenDetail(r, "edit"); }}>{t("members.edit")}</button>
                </div>
            </div>
        </article>
    {/each}
    {#if filteredRows.length > visibleRows.length}
        <button type="button" class="b3-button b3-button--outline lv-vehicle-more" onclick={() => (renderLimit += RENDER_PAGE)}>{t("ledger.loadMore").replace("${n}", String(filteredRows.length - visibleRows.length))}</button>
    {/if}
</div>
