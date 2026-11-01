/**
 * 家庭重要凭据与合同附件离线归档索引（§16/§17 303波）：
 * 聚合证件、合同、资产、保险等模块绑定的思源资源附件（mAsset），
 * 按家庭成员与业务模块分类组织，生成离线可读、可检索的结构化 Markdown 归档索引清单。
 * 纯函数，无网络，100% 可单元测试。
 */

import type { AssetRef } from "./assets";

export interface ArchiveRecordItem {
    id: string;
    module: string;
    title: string;
    memberName?: string;
    date?: string;
    expiry?: string;
    note?: string;
    attachments: AssetRef[];
}

export interface ArchiveManifestCategory {
    module: string;
    records: Array<{
        title: string;
        memberName?: string;
        date?: string;
        expiry?: string;
        attachments: Array<{ name: string; path: string }>;
    }>;
}

export interface ArchiveManifest {
    generatedAt: string;
    totalRecords: number;
    totalFiles: number;
    members: string[];
    categories: ArchiveManifestCategory[];
}

/**
 * 构建家庭凭据与附件归档清单数据结构
 */
export function buildArchiveManifest(
    records: ArchiveRecordItem[],
    options: { maskSensitive?: boolean; generatedAt?: string; t?: (k: string) => string } = {},
): ArchiveManifest {
    const { maskSensitive = false, generatedAt = new Date().toISOString().slice(0, 10), t } = options;
    const defaultMember = t ? t("members.unassigned") : "未指定成员";
    const defaultAttachment = t ? t("ledger.unnamed") : "未命名附件";
    const defaultRecord = t ? t("ledger.unnamed") : "未命名记录";

    const validRecords = (records || []).filter((r) => r.attachments && r.attachments.length > 0);
    const membersSet = new Set<string>();
    const categoryMap = new Map<string, ArchiveManifestCategory>();
    let totalFiles = 0;

    for (const r of validRecords) {
        const member = (r.memberName ?? defaultMember).trim();
        membersSet.add(member);

        let cat = categoryMap.get(r.module);
        if (!cat) {
            cat = { module: r.module, records: [] };
            categoryMap.set(r.module, cat);
        }

        const validAttachments = r.attachments
            .filter((a) => a && (a.content || a.name))
            .map((a) => ({
                name: a.name || a.content?.split("/").pop() || defaultAttachment,
                path: a.content || "",
            }));

        totalFiles += validAttachments.length;

        let displayTitle = r.title.trim() || defaultRecord;
        if (maskSensitive && displayTitle.length > 4) {
            displayTitle = displayTitle.slice(0, 2) + "***" + displayTitle.slice(-2);
        }

        cat.records.push({
            title: displayTitle,
            memberName: member,
            date: r.date,
            expiry: r.expiry,
            attachments: validAttachments,
        });
    }

    return {
        generatedAt,
        totalRecords: validRecords.length,
        totalFiles,
        members: Array.from(membersSet),
        categories: Array.from(categoryMap.values()),
    };
}

/**
 * 格式化输出离线 Markdown 归档索引文本
 */
export function formatArchiveManifestMarkdown(manifest: ArchiveManifest, t?: (k: string) => string): string {
    const translateMod = (m: string) => {
        if (!t) return m;
        const key = `module.${m}`;
        const val = t(key);
        return val !== key ? val : m;
    };

    const lines: string[] = [
        "# 📑 家庭重要凭据与合同附件归档索引",
        "",
        `> 生成日期：${manifest.generatedAt} · 记录总数：${manifest.totalRecords} 条 · 附件总数：${manifest.totalFiles} 份`,
        `> 涉及家庭成员：${manifest.members.join("、") || "全部"}`,
        "",
        "---",
        "",
    ];

    if (manifest.totalRecords === 0) {
        lines.push("当前范围无带附件的凭据或合同记录。");
        return lines.join("\n");
    }

    for (const cat of manifest.categories) {
        lines.push(`## 📁 ${translateMod(cat.module)}（${cat.records.length} 条记录）`);
        lines.push("");

        for (const rec of cat.records) {
            const metaParts: string[] = [];
            if (rec.memberName) metaParts.push(`成员：${rec.memberName}`);
            if (rec.date) metaParts.push(`发生日：${rec.date}`);
            if (rec.expiry) metaParts.push(`到期日：${rec.expiry}`);

            lines.push(`### ${rec.title}`);
            if (metaParts.length > 0) {
                lines.push(`*${metaParts.join(" · ")}*`);
            }
            lines.push("");

            for (const att of rec.attachments) {
                const link = att.path ? `[${att.name}](${att.path})` : att.name;
                lines.push(`- 📎 ${link}`);
            }
            lines.push("");
        }
    }

    lines.push("---");
    lines.push("*小驴管家 · 本地优先家庭资产管理归档文件*");
    return lines.join("\n");
}

/**
 * 格式化输出支持思源原生富表格 (custom-sy-table-rich) 的归档汇总表格
 * 首行表头固定，单元格内支持多附件与超链接渲染，满足资产与保单大表浏览需求（Issue #137）
 */
export function formatArchiveManifestTableMarkdown(manifest: ArchiveManifest, t?: (k: string) => string): string {
    const translateMod = (m: string) => {
        if (!t) return m;
        const key = `module.${m}`;
        const val = t(key);
        return val !== key ? val : m;
    };

    const lines: string[] = [
        "| 业务模块 | 事项名称 | 归属成员 | 业务日期 | 效期/到期 | 凭证与合同附件 |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ];

    for (const cat of manifest.categories) {
        for (const rec of cat.records) {
            const attLinks = rec.attachments.map((a) => a.path ? `[${a.name}](${a.path})` : a.name).join("、") || "—";
            lines.push(
                `| ${translateMod(cat.module)} | ${rec.title} | ${rec.memberName || "—"} | ${rec.date || "—"} | ${rec.expiry || "—"} | ${attLinks} |`
            );
        }
    }

    lines.push('{: custom-sy-table-rich="true" custom-sy-table-header-row="true" }');
    return lines.join("\n");
}

