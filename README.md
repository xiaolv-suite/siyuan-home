> **内测说明**：目前，小驴管家（内测版）仅实现基础功能，仍有较多功能处于开发与测试阶段。欢迎对插件感兴趣的用户参与内测体验，并通过交流 QQ 群 **871707735** 反馈使用中的 Bug 与功能需求。对功能完整性要求较高或更重视稳定性的用户，建议等待正式版发布后再使用。项目将根据反馈持续更新迭代，逐步完善功能与体验。

<div align="center">

# 🏠 小驴管家（内测版）

**思源笔记里的家庭事实、到期提醒与事务跟进层**

[![CI](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-home)](https://github.com/ai68298100/siyuan-home/releases/latest) [![License](https://img.shields.io/github/license/ai68298100/siyuan-home)](./LICENSE)

家庭私有资料 · 成员视角 · 到期提醒 · 可继续办理

[⬇️ 下载安装](https://github.com/ai68298100/siyuan-home/releases/latest) · [📖 使用文档](https://github.com/ai68298100/siyuan-home/blob/main/docs/FAQ.md) · [📖 术语表](https://github.com/ai68298100/siyuan-home/blob/main/docs/glossary.md) · [🗺 路线图](https://github.com/ai68298100/siyuan-home/blob/main/ROADMAP.md) · [🌐 English](https://github.com/ai68298100/siyuan-home/blob/main/README.en.md)

*本地优先 · 插件不自建遥测 · 数据保存在你的思源工作区*

</div>

---

## 本次更新（v0.5.178 本地就绪版）

本次更新推进提醒视图模型与页头摘要全面解耦独立，**全仓自动化单元测试增至 1,023 项全绿（1023/1023 全绿）**：
- **重构（提醒视图模型与纯计算引擎独立解耦）**：
  - 独立抽取 `src/core/reminders-view-model.ts`（160 行），集中封装多维过滤（`filterReminders`、`filterHandledEntries`）、分组置顶（`computeReminderDisplayGroups`、`sortPinnedFirst`）、规则多语言标签解析、提前量段位推算（`getReminderStage`）、任务块复制（`copyReminderAsTaskBlock`）与双日期今日排程（`toggleReminderQuickPlanToday`）；
- **重构（提醒主屏页头摘要与样式独立解耦）**：
  - 独立抽取 `src/panels/screens/reminder-hero-bar.svelte`（75 行），集中封装提醒页顶部 Hero 看板与专用响应式样式；
  - 提醒主屏核心组件 `src/panels/screens/reminders.svelte` 代码行数降至 **505 行**（从 666 行净减 **161 行**，净精简达 **24.2%**）；
- **质量保障与单测突破**：
  - 新增 `tests/core/reminders-view-model.test.ts` 专项单元测试，自动化单测增至 **156 个套件、1,023 项全部通过**；
  - 严格通过 5 层质量门禁（tsc 0 错、svelte 0 错 0 警、i18n 1983 键对齐、元数据合规、安全审计、加载器生命周期验证）；
- **发版状态**：**本地就绪版（遵从用户指示，暂未向 GitHub 远程仓库推送）**。

<details>
<summary>查看历史版本更新（点击展开）</summary>

### v0.5.177 本地就绪版
- 抽取 `src/core/hub/runtime-store.ts` 独立封装运行态持久化、语义指纹比对与 WeakMap 实例级写锁；
- 运行态核心 `src/core/hub/runtime.ts` 降至 332 行，单测增至 1,016 项。

### v0.5.176 本地就绪版
- 抽取 `src/core/plugin-entrypoints.ts` 与 `src/core/plugin-auth-guard.ts` 独立封装插件同步入口与鉴权守护；
- 插件主入口 `src/index.ts` 降至 627 行，单测增至 1,010 项。

### v0.5.175 本地就绪版
- 抽取 `src/core/ledger-view-model.ts` 与 `src/panels/screens/ledger-empty-state.svelte` 独立封装台账视图模型与空态引导；
- 台账主屏 `src/panels/screens/ledger.svelte` 降至 628 行，单测增至 1,005 项。

### v0.5.174 本地就绪版
- 抽取 `src/panels/screens/reminder-groups-list.svelte` 独立封装多层级分组渲染、合并卡流与空态呈现；
- 提醒主屏 `src/panels/screens/reminders.svelte` 降至 666 行，单测正式突破 1,000 项大关。

### v0.5.173 本地就绪版
- 抽取 `src/panels/settings-members-tab.svelte` 与 `src/panels/settings-data-tab.svelte` 独立封装成员设置与数据管理；
- 设置主面板 `src/panels/settings.svelte` 降至 558 行，单测增至 995 项。

### v0.5.170 ~ v0.5.172 核心解耦批次
- 抽取 `overview-bento-grid`、`overview-upcoming-list`、`quick-capture-form` 与 `drawer-actions`，主屏与详情抽屉代码大幅瘦身，单测增至 991 项。

### v0.5.160 ~ v0.5.169 架构治理批次
- 抽取 `triage-to-ledger`、`reminder-exporter`、`member-card`、`ledger-record-saver`、`drawer-conversions`、`drawer-domain-sections`、`schema-catalog`、`vehicle-energy-section`、`quick-capture-saver`、`overview-module-grid` 与 `runtime-views`，全仓单测突破 980 项。

### v0.5.130 ~ v0.5.159 基础解耦与生态闭环
- 抽取 `siyuan-transport`、`drawer-sections`、`settings-about-tab`、`reminder-controls-bar`、`mobile-controller`、`plugin-context-menus`、`ecosystem-integration`、`ledger-table` 与 `reminder-handled-list`，单测突破 950 项。

### 更早版本演进
- **v0.5.1 ~ v0.5.129**：详情抽屉拆解、批量操作栏解耦、车辆大屏独立、任务视界联动闭环、合同解约通知窗口测算、全台账 iCalendar 日历导出。
- **v0.4.0 ~ v0.5.0**：证件资料、分享卡、全模块 CSV 导入、今日免打扰、Bento 卡片、Spotlight 键盘流式检索。
- 更早版本完整细节见 [CHANGELOG.md](./CHANGELOG.md)。

</details>

---

## 💡 它解决什么问题

证件会到期、药品会过期、保单和会员会续费扣款、家人的公历/农历生日、体检、疫苗和车辆年检容易被遗忘；生活关键资料分散在不同聊天记录、纸质票据与不同笔记里，真正需要办理时难以快速检索并提供凭证依据。

小驴管家把这些生活要素沉淀为三个核心层次：
1. **家庭事实（Family Facts）**：以家庭成员为轴心，归集证件、资产、健康、出行、合同与日常生活事实；
2. **到期中枢（Expiry Hub）**：由客观日期与业务规则自动派生多层级提醒（逾期警报、临近到期、提前准备），不再依赖人工手动反复新建提醒；
3. **事务闭环（Action Loop）**：就地办理续期、修改排期、记录换证链条、导出日历与协同，跨会话保留办事依据与结果。

---

## 🧭 核心功能与作用

插件主要由 **四大主控面板** 与 **全域工作流能力** 组成：

### 一、四大主控面板功能与作用

| 核心面板 | 核心功能 | 解决什么问题（作用） |
|---|---|---|
| 🏠 **总览工作台 (Overview)** | • Bento 式全景仪表盘与焦点倒计时卡片<br>• 今日到期与重点待办即时聚焦<br>• 按成员一键过滤全家近期动态<br>• 闪电输入快速备忘（自然语言日期识别）<br>• 31 个生活模块启用状态条与数据健康监控 | 打开即见全家最近需要关注的关键事务；无需翻阅繁琐表格，一眼掌握今日重点与全家资料健康度。 |
| ⏰ **到期提醒中枢 (Reminders)** | • 客观截止日（Deadline）与主观计划日（PlanDate）双日期驱动<br>• 列表模式与原生日历模式（月/周）一键切换<br>• 四维组合复合筛选（级别/成员/模块/时间窗口）<br>• 常用筛选一键存为「命名视图」跨会话记忆<br>• 多段位提前量阶梯徽章预警（如 90天/30天/7天）<br>• 批量快捷操作栏（批量完成、延后 7 天、忽略）<br>• 导出日历 (.ics) 与家庭提醒周报/月报 Markdown 导出 | 自动化接管证件、保单、药品、会员、年检等各类到期事务；提前规划办理时点，杜绝证件过期滞留、保单失效或会员静默扣费。 |
| 🗂️ **全景家庭台账 (Ledger)** | • 31 大生活领域专属数据表（人员/资产/生活/育儿/出行/影音）<br>• 证件类型智能字段画像（身份证/护照/通行证/驾照/资质等）<br>• 中国身份证 GB 11643 严苛校验、生日与性别自动回填<br>• 敏感信息掩码保护（防窥遮蔽）与一键显隐<br>• 车辆能源/维护流水大屏（贝塞尔能耗曲线与百公里成本）<br>• 记录分享卡（生成带水印图片/脱敏文本/PNG导出）<br>• 全模块 CSV 批量导入（智能列映射向导）与安全导出<br>• 思源属性视图底层驱动，自动建库与列损坏自愈 | 建立结构化的全家终身数字档案库；证件信息立等可取、换证历史有迹可循，同时兼顾资产盘点与生活开销追溯。 |
| 👥 **家庭成员档案 (Members)** | • 家庭角色档案树（自己/配偶/子女/父母/长辈/亲属）<br>• 公历生日与中国传统农历生日自动转换与到期推算<br>• 成员视角一键汇总穿透（“关于我儿子的所有事项”）<br>• 小驴人脉联系人双向绑定与跳转<br>• 成员通讯录 (.vcf) 批量导出<br>• 成员专属拖拽排序与个性化头像管理 | 以“人”为第一等公民聚合分散资料；无论是给长辈办医保还是给孩子办理入学，所有相关证件与材料一键穿透展示。 |

---

### 二、全域工作流与深度闭环

#### 1. ⚡ 快速记录与自然语言解析（Quick Capture）
- **功能**：全局快捷键随时唤出轻量记录窗（支持命令面板快捷键或顶部闪电图标）；
- **作用**：内置中文自然语言解析引擎，随手输入“明天下午交物业费 300”或“下周五带小驴打疫苗”，自动识别提取时间、金额与类别，秒级沉淀为备忘或分流归入对应正式台账。

#### 2. 🔍 全景生活检索（Spotlight Search）
- **功能**：通过全局快捷键呼出极速生活检索浮层，支持全键盘上下穿梭选择；
- **作用**：基于全字段标量文本与拼音（全拼/首字母）混合模糊匹配，无论查护照号、车牌号、药品存放位置还是保单编号，敲击键盘即可瞬时直达目标记录。

#### 3. 📋 详情抽屉与深度办理闭环（Detail Drawer）
- **功能**：点击台账行右侧滑出富详情抽屉；
- **作用**：
  - **办理依据与材料闭环**：支持拍照、本地图片与 PDF 附件上传、同源快速预览下载；
  - **宿主按需 OCR 识别**：按需调用思源内置 OCR 引擎快速提取证件图片文本进行比对复核；
  - **换证链条追踪**：记录旧证换新证过程，保留换证历史流水；
  - **跨模块转化闭环**：便签分诊为正式台账行、处方一键入库为常备药、采购清单一键转固定资产。

#### 4. 🔗 小驴生态与系统级联动（Ecosystem Integration）
| 集成对象 | 联动方向 | 解决什么问题（作用） |
|---|---|---|
| **小驴人脉** (siyuan-contacts) | 人脉↔管家 | 合同/保单/就诊医生等直接从小驴人脉即时搜索并绑定；成员卡双向跳转人脉详情。 |
| **小驴打卡** (siyuan-checkin) | 管家→打卡 | 办结关键家庭事项（如车辆保养、宠物喂药、水电缴费）自动同步打卡沉淀生活习惯。 |
| **小驴考试** (siyuan-exam) | 考试→管家 | 总览工作台联动展示家庭备考连续打卡天数与刷题正确率。 |
| **小驴拾遗** (siyuan-glean) | 管家→拾遗 | 大额合同与贵重家电说明书一键推入拾遗渐进阅读流进行深度标注与学习。 |
| **任务视界** (Task Horizon) | 管家↔任务 | 提醒一键生成带双向引用的思源原生任务块语法，任务视界勾选完成时反向核销管家待办。 |
| **开放服务桥** (window.LvHome) | 管家→宿主/挂件 | 遵循 Protocol 1 开放协议，提供打开管家、添加备忘与读取只读健康摘要接口。 |

#### 5. 🛡️ 本地优先与隐私安全守护（Privacy & Security）
- **数据保存在你的思源工作区**：插件不自建外部服务器，不收集任何用户隐私数据，纯本地离线运行；
- **访客安全模式（Guest Mode）**：家庭多设备协同或面对朋友展示时，一键开启访客模式，敏感财务金额与身份证件号码自动打码遮蔽；
- **数据备份与一键容灾**：设置支持完整 JSON 导出与导入，导入前强制自动生成快照备份，支持误操作一键回滚。

---

## 🧩 31 个生活模块全景与分类

模块按六大生活场景组织，按需启用（未启用模块不产生任何冗余数据）：

<details open>
<summary><b>1. 人员档案</b>：成员、证件、健康、社保、保险、考试、宠物</summary>

成员关系与生日、证件和材料、就诊资料、社保快照、保单、考试通知、宠物照护记录。
</details>

<details open>
<summary><b>2. 资产与服务</b>：实物资产、虚拟资产、购物、会员订阅、合同</summary>

物品位置与保修资料、非秘密的数字资产索引、订单与售后材料、续费周期、合同版本。
</details>

<details open>
<summary><b>3. 日常生活</b>：药箱、库存、人情、家务、餐饮、地址、网址、常用语、房屋</summary>

效期和余量、库存盘点、收送记录、周期事项、菜谱与偏好、地址版本、办事入口、常用语和住处事项。
</details>

<details open>
<summary><b>4. 育儿与上学</b>：育儿、上学、零花钱</summary>

成长与照护记录、学校通知和材料、学费/课时草稿、零花钱流水草稿。
</details>

<details open>
<summary><b>5. 出行与旅行</b>：车辆、交通卡、旅行计划、预订、行李、足迹</summary>

车辆支持档案、加油和充电流水、油耗/电耗及费用统计；维护和年检资料、卡证期限、行程约束、预订凭证、行前清单和行后事实。
</details>

<details open>
<summary><b>6. 影音书库</b>：电影、电视剧、综艺、书籍、漫画、小说</summary>

想看/在看/完成状态、评分、进度和来源链接。
</details>

---

## 🚀 快速开始：从一条证件记录开始

1. **安装与初始化**：安装并启用插件，通过顶部图标或快捷键 `Ctrl+Alt+H` 打开管家面板；
2. **两步向导**：在初次向导中选择家庭构成与推荐模块（根据需要随时在设置中增减）；
3. **添加成员**：进入“家庭成员”页，添加自己与家人的基本信息（支持公历/农历生日）；
4. **录入首条证件**：进入“家庭台账”选择“证件”模块，新增一条身份证或护照记录；
5. **体验自动提醒**：回到“到期提醒”中枢，系统已根据到期日和提前量规则自动生成提醒流，支持就地排期、续期或复制为思源任务块。

---

## 🐎 小驴系列插件

以下为小驴系列插件及其 GitHub 仓库。欢迎加入交流 QQ 群 **871707735**，反馈 Bug 或提交功能需求。

| 插件 | 一句话简介 | GitHub 仓库 |
|---|---|---|
| **小驴雷切** | 思源本地导航工作区，集中管理页签、收藏、搜索和快捷入口。 | [siyuan-speed-switch](https://github.com/ai68298100/siyuan-speed-switch) |
| **小驴打卡** | 习惯与目标打卡工作台，提供分组、模板、统计及扩展集成。 | [siyuan-checkin](https://github.com/ai68298100/siyuan-checkin) |
| **小驴人脉** | 在思源中管理联系人、人际关系、关系图谱和生日提醒。 | [siyuan-contacts](https://github.com/ai68298100/siyuan-contacts) |
| **小驴拾遗** | 整理思源剪藏与导入文章，支持状态分拣、阅读和每日回顾。 | [siyuan-glean](https://github.com/ai68298100/siyuan-glean) |
| **小驴考试（内测版）** | 本地题库备考工具，支持导入、刷题、模考、错题复盘与 AI 辅助。 | [siyuan-exam](https://github.com/ai68298100/siyuan-exam) |
| **小驴管家（内测版）** | 管理家庭成员与生活资料，并集中跟进各类到期事项。 | [siyuan-home](https://github.com/ai68298100/siyuan-home) |
| **小驴闪卡（内测版）** | 本地闪卡学习工具，覆盖制卡、练习、复习和 FSRS 调度。 | [siyuan-lv-cards](https://github.com/ai68298100/siyuan-lv-cards) |
| **小驴常用（内测版）** | 从思源文档快速调用常用语、模板、代码和链接，并支持变量填充。 | [xiaolv-common](https://github.com/ai68298100/xiaolv-common) |
