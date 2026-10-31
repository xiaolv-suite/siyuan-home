# v0.5.186 · 小驴管家（内测版）隔离工作区真实浏览器深度自测与 8 项生产级缺陷清零（本地就绪版）

> **单一事实来源说明（2026-10-31）**：本文件同步最新本地发版摘要，完整更新日志以 [`CHANGELOG.md`](./CHANGELOG.md) 与 [`README.md`](./README.md) 为准，完整自测报告见 [`docs/audit/2026-10-31-隔离工作区全真实浏览器深度自测与修复报告.md`](./docs/audit/2026-10-31-隔离工作区全真实浏览器深度自测与修复报告.md)。

## 变更摘要

- **新增隔离工作区真实 Chrome 自测套件（`scripts/e2e-isolated.mjs`，支持 `--keep` / `--headed`）**：从空白工作区自动冷启动独立思源内核并驱动 Chrome 模拟真实家庭 13 步深度自用与探索测试；
- **清零 8 项单测无法覆盖的真实生产级缺陷**：关闭破坏 Go 内核建库的 Terser `booleans_as_integers: true`、根治 Go 空单元格 `-62135596800000` 幽灵逾期告警、修复空台账切换 `$effect` 死循环崩溃、补齐向导初始成员 `avItemId` 建行、恢复新建证件专属字段渲染、修复日常流水保存不关窗、消除总览位置速查跨屏竞态、修复访客模式响应式更新。

## 验证

- **175 个测试套件 / 1,151 项自动化单测 100% 通过**（0 失败）。
- `pnpm run check`、`pnpm run smoke`、`pnpm run verify:loader`、`node scripts/e2e-isolated.mjs --keep` 13/13 全绿。
