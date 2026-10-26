# v0.5.85 · 小驴管家（内测版）全盘色彩体系重塑与硬编码颜色清零：全场景--lv-*语义色贯通

## 变更

- **全盘色彩体系梳理与硬编码颜色彻底收敛**：
  - 建立统一的信息色阶（`--lv-info` 系列），极光紫焦点卡（`lv-focus-card--review`）、成就勋章（`lv-achievement-chip`）与蓝色徽章全面接入语义变量，实现暗夜黑曜石自适应；
  - 清零 Svelte 组件内残留的 `b3-theme-error`、`b3-theme-on-surface`、`b3-theme-background-light` 等非标硬编码，全部归拢为 `--lv-danger`、`--lv-tx-2`、`--lv-surface-2` 等纯净语义变量；
  - 台账筛选胶囊（`lv-preset-tag`）新增高亮激活态（`active` 琥珀金微光），总览常用模块磁贴（`lv-qbtn`）按压与图标微缩放细腻加固；
  - 全局空状态图标（`.eic` / `.eic-sm`）注入透金微描边与微发光柔阴影，质感与界面一致性全盘贯通；
- **全量测试与门禁验证**：
  - 保持全仓 804 项单测 100% 全绿，五层静态门禁全部通过。

## 验证

- 91 个测试文件，**804 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1950 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
