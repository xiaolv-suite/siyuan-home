# v0.5.155 · 小驴管家（内测版）全仓跌破千行大圆满、主入口降至981行（本地就绪版）

## 变更

- **全仓所有代码文件严格进入 1,000 行以内历史性里程碑**：
  - 独立抽取 `src/core/mobile-controller.ts`（130 余行），完整封装移动端顶栏入口注入、DOM 自查重挂、全屏弹层 Dialog 适配与组件惰性加载；
  - 独立抽取 `src/core/plugin-context-menus.ts`（190 余行），完整封装选区右键菜单、块图标右键“收录本块”二级分流、思源插件自定义协议 URL Scheme 路由跳转、AV 属性视图原生数据库右键入口、WS 主通道数据变更节流同步与系统休眠唤醒补扫；
  - 独立抽取 `src/core/quick-capture-action.ts`（60 行），原子封装划选存入常用语/书签/地址、码点截断、防抖去重与容错上报；
  - 插件主入口 `src/index.ts` 代码行数历史性降至 **981 行**（累计精简超 **506 行**，净精简达 **34%**）；
  - **历史性架构大圆满**：全仓无任何单个文件超过 1,000 行（全部核心收敛于 600~980 行黄金高内聚区间）！
- **全量测试与门禁验证**：
  - 新增 `tests/core/mobile-controller.test.ts`、`tests/core/plugin-context-menus.test.ts`、`tests/core/quick-capture-action.test.ts` 三大自动化单元测试套件，全仓单测套件扩增至 **132 个套件、943 项单测全部全绿**，五层静态门禁无警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 132 个测试文件，**943 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。












