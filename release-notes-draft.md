# v0.5.157 · 小驴管家（内测版）设置页关于与诊断解耦、设置面板降至788行（本地就绪版）

## 变更

- **设置页关于与系统诊断、维护调度全面解耦**：
  - 独立抽取 `src/panels/settings-about-tab.svelte`（110 余行），完整封装系统轻量/深度健康检查（`runDeepHealthCheck`）、成员反向关联回填（`runBackfillMemberLinks`）、历史台账接管发现与一键重建（`runAdoptHistoryLedgers`, `rebuildAllLedgers`）、重复台账排查（`runDuplicateCheck`）、诊断数据快照与预览模态框（`previewDiagnostics`）以及向导重新运行（`rerunOnboarding`）；
  - 设置面板 `src/panels/settings.svelte` 代码行数历史性降至 **788 行**（从最初 1,021 行累计精简 **233 行**，净精简达 **22.8%**）；
  - 全仓四大主屏与核心配置面板全部稳居 800 行以内的极佳可维护架构区间；
- **全量测试与门禁验证**：
  - 新增设置关于与诊断面板自动化单元测试套件 `tests/core/settings-about-tab.test.ts`，全仓单测套件扩增至 **134 个套件、948 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 134 个测试文件，**948 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












