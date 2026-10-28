# v0.5.161 · 小驴管家（内测版）总览模块网格解耦、概览主屏降至616行（本地就绪版）

## 变更

- **总览全功能模块网格、火花线趋势与折叠控制全面解耦**：
  - 独立抽取 `src/panels/screens/overview-module-grid.svelte`（210 余行），完整封装功能模块大类统计过滤（`moduleGroupStats` / `moduleGroupFilter`）、本地实时搜索过滤（`moduleQuery`）、模块分组首项与待办智能展开折叠（`isModuleGroupOpen`, `toggleModuleGroup`）、主数字记录行数与待办下钻、近 5 日待办动态火花线比例映射（`sparkOf`）、小驴考试连续学习天数及正确率徽章、健康模块打卡绑定强弱展示；
  - 概览主屏 `src/panels/screens/overview.svelte` 代码行数历史性降至 **616 行**（从最初 853 行累计精简 **237 行**，净精简达 **27.8%**）；
  - 全仓四大主屏全部稳居 616~788 行黄金区间；
- **全量测试与门禁验证**：
  - 新增总览模块网格与火花线趋势自动化单元测试套件 `tests/core/overview-module-grid.test.ts`，全仓单测套件扩增至 **137 个套件、960 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 137 个测试文件，**960 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












