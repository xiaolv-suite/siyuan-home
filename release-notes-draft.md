# v0.5.172 · 小驴管家（内测版）Bento看板与近期列表双组件解耦、overview降至514行（本地就绪版）

## 变更

- **总览主屏 Bento 特征看板与近期提醒列表双组件独立解耦**：
  - 独立抽取 `src/panels/screens/overview-bento-grid.svelte`（96 行），集中封装总览主屏特色 Bento 网格看板：
    1. 大方块 Bento 英雄特征卡（`urgentDueReminder` 倒计时徽章、最近到期事件智能路由）
    2. 双小方块 Bento 副卡（今日待办汇总与成员资料同步核对）
  - 独立抽取 `src/panels/screens/overview-upcoming-list.svelte`（131 行），集中封装近期提醒列表与空态骨架呈现：
    1. 标题栏动作与日期聚焦清除标签联动（`pulseDateFilter`）
    2. 首扫骨架屏态、扫描故障提示、成员筛选空态与全家就绪空态
    3. 近期提醒项行内卡片渲染、离场淡出动画（`fade`）、复制思源待办块、单条快速完成与延后 7 天动作
  - 总览主屏核心组件 `src/panels/screens/overview.svelte` 代码行数历史性降至 **514 行**（从最初 615 行精简 **101 行**，净精简达 **16.4%**）；
- **全量测试与门禁验证**：
  - 新增专项测试套件 `tests/core/overview-bento-grid.test.ts` 与 `tests/core/overview-upcoming-list.test.ts`，全仓单测扩展至 **148 个测试套件、991 项单测全部通过**；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 148 个测试文件，**991 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
