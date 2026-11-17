import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const svelteFiles = [];
const tsFiles = [];

function walk(dir) {
    const list = fs.readdirSync(dir);
    for (const item of list) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            walk(full);
        } else if (item.endsWith(".svelte")) {
            svelteFiles.push(full);
        } else if (item.endsWith(".ts") && !item.endsWith(".d.ts")) {
            tsFiles.push(full);
        }
    }
}

walk(path.join(REPO, "src"));

const elements = [];

// Helper to push element
function addElem({ category, module, location, type, label, action, risk = "常规" }) {
    elements.push({
        id: `CTRL-${String(elements.length + 1).padStart(3, "0")}`,
        category,
        module,
        location,
        type,
        label: (label || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 80),
        action: (action || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 100),
        risk,
    });
}

// 1. Pages & Panels
const screens = [
    { name: "总览主屏 (Overview)", file: "src/panels/screens/overview.svelte", module: "overview", desc: "日常待办概览、周律动、指标Bento卡、模块快捷入口" },
    { name: "家庭台账 (Ledger)", file: "src/panels/screens/ledger.svelte", module: "ledger", desc: "21项核心生活台账表格、车辆能耗网格、批量管理与筛选" },
    { name: "到期提醒中枢 (Reminders)", file: "src/panels/screens/reminders.svelte", module: "reminders", desc: "全域待办/周期提醒/多段割点聚合、一键顺延、批量处理与已处理归档" },
    { name: "家庭成员档案 (Members)", file: "src/panels/screens/members.svelte", module: "members", desc: "成员档案名片、农历生日、时间轴、证件与健康聚合" },
    { name: "生活日历 (Calendar)", file: "src/panels/screens/calendar.svelte", module: "calendar", desc: "月度视图、日期待办分布、当日便签添加、农历节气" },
    { name: "管家设置 (Settings)", file: "src/panels/settings.svelte", module: "settings", desc: "成员管理、模块启停、提醒策略与免打扰、数据备份/恢复/回收站、关于" },
    { name: "初次使用向导 (Onboarding)", file: "src/panels/onboarding.svelte", module: "onboarding", desc: "全新安装引导、成员添加、默认模块启用与一键建库" },
    { name: "主导航轨 (Rail Navigation)", file: "src/panels/tab-rail-nav.svelte", module: "nav", desc: "五屏切换、访客模式开关、近期动态入口、关于与设置" },
    { name: "访客模式横幅 (Guest Banner)", file: "src/panels/tab-guest-banner.svelte", module: "nav", desc: "脱敏只读保护状态提示与退出访客按钮" },
    { name: "周律动条 (Pulse Strip)", file: "src/panels/overview-pulse-strip.svelte", module: "overview", desc: "近7天任务与习惯律动分布直方图" },
    { name: "全局异常边界 (Error Boundary)", file: "src/panels/error-boundary.svelte", module: "system", desc: "渲染崩溃兜底保护与一键刷新重试" },
];

for (const s of screens) {
    addElem({
        category: "页面与面板",
        module: s.module,
        location: s.file,
        type: "主面板/页面",
        label: s.name,
        action: s.desc,
        risk: s.module === "settings" || s.module === "onboarding" ? "高风险" : "常规",
    });
}

