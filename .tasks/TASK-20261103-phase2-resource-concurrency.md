# [TASK-20261103-phase2-resource-concurrency] 小驴管家 · 第二阶段：系统资源与并发加固落地工单

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **核心库源**: `src/libs/lv-notice-kit.ts` (或 `src/render/lv-notice-kit.ts`)，已升级至 Protocol v1.1.0 标准
- **标准协议**: Epoch 7 Phase 2 · 资源节约与并发排队

---

## 一、 第二阶段核心改造目标

1. **消除定时器风暴 (lvTicker)**：
   - 彻底拔除本插件内原本散乱的 `setInterval`；
   - 接入统一后台主时钟，由单例主时钟按周期或每分钟统一对齐触发；
   - 思源窗口最小化时自动享受 60 秒降频节电（Low Power Mode），降低 75% CPU 唤醒耗电；
   - 接入 `lvTicker.onDateCross`，零点精准触发跨日，不再自行反复轮询算日期。
2. **消除内核写锁死 (withDocLock)**：
   - 思源内核文档写入是非线程安全的，并发写入会抛出 `document is locked`；
   - 向思源文档（特别是当天同一篇 Daily Note 或大纲）执行 `appendBlock` / `putFile` 等异步写操作时，使用 `withDocLock(docId, async () => { ... })` 排队串行执行。
3. **统一 Esc 键浮层栈 (lvSurfaceStack)**：
   - 菜单、抽屉、自定义弹窗打开时压栈 `lvSurfaceStack.push({ id, dismiss })`；
   - 捕获阶段拦截 Esc，只关栈顶，绝不穿透误关底层窗口。

---

## 二、 本插件专属改造重点

1. **拔除独立 Heartbeat 定时器**：将 src/index.ts 中的 this.heartbeat (30min) 替换为 lvTicker.subscribe("siyuan-home", 30 * 60 * 1000, () => this.refreshHub())，在思源窗口最小化时自动享受节电降频；
2. **零点跨日刷新**：接入 lvTicker.onDateCross("siyuan-home", () => this.refreshHub())，零点自动刷新到期事项与待办；
3. **事项写入日记锁**：向思源文档或 Daily Note 归档待办时，使用 withDocLock(docId, async () => { ... }) 排队。

---

## 三、 质量门禁与验收标准

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 报错；
2. **测试门禁**：运行 `pnpm test` 确保全量测试 100% 通过；
3. **任务状态回写**：完成后将本文首行 `- **任务状态**: `pending`` 改为 `completed`；
4. **严格本地提交**：使用 Conventional Commit 规范（如 `feat(core): integrate lvTicker and withDocLock for phase 2 resource hardening`），**严禁 git push**。

---

## 四、 实施验收记录 (2026-11-03 完工)

1. **升级至 Protocol v1.1.0 标准核**：
   - 引入最新 `src/libs/lv-notice-kit.ts`，内置 `lvTicker`、`withDocLock`、`lvSurfaceStack`；
   - 适配 Node/SSR 单元测试环境内存 Fallback。
2. **拔除独立 Heartbeat 定时器 & 零点跨日刷新**：
   - `LvHomePlugin.onload` 接入 `lvTicker.subscribe("siyuan-home", 30 * 60 * 1000, ...)`，享受失焦/最小化 60s 节电降频；
   - 接入 `lvTicker.onDateCross("siyuan-home", ...)`，零点准点刷新到期中枢；
   - `onunload` 统一清理 `tickerUnsubscribe` 与 `dateCrossUnsubscribe`。
3. **事项写入日记锁**：
   - `src/core/doc-sync.ts` 中的 `upsertDocSection` 写入思源文档时全面包裹 `withDocLock(docId, ...)`，彻底解决并发写入锁冲突。
4. **门禁全数通过**：
   - `pnpm run check`：0 错误、0 警告；
   - `pnpm test`：200 个测试套件，1,249 项自动化测试 100% 通过；
   - `pnpm run build`：生产构建正常打包；
   - `node scripts/smoke-test.mjs` & `node scripts/verify-loader-semantics.mjs`：全数通过。

