# [TASK-20261103-phase6-ai-integration-and-command-center] 小驴管家 · 第六阶段：AI 全面接入与全生态作战大盘工单

- **任务状态**: `completed`
- **目标插件**: `小驴管家 (siyuan-home)`
- **核心套件源**: `src/libs/lv-notice-kit.ts` (已升级至 Protocol v1.5.0)
- **标准协议**: Epoch 7 Phase 6 · 全生态 AI 赋能与业务大盘

---

## 一、 第六阶段改造核心目标

1. **全面接入统一 AI 网关 (lvAi)**：
   - 彻底免去配置 Key，直接调用 `lvAi.chat({ source, messages })` 复用全生态共享大模型，自动享受并发限流与 429 退避；
2. **进阶业务协同聚变**：
   - 打卡通盘升级为【全生态今日作战大盘】，支持睡前一键汇编全家桶产出并写入 Daily Note；
   - 雷切切片、管家自然语言录入、常用智能变体全面由大模型赋能。

---

## 二、 本插件专属改造重点

1. **接入统一 AI 网关 (lvAi)**：
   - **自然语言智能极速记账与备忘 (NLP Quick Parser)**：用户直接输入一句话（如“下周五上午10点去车管所换驾照，费用120元”），调用 lvAi.chat 解析输出结构化 JSON，自动填充事项名、到期时间、分类、金额，免去手动繁琐表单；
   - **生活效期全局体检洞察**：对证件、药品、保单效期进行全局智能盘点，输出换证/换药提示。

---

## 三、 质量门禁与验收标准

1. **类型检查**：运行 `pnpm run check` 或 `tsc --noEmit`，确保 0 报错；
2. **测试门禁**：运行 `pnpm test` 确保全量测试通过；
3. **任务状态回写**：完成后将首行 `- **任务状态**: `pending`` 改为 `completed`；
4. **严格本地提交**：Conventional Commit 规范（如 `feat(ai): integrate lvAi nlp parser and life health audit for phase 6`），**严禁 git push**。

---

## 四、 实施验收记录 (2026-11-03 完工)

1. **AI 自然语言极速记账与备忘解析器 (NLP Quick Parser)**：
   - 编写 `src/core/ai-nlp.ts` 中的 `parseQuickEntryWithAi`，优先调用 `lvAi.chat` 输出结构化 JSON，自动提取事项名、到期时间、分类、优先级与金额；
   - 具备完备的本地智能规则兜底（无 Key 或网络超时平滑回退，100% 零阻断）；
   - 在 `overview-quick-memo.svelte` 中接入 AI 智能极速解析与即时预览。
2. **证件与生活效期全局体检洞察 (Life Health Audit)**：
   - 实现 `auditLifeHealthWithAi` 对证件、常备药、保险到期日进行全局智能汇总与大模型深度洞察；
   - 输出高危即将到期项预警、30~90天规划提示与办事防坑建议，支持复制报告与一键写入思源流水日记超级块。
3. **二级行动直达穿透**：
   - 在 `LvHomePlugin` 与小驴罗盘中注册 `"AI生活效期智能体检"` 快捷动作，确保 `onAction` 响应外部穿透调用。
4. **门禁全数通过**：
   - `pnpm run check`：0 错误，0 警告，i18n 2,189 键完全对齐；
   - `pnpm test`：新增 `tests/core/ai-nlp.test.ts` 专项单测，205 个测试套件，1,269 项自动化单测 100% PASSED；
   - `pnpm run build`、`smoke-test`、`verify-loader-semantics`：全部通过。