// 2. Modals & Drawers
const modals = [
    { name: "快速记录弹窗 (Quick Capture)", file: "src/panels/quick-capture.svelte", module: "quick-capture", desc: "N快捷键唤起，支持日常流水优先与台账直达双模式" },
    { name: "日常流水录入流 (Quick Event Flow)", file: "src/panels/quick-event-flow.svelte", module: "quick-capture", desc: "加油/充电换算、血压血糖、家务打卡、采购购物、备忘便签录入" },
    { name: "新建/编辑台账记录弹窗", file: "src/panels/screens/ledger-record-modal.svelte", module: "ledger", desc: "动态表单录入各模块台账行、智能识别与校验" },
    { name: "台账详情抽屉 (Ledger Detail Drawer)", file: "src/core/ledger-detail-drawer.ts", module: "ledger", desc: "行字段编辑、历史流水、附件、分享卡、定位直达与删除" },
    { name: "车辆详情抽屉 (Vehicle Drawer)", file: "src/core/vehicle-drawer.ts", module: "ledger", desc: "车辆档案、能耗统计看板、加油充电明细与维保记录" },
    { name: "附件管理抽屉 (Attachment Drawer)", file: "src/core/attachment-drawer.ts", module: "ledger", desc: "图片附件上传、预览、重命名与删除" },
    { name: "全景检索 (Spotlight Dialog)", file: "src/core/spotlight-dialog.ts", module: "spotlight", desc: "Ctrl+K 全局拼音检索、位置反查、复制引用与直达" },
    { name: "近期活动动态 (Activity Feed)", file: "src/panels/activity-feed.svelte", module: "overview", desc: "近期打卡流水、日志时间轴与分页浏览" },
    { name: "家庭急救卡弹窗 (Emergency Card)", file: "src/core/emergency-card-dialog.ts", module: "overview", desc: "血型、慢病、过敏、急救箱与紧急联络人聚合展示与复制" },
    { name: "物品存放位置索引 (Location Dialog)", file: "src/core/location-dialog.ts", module: "ledger", desc: "聚合全库 location 字段，全局检索东西放哪了" },
    { name: "儿童积分结算弹窗 (Rewards Dialog)", file: "src/core/rewards-dialog.ts", module: "ledger", desc: "家务打卡积分结算，一键兑换零花钱写入账本" },
    { name: "市政垃圾清运排期 (Waste Dialog)", file: "src/core/waste-dialog.ts", module: "ledger", desc: "两周垃圾清运日程推算与分类指南" },
    { name: "支出分类预算限额 (Expense Dialog)", file: "src/core/expense-dialog.ts", module: "ledger", desc: "分类月度预算限额测算与超支告警" },
    { name: "生理指标监测 (Vitals Dialog)", file: "src/core/vitals-dialog.ts", module: "ledger", desc: "血压/血糖/心率时间序列与高低压医学判定" },
    { name: "家务轮换与打卡 (Chore Dialog)", file: "src/core/chore-dialog.ts", module: "ledger", desc: "轮换规则判定、本轮该谁、完成历史记录" },
    { name: "超市动线扫货模式 (Store Dialog)", file: "src/core/store-dialog.ts", module: "ledger", desc: "按动线分类分组核对采购清单" },
    { name: "成长发育评估 (Growth Dialog)", file: "src/core/growth-dialog.ts", module: "ledger", desc: "WHO生长曲线百分位测算与疫苗接种登记" },
    { name: "人情往来账本 (Favors Dialog)", file: "src/core/favors-dialog.ts", module: "ledger", desc: "收礼送礼往来平衡测算与还礼提醒" },
    { name: "思源块收录入台账 (Block Ingest)", file: "src/core/block-ingest-dialog.ts", module: "ledger", desc: "智能解析思源块内容/ID并双向收录入台账" },
    { name: "绑定已有思源文档 (Bind Dialog)", file: "src/core/bind-dialog.ts", module: "ledger", desc: "将已有思源文档/属性视图关联为台账事实源" },
    { name: "批量操作确认弹窗 (Batch Dialog)", file: "src/core/batch-dialog.ts", module: "reminders", desc: "批量顺延天数、标记完成等二次确认" },
    { name: "备忘提醒编辑弹窗 (Reminder Dialogs)", file: "src/core/reminder-dialogs.ts", module: "reminders", desc: "快速便签与周期提醒参数编辑" },
    { name: "分享卡生成弹窗 (Sharecard Dialog)", file: "src/core/sharecard-dialog.ts", module: "ledger", desc: "Canvas 渲染高清分享卡并复制/下载图片" },
    { name: "CSV 导入向导 (CSV Import Dialog)", file: "src/core/csv-import-dialog.ts", module: "ledger", desc: "文件选择、表头对齐映射与批量导入" },
    { name: "成员头像裁剪弹窗 (Avatar Settings)", file: "src/panels/avatar-settings.svelte", module: "members", desc: "图片缩放、平移裁剪并保存至思源资源库" },
];

for (const m of modals) {
    addElem({
        category: "弹窗与抽屉",
        module: m.module,
        location: m.file,
        type: "弹窗/抽屉",
        label: m.name,
        action: m.desc,
        risk: m.module === "ledger" && (m.name.includes("导入") || m.name.includes("绑定")) ? "高风险" : "常规",
    });
}

