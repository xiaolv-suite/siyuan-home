# v0.5.170 · 小驴管家（内测版）抽屉模板与行级操作解耦、ledger-detail-drawer降至533行（本地就绪版）

## 变更

- **台账详情抽屉文档模板生成与行操作事务独立解耦**：
  - 扩展 `src/core/drawer-actions.ts`（增至 515 行），完整封装详情抽屉底栏与文档生成引擎：
    1. 动态文档模板生成按键组与变量渲染落盘（`renderDrawerDocTemplates`）
    2. 条目完整克隆为副本弹窗预填与智能提取（`bindDrawerRowOperations` duplicate）
    3. 条目删除与成员解绑、运行态清理、行日志清理级联事务（`bindDrawerRowOperations` delete）
  - 台账行详情抽屉核心 `src/core/ledger-detail-drawer.ts` 代码行数历史性降至 **533 行**（从最初 641 行精简 **108 行**，净精简达 **16.8%**）；
- **全量测试与门禁验证**：
  - 增强 `tests/core/drawer-actions.test.ts` 专项测试套件，单测总数扩增至 **145 个测试套件、983 项单测全部通过**；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 145 个测试文件，**983 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
