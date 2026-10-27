# v0.5.131 · 小驴管家（内测版）彻底根治属性写入 key not found 死锁自愈、顶栏主导航对称居中修复

## 变更

- **彻底根治思源内核 setAttributeViewBlockAttr 报错 key not found 死锁 Bug**：
  - **根因分析**：快速记录与台账建行时，`settings.dbRefs[moduleId].columns` 记录的 `keyID` 若因用户在思源侧删除重设、导入差异或版本演化出现幽灵失效 ID 时，调用思源写入 API 抛出 `key not found [keyID]`；旧有逻辑仅重试相同死 ID 导致死锁，用户反复报错“记录已创建但部分字段未保存”；
  - **自愈机制**：在 `src/core/provisioner.ts` 中实现 `healColumnMapping` 实时自愈引擎，并在 `quick-capture`、`ledger-record-modal`、`ledger-detail-drawer`、`inline-edit` 全写入链路拦截 `key not found` 异常；
  - 遇到错误时自动从思源属性视图当前真实列清单中按别名对齐纠正，若该列已彻底被删则自动补建新列并刷新持久化映射，随后携带真实新 `keyID` 自动重试写入，彻底消除保存死锁；
- **顶栏主标签导航左右对称居中布局修复**：
  - 修复 `tab-panel.svelte` 顶栏结构，在左侧 `.lv-appbrand` 与 `.lv-tabs` 之间补充 `<span class="fn__flex-1">` 弹性占位，配合右侧弹性填充，使四大主页签（总览、提醒、台账、成员）在桌面端及宽屏视口下完美处于水平对称居中主视觉；
- **全量测试与门禁验证**：
  - 新增列映射失效自愈、补建与顶栏对称居中自动化单元测试，全仓 857 项单测全部全绿，五层静态门禁全部通过。

## 验证

- 108 个测试文件，**857 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1975 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