// 3. Scan Svelte files for elements
for (const file of svelteFiles) {
    const relFile = path.relative(REPO, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    // Guess module from path
    let mod = "other";
    if (relFile.includes("overview") || relFile.includes("activity")) mod = "overview";
    else if (relFile.includes("ledger") || relFile.includes("vehicle") || relFile.includes("attachment")) mod = "ledger";
    else if (relFile.includes("reminder")) mod = "reminders";
    else if (relFile.includes("member") || relFile.includes("avatar")) mod = "members";
    else if (relFile.includes("calendar")) mod = "calendar";
    else if (relFile.includes("settings") || relFile.includes("setting")) mod = "settings";
    else if (relFile.includes("capture") || relFile.includes("quick")) mod = "quick-capture";
    else if (relFile.includes("onboarding")) mod = "onboarding";
    else if (relFile.includes("tab-") || relFile.includes("nav")) mod = "nav";
    else if (relFile.includes("spotlight")) mod = "spotlight";
    else if (relFile.includes("error-boundary")) mod = "system";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        const loc = `${relFile}:${lineNum}`;

        // Buttons
        if (line.includes("<button") && !line.includes("<!--")) {
            let label = "";
            let action = "";
            const onclickMatch = line.match(/onclick=\{([^}]+)\}/);
            if (onclickMatch) action = onclickMatch[1];
            const ariaMatch = line.match(/aria-label=\{?["']?([^"'}]+)["']?\}?/);
            if (ariaMatch) label = ariaMatch[1];
            const titleMatch = line.match(/title=\{?["']?([^"'}]+)["']?\}?/);
            if (!label && titleMatch) label = titleMatch[1];
            const classMatch = line.match(/class=["']([^"']+)["']/);
            const isIcon = classMatch && (classMatch[1].includes("icon") || classMatch[1].includes("tool") || classMatch[1].includes("close"));

            if (!label) {
                // Peek next line or within tag
                const textMatch = line.match(/>([^<]+)<\/button>/);
                if (textMatch) label = textMatch[1].trim();
            }

            const risk = (action.includes("delete") || action.includes("remove") || action.includes("clear") || action.includes("purge") || action.includes("Reset")) ? "高风险" : "常规";

            addElem({
                category: "按钮与图标按钮",
                module: mod,
                location: loc,
                type: isIcon ? "图标按钮" : "按钮",
                label: label || `Button (${loc})`,
                action: action || "点击触发交互",
                risk,
            });
        }

        // Inputs & Textareas
        if ((line.includes("<input") || line.includes("<textarea")) && !line.includes("<!--")) {
            const isTextarea = line.includes("<textarea");
            const typeMatch = line.match(/type=["']([^"']+)["']/);
            const inputType = isTextarea ? "textarea" : (typeMatch ? typeMatch[1] : "text");
            const bindMatch = line.match(/bind:value=\{([^}]+)\}/) || line.match(/bind:checked=\{([^}]+)\}/);
            const phMatch = line.match(/placeholder=\{?["']?([^"'}]+)["']?\}?/);
            const ariaMatch = line.match(/aria-label=\{?["']?([^"'}]+)["']?\}?/);

            let typeDesc = "输入框";
            if (inputType === "checkbox") typeDesc = "复选框";
            else if (inputType === "date") typeDesc = "日期输入框";
            else if (inputType === "number") typeDesc = "数值输入框";
            else if (inputType === "file") typeDesc = "文件选择器";
            else if (isTextarea) typeDesc = "文本域";

            const risk = (bindMatch && (bindMatch[1].includes("token") || bindMatch[1].includes("key"))) ? "高风险" : "常规";

            addElem({
                category: inputType === "checkbox" ? "输入框与开关" : "输入框与开关",
                module: mod,
                location: loc,
                type: typeDesc,
                label: ariaMatch?.[1] || phMatch?.[1] || `Input [${inputType}]`,
                action: bindMatch ? `双向绑定 ${bindMatch[1]}` : "内容输入",
                risk,
            });
        }

        // Selects & Segmented controls
        if (line.includes("<select") && !line.includes("<!--")) {
            const bindMatch = line.match(/bind:value=\{([^}]+)\}/);
            const ariaMatch = line.match(/aria-label=\{?["']?([^"'}]+)["']?\}?/);
            addElem({
                category: "下拉与分段控件",
                module: mod,
                location: loc,
                type: "下拉选择框",
                label: ariaMatch?.[1] || "Select Dropdown",
                action: bindMatch ? `选中绑定至 ${bindMatch[1]}` : "选项选择",
                risk: "常规",
            });
        }

        // Role tab / Segmented button
        if (line.includes('role="tab"') && !line.includes("<button")) {
            const ariaMatch = line.match(/aria-label=\{?["']?([^"'}]+)["']?\}?/);
            addElem({
                category: "下拉与分段控件",
                module: mod,
                location: loc,
                type: "分段/页签控件",
                label: ariaMatch?.[1] || "Tab Segment",
                action: "切换选中选项卡/视图",
                risk: "常规",
            });
        }

        // Empty states
        if ((line.includes("lv-empty") || line.includes("empty-state") || line.includes("ledger-empty-state") || line.includes("zero-state")) && !line.includes("<!--")) {
            addElem({
                category: "空态与错误态",
                module: mod,
                location: loc,
                type: "空态展示区",
                label: "空数据缺省态提示",
                action: "引导创建或初始数据填充",
                risk: "常规",
            });
        }

        // Error states
        if ((line.includes("error-boundary") || line.includes("lv-error") || line.includes("aria-invalid") || line.includes("missing-cols-banner") || line.includes("corruptedSettings")) && !line.includes("<!--")) {
            addElem({
                category: "空态与错误态",
                module: mod,
                location: loc,
                type: "错误/异常保护态",
                label: "错误拦截或缺失提示",
                action: "异常反馈与修复指引",
                risk: "高风险",
            });
        }
    }
}

