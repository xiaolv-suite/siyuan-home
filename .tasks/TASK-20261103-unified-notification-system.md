# [TASK-20261103-unified-notification-system] 小驴管家 · 全生态去中心化统一通知系统接入任务

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **仓库路径**: `D:/思源插件/小驴管家`
- **生态标准核源文件**: `D:思源插件小驴快门siyuan-quickgatedocslv-notice-kit.ts`
- **标准协议**: Epoch 7 · 去中心化自协商 (Protocol v1.0.0)

---

## 一、 背景与设计目标

为了终结小驴全系列插件各自弹窗导致的“Toast 瀑布刷屏”、“报错无法回溯”、“通知过频打扰”等痛点，小驴生态已制定并落地了去中心化统一通知套件：
1. **绝对去中心化自协商**：零强依赖任何单一插件，谁先启动谁当 Coordinator，高版本自动热替换，卸载时平滑交棒，无孤儿 DOM；
2. **四级渐进降噪**：
   - `inline`（原位微动效）：复制/收藏等操作坚决不弹窗，直接在按钮上微弹反馈；
   - `capsule`（瞬时微胶囊）：常规简短提示，2.5s 自然淡出，余光可感知；
   - `card`（交互卡片）：重点到期提醒，支持【稍后提醒 15m/1h】、【今日免打扰】与操作跳转；
   - `silent`（静默入库）：后台自动保存/同步，全程零弹窗，仅进历史记录。
3. **全端自适应**：桌面端右下角 3D 毛玻璃悬浮卡片；手机端（<=640px）自适应为顶部灵动微条，避让刘海屏并支持上滑划走；
4. **同类消息自动计数折叠**：3 秒内高频消息自动变为 `×2`、`×3`，绝不刷屏。

---

## 二、 本插件专门改造重点

1. **引入标准核**：复制 `D:/思源插件/小驴快门/siyuan-quickgate/docs/lv-notice-kit.ts` 到 `src/libs/lv-notice-kit.ts`。
2. **后台大量扫描静默化**：管家拥有近 800 处通知，大量为自动同步、健康体检、备份检查。严格遵循《降噪矩阵》，将后台常规运行全部降级为 `lvNotify.silent`（零弹窗，仅进历史记录）。
3. **效期与重点提醒卡片化**：证件、保单、药品等到期提醒，使用 `lvNotify.card`，提供【去处理】按钮及【稍后提醒/今日跳过】选项。

---

## 三、 推荐落地实施步骤 (3步平滑改造)

### 步骤 1：引入标准核
复制标准核心文件到本插件源码目录：
```bash
cp "D:/思源插件/小驴快门/siyuan-quickgate/docs/lv-notice-kit.ts" "D:/思源插件/小驴管家/src/libs/lv-notice-kit.ts"
```
*(若打卡已有则直接使用)*

### 步骤 2：生命周期注册与交棒
在插件主类 `onload` 中注册，在 `onunload` 中注销：
```typescript
import { lvNotify } from "./libs/lv-notice-kit";

// onload 结尾：
this.noticeHubCleaner = lvNotify.registerPlugin("siyuan-home");

// onunload 开头：
this.noticeHubCleaner?.();
this.noticeHubCleaner = undefined;
```

### 步骤 3：统一出口智能拦截（无需改动全量业务代码）
在公共通知包装器（如 `showMessage`）中接入智能分流：
```typescript
function showMessage(message: string, timeout = 3000, type: "info" | "error" = "info") {
    if (type === "error") {
        lvNotify.card({
            source: "小驴管家",
            title: "小驴管家提示",
            message,
            level: "error",
            duration: Math.max(timeout, 6000),
        });
    } else {
        lvNotify.capsule({
            source: "小驴管家",
            message,
            duration: timeout,
        });
    }
}
```
对于复制、收藏等特定高频前台操作，逐步替换为 `lvNotify.inline(btnElement, "已复制")`。

---

## 四、 质量门禁与验收标准 (Quality Gate)

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 TS 错误；
2. **测试门禁**：运行 `pnpm test`（或对应测试脚本），确保全量单测 100% 通过；
3. **打包构建**：运行 `pnpm run build`，确保生产构建正常；
4. **本地 Git 规范**：严格执行**仅本地 commit**（Conventional Commit，如 `feat(notice): integrate ecosystem unified notice kit`），**绝不执行 git push**（GitHub 冻结保护）。
5. **任务状态回写**：完成后将本文档首部的 `- **任务状态**: `pending`` 改为 `completed`。

---

## 五、 实施验收记录 (2026-11-03 完工)

1. **引入标准核**：
   - 复制标准代码至 `src/libs/lv-notice-kit.ts`，并适配 Node/SSR/测试环境的内存 Hub 单例；
   - 建立高层出口包装层 `src/libs/notice.ts`，导出 `homeNotify`、`homeSilent`、`homeCard`、`homeInline` 等。
2. **生命周期集成**：
   - 在 `LvHomePlugin.onload` 结尾注册 `lvNotify.registerPlugin("siyuan-home")`；
   - 在 `LvHomePlugin.onunload` 开头注销 `this.noticeHubCleaner?.()`。
3. **后台常规扫描与备份 100% 静默化**：
   - 心跳定时巡检（`heartbeat-scan`）、历史台账智能对齐（`ledger-adopt`）、后台流水与日记增量同步（`journal-sync`）、配置导入前自动备份快照（`backup-preimport`）以及全量/增量常规扫描结果全面降级为 `lvNotify.silent`，仅进通知历史，全程 0 弹窗打扰。
4. **效期提醒卡片化**：
   - 打造 `src/core/hub/priority-reminder-delivery.ts`，精准筛选证件（certs）、保单（insurance）、药品（medicine）及关键合同/车辆等重点事项；
   - 逾期或 7 天临期使用 `lvNotify.card` 发送 3D 悬浮毛玻璃交互卡片，提供【去处理】快捷按钮、Snooze 稍后提醒（15m/1h）以及【今日免打扰/今日跳过】；
   - 重点卡片派发后，常规摘要自动静默入库，彻底杜绝双重弹窗。
5. **复制原位微反馈 (lvNotify.inline)**：
   - 时间线生活洞察复制（`activity-feed.svelte`）、年度生活指数报告复制（`life-index.ts`）；
   - 提醒中枢单条/批量复制事项任务块与块引用（`reminders-view-model.ts`、`reminder-batch-bar.svelte`）；
   - 总览界面复制事项任务块（`overview.svelte`）；
   - 原生日历视图复制当日事项与单条事项（`calendar.svelte`）；
   - 台账批量栏复制块引用（`ledger-batch-bar.svelte`）；
   - 台账详情抽屉复制卡片、Markdown、块引用与任务块（`drawer-actions.ts`）；
   - 复制时直接在触发按钮上呈现原位微弹反馈，彻底告别 Toast 刷屏。
6. **门禁全数通过**：
   - `pnpm run check`：0 错误、0 警告、类型全通、Svelte 5 全通、中英文 2,169 键对齐、0 安全漏洞；
   - `pnpm test`：200 个测试套件，1,249 项自动化测试 100% 通过；
   - `pnpm run build`：生产构建正常打包；
   - `node scripts/smoke-test.mjs` & `node scripts/verify-loader-semantics.mjs`：全数通过。

