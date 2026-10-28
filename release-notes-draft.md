# v0.5.160 · 小驴管家（内测版）提醒视图排期解耦、运行态降至651行（本地就绪版）

## 变更

- **提醒命名视图、双日期排期计算与全模块置顶引擎全面解耦**：
  - 独立抽取 `src/core/hub/runtime-views.ts`（150 余行），完整封装提醒命名视图持久化保存、更新、删除与筛选条件映射（`saveNamedView`, `removeNamedView`, `applyNamedView`）、双日期计划处理日偏差天数计算与专注模式判定（`getReminderPlanStatus`, `setReminderPlanDate`, `clearReminderPlanDate`）、一键批量推入今日计划（`batchPushRemindersToTodayPlan`）以及通用与遗留备忘提醒双模置顶管理（`toggleReminderPinInRuntime`, `isReminderPinned`）；
  - 运行态存储管理核心 `src/core/hub/runtime.ts` 代码行数历史性降至 **651 行**（累计精简 **144 行**，净精简达 **18.1%**）；
  - 全仓核心架构持续精悍化，所有核心运行态与驱动文件全面稳定于 400~780 行区间；
- **全量测试与门禁验证**：
  - 新增视图排期与置顶引擎自动化单元测试套件 `tests/core/runtime-views.test.ts`，全仓单测套件扩增至 **136 个套件、957 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 136 个测试文件，**957 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












