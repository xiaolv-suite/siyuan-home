# [TASK-20261103-phase4-full-backup-and-finale] 小驴管家 · 第四阶段：全家桶一键联合灾备与终局闭环工单

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **核心库源**: `src/libs/lv-notice-kit.ts` (已升级至 Protocol v1.3.0 终局版)
- **标准协议**: Epoch 7 Phase 4 · 全生态联合灾备与自省闭环

---

## 一、 第四阶段核心改造目标

1. **全家桶一键联合灾备切面 (lvBackup)**：
   - 换机或备份时，用户可在任意小驴插件一键导出/导入全生态总包；
   - 本插件只需在 `onload` 中向总线登记备份生成与恢复函数：
     ```typescript
     this.backupCleaner = lvBackup.register(
         "siyuan-home",
         async () => this.dumpData(),
         async (data) => this.restoreData(data)
     );
     ```
   - 在 `onunload` 时调用 `this.backupCleaner?.()` 干净注销。
2. **全生态健康自省与指示徽章 (lvEcosystem)**：
   - 在本插件的设置页或状态概览底部，嵌入调用 `lvEcosystem.getStatusBadgeText()`；
   - 动态呈现极精致的状态胶囊：`🐴 小驴全家桶协同正常 · 8 插件已联结 · 今日活动 12 项`。

---

## 二、 本插件专属改造重点

1. **注册全生态灾备切面 (lvBackup)**：将待办、证件、药品、保单等数据注册进 lvBackup.register；
2. **管家数据维护页接入总备份**：在管家数据管理页支持导出/导入全生态总备份包。

---

## 三、 质量门禁与验收标准

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 报错；
2. **测试门禁**：运行 `pnpm test` 确保全量测试通过；
3. **任务状态回写**：完成后将首行 `- **任务状态**: `pending`` 改为 `completed`；
4. **严格本地提交**：Conventional Commit 规范（如 `feat(finale): integrate lvBackup and lvEcosystem for phase 4`），**严禁 git push**。

---

## 四、 实施验收记录 (2026-11-03 完工)

1. **注册全生态灾备切面 (lvBackup)**：
   - 在 `LvHomePlugin.onload` 中向总线登记 `lvBackup.register("siyuan-home", ...)`，提供待办事项、成员档案、模块配置、台账列绑定与处理状态的总包导出与恢复能力；
   - 在 `onunload` 钩子中登记 `backupCleaner?.()` 进行完整无残留注销；
   - 适配 Node/SSR 单元测试环境下对 `lvBackup` 灾备导出/恢复的内存 fallback 支持。
2. **管家数据维护页接入总备份**：
   - 在 `src/panels/settings-data-tab.svelte`（数据与迁移维护页）接入全生态总备份包导出与恢复，支持一键将小驴全生态所有插件的数据打包为单一 JSON 文件，并支持一键恢复与自动重算。
3. **状态指示徽章 (lvEcosystem)**：
   - 在概览面板 `overview-ecosystem-activity.svelte` 标题区与数据设置页 `settings-data-tab.svelte` 生态区嵌入展示 `lvEcosystem.getStatusBadgeText()`，实时呈现如 `🐴 小驴全家桶协同正常 · 8 插件已联结 · 今日活动 12 项` 的协同状态指示徽章。
4. **全量门禁检验通过**：
   - `pnpm run check`：0 错误，0 警告，i18n 2,185 词条严密对齐；
   - `pnpm test`：203 个测试套件，1,261 项单测全部 PASSED；
   - `pnpm run build`、`smoke-test`、`verify-loader-semantics`：生产包与思源加载器语义校验 100% 通过。

