# v0.5.158 · 小驴管家（内测版）抽屉子记录时间线与二维码下沉、详情抽屉降至644行（本地就绪版）

## 变更

- **台账详情抽屉子记录日志与二维码分享渲染全面下沉**：
  - 在 `src/core/drawer-sections.ts` 独立新增 `renderRowLogSection` 引擎与 `renderDrawerQrSection`，完整内聚子记录动态输入框表单生成、Enter 快速添加、日期校验、删除确认与乐观更新，并将 `markActivityLine` 时间线定位工具函数统一下沉至 `src/core/activity.ts` 导出复用；
  - 台账详情抽屉核心 `src/core/ledger-detail-drawer.ts` 代码行数历史性降至 **644 行**（从最初 1,554 行累计精简 **910 行**，净精简达 **58.6%**）；
  - 全仓所有详情与展示抽屉组件（`ledger-detail-drawer.ts` 644 行、`vehicle-drawer.ts` 726 行、`drawer-module-sections.ts` 724 行）全面收敛在精悍受控区间；
- **全量测试与门禁验证**：
  - 扩充抽屉专属板块自动化单元测试套件 `tests/core/drawer-sections.test.ts`，全仓单测套件扩增至 **134 个套件、949 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 134 个测试文件，**949 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












