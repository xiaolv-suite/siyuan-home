# v0.5.74 · 小驴管家（内测版）键盘优先录入体验全场景闭环与常用弹窗回车提交覆盖

## 变更

- **常用弹窗输入框全面接入回车快捷提交**：
  - 提醒排期弹窗（`schedulePlanDialog` 日期输入）、保存命名视图弹窗（`promptSaveNamedView` 视图名称）、绑定文档弹窗（`bindDocInput`）、批量存放位置弹窗（`batchLocationInput`）全面绑定 `Enter` 快捷提交；
  - 键盘操作无缝直达，免去频繁伸手使用鼠标点击保存的繁琐流程；
- **全量测试与门禁验证**：
  - 保持全仓 804 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**804 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
