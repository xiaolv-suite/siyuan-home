# v0.5.133 · 小驴管家（内测版）归档清单全面支持思源原生富表格属性升级，Issue #137 正式闭环验收

## 变更

- **归档清单全面升级思源原生富表格支持**：
  - 在 `src/core/archive.ts` 中实现 `formatArchiveManifestTableMarkdown`，支持将资产、保单、合同及重要证件清单一键生成为带原生富表格属性（`custom-sy-table-rich="true" custom-sy-table-header-row="true"`）的对比汇总大表；
  - 表头首行在思源中自动吸顶固定，单元格内完整支持保单与发票附件超链接，大幅提升大表浏览与复盘体验；
- **治理（正式闭环验收 Issue #137）**：
  - Issue #137（生态联邦协同与排雷规范）中 P0（关键词与大窗）、P1（iconLvHome与人脉打卡联邦）、P2（样式隔离与快捷键精简）及 Task Horizon 双向闭环与富表格等需求全部达成；
- **全量测试与门禁验证**：
  - 新增富表格生成测试，全仓 860 项单测全部全绿，五层静态门禁全部通过。

## 验证

- 108 个测试文件，**860 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1975 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
