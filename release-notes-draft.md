# v0.5.145 · 小驴管家（内测版）台账导出调度收敛、增量微调解耦、主台账降至888行（本地就绪版）

## 变更

- **台账导出分发与数量微调逻辑全面下沉解耦**：
  - 在 `src/core/ledger-modals.ts` 新增 `dispatchLedgerModal` 统一分发器，彻底消除主台账内部 20 余项模态框的巨型 switch-case 分支；
  - 在 `src/core/inline-edit.ts` 抽取 `quickAdjustRowQty` 函数，统一封装库存/数量加减快捷调节、下限守护与单模块智能局部重扫；
  - 在 `src/core/ledger-export.ts` 新增 `executeLedgerExportAction`，统一收敛 CSV/归档清单/实物标签/ICS 日历导出参数与调用；
  - 主台账 `src/panels/screens/ledger.svelte` 代码行数历史性跌破 900 行大关，降至 **888 行**（从最初近 6,500 行累计精简超 **5,610 行**，净减幅高达 **86.3%**）；
- **全量测试与门禁验证**：
  - 扩充台账导出与行内编辑自动化单元测试，全仓单测套件扩增至 **121 个套件、909 项单测全部全绿**，五层静态门禁全部通过；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 121 个测试文件，**909 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。






