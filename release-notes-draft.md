# v0.5.154 · 小驴管家（内测版）生态集成中枢独立下沉、主入口大瘦身241行（本地就绪版）

## 变更

- **小驴生态深度联动与中枢事件调度全面独立解耦**：
  - 独立抽取 `src/core/ecosystem-integration.ts`（280 余行），完整封装雷切快捷动作与小组件注册（`registerRaikiriModuleSafely`）、服务桥 `window.LvHome` 挂载与销毁、打卡强度摘要定时节流拉取（`pullCheckinSummary`）、家庭摘要快照生成（`buildHomeSummarySnapshot`）、考试/闪卡活跃度事件监听（`lv-exam:stats`, `lv-cards:reviewed`）以及任务核销联动（`tm:task-completed`）；
  - 插件主入口 `src/index.ts` 代码行数历史性降至 **1,246 行**（从最初 1,487 行精简 **241 行**，净精简达 **16.2%**）；
  - 插件主生命周期 `onload` / `onunload` 极其精简明晰，大幅提升了顶层架构的可读性与健壮性；
- **全量测试与门禁验证**：
  - 新增生态集成中枢单元测试套件 `tests/core/ecosystem-integration.test.ts`，全仓单测套件扩增至 **129 个套件、935 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 129 个测试文件，**935 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












