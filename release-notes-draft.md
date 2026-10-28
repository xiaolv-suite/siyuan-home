# v0.5.165 · 小驴管家（内测版）抽屉领域卡片全面解耦、drawer-module-sections降至265行（本地就绪版）

## 变更

- **抽屉 6 大生活领域智能分析卡片独立解耦**：
  - 独立抽取 `src/core/drawer-domain-sections.ts`（600 余行），集中承载 6 大领域的智能富卡片与业务闭环交互：
    1. 房屋台账保修关联合同卡片（`renderHouseWarrantySection`）
    2. 食品忌口与过敏原排查卡片及食材清单复制（`renderFoodDietarySection`）
    3. 教育学段升学与毕业倒计时进度（`renderSchoolingStageSection`）
    4. 宠物照护与生理人类等效年龄换算（`renderPetCareSection`）
    5. 育儿辅食排查观察与健康过敏原联运录入弹窗（`renderParentingFeedingSection`）
    6. 家庭成员社保退休测算与生涯进度（`renderSocialRetirementSection`）
  - 抽屉扩展板块分发中心 `src/core/drawer-module-sections.ts` 代码行数历史性降至 **265 行**（从最初 724 行精简 **459 行**，净精简达 **63.4%**）；
  - 修复教育学段（schooling）因重复分支判定导致的学段卡片无法触达的历史隐患，实现转学记录与升学倒计时双重正常挂载；
- **全量测试与门禁验证**：
  - 新增抽屉领域卡片专项测试套件 `tests/core/drawer-domain-sections.test.ts`，全仓单测扩展至 **140 个测试套件、968 项单测全部通过**；
  - `package.json` 测试运行参数支持 4GB 堆内存，杜绝大规模测试套件执行过程中的瞬时内存膨胀；五层质量门禁 0 警告；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

## 验证

- 140 个测试文件，**968 项单测全部通过**（0 失败）。
- `tsc` 类型检查、Svelte 5 诊断（0 错误 0 警告）、i18n 1983 键严格对齐。
- 元数据校验与 `pnpm audit` 全部通过。
- 生产构建与 `smoke-test`、思源加载器语义测试（`verify-loader-semantics`）全部绿灯。

完整变更细节见 [CHANGELOG.md](./CHANGELOG.md)。