// 4. Scan TS files for commands, menus, shortcuts, settings
// Topbar & commands
const entryContent = fs.readFileSync(path.join(REPO, "src/core/plugin-entrypoints.ts"), "utf8");
const entryLines = entryContent.split("\n");
for (let i = 0; i < entryLines.length; i++) {
    const line = entryLines[i];
    if (line.includes("plugin.addCommand({")) {
        const chunk = entryLines.slice(i, i + 12).join(" ");
        const keyMatch = chunk.match(/langKey:\s*["']([^"']+)["']/);
        const textMatch = chunk.match(/langText:\s*`([^`]+)`/) || chunk.match(/langText:\s*["']([^"']+)["']/);
        const hotkeyMatch = chunk.match(/hotkey:\s*["']([^"']+)["']/);
        addElem({
            category: "快捷键与指令",
            module: "entry",
            location: `src/core/plugin-entrypoints.ts:${i + 1}`,
            type: "命令面板指令",
            label: textMatch ? textMatch[1].replace(/\${[^}]+}/g, "管家") : (keyMatch ? keyMatch[1] : "Command"),
            action: hotkeyMatch && hotkeyMatch[1] ? `快捷键 ${hotkeyMatch[1]} 触发` : "命令面板执行",
            risk: "常规",
        });
    }
    if (line.includes("plugin.protyleSlash = [")) {
        // Find slash items
        const slashChunk = entryLines.slice(i, i + 40).join("\n");
        const items = slashChunk.split("id: \"").slice(1);
        for (const item of items) {
            const id = item.split('"')[0];
            addElem({
                category: "快捷键与指令",
                module: "entry",
                location: `src/core/plugin-entrypoints.ts:${i + 1}`,
                type: "编辑器斜杠指令 (/)",
                label: `Slash Command: ${id}`,
                action: "思源编辑器输入 / 唤起执行",
                risk: "常规",
            });
        }
    }
    if (line.includes("plugin.addTopBar(")) {
        addElem({
            category: "按钮与图标按钮",
            module: "nav",
            location: `src/core/plugin-entrypoints.ts:${i + 1}`,
            type: "顶栏图标按钮",
            label: "思源顶栏管家图标 (iconLvHome)",
            action: "左键打开管家，右键唤出快捷菜单",
            risk: "常规",
        });
    }
    if (line.includes("plugin.addStatusBar(")) {
        addElem({
            category: "按钮与图标按钮",
            module: "nav",
            location: `src/core/plugin-entrypoints.ts:${i + 1}`,
            type: "状态栏角标控件",
            label: "状态栏到期待办角标 (⏰ N)",
            action: "点击直达提醒中枢",
            risk: "常规",
        });
    }
    if (line.includes("menu.addItem({")) {
        const labelMatch = entryLines.slice(i, i + 5).join(" ").match(/label:\s*([^,\n]+)/);
        addElem({
            category: "菜单项与右键菜单",
            module: "entry",
            location: `src/core/plugin-entrypoints.ts:${i + 1}`,
            type: "顶栏右键菜单项",
            label: labelMatch ? labelMatch[1].replace(/["'`+]/g, "").trim() : "顶栏右键菜单项",
            action: "点击快速打开相应功能",
            risk: "常规",
        });
    }
}

