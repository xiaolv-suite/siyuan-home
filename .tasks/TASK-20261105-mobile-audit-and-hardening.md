# TASK-20261105-mobile-audit-and-hardening: 手机端与全量细节自查 · 打磨轮（不开新功能）

## 任务背景与目标
针对【手机端与全量细节自查 · 打磨轮（不开新功能）】开展 12 类通用项目自查与 2 项专项疑点排查：
1. **资源生命周期**：复核并补全 `URL.createObjectURL` 的 `setTimeout(..., 0)` 延迟 revoke，防止移动端异步下载时提前失效；
2. **竞态时序**：排查异步搜索与弹层组件在 closed/销毁时的时序校验；补全 Svelte 组件 unmount 显式调用；
3. **剪贴板反馈**：补齐 `navigator.clipboard.writeText` 漏网的 try/catch 失败分支提示；
4. **焦点管理**：复核 APG 标准对话框焦点捕获、Esc 拦截与关闭焦点安全回落；
5. **对比度令牌**：将硬编码文本白字替换为 `--b3-theme-on-primary` / `--b3-theme-on-error` 等对比度令牌；
6. **移动端输入**：全量补齐 `type="number"` 输入框的 `inputMode="numeric"`；
7. **时序边界**：确认休眠唤醒补跑与跨日状态自动对齐机制；
8. **i18n 对齐**：增量补齐中英文词条并保证 100% 对称；
9. **HTML 规范**：排查全量动态创建按钮，显式声明 `type="button"` 防止误提交；
10. **XSS 面**：全量扫描消除 `innerHTML` 用户插值漏洞（车名、证件链、行日志字段、忌口排查、家务积分、作品名）；
11. **渲染粒度**：逾期左滑芯片操作定向增删与防抖锁深度加固；
12. **专项疑点 1**：左滑顺延芯片增加防重锁（`disabled={isBusy}` + `if (isBusy) return;`）；
13. **专项疑点 2**：证件照超大图拍照留存全流程 loading 态反馈（`⏳ 正在压缩...` → `☁️ 正在上传...`）。

## 修复清单与覆盖文件
1. `src/core/assets.ts` & `tests/core/assets.test.ts`：`downloadAsset` 延迟 `setTimeout(() => URL.revokeObjectURL(...), 0)`，单测宏任务对齐。
2. `src/core/offline-manual-exporter.ts`、`src/panels/screens/calendar.svelte`、`src/panels/settings-data-tab.svelte`：同步 revoke 全部修正为异步延迟 revoke。
3. `src/core/mobile-controller.ts`：`closeMobilePanel` 显式调用 Svelte 5 `mobileDialogUnmount()`，确保组件 effect 与销毁函数完整触发。
4. `src/core/spotlight-dialog.ts`：增加 `isClosed` 代际标记与异步退出；`copyRef.type = "button"`。
5. `src/panels/screens/ledger-table.svelte`：补齐块引用复制的 `try/catch` 失败反馈。
6. `src/styles/design-system.scss` & `src/index.scss`：修正 `.lv-seg-btn.active` 与 `.lv-mob-badge` 的对比度文字令牌。
7. `src/panels/quick-event-flow.svelte` & `src/panels/settings-reminders-tab.svelte`：5 处 `type="number"` 补齐 `inputMode="numeric"`。
8. `src/core/fuel.ts`、`src/core/attachment-drawer.ts`、`src/core/bookmarks.ts`、`src/core/drawer-actions.ts`、`src/core/drawer-conversions.ts`、`src/core/drawer-domain-sections.ts`、`src/core/drawer-sections.ts`、`src/core/growth-dialog.ts`、`src/core/ledger-detail-drawer.ts`、`src/core/location-dialog.ts`、`src/core/record-form.ts`、`src/core/reminder-dialogs.ts`、`src/core/triage-to-ledger.ts`：补齐动态按钮 `type="button"`。
9. `src/core/fuel.ts`、`src/core/drawer-sections.ts`、`src/core/drawer-module-sections.ts`、`src/core/drawer-domain-sections.ts`、`src/core/rewards-dialog.ts`、`src/core/media.ts`：全量增加 `esc` 转义消除 XSS 盲区。
10. `src/panels/screens/reminder-card.svelte`：左滑顺延 chip 增加 `disabled={isBusy}` 与前置防抖锁。
11. `src/core/attachment-drawer.ts` & `public/i18n/`：证件大图拍照压缩及上传添加 `certs.compressing` 与 `certs.uploading` 动态按钮状态反馈。

## 验证数据
- `pnpm run check:i18n`：2,203 键 100% 对齐
- `pnpm run check:types`：0 错误
- `pnpm run check:svelte`：0 错误，0 警告
- `pnpm run check:meta`：package.zip 0.78 MB（符合预算）
- `pnpm test`：207 套件、1,279 单测 100% PASS
- `pnpm run check`：全流水线与依赖审计完全绿灯
- `src/libs/lv-notice-kit.ts`：0 改动，绝对未触碰
- 本地原子 commit，严禁 push 远程。
