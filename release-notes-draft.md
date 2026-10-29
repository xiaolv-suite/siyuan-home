# v0.5.179 · 小驴管家（内测版）台账列计算与载荷解耦、单测突破1027项（本地就绪版）

## 变更

- **台账缺失列排查、表格展示列与写入载荷构建解耦**：
  - 扩展 `src/core/ledger-view-model.ts`，集中封装缺失列感知计算（`computeMissingSchemaColumns`）、表格首选展示列推算（`computeTableKeys`）、模块提醒提前期阈值推导（`computeModuleWarnDays`）与单元格写入载荷构建（`buildLedgerCellPayload`）；
  - 彻底移除 `src/panels/screens/ledger.svelte` 中冗余重复的 `cellValue` 定义，台账主屏行数由 628 行精简至 **589 行**；
- **全量测试与门禁验证**：
  - 扩展 `tests/core/ledger-view-model.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **156 个测试套件、1,027 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 156 个测试文件，**1,027 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
