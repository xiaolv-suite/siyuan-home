# v0.5.75 · 小驴管家（内测版）台账详情抽屉深度瘦身与高频行样式常量收敛优化

## 变更

- **台账高频子行样式收敛与构建瘦身**：
  - 对 `ledger.svelte` 内部的 25 处长内联样式字面量进行体系化收敛（`itemRowCss`、`lineBadgeCss`、`colLeftCss`、`sectionHeadBorderCss`、`linkBtnCss`、`boxContentCss`、`btnActionSmCss` 等）；
  - 单文件原始体积从 950.34 kB 降至 949.09 kB，优化产物压缩冗余，扩大 CI 门禁安全缓冲；
- **全量测试与门禁验证**：
  - 保持全仓 804 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**804 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
