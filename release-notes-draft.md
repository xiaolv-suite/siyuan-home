# v0.5.132 · 小驴管家（内测版）对齐 Task Horizon 属性标准与 tm:task-completed 反向核销联动闭环

## 变更

- **对齐 Task Horizon 任务视界自定义属性标准**：
  - 增强 `src/core/block-capture.ts` 中的 `formatAsTaskBlock`，支持 Task Horizon 标准自定义属性集（`custom-status="todo"`、`custom-priority="high"`、`custom-completion-time`、`custom-remark` 关联管家行引用）；
  - 全面打通 `overview.svelte`（总览）、`reminders.svelte`（提醒中枢及批量复制）与 `calendar.svelte`（日历），复制或同步的任务块可无缝自动流入任务视界的日历、甘特图与四象限看板；
- **监听 tm:task-completed 实现生活待办反向核销**：
  - 在 `src/index.ts` 中实现 `markReminderDoneByBlockId`，打通监听 Task Horizon 任务完成事件 `tm:task-completed`；
  - 当用户在 Task Horizon 中打勾完成生活缴费或维保任务时，管家自动将对应的到期提醒核销为已办理，并同步记录打卡流水与即时更新生活指数；
- **全量测试与门禁验证**：
  - 新增 Task Horizon 任务属性构造及反向事件核销自动化单元测试，全仓 859 项单测全部全绿，五层静态门禁全部通过。

## 验证

- 108 个测试文件，**859 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1975 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
