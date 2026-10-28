# v0.5.166 · 小驴管家（内测版）跨台账流转入库引擎全面解耦、drawer-sections降至380行（本地就绪版）

## 变更

- **跨台账流转入库与资产转换引擎独立解耦**：
  - 独立抽取 `src/core/drawer-conversions.ts`（340 余行），集中承载 3 大高频跨台账数据流转与入库交互动作：
    1. 就医台账处方流转入药箱快捷按钮与关系对齐（`renderRxToMedicineButton`）
    2. 采购清单条目药箱入库增量合并与多行匹配对齐弹窗（`renderStockInButton`）
    3. 采购条目一键转固定资产档案与分类映射（`renderShoppingToAssetButton`）
  - 抽屉扩展区块核心 `src/core/drawer-sections.ts` 代码行数历史性降至 **380 行**（从最初 708 行精简 **328 行**，净精简达 **46.3%**）；
  - 全仓所有抽屉文件全员平稳收敛至 200~640 行极致精炼区间；
- **全量测试与门禁验证**：
  - 新增抽屉跨台账流转专项测试套件 `tests/core/drawer-conversions.test.ts`，全仓单测扩展至 **141 个测试套件、970 项单测全部通过**；
  - 五层静态门禁无警告，构建产物仅 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 141 个测试文件，**970 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
