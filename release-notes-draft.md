# v0.5.105 · 小驴管家（内测版）快速日常流水全自动自愈与建行断言闭环

## 变更

- **快速记录日常流水未建库即时自愈**：
  - `submitQuickShopping`（购物清单）与 `submitQuickSnippet`（随手记）全面接入 `ensureTargetRef`：首次使用或未建库时自动触发 `repairModule` 静默建库，彻底告别冰冷的未建库抛错；
  - 深度简化快速记录建行前目标库校验与缺列核对，消除重复模板代码；
- **思源断言与行检索函数复用**：
  - 提取 `findHit` 辅助函数统一收敛 `addDetachedRow` 中的确认断言，杜绝多处冗余三元判断；
  - 修复 `ledger.svelte` 中子按钮样式变量命名漂移；
- **全量测试与门禁验证**：
  - 保持全仓 810 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**810 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1956 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
