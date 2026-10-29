# v0.5.175 · 小驴管家（内测版）台账视图模型解耦、单测突破1005项（本地就绪版）

## 变更

- **台账视图模型与数据计算中枢独立解耦**：
  - 独立抽取 `src/core/ledger-view-model.ts`（160 行），集中封装单元格格式化、脱敏（`formatLedgerCellText`）、到期展示级色调（`calculateLedgerTone`、`toneCls`、`toneColor`）、动态列输入历史建议（`computeColumnSuggestions`）、收纳位置预设（`computeDynamicLocations`）、安全排序（`sortLedgerRows`）与拼音多列搜索（`matchLedgerRowSearch`）；
- **台账多态空态呈现与骨架屏引导独立解耦**：
  - 独立抽取 `src/panels/screens/ledger-empty-state.svelte`（102 行），集中承载骨架屏加载、读取异常重试、未启用模块引导、未建库引导与搜索无匹配空态；
  - 台账主屏组件 `src/panels/screens/ledger.svelte` 代码行数大幅精简至 **628 行**（从最初 776 行精简 **148 行**，净精简达 **19.1%**）；
- **全量测试与门禁验证**：
  - 新增 `tests/core/ledger-view-model.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **152 个测试套件、1,005 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 152 个测试文件，**1,005 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
