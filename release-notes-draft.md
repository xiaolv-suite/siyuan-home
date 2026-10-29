# v0.5.176 · 小驴管家（内测版）入口与鉴权守护全面解耦、单测突破1010项（本地就绪版）

## 变更

- **重大重构（插件UI同步入口与存活守护独立解耦）**：
  - 独立抽取 `src/core/plugin-entrypoints.ts`（272 行），集中承载统一矢量图标注册（`iconLvHome`）、全局页签（`addTab`）、工具栏残留排重、顶栏及右键快捷菜单、桌面端顶栏 `MutationObserver` 存活复活监听（防图标消失）、8 项命令面板指令、3 项斜杠指令与状态栏角标；
- **重构（内核鉴权拦截与会话恢复守护独立解耦）**：
  - 独立抽取 `src/core/plugin-auth-guard.ts`（122 行），集中承载 `siyuan-home:auth-expired` 拦截与 sessionStorage 同源返回点暂存、`siyuan-home:permission-denied` 统一提示与登录后返回点自愈恢复（`checkRestoredAuth`）；
  - 核心入口文件 `src/index.ts` 代码行数由 981 行大幅骤降至 **627 行**（净精简 **354 行**，净精简幅度达 **36.1%**），全仓所有源码文件彻底稳居 666 行以内；
- **全量测试与门禁验证**：
  - 新增 `tests/core/plugin-entrypoints.test.ts` 与 `tests/core/plugin-auth-guard.test.ts` 专项单元测试套件；
  - 自动化单测套件扩增至 **154 个测试套件、1,010 项单元测试 100% 全部通过**（0 失败）；
  - 五层静态门禁无警告，构建产物保持 0.71 MB；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 154 个测试文件，**1,010 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
