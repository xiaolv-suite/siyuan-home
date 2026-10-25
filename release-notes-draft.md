# v0.5.64 · 小驴管家（内测版）台账抽屉样式收敛瘦身与体积预算余量优化

## 变更

- **台账抽屉重复样式常量收敛**：
  - 收敛 `ledger.svelte` 内部重复出现的十几处长样式字面量（`sectionBorderCss`、`sectionHeaderCss`、`subCardBoxCss`、`metricCardCss` 等）；
  - 单文件产物精确 gzip 体积优化至 277,971 字节，进一步扩大安全预算余量；
- **全量门禁与 801 项单测全绿**：
  - 保持全量 91 个测试套件、801 项单元测试与 E2E 测试 100% 绿灯。

## 验证

- 91 个测试文件，**801 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
