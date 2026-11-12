# TASK-20261105-stale-task-micro-decomposition: 顽固事项降阻微拆解 (Stale Task Micro-Decomposition)

## 任务背景与核心使命
顺延 ≥3 次的顽固事项已陷入拖延泥潭——继续顺延无意义。提供"降阻微拆解"：
通过手动 3 步或 AI 帮拆，拆成 5 分钟可执行微步骤排入今日高优待办流，并经由 `lvAutomation.trigger("siyuan-home", "create-todo", { title, dueDate })` 与打卡仓既有规则管线联动。

## 详细功能落地
1. **顽固标记与判定** (`src/core/micro-decomposition.ts` & `src/types/index.ts`)：
   - 事项维护 `postponeCount`（同步兼容已有 `snoozeCount` 计数体系）；
   - 当 `postponeCount >= 3` 且未完成、未拆解时，卡片标题右侧呈现橙色「🧩 待拆解」徽记，悬停与长按提示「拆成 5 分钟小事更容易开始」；
   - 事项卡片左滑手势区增加「🧩 拆解」快捷芯片；卡片展开详情行提供直达入口。
2. **微拆解弹窗** (`src/core/micro-decomposition-dialog.ts`)：
   - 双端适配：手机端全屏 Dialog（`100dvh` / `100vw`），桌面端居中 Dialog（`520px`），Esc 与右上角/头部 ✕ 均可关闭，APG a11y 焦点回归；
   - 手动途径：预置 3 个输入框（每步 ≤30 字，placeholder 强调 5 分钟内能做完）；
   - AI 途径：「🤖 AI 帮我拆解」按钮调取 `lvAi.chat` 统一网关，向敏捷拆解专家请求 3 条微步骤 JSON；
   - 降级契约：`lvAi` 未配置时按钮置灰并提示引导，手动途径永远可用；
   - 安全转义：原事项名、用户输入与 AI 返回内容均采用 DOM 属性赋值或 `esc()` 渲染，彻底防御 XSS。
3. **确认拆解与生态联动**：
   - 过滤用户有效输入的 2~3 条微步骤，生成今日高优待办（`plugin.addMemo`，`priority: "high"`, `category: "微拆解"`）；
   - 跨插件联动：调用 `lvAutomation.trigger("siyuan-home", "create-todo", { title, dueDate })`，对齐打卡仓 `rule-home-to-checkin` 规则契约；
   - 原事项在运行态持久化标记 `decomposed: true`（`rt.decomposedReminders`），触发 `lvLaunchpad.haptic(10)`，微胶囊提示反馈，卡片徽记立即消失。

## 验收门禁与测试数据
- **单元测试** (`tests/core/micro-decomposition.test.ts`)：
  - `postponeCount >= 3` 顽固判定与 `decomposed` 过滤断言；
  - AI 返回标准 JSON 与 markdown 代码块包裹的 JSON 解析断言；
  - 初次畸形输出时的容错修正重试机制与降级分行提取断言；
  - AI 未配置（无 apiKey）时的降级契约断言；
  - 手动微拆解生成今日高优待办与 `create-todo` 载荷契约断言；
  - 弹窗 DOM 创建与交互行为断言。
- **全量测试**：**208 个套件、1,294 项单测 100% PASS**（新增 1 套件、15 项单测）
- **工程门禁**：
  - `pnpm run check:types`：0 错误
  - `pnpm run check:svelte`：0 错误，0 警告
  - `pnpm run check:i18n`：2,220 键完全对称对齐
  - `pnpm run check:meta`：package.zip 0.78 MB（符合预算）
  - `src/libs/lv-notice-kit.ts`：完全冻结，0 改动。
- 本地 commit 遵循规范："feat(stale-task): micro-step decomposition with manual and AI-assisted paths via lvAutomation"，严禁 push 远程。
