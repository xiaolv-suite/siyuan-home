# v0.5.177 · 小驴管家（内测版）运行态持久化解耦、单测突破1016项（本地就绪版）

## 变更

- **运行态存储持久化、数据规范化与并发锁独立解耦**：
  - 独立抽取 `src/core/hub/runtime-store.ts`（339 行），集中封装运行态数据规范化（`normalizeCache`、`normalizeHandled`、`normalizeRenewHistory`、`normalizeReminders`、`normalizeMemo`、`normalizeNamedView`）、安全持久化（`loadRuntime`）、实质语义指纹比对（`semanticRuntimeFingerprint`）与基于 WeakMap 的异步写入并发锁队列（`withRuntimeSaveLock`、`saveRuntime`、`persistRuntimeUnderLock`）；
  - 核心文件 `src/core/hub/runtime.ts` 代码行数大幅骤降至 **332 行**（净精简 **319 行**，精简幅度达 **49.0%**），聚焦于业务生命周期、记录清理与提醒规则派生；
- **全量测试与门禁验证**：
  - 新增 `tests/core/runtime-store.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **155 个测试套件、1,016 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 155 个测试文件，**1,016 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