// Context menus
const contextContent = fs.readFileSync(path.join(REPO, "src/core/plugin-context-menus.ts"), "utf8");
const contextLines = contextContent.split("\n");
for (let i = 0; i < contextLines.length; i++) {
    const line = contextLines[i];
    if (line.includes("menu.addItem({")) {
        const labelMatch = contextLines.slice(i, i + 5).join(" ").match(/label:\s*([^,\n]+)/);
        addElem({
            category: "菜单项与右键菜单",
            module: "context-menu",
            location: `src/core/plugin-context-menus.ts:${i + 1}`,
            type: "思源上下文右键菜单项",
            label: labelMatch ? labelMatch[1].replace(/["'`+]/g, "").trim() : "上下文菜单项",
            action: "编辑器/文档块菜单收录或联动",
            risk: "常规",
        });
    }
    if (line.includes("siyuanUrlHandler")) {
        addElem({
            category: "快捷键与指令",
            module: "entry",
            location: `src/core/plugin-context-menus.ts:${i + 1}`,
            type: "URL Scheme 协议监听",
            label: "siyuan://plugins/siyuan-home 深度链接",
            action: "外部或第三方通过 URL 直达特定模块或快录",
            risk: "高风险",
        });
    }
}

// In-app global keyboard listeners
addElem({
    category: "快捷键与指令",
    module: "quick-capture",
    location: "src/panels/tab-panel.svelte:293",
    type: "全局单键快捷键",
    label: "N 键快速记一笔",
    action: "非输入态下按 N / n 唤出快速记录弹层",
    risk: "常规",
});
addElem({
    category: "快捷键与指令",
    module: "spotlight",
    location: "src/core/spotlight-dialog.ts",
    type: "全局组合快捷键",
    label: "Ctrl+K 全景检索",
    action: "按下 Ctrl+K 快速唤起全局全景生活检索 Spotlight",
    risk: "常规",
});
addElem({
    category: "快捷键与指令",
    module: "system",
    location: "src/panels/quick-capture.svelte",
    type: "全局通用快捷键",
    label: "Esc 关闭弹层",
    action: "在任何打开的弹层/抽屉中按 Esc 安全关闭",
    risk: "常规",
});

// Settings items
const settingItems = [
    { label: "家庭成员档案管理", loc: "src/panels/settings-members-tab.svelte", desc: "成员姓名/称谓/角色/公农历生日/头像配置" },
    { label: "全量生活模块启停", loc: "src/panels/settings-modules-tab.svelte", desc: "21+ 生活台账模块的开关切换与台账生成" },
    { label: "全部启用 / 仅保留默认模块", loc: "src/panels/settings-modules-tab.svelte", desc: "一键批量启用或还原核心模块" },
    { label: "每日到期通知时间与开关", loc: "src/panels/settings-reminders-tab.svelte", desc: "提醒推送时机设定与静默时段免打扰" },
    { label: "周报与每周待办概览开关", loc: "src/panels/settings-reminders-tab.svelte", desc: "周日/周一自动汇总提醒配置" },
    { label: "外部 Webhook (Bark) 推送配置", loc: "src/panels/settings-reminders-tab.svelte", desc: "移动端 Bark 实时通知推送集成" },
    { label: "配置备份导出 (JSON)", loc: "src/panels/settings-data-tab.svelte", desc: "导出当前管家配置与运行时快照" },
    { label: "配置导入与覆盖恢复", loc: "src/panels/settings-data-tab.svelte", desc: "导入历史 JSON 配置文件并校验恢复", risk: "高风险" },
    { label: "安全回收站查看与一键恢复", loc: "src/panels/settings-data-tab.svelte", desc: "查看被删除的行记录并可逆恢复" },
    { label: "清空回收站", loc: "src/panels/settings-data-tab.svelte", desc: "物理清除回收站数据，防呆二次确认", risk: "高风险" },
    { label: "重新执行首次使用向导", loc: "src/panels/settings-data-tab.svelte", desc: "重新配置基础参数，不破坏已有数据", risk: "高风险" },
    { label: "导出系统诊断日志", loc: "src/panels/settings-data-tab.svelte", desc: "导出版本、模块状态与排障诊断报告" },
    { label: "只读访客模式切换", loc: "src/panels/tab-rail-nav.svelte", desc: "一键隐藏财务/合同等敏感档案，仅保留日常便签与急救" },
];

for (const s of settingItems) {
    addElem({
        category: "设置项与系统配置",
        module: "settings",
        location: s.loc,
        type: "系统设置项",
        label: s.label,
        action: s.desc,
        risk: s.risk || "常规",
    });
}

console.log(`Total elements scanned: ${elements.length}`);

// Output summary by category
const catMap = {};
for (const e of elements) {
    catMap[e.category] = (catMap[e.category] || 0) + 1;
}
console.log("Categories breakdown:", JSON.stringify(catMap, null, 2));

fs.writeFileSync(path.join(REPO, "scripts", "scanned-inventory.json"), JSON.stringify(elements, null, 2));
