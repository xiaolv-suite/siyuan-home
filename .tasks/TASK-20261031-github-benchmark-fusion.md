# [TASK-20261031-github-benchmark-fusion] 小驴管家 · GitHub 三大顶级对标产品深度调研与融合方案

> **单一事实来源迁移说明（2026-10-31 盘点）**：本文件判定为 **已落地未标记（部分半成品已于 v0.5.184 补齐闭环）**。所有有效待办与验收记录已统一归并至唯一待办池 [`TODO.md`](../TODO.md) 与完整审计报告 [`docs/audit/2026-10-31-全量盘点与闭环验收报告.md`](../docs/audit/2026-10-31-全量盘点与闭环验收报告.md)，原文件保留不删。

- **任务状态**: `completed`
- **完成时间**: 2026-10-31
- **目标插件**: `小驴管家 (siyuan-home)`
- **仓库路径**: `D:\思源插件\小驴管家`
- **对标产品**:
  1. [`go-vikunja/vikunja`](https://github.com/go-vikunja/vikunja) — 现代开源任务管理与自然语言输入标杆
  2. [`johannesjo/super-productivity`](https://github.com/johannesjo/super-productivity) — 深度工作规划、时间盒（Timeboxing）与反拖延标杆
  3. [`Tasks-org/tasks`](https://github.com/Tasks-org/tasks) — 高自由度周期提醒与推迟（Snooze）规则引擎标杆

---

## 一、 三大参考产品深度调研剖析

### 1. `go-vikunja/vikunja` 核心精华
- **Quick Add Magic 自然语言语法解析**：在单行备忘输入框内输入 `交物业费 !p1 #家庭 @明天 18:00 *每月15号`，实时解析出任务标题、优先级（`!p1`~`!p4`）、分类标签（`#家庭`）、截止时间（`@明天`）与循环规则（`*每月`），并在输入时高亮语法 Token。
- **四视图同源切换 (List / Kanban / Eisenhower Matrix / Timeline)**：同一批管家提醒事项，既可按常规到期时间列表查看，也可一键切换为「艾森豪威尔四象限（重要/紧急）」或「今日/本周/逾期三栏看板」。

### 2. `johannesjo/super-productivity` 核心精华
- **每日晨间规划向导 (Plan Your Day Ritual)**：每天首次打开管家总览时，顶部展示精简的“今日聚焦（Today's Focus）”聚合卡：列出昨日遗留逾期项（提供一键顺延至今日或重排期）、今日到期项，以及预计耗时评估。
- **反拖延子任务拆解与关联思源块附件 (Context Attachments)**：针对反复推迟超过 3 次的顽固待办，自动提示“该任务已推迟 3 次，是否拆解为 2 分钟可启动的微步骤？”，并支持直接绑定思源笔记文档/块作为执行上下文。

### 3. `Tasks-org/tasks` 核心精华
- **双基准循环规则 (Repeat from Due Date vs. Repeat from Completion Date)**：
  - **按固定日历循环**（如“每月 10 号还信用卡”）：无论哪天完成，下一次仍在下月 10 号；
  - **按实际完成日顺延**（如“每隔 14 天换床单/剪指甲/浇水”）：如果推迟到 15 号才完成，下一次自动从 15 号往后推 14 天，避免账单式堆积！
- **一键梯度推迟胶囊 (One-Tap Snooze Presets)**：提醒触发或即将到期时，提供 `+1小时`、`今晚 20:00`、`明天上午`、`下周一` 四个零思考推迟胶囊。

---

## 二、 适合融合进「小驴管家」的落地改造清单

### 改造项 A：快速备忘自然语言语法解析器（借鉴 Vikunja Quick Add Magic）
- **涉及目录**：`src/core/`、`src/panels/`、`src/ui/`
- **具体内容**：
  1. 在管家快速备忘输入与 `home.memo` 处理层增加轻量自然语言标记解析：支持 `@今天`、`@明天`、`@下周一`、`@+3d`、`!高/!中/!低`（或 `!1`/`!2`/`!3`）、`#分类名`，实时转化为结构化字段并展示解析预览胶囊。

### 改造项 B：「按计划日循环」与「按完成日顺延循环」双模式 + 一键梯度推迟（借鉴 Tasks.org）
- **涉及目录**：`src/core/`、`src/types/`、`src/ui/`
- **具体内容**：
  1. 为周期性提醒事项增加 `recurrenceAnchor: "due" | "completion"` 属性：家务护理类事项支持“自实际完成日起 +N 天生成下一期”。
  2. 在提醒中枢（Reminders）卡片的操作栏补充一键 Snooze 快捷菜单（`推迟1天`、`推迟至周末`、`推迟至下周一`），并记录推迟次数 `snoozeCount`。

### 改造项 C：逾期顺延批处理与「顽固拖延项预警」（借鉴 Super Productivity）
- **涉及目录**：`src/panels/`、`src/ui/`
- **具体内容**：
  1. 当存在多条 `overdue`（逾期）事项时，在管家总览顶部提供「一键全部顺延至今日」批量动作按钮（带撤销能力）。
  2. 当某事项 `snoozeCount >= 3` 时，在卡片上渲染温和的橙色「微步骤拆解提示徽标」，引导用户拆解或降级。

---

## 三、 质量门禁与验收标准 (Quality Gate)
1. 新增单元测试覆盖自然语言备忘语法解析器、双基准循环日期推算（含闰年与大小月边界）、一键推迟计数逻辑；
2. 运行 `pnpm test` 确保全量测试 100% 通过；
3. 运行 `pnpm build` 确保生产打包零错误；
4. 严格本地 Git 提交，禁止 `git push`。

---

## 四、 交付与验证记录 (Verification Record)
- **单元测试**: `tests/core/github-benchmark-fusion.test.ts` (16 测试用例) 全数通过；全量测试套件 173/173 suites、1,126/1,126 tests 100% 通过。
- **质量门禁**:
  - `pnpm check:types`: 0 errors
  - `pnpm check:svelte`: 0 errors, 0 warnings
  - `pnpm check:i18n`: 2,045 keys aligned, 1,301 static keys verified
  - `pnpm check:meta`: package.zip 0.71 MB
  - `pnpm check:audit`: 0 vulnerabilities
  - `pnpm smoke`: OK, all required files present
- **产物体积**: `dist/index.js gzip` 304.4 KB (311,742 bytes)，处于 310KB (317,440 bytes) 预算红线内。

