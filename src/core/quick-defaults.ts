export interface QuickDefaults {
    fuelVehicleId?: string;
    fuelKind?: "fuel" | "charging";
    fuelGrade?: string;
    fuelPrice?: number;
    fuelAmount?: number;
    fuelLiters?: number;
    fuelIsFull?: boolean;
    chargingMode?: string;
    chargePrice?: number;
    chargeAmount?: number;
    chargeLiters?: number;
    chargeIsFull?: boolean;
    vitalMemberId?: string;
    vitalMetricType?: "bp" | "glucose" | "weight" | "temp";
    choreMemberId?: string;
    choreMemberIds?: string[];
    choreRowId?: string;
    shoppingCategory?: string;
    snippetTag?: string;
}

const KEY = "siyuan_home_quick_defaults";

export function loadQuickDefaults(plugin?: any): QuickDefaults {
    try {
        const raw = typeof window !== "undefined" && window.localStorage?.getItem(KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* soft */ }
    return plugin?.runtime?.quickDefaults ?? {};
}

export function saveQuickDefaults(plugin: any, patch: Partial<QuickDefaults>): void {
    const cur = loadQuickDefaults(plugin);
    const next = { ...cur, ...patch };
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem(KEY, JSON.stringify(next));
        }
    } catch { /* soft */ }
    if (plugin) {
        if (!plugin.runtime) plugin.runtime = {};
        plugin.runtime.quickDefaults = next;
    }
}
