# v0.5.104 · 小驴管家（内测版）根治思源数据库空壳与幽灵列映射死锁：彻底打通思源原生台账补列链路

## 变更

- **幽灵列映射清除与强制向思源建列**：
  - 根除 `ensureColumns` 盲目信任已有 `columns` 字典跳过建列的重大隐患：增加 `reconcileGhostColumns` 真实性对齐机制，当思源数据库中实际不存在已登记列且无同名别名列时，自动清除失效幽灵映射，强制调用 `addAttributeViewColumn` 向思源内核建齐全部标准列；
  - 缩短 `addAttributeViewColumn` 的 `idempotencyKey`，避免建列时因自造 keyID 变化触发请求层 `-409` 指纹冲突异常；
  - `repairModule` 默认启用 `reconcileGhostColumns: true`，确保用户点击【重建台账】或数据录入自动自愈时，思源原生数据库的所有列必定 100% 完整生成；
- **台账宽表内联样式字面量深度收敛**：
  - 深度收敛 `ledger.svelte` 中多处子卡片、行、栅格与警告样式字面量，单文件 gzip 体积稳稳收敛至 281.57 KB（严格低于 281.6 KB 硬预算）；
- **全量测试与门禁验证**：
  - 保持全仓 810 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**810 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1956 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
