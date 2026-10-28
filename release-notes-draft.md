# v0.5.150 · 小驴管家（内测版）历史台账接管与列自愈解耦、建库引擎降至531行（本地就绪版）

## 变更

- **历史台账发现接管、重名检测与列自愈全面解耦**：
  - 独立抽取 `src/core/provision-adoption.ts`（250 余行），完整承载同一笔记本内重名台账排查（`findDuplicateLedgers`）、绑定思源已有文档为台账（`bindExistingDoc`）、老版本历史台账全局智能探针找回与接管（`discoverAndAdoptAllLedgers`）以及属性视图缺失/幽灵列实时自愈校准（`healColumnMapping`）；
  - 台账建库与初始化驱动 `src/core/provisioner.ts` 代码行数历史性降至 **531 行**（从最初 752 行精简 **221 行**，净降幅达 **29.4%**），并在模块出口无缝保持 100% 签名与 API 向后兼容；
  - **核心引擎解耦大圆满**：小驴管家底层数据持久化三大核心引擎（`siyuan.ts` 820 行、`schema.ts` 771 行、`provisioner.ts` 531 行）全部进入精悍高内聚区间！
- **全量测试与门禁验证**：
  - 新增历史台账接管与自愈自动化单元测试套件 `tests/core/provision-adoption.test.ts`，全仓单测套件扩增至 **126 个套件、925 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 126 个测试文件，**925 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。











