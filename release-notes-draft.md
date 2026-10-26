# v0.5.108 · 小驴管家（内测版）台账抽屉与快速录入全场景 Ctrl+Enter 快捷提交全闭环

## 变更

- **台账新建抽屉支持 Ctrl+Enter / Cmd+Enter 快速保存**：
  - 台账页“＋ 新建记录”抽屉接入 `onNewRecordKeydown` 快捷保存：在表单任意控件按下 `Ctrl+Enter`（macOS 下 `Cmd+Enter`）即可立即提交并关闭；
  - 组合 `Ctrl+Alt+Enter` 支持直接连续录入下一条，保存按钮同步呈现快捷键提示；
- **表单提交状态派生收敛**：
  - 提取 `canSubmitNewRecord` 统一驱动新建抽屉按钮禁用态与按键拦截，收敛重复逻辑；
- **全量测试与门禁验证**：
  - 保持全仓 811 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**811 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1956 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
