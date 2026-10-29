# v0.5.178 · 小驴管家（内测版）提醒视图模型解耦、单测突破1023项（本地就绪版）

## 变更

- **提醒视图模型与纯计算引擎独立解耦**：
  - 独立抽取 `src/core/reminders-view-model.ts`（160 行），集中封装多维过滤（`filterReminders`、`filterHandledEntries`）、分组与置顶排序推算（`computeReminderDisplayGroups`、`sortPinnedFirst`）、规则与类型多语言文本解析、提前量段位徽章推算（`getReminderStage`）、思源原生任务块语法写入（`copyReminderAsTaskBlock`）与双日期今日排程切换（`toggleReminderQuickPlanToday`）；
- **提醒主屏页头摘要与样式独立解耦**：
  - 独立抽取 `src/panels/screens/reminder-hero-bar.svelte`（75 行），集中封装提醒页顶部 Hero 导览、到期总数与逾期高亮看板以及独立响应式样式；
  - 提醒主屏核心组件 `src/panels/screens/reminders.svelte` 代码行数降至 **505 行**（从 666 行净减 **161 行**，净精简达 **24.2%**）；
- **全量测试与门禁验证**：
  - 新增 `tests/core/reminders-view-model.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **156 个测试套件、1,023 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 156 个测试文件，**1,023 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
