# v0.5.169 · 小驴管家（内测版）备忘分诊与日历周报解耦、reminder-dialogs降至335行（本地就绪版）

## 变更

- **收件箱备忘归档与日历周报导出双引擎独立解耦**：
  - 独立抽取 `src/core/triage-to-ledger.ts`（167 行），集中封装备忘分诊归档全链路：
    1. 动态筛选可归档目标台账与自愈建库（`provisionModule`）
    2. 成员关联校验与解耦防空判断
    3. 原子建行与列写入重试事务机制（`addDetachedRow`, `setCellSafe`）
    4. 归档成功自动标记原备忘完成（`complete`）并触发中枢刷新
  - 独立抽取 `src/core/reminder-exporter.ts`（118 行），集中承载提醒中枢外部交付与周报：
    1. 周报/月报 Markdown 摘要生成、差值对比与剪贴板一键复制（`openReminderDigestDialog`）
    2. 日历 ICS 事件标准协议生成与敏感生活分类（社保、就医、资产、合同）二次防泄漏确认（`exportReminderIcs`）
  - 提醒弹窗动作中枢 `src/core/reminder-dialogs.ts` 代码行数历史性降至 **335 行**（从最初 603 行精简 **268 行**，净精简达 **44.4%**）；
- **全量测试与门禁验证**：
  - 新增专项测试套件 `tests/core/triage-to-ledger.test.ts` 与 `tests/core/reminder-exporter.test.ts`，全仓单测扩展至 **145 个测试套件、981 项单测全部通过**；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 145 个测试文件，**981 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
