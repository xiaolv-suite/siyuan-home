/**
 * 扫描 provider 注册表（12 轮修复）：由 schemaCatalog 程序化派生，杜绝
 * "schema 声明了 reminders 但忘了注册 provider"的手工清单漂移——
 * 此前 parenting/schooling 两模块的提醒因清单未更新而从未生效。
 */
import type { ModuleSchema } from "@/core/schema";
import type { DataProvider, ProviderDeps } from "./providers";
import { CertsProvider, MembersProvider, SchemaLedgerProvider, NumericRuleProvider, VehiclesProvider } from "./providers";

export function buildScanProviders(schemaCatalog: Record<string, ModuleSchema>, deps: ProviderDeps): DataProvider[] {
    const providers: DataProvider[] = [
        new CertsProvider(deps),
        new MembersProvider(deps),
    ];
    const vehiclesSchema = schemaCatalog.vehicles;
    if (vehiclesSchema && ((vehiclesSchema.reminders?.length ?? 0) > 0 || (vehiclesSchema.numericRules?.length ?? 0) > 0)) {
        providers.push(new VehiclesProvider(vehiclesSchema, deps));
    }
    for (const [moduleId, schema] of Object.entries(schemaCatalog)) {
        if (moduleId === "certs" || moduleId === "members" || moduleId === "vehicles") continue;
        const hasRules = (schema?.reminders?.length ?? 0) > 0 || (schema?.numericRules?.length ?? 0) > 0;
        if (!hasRules) continue;
        providers.push(new SchemaLedgerProvider(moduleId, schema, deps));
        if (schema.numericRules?.length) providers.push(new NumericRuleProvider(moduleId, schema, deps));
    }
    return providers;
}

/** 契约自检（测试用）：有提醒/阈值规则的模块都有对应 provider */
export function providerCoverage(
    schemaCatalog: Record<string, ModuleSchema>,
    providers: DataProvider[],
): string[] {
    const ids = new Set(providers.map((p) => p.moduleId));
    const missing: string[] = [];
    for (const [moduleId, schema] of Object.entries(schemaCatalog)) {
        const needs = (schema?.reminders?.length ?? 0) > 0 || (schema?.numericRules?.length ?? 0) > 0;
        if (needs && !ids.has(moduleId)) missing.push(moduleId);
    }
    return missing;
}
