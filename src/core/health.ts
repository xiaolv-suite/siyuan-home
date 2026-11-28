/**
 * 深度健康检查（D12 最小版）：登记存在 ≠ 健康。
 * 对每个启用模块实际发起读取，报告行数、读取完整性、schema 声明但台账缺失的列，
 * 以及建库/读取错误。结果带检查时间；只读，不修复（修复动作属 F07 局部修复，另行）。
 * §15/201 波：读取前先查文档存在性——被移入回收站/删除的台账给出明确的重建指引，
 * 不与其他内核错误混作一团。
 */
import type { HomeSettings } from "@/types";
import { renderLedgerAll, sql } from "./siyuan";
import {
    reconcileLiveColumns,
    type ColumnTypeDriftIssue,
    type SelectEnumCoverageIssue,
} from "./provision-common";
import { summarizeModuleFieldCapabilities } from "./field-capability-matrix";
import type { ColumnDef } from "./schema-types";

export interface ModuleHealth {
    moduleId: string;
    ok: boolean;
    /** 台账行数（render 视图行数） */
    rows?: number;
    /** 读取是否完整（false = 返回行数 < rowCount，扫描可能遗漏） */
    complete?: boolean;
    /** schema 声明但 dbRef.columns 或真实 AV 缺失的列 key */
    missingColumns?: string[];
    /** dbRef.columns 有登记但真实 AV 已不存在的幽灵列 key */
    ghostColumns?: string[];
    /** 真实 AV 列类型与 schema 期望不一致的漂移告警（绝不自动覆盖/删除用户原列） */
    typeDrifts?: ColumnTypeDriftIssue[];
    /** 与 typeDrifts 等价的结构化 schema 问题清单 */
    schemaIssues?: ColumnTypeDriftIssue[];
    /** select / mSelect 列枚举覆盖状态（标明是否仅应用层约束还是已同步至 AV 原生选项） */
    selectEnumCoverage?: {
        totalSelectCols: number;
        syncedCols: number;
        appLayerOnlyCols: number;
        issues: SelectEnumCoverageIssue[];
    };
    /** 通用表单 / 专用面板 / 仅原生 AV 的字段能力摘要 */
    fieldCapabilitySummary?: {
        totalFields: number;
        genericFormCount: number;
        specializedCount: number;
        nativeOnlyCount: number;
        nativeOnlyFields: string[];
    };
    error?: string;
}

export interface HealthReport {
    at: string;
    modules: ModuleHealth[];
}

export async function runHealthCheck(
    settings: HomeSettings,
    schemaCatalog: Record<string, { columns?: Array<{ key: string; type?: string; options?: string[]; default?: string }> }>,
): Promise<HealthReport> {
    const modules: ModuleHealth[] = [];
    for (const moduleId of settings.enabledModules) {
        const ref = settings.dbRefs[moduleId];
        const schema = schemaCatalog[moduleId];
        if (!ref?.avId || !ref.columns) {
            modules.push({ moduleId, ok: false, error: "not provisioned" });
            continue;
        }
        try {
            if (ref.docId) {
                // 文档根块 id 即 docId；回收站/删除的文档已退出 blocks 索引。
                // 索引延迟（E5）可致瞬时查空——判缺失前延迟复检一次，避免误报。
                const exists = async () =>
                    (await sql<{ id: string }>(`SELECT id FROM blocks WHERE id='${ref.docId!.replace(/'/g, "''")}' LIMIT 1`)).length > 0;
                if (!(await exists())) {
                    await new Promise((r) => setTimeout(r, 600));
                    if (!(await exists())) {
                        modules.push({
                            moduleId,
                            ok: false,
                            error: "ledger document missing (deleted or in trash?) — rebuild from the ledger page",
                        });
                        continue;
                    }
                }
            }
            const read = await renderLedgerAll(ref.avId);
            const reconciled = reconcileLiveColumns({
                moduleId,
                schema: { columns: (schema?.columns ?? []) as any },
                existing: ref.columns,
                knownColumns: read.columns ?? [],
                reconcileGhostColumns: false,
            });
            const missing = reconciled.missingColumns;
            const ghostColumns = reconciled.ghostColumns;
            const typeDrifts = reconciled.typeDrifts;
            const syncedCols = reconciled.selectCoverage.filter((s) => s.kernelOptionsAvailable && s.missingOptions.length === 0).length;
            const selectEnumCoverage = reconciled.selectCoverage.length > 0
                ? {
                    totalSelectCols: reconciled.selectCoverage.length,
                    syncedCols,
                    appLayerOnlyCols: reconciled.selectCoverage.length - syncedCols,
                    issues: reconciled.selectCoverage.filter((s) => !s.kernelOptionsAvailable || s.missingOptions.length > 0),
                }
                : undefined;
            const typedCols = (schema?.columns ?? []).filter((c): c is ColumnDef => Boolean(c.type));
            const fieldCapabilitySummary = typedCols.length > 0 && typedCols.length === (schema?.columns ?? []).length
                ? (() => {
                    const summary = summarizeModuleFieldCapabilities(moduleId, { columns: typedCols });
                    return {
                        totalFields: summary.totalFields,
                        genericFormCount: summary.genericFormCount,
                        specializedCount: summary.specializedCount,
                        nativeOnlyCount: summary.nativeOnlyCount,
                        nativeOnlyFields: summary.nativeOnlyFields,
                    };
                })()
                : undefined;

            const errors: string[] = [];
            if (!read.complete) errors.push(`incomplete read (${read.rows.length}/${read.rowCount})`);
            if (missing.length > 0) errors.push(`missing schema columns: ${missing.join(", ")}`);
            if (typeDrifts.length > 0) {
                errors.push(
                    `column type drift (user column preserved): ${typeDrifts.map((d) => `${d.colKey}(expected ${d.expectedType}, actual ${d.actualType})`).join(", ")}`,
                );
            }
            modules.push({
                moduleId,
                // A complete read is necessary but not sufficient: the provisioned
                // attribute view must also contain every schema-declared column with compatible types.
                ok: read.complete && missing.length === 0 && typeDrifts.length === 0,
                rows: read.rows.length,
                complete: read.complete,
                missingColumns: missing,
                ...(ghostColumns.length > 0 ? { ghostColumns } : {}),
                ...(typeDrifts.length > 0 ? { typeDrifts, schemaIssues: typeDrifts } : {}),
                ...(selectEnumCoverage ? { selectEnumCoverage } : {}),
                ...(fieldCapabilitySummary ? { fieldCapabilitySummary } : {}),
                error: errors.length > 0 ? errors.join("; ") : undefined,
            });
        } catch (e) {
            modules.push({ moduleId, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return { at: new Date().toISOString(), modules };
}
