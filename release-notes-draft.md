# v0.5.181 · 小驴管家（内测版）录入模型解耦、单测突破1035项（本地就绪版）

## 变更

- **台账录入数据模型、字段校验与证件画像解耦**：
  - 独立抽取 `src/core/ledger-record-view-model.ts`（160 行），集中封装证件分类专属标量列智能派生（`getCertificateScalarCols`）、附件插槽去重（`getQuickAssetCols`）、表单草稿存在性检查（`hasAnyFormInput`）、提交门禁（`canSubmitRecord`）、分类切换草稿保护（`prepareCategoryChange`）与字段级数据校验（`validateFieldInput`）；
  - 录入弹窗核心组件 `src/panels/screens/ledger-record-modal.svelte` 代码行数降至 **572 行**；
- **全量测试与门禁验证**：
  - 新增 `tests/core/ledger-record-view-model.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **157 个测试套件、1,035 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.70 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 157 个测试文件，**1,035 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
