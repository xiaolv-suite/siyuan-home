# v0.5.167 · 小驴管家（内测版）新增记录保存事务引擎解耦、ledger-record-modal降至586行（本地就绪版）

## 变更

- **台账新增记录保存事务引擎与列自愈独立解耦**：
  - 独立抽取 `src/core/ledger-record-saver.ts`（230 余行），集中封装新增台账记录全链路持久化引擎：
    1. 动态表单数据类型转换与成员关联校验（`convertFormCellValue`）
    2. 自然语言输入智能分离清洗（`smartExtractTitleFields`）
    3. 模块列自愈（`healColumnMapping`）、悬决身份恢复（`RowIdentityPendingError`）、原子行插入与列重试（`tryCell`）
    4. 资产与证书附件上传及指纹去重（`uploadAsset`, `fileFingerprint`）
    5. 状态列默认值自动补全与错误队列收敛
  - 新增记录弹窗组件 `src/panels/screens/ledger-record-modal.svelte` 代码行数大幅精简至 **586 行**（从最初 696 行精简 **110 行**，净精简达 **15.8%**）；
- **全量测试与门禁验证**：
  - 新增台账保存事务引擎专项测试套件 `tests/core/ledger-record-saver.test.ts`，全仓单测扩展至 **142 个测试套件、974 项单测全部通过**；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 142 个测试文件，**974 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
