# v0.5.164 · 小驴管家（内测版）31模块模型目录解耦、schema.ts降至172行（本地就绪版）

## 变更

- **31 大生活模块声明式 Schema 目录与字段工厂全面解耦**：
  - 独立抽取 `src/core/schema-catalog.ts`（610 余行），集中承载 31 个家庭模块的结构化 Schema 声明（`CERTS_SCHEMA` ~ `ASSETS_VIRTUAL_SCHEMA`）、字段字典（`FIELD_DICT`）、基础声明工厂函数（`txt`, `dat`, `num`, `sel`, `ast`, `chk`, `rem`）、视图声明（`VIEW_EXPIRING`, `VIEW_BY_MEMBER`）与统一目录索引映射（`SCHEMA_CATALOG`）；
  - 数据模型核心定义 `src/core/schema.ts` 代码行数历史性降至 **172 行**（从最初 924 行累计精简 **752 行**，净精简达 **81.4%**），专注于类型契约定义、校验门禁（`validateSchema`）与内核白名单矩阵；
  - **契约基准 100% 字节级对齐**：`tests/core/schema-snapshot.test.ts` 自动化快照全量对比 0 漂移，对外部调用保持 100% 符号与类型向后兼容；
- **全量测试与门禁验证**：
  - 全仓 139 个自动化单元测试套件、966 项单测全部全绿，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 139 个测试文件，**966 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
