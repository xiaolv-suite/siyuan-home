# v0.5.173 · 小驴管家（内测版）数据管理与成员维护双分区解耦、settings降至558行（本地就绪版）

## 变更

- **设置面板数据管理分区与成员维护分区独立解耦**：
  - 独立抽取 `src/panels/settings-members-tab.svelte`（197 行），集中承载家庭成员设置列表、7 大家庭角色枚举、姓名/性别/公农历生日编辑、增删成员及 120 行专用响应式样式；
  - 独立抽取 `src/panels/settings-data-tab.svelte`（112 行），集中承载数据管理与生态分区：
    1. 目标笔记本切换与配置即时落盘
    2. 设置 JSON 导出、导入、导入前备份恢复（`executeRestorePreImport`）
    3. 示例数据一键生成与清除管理
    4. 生态规划功能清单呈现与全局快捷键指南
  - 设置主面板组件 `src/panels/settings.svelte` 代码行数大幅精简至 **558 行**（从最初 788 行累计精简 **230 行**，净精简达 **29.2%**），完全消除单组件样式冗余；
- **全量测试与门禁验证**：
  - 新增专项测试套件 `tests/core/settings-data-tab.test.ts` 与 `tests/core/settings-members-tab.test.ts`，全仓单测扩展至 **150 个测试套件、995 项单测全部通过**；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 150 个测试文件，**995 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
