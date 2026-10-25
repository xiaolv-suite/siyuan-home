# v0.5.65 · 小驴管家（内测版）批量操作并发保护加固与跨模块提醒中枢秒级联动

## 变更

- **批量归属与批量位置操作并发保护与扫描联动**：
  - 批量指派家庭成员（`openBatchMemberModal`）与批量调整存放位置（`openBatchLocationModal`）全面接入 `batchBusy` 防连击互斥锁；
  - 批量更新完成后自动异步触发当前模块重扫（`plugin.refreshHub([active])`），使成员面板、位置索引与提醒中枢秒级同步最新归属；
- **全量门禁与 801 项单测全绿**：
  - 保持全量 91 个测试套件、801 项单元测试与 E2E 测试 100% 绿灯。

## 验证

- 91 个测试文件，**801 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
