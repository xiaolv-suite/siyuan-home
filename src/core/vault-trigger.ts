import { lvSnapshotVault } from "@/libs/lv-notice-kit";

const registeredVaultPlugins = new WeakSet<object>();
const activeRestorePlugins = new WeakSet<object>();

export function setHomeVaultRegistered(plugin: object, active: boolean): void {
    if (!plugin || typeof plugin !== "object") return;
    if (active) registeredVaultPlugins.add(plugin);
    else registeredVaultPlugins.delete(plugin);
}

export function isHomeVaultRegistered(plugin: unknown): boolean {
    return Boolean(plugin && typeof plugin === "object" && registeredVaultPlugins.has(plugin));
}

export function setHomeVaultRestoring(plugin: object, restoring: boolean): void {
    if (!plugin || typeof plugin !== "object") return;
    if (restoring) activeRestorePlugins.add(plugin);
    else activeRestorePlugins.delete(plugin);
}

export function scheduleHomeVaultBackup(plugin: unknown): void {
    if (!plugin || typeof plugin !== "object") return;
    if (!registeredVaultPlugins.has(plugin)) return;
    if (activeRestorePlugins.has(plugin)) return;
    if ((plugin as any)?.runtime?.guestModeActive) return;
    try {
        lvSnapshotVault.scheduleAutoBackup("siyuan-home");
    } catch {
        /* soft */
    }
}
