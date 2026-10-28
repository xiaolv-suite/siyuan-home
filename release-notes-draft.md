# v0.5.159 · 小驴管家（内测版）底层传输引擎解耦、内核驱动层降至429行（本地就绪版）

## 变更

- **思源内核底座 HTTP 传输、重试退避与幂等去重引擎全面解耦**：
  - 独立抽取 `src/core/siyuan-transport.ts`（374 行），完整封装 HTTP 统一请求封装（`request` / `post`）、读端点有限重试与指数退避（`waitForRetryBackoff`）、超时控制中断（`withTimeout`）、请求幂等性内存指纹缓存（`idempotencyKey` 去重与防重入）、请求版本顺序失效守卫（`latestKey`）以及登录失效统一广播（`dispatchAuthExpired`）；
  - 思源内核适配核心驱动 `src/core/siyuan.ts` 代码行数历史性降至 **429 行**（从最初 973 行累计精简 **544 行**，净精简达 **55.9%**），并保持对全仓调用的 100% 签名与符号向后兼容；
  - **核心基础设施层全面精悍化**：底层四大基石文件全部收敛在极致简洁区间（`siyuan.ts` 429 行、`siyuan-transport.ts` 374 行、`provisioner.ts` 531 行、`schema.ts` 771 行）；
- **全量测试与门禁验证**：
  - 新增思源底层传输控制引擎自动化单元测试套件 `tests/core/siyuan-transport.test.ts`，全仓单测套件扩增至 **135 个套件、953 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 135 个测试文件，**953 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












