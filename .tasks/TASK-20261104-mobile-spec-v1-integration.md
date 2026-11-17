# TASK-20261104-mobile-spec-v1-integration: 小驴生态 · 手机端完整开发 · Mobile Spec v1 落地

## 任务背景与目标
落实【小驴生态 · 手机端完整开发 · Mobile Spec v1】规范：
1. 规范对齐：标准库 `src/libs/lv-notice-kit.ts` 保持原样不改动；测试环境注入轻量 Node window/localStorage 兼容桩，解决单测脱水问题。
2. 入口收敛：删除 `mobile-controller.ts` 中自建的 `#lvHomeMobileTopBarButton` 与多阶重试自愈逻辑，全生命周期接入 `lvLaunchpad.ensureMobileEntry()`（onload 挂载，onunload 严格清理且不写 petal）。
3. 宿主形态：全屏 TabPanel（100dvh）作为手机端主界面样板，支持下滑关闭手势（下拉 >80px 调起 `closeMobilePanel` 关坞与 `haptic(10)` 反馈）。
4. 导航收敛：TabPanel 底部导航收敛为 ≤4 项（今日 / 清单 / 资产 / 我的），触控目标高度 ≥48px（≥44px），样式全走 `--b3-theme-*` 变量，支持 iOS/Android 安全区。
5. 语法提示条：在快速备忘输入框上线语法提示条（检测输入 `@` 弹日期 chips、`!` 弹优先级 chips、`#` 弹分类 chips，及默认快速语法引导条），点选即智能替换插入，伴随 `lvLaunchpad.haptic(10)`。
6. 临期置顶：证件/保单/药品/合同临期（<=30 天或已逾期）在今日页置顶特显展示；并在扫描时确认 `lvAutomation` 临期→打卡待办跨插件联动规则正常触发。
7. 罗盘 actions 重写：将 `lvLaunchpad.register` 中的二级 actions 重写为 4 个手机直办动作（「记一笔备忘」、「今日清单」、「逾期扫描」、「证件到期速览」）。
12	8. 穿透搜索增强：`lvOmnisearch` provider 补充覆盖家庭成员高频实体，支持拼音首字母穿透检索。
13	9. 触感全面补齐：在「完成待办」（`complete` 与单卡片动作）与「逾期一键批延成功」（`batchSnooze` 与 `handleBatchPostponeOverdue`）两处调用 `lvLaunchpad.haptic(10)`（直接自 `src/libs/lv-notice-kit.ts` 导入）。
14	
15	## 验证结论
16	- `pnpm run check:types`：0 错误
17	- `pnpm run check:svelte`：0 错误，0 警告
18	- `pnpm run check:i18n`：2,199 词条完全对称
19	- `pnpm run check:meta`：通过
20	- `pnpm test`：207 套件、1,277 单测全绿（100% 通过）
21	- `pnpm run build`：生产打包通过
22	- 本地 commit 完成，严禁 git push，符合小驴生态发版规范。
