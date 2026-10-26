# v0.5.84 · 小驴管家（内测版）全页面深度逐屏微雕：总览备忘动作强化、车辆卡片立体悬浮、日历录入闭环与成员退休倒计时进度美化

## 变更

- **全盘逐屏逐模块深度布局优化**：
  - **总览屏（`overview.svelte`）**：快速备忘卡添加按钮升级为标准主操作按钮（`lv-btn primary sm`），显著提升输入与保存视觉焦点；
  - **台账屏（`ledger.svelte`）**：车辆卡片（`.lv-vehicle-card`）接入 `-2px` 平滑悬浮抬起与立体阴影（`var(--lv-shadow-2)`），与成员卡、Bento 卡达成完全统一的心流反馈；
  - **成员屏（`members.svelte`）**：退休倒计时卡片进度条加粗至 6px 并配备线性双色温渐变（`var(--lv-accent) ➔ #f59e0b`），进度清晰易读；
  - **日历屏（`calendar.svelte`）**：当日备忘添加按钮升级为小尺寸主按钮（`lv-btn primary sm`），保持全屏操作一致；
  - **提醒屏（`reminders.svelte`）**：批量操作悬浮条（`.lv-hub-batchbar`）边框与阴影加固，高亮批处理心流；
- **全量测试与门禁验证**：
  - 保持全仓 804 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**804 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
