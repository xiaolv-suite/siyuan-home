# v0.5.144 · 小驴管家（内测版）成员表单编辑器独立解耦、改派与导出弹窗中枢下沉（本地就绪版）

## 变更

- **成员编辑表单与改派/导出业务弹窗全面解耦**：
  - 独立抽取 `src/panels/screens/member-form-editor.svelte`（180 余行），完整封装家庭成员新增与编辑、姓名校验、同名二次确认提示、快捷回车保存与表单重置逻辑；
  - 独立抽取 `src/core/member-dialogs.ts`，统一封装家庭成员台账归属批量改派对话框与 vCard 4.0 格式导出功能，消除主屏异步分支与深层 DOM 查询；
  - 成员档案主屏 `src/panels/screens/members.svelte` 代码行数历史性精简至 **666 行**（从最初 835 行累计削减 **169 行**，净降幅达 **20.2%**）；
- **全量测试与门禁验证**：
  - 新增成员弹窗中枢与表单编辑器单元测试套件 `tests/core/member-dialogs.test.ts` 与 `tests/core/member-form-editor.test.ts`，全仓单测套件扩增至 **121 个套件、906 项单测全部全绿**，五层静态门禁全部通过；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 121 个测试文件，**906 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。





