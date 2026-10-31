# v0.5.187 · 小驴管家（内测版）隔离环境全界面二轮深挖与暗色对比度/车辆快捷加油/数量步进/访客隔离修复（本地就绪版）

> **单一事实来源说明（2026-10-31）**：本文件同步最新本地发版摘要，完整更新日志以 [`CHANGELOG.md`](./CHANGELOG.md) 与 [`README.md`](./README.md) 为准，完整自测报告见 [`docs/audit/2026-10-31-隔离工作区全真实浏览器深度自测与修复报告.md`](./docs/audit/2026-10-31-隔离工作区全真实浏览器深度自测与修复报告.md)。

## 变更摘要

- **修复暗色模式主按钮与激活胶囊对比度（`1.86:1` ➔ `9.8:1`）**：引入 `--lv-on-accent` 与 `--lv-on-data` 令牌；
- **修复车辆卡片「记加油 / 记充电」快捷按钮无法唤起录入表单**：修正 `vehicle-energy-section.ts` 中 `registerVehicleAction` 的 DOM 挂载时序；
- **恢复囤货/药箱/购物主表 `qty` 与 `stock_qty` 行内 `+/-` 步进列展示**；
- **补齐访客只读模式（Guest Mode）跨屏敏感模块隐藏与写操作全面拦截**；
- **实现弹窗异步按钮 `type="button"` 自动补齐与次级按钮 `≥24px` 热区达标（全界面 DOM/UI 巡检 0 告警）**。

## 验证

- **175 个测试套件 / 1,151 项自动化单测 100% 通过**（0 失败）。
- `pnpm run check`、`pnpm run smoke`、`pnpm run verify:loader`、`pnpm run e2e:isolated -- --keep` 13/13 全绿。
