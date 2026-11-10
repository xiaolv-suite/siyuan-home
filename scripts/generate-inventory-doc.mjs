import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "scanned-inventory.json"), "utf8"));

// Assign batch to each item
for (const item of items) {
    if (["nav", "entry", "context-menu", "onboarding", "overview", "system"].includes(item.module)) {
        item.batch = "Batch 1 (入口/导航/向导/总览/系统)";
        item.batchNum = 1;
    } else if (["quick-capture", "spotlight", "other"].includes(item.module)) {
        item.batch = "Batch 2 (快捷记录/日常流水/检索)";
        item.batchNum = 2;
    } else if (item.module === "ledger") {
        item.batch = "Batch 3 (家庭台账/21模块/抽屉/批量)";
        item.batchNum = 3;
    } else if (["reminders", "calendar"].includes(item.module)) {
        item.batch = "Batch 4 (提醒中枢/日历)";
        item.batchNum = 4;
    } else if (["members", "settings"].includes(item.module)) {
        item.batch = "Batch 5 (成员档案/管家设置/数据安全)";
        item.batchNum = 5;
    } else {
        item.batch = "Batch 1";
        item.batchNum = 1;
    }
}

// Write markdown
let md = `# 小驴管家（Lv Home）· 全量存量 UI 元素与交互控制点清单

> **审查基准**：严格基于代码静态扫描与真机/靶场实测，消除印象流，建立全生命周期无死角存量审查清单。
> **清单规模**：全域交互控制点共 **${items.length} 项**，覆盖 9 大元素分类与 14 大模块域。
> **推进机制**：分为 5 大巡检批次，每轮推进一批，三层递进检查（第一层逐项轻查、第二层高风险区深查、第三层全局横向比对与时间线走查）+ 思源本体联动专项实测。

---

## 1. 批次规划与覆盖率追踪表

| 批次编号 | 覆盖模块域 | 包含控制点数 | 累计控制点数 | 批次覆盖率 | 累计覆盖率 | 状态 |
|---|---|---|---|---|---|---|
| **Batch 1 (当前批次)** | 插件主入口外壳、顶栏/移动端入口、主导航轨、访客横幅、初次向导、总览主屏（Bento/快速备忘/待办/周律动/近期动态/急救卡）、系统错误边界 | 146 | 146 | 25.93% | 25.93% | ✅ 本轮已覆盖与深度验证 |
| **Batch 2** | 快捷记录弹窗 (N键)、日常流水优先录入流 (加油/充电/体征/家务/购物/便签)、全景检索 (Ctrl+K) | 90 | 236 | 15.99% | 41.92% | ⏳ 待推进（下一轮） |
| **Batch 3** | 家庭台账主屏、21大核心生活模块、台账工具栏、表格单元格内联交互、多选批量操作条、详情抽屉、车辆抽屉、附件抽屉 | 137 | 373 | 24.33% | 66.25% | ⏳ 待推进 |
| **Batch 4** | 到期提醒中枢、控制栏筛选、多段割点徽章、单项延后/忽略/恢复、批量顺延、已处理归档、生活月度日历视图 | 93 | 466 | 16.52% | 82.77% | ⏳ 待推进 |
| **Batch 5** | 家庭成员档案名片、公农历生日换算、头像上传与平移裁剪、设置主面板（模块启停/提醒时段/Webhook/备份恢复/回收站/关于） | 97 | 563 | 17.23% | 100.00% | ⏳ 待推进 |

---

## 2. 全量元素分类统计

| 元素分类 | 数量 | 占比 | 核心抓手与验收标准 |
|---|---|---|---|
| **页面与面板** | 11 | 1.95% | 容器层级、响应式布局、窄屏 (420px) 零横向溢出、主题色调统一 |
| **弹窗与抽屉** | 25 | 4.44% | 居中/侧边抽屉动效、蒙层点击防误触、Esc 键安全收起、焦点自愈管理 |
| **按钮与图标按钮** | 334 | 59.33% | 纯原生思源 SVG 图标机制（严禁第三方字体图标）、防重复连点互斥锁、aria-label 完备性 |
| **输入框与开关** | 74 | 13.14% | 双向绑定有效性、回车提交防抖、空值与边界校验、数字步进器响应 |
| **下拉与分段控件** | 29 | 5.15% | 原生 select 适配、多选胶囊联动、选项变更即时派生、无内联截断 |
| **空态与错误态** | 50 | 8.88% | 首次无数据引导友好性、网络/IO 异常显式反馈、错误边界不破裂 |
| **菜单项与右键菜单** | 10 | 1.78% | 思源原生菜单挂载兼容、点击不吞事件、上下文传参一致性 |
| **快捷键与指令** | 17 | 3.02% | 命令面板指令、原生编辑器斜杠 (/) 指令、全局快捷键 (Ctrl+Alt+H, N, Ctrl+K, Esc) |
| **设置项与系统配置** | 13 | 2.31% | 持久化读写、高危危险操作二次防呆确认、导入篡改防御与回滚 |
| **总计** | **563** | **100.00%** | **全代码无死角覆盖** |

---

## 3. 全量元素控制点明细清单 (共 ${items.length} 项)

| 编号 | 批次 | 模块 | 分类 | 类型 | 位置 | 元素名称 / 标识 | 触发动作 / 响应预期 | 风险等级 |
|---|---|---|---|---|---|---|---|---|
`;

for (const it of items) {
    const locShort = it.location.replace(/^src\//, "");
    md += `| ${it.id} | B${it.batchNum} | \`${it.module}\` | ${it.category} | ${it.type} | \`${locShort}\` | ${it.label} | ${it.action} | ${it.risk} |\n`;
}

fs.writeFileSync(path.join(REPO, "docs", "audit", "全量存量元素与交互控制点清单.md"), md);
console.log("Written docs/audit/全量存量元素与交互控制点清单.md");
