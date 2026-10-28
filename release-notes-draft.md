# v0.5.151 · 小驴管家（内测版）提醒已处理视图解耦、ICS导出中枢下沉、提醒主屏降至854行（本地就绪版）

## 变更

- **提醒中枢已处理/归档列表与 ICS 导出调度全面解耦**：
  - 独立抽取 `src/panels/screens/reminder-handled-list.svelte`，统一封装已处理事项（完成/静音/周期已过/备忘）列表展示、类型标签映射、恢复提醒、永久删除备忘及无障碍分页加载；
  - 在 `src/core/reminder-dialogs.ts` 新增 `exportReminderIcs` 统一调度函数，彻底消除主屏内联的 ICS 构造与敏感模块二次确认长逻辑；
  - 提醒主屏 `src/panels/screens/reminders.svelte` 代码行数历史性降至 **854 行**（从最初 1,436 行累计精简 **582 行**，净精简达 **40.5%**）；
- **全量测试与门禁验证**：
  - 新增提醒已处理事项列表自动化单元测试套件 `tests/core/reminder-handled-list.test.ts` 并扩充 `tests/core/reminder-dialogs.test.ts`，全仓单测套件扩增至 **127 个套件、929 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 127 个测试文件，**929 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












