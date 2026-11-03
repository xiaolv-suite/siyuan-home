# [TASK-20261103-launchpad-topbar-integration] 小驴管家 · 小驴罗盘顶栏收敛与二级行动极速直达接入工单

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **核心套件源**: `src/libs/lv-notice-kit.ts` (Protocol v1.4.0 Launchpad Standard)
- **标准协议**: Epoch 7 Phase 5 · 顶栏收敛与极速直达

---

## 一、 背景与改造目标

为了解决小驴系列 9 大插件在思源顶栏图标过度拥挤（一排 9 个小图标挤占顶栏）、找插件困难的痛点，全生态推行「小驴罗盘 · 家族极速弹射坞」：
1. **自动出场**：装有 >= 2 个小驴插件时，顶栏自动收拢并升起【🐴 小驴罗盘】主入口，顶栏空间节省 80%；只有 1 个插件时自动退化为普通独立图标；
2. **三态呈现权限**：用户可在罗盘设置中自主决定本插件【📌 置顶在外 / 📥 仅在坞内 / 👁️ 彻底隐藏】；
3. **图标为绝对第一主角**：采用思源原生 1.85px 纯线条矢量 SVG 图标，消灭遮挡；
4. **二级快捷行动常驻**：提供 4~5 项真实业务深度操作，默认展示前 3 项。

---

## 二、 本插件标准接入代码

```typescript
import { lvLaunchpad } from "./libs/lv-notice-kit";

// 在 onload 中注册到小驴罗盘：
this.launchpadCleaner = lvLaunchpad.register({
    id: "siyuan-home",
    name: "管家",
    fullName: "小驴管家",
    svgIcon: "icon-lv-home",
    color: "#10b981",
    desc: "事项归档 · 效期预警",
    digit: 3,
    badge: this.getExpiringCount() > 0 ? `${this.getExpiringCount()} 到期` : undefined,
    badgeType: "warn",
    actions: ["快速记录生活备忘事项", "扫描即将到期证件与药品", "批量归档已完成待办项", "全生态数据健康体检与清理"],
    onClick: () => this.openDashboard(),
    onAction: (action) => this.handleQuickAction(action),
});
// 在 onunload 中：
this.launchpadCleaner?.();
```

---

## 三、 质量门禁与验收标准

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 报错；
2. **测试门禁**：运行 `pnpm test` 确保全量测试通过；
3. **任务状态回写**：完成后将首行 `- **任务状态**: `pending`` 改为 `completed`；
4. **严格本地提交**：Conventional Commit 规范（如 `feat(launchpad): integrate lvLaunchpad entry with secondary actions`），**严禁 git push**。

---

## 四、 实施验收记录 (2026-11-03 完工)

1. **升级至 Protocol v1.4.0 罗盘标准协议**：
   - 适配 `src/libs/lv-notice-kit.ts`，内置 `lvLaunchpad` 引擎；
   - 补充 Node/SSR 单元测试环境下 `fallbackStates` 状态持久与事件订阅支持。
2. **小驴罗盘入口注册与二级行动直达**：
   - 在 `LvHomePlugin.onload` 与 `refreshHub` 扫描更新时，向罗盘注册 `siyuan-home` 切面；
   - 支持动态展示即将到期角标（`${count} 到期`，`badgeType: "warn"`）；
   - 支持 4 项业务深度二级极速行动：
     - `快速记录生活备忘事项`：唤起快速速记面板；
     - `扫描即将到期证件与药品`：强制全仓补扫并直切到期提醒中枢；
     - `批量归档已完成待办项`：触发流水与日记文档自动同步；
     - `全生态数据健康体检与清理`：读取全生态协同健康诊断并提示；
   - `onunload` 统一执行 `this.launchpadCleaner?.()` 干净注销。
3. **门禁全数通过**：
   - `pnpm run check`：0 错误，0 警告；
   - `pnpm test`：新增 `tests/libs/launchpad.test.ts` 专项测试，204 个测试套件，1,264 项自动化单测 100% PASSED；
   - `pnpm run build`、`smoke-test`、`verify-loader-semantics`：生产包成功构建，加载器语义与功能校验全部通过。

