# v0.5.149 · 小驴管家（内测版）证件细分画像解耦、数据模型层降至771行（本地就绪版）

## 变更

- **证件细分画像与字段档案独立解耦**：
  - 独立抽取 `src/core/certificate-profiles.ts`（160 余行），完整承载 17 种标准证件类型枚举（`CERTIFICATE_CATEGORY_OPTIONS`）、专属扩展字段规格（`CERTIFICATE_PROFILES`）、Profile 降级策略（`getCertificateProfile`）以及专属到期日提醒字段映射（`getCertificateReminderField`）；
  - 数据模型核心定义 `src/core/schema.ts` 代码行数降至 **771 行**（从最初 924 行精简 **153 行**），并在模块出口无缝保持 100% 签名与 API 向后兼容；
  - **全仓文件健康度再创纪录**：全仓十大核心关键文件（包括模型层、驱动层、全部业务主屏）全部跌破 900 行，收敛于 600~800 行黄金区间！
- **全量测试与门禁验证**：
  - 新增证件细分画像与字段档案自动化单元测试套件 `tests/core/certificate-profiles.test.ts`，全仓单测套件扩增至 **125 个套件、921 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 125 个测试文件，**921 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。










