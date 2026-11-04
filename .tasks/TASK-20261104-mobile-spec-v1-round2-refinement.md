# TASK-20261104-mobile-spec-v1-round2-refinement: 手机端第二轮优化 · 真机教训审计与深化

## 任务背景与目标
落实【手机端第二轮优化 · 真机教训审计 + 深化】规范：
1. **真机教训强制审计**：
   - **Esc-only 关闭面审计**：全局审计 Dialog 创建点，在 `src/core/dialog-a11y.ts` 实现全局保障（自动兜底绑定取消/关闭点击；移动端或窄屏无可见关闭钮时自动在 header 顶部注入触控目标 ≥44px 的显式 ✕ 关闭按钮），并在 `src/core/spotlight-dialog.ts`（全景生活检索）输入框右侧显式配备关闭按钮 `✕`。
   - **焦点移除卡死审计**：重构依赖 blur/focusout 自动提纯的表单逻辑，在 `saveNewRecord` 与 `createRow` 入口强制主动前置重算，彻底规避焦点元素被移除时 Chromium 不派发 focusout 的卡死通病。
   - **svgIcon 一致性**：核对并修正 `src/index.ts` 注册小驴罗盘条目时的 `svgIcon: "iconLvHome"`，与 `addIcons` 注入的官方 SVG sprite ID 完全逐字一致。

2. **本插件专项深化**：
   - **逾期卡片手势**：`src/panels/screens/reminder-card.svelte` 支持逾期卡片左滑手势（向左横滑跟手位移，滑出超过 60px 展开快捷批延动作区），支持「顺延 1 天 / 顺延 1 周 / 明天再说」三个快捷 chips，点击/松手即批延并联动 `lvLaunchpad.haptic(10)` 触感反馈。
   - **证件/证件照 mobile 拍摄**：在 `src/core/attachment-drawer.ts` 证件详情页新增「📷 拍照留存」按钮，直接唤起 `<input type="file" accept="image/*" capture="environment">` 调起手机后置相机；拍后使用 HTML5 Canvas 纯前端自动等比缩放并有损压缩至 ≤300KB（`src/core/assets.ts` `compressImageTo300KB`），安全保存至附件并触发触感确认。
   - **快速备忘语法补齐第 4 类**：在 `@日期`、`!优先级`、`#分类` 之外，新增输入 `$` 触发金额快捷 chips（`¥10`、`¥20`、`¥50`、`¥100`、`¥200`、`¥500`、`¥1000`），支持点击智能插入并精准被 `parseQuickAdd` 识别为记账金额，配合触感振动。

## 验证结论
- `pnpm run check:types`：0 错误
- `pnpm run check:svelte`：0 错误，0 警告
- `pnpm run check:i18n`：2,201 词条完全对称
- `pnpm run check:meta`：元数据与产物体积通过
- `pnpm test`：207 套件、1,279 项单元测试 100% PASS
- 本地 commit 完成，严禁 push 远程，严守生态铁律。
