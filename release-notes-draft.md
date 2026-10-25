# v0.5.76 · 小驴管家（内测版）提醒中枢排期与表单弹窗样式收敛瘦身

## 变更

- **提醒与台账常用弹窗样式常量收敛**：
  - 对 `reminders.svelte` 与 `ledger.svelte` 内部的 15 处重复弹性布局样式字面量进行体系化收敛（`rowFlexCenterCss`、`wrapBorderCss`、`h3TitleCss`、`hintTextCss`、`fieldErrCss`、`actionRowEndCss` 等）；
  - 单文件未压缩原始体积从 949.09 kB 进一步下降至 948.63 kB；
- **全量测试与门禁验证**：
  - 保持全仓 804 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**804 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
