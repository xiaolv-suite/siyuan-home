# [TASK-20261103-phase3-ai-and-activity] 小驴管家 · 第三阶段：AI统一网关与全生态今日活动流工单

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **核心库源**: `src/libs/lv-notice-kit.ts` (已升级至 Protocol v1.2.0)
- **标准协议**: Epoch 7 Phase 3 · AI 网关与今日活动流

---

## 一、 第三阶段核心改造目标

1. **统一 AI 凭据与并发限流网关 (lvAi)**：
   - 彻底告别每个插件重复填 Key；在任一插件配置好的共享 API Key，通过 `lvAi.chat({ source, messages })` 自动继承复用；
   - 全局令牌桶自动限制最大并发（<=2），遇到 429 自动按指数退避重试，调用方零额外容灾代码；
2. **今日全生态活动主干流 (lvActivity)**：
   - 各插件的关键产出（打卡记录、剪藏文章、试卷交卷、卡片复习、人脉互动）通过 `lvActivity.record({ source, category, title })` 统一汇报；
   - 今日打卡/工作台可直接读取 `lvActivity.getTodayRecords()`，并调用 `lvActivity.formatAsMarkdown()` 一键将今日全家桶成果汇编入 Daily Note！

---

## 二、 本插件专属改造重点

1. **待办完成活动广播**：事项归档时广播 lvActivity.record({ source: "管家", category: "task", title: `完成待办: ${taskTitle}` })；
2. **管家仪表盘展示全生态今日动态**：在概览面板中嵌入展示全家桶活动时间线。

---

## 三、 质量门禁与验收标准

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 报错；
2. **测试门禁**：运行 `pnpm test` 确保全量测试通过；
3. **任务状态回写**：完成后将首行 `- **任务状态**: `pending`` 改为 `completed`；
4. **严格本地提交**：Conventional Commit 规范（如 `feat(synergy): integrate lvAi and lvActivity for phase 3`），**严禁 git push**。

---

## 四、 实施验收记录 (2026-11-03 完工)

1. **升级至 Protocol v1.2.0 标准核心套件**：
   - `src/libs/lv-notice-kit.ts` 完整支持 `lvAi` (共享 Key/模型、令牌桶限流与 429 指数退避) 与 `lvActivity` (今日活动流广播、收集与 Markdown 汇编)；
   - 适配 Node/SSR 单元测试环境下的内存 Fallback 与活动订阅分发机制。
2. **待办完成活动广播**：
   - `src/index.ts` 中的 `complete(r)` 办结归档事项时，自动调用 `lvActivity.record({ source: "管家", category: "task", title: "完成待办: ${taskTitle}", ... })` 广播至生态主干流。
3. **管家仪表盘展示全生态今日动态**：
   - 新增 `src/panels/screens/overview-ecosystem-activity.svelte` 组件，嵌入在概览面板中实时展示全生态今日动态时间线；
   - 支持实时事件监听、复制今日活动汇编 Markdown 到剪贴板，以及通过 `withDocLock` 安全将活动流写入流水日记。
4. **全量门禁检验通过**：
   - `pnpm run check`：0 错误，0 警告，i18n 2177 键全对齐；
   - `pnpm test`：202 测试套件、1,257 项自动化单测 100% 全绿；
   - `pnpm run build`、`smoke-test`、`verify-loader-semantics`：生产包与加载器语义全绿。

