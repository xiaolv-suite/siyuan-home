import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const AUDIT_SHOTS = "D:/思源插件/小驴管家/tmp/ui-shots/comprehensive-audit";
fs.mkdirSync(AUDIT_SHOTS, { recursive: true });

(async () => {
    console.log("=== 开始执行详细全景走查（每个按钮、每个按键、每个截图） ===");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto("http://127.0.0.1:43919/stage/build/desktop/");
    await page.waitForTimeout(3500);

    // 1. 打开小驴管家主页签
    await page.evaluate(() => {
        const tb = document.getElementById("toolbar");
        const el = tb?.querySelector('[data-name="siyuan-home"]')
            ?? Array.from(tb?.children ?? []).find((c) => (c.getAttribute("aria-label") || "").includes("小驴管家"));
        if (el) el.click();
        else if (window.LvHome) window.LvHome.openButler();
    });
    await page.locator(".lv-home").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(AUDIT_SHOTS, "01-overview-screen.png") });
    console.log("01: 总览页面截图已捕获");

    // 2. 检视 Bento Hero 卡片与流按钮
    const heroCard = page.locator(".lv-bento-card--hero");
    if (await heroCard.count()) {
        const heroBg = await heroCard.evaluate((el) => window.getComputedStyle(el).backgroundImage || window.getComputedStyle(el).backgroundColor);
        const heroColor = await heroCard.evaluate((el) => window.getComputedStyle(el).color);
        console.log("Bento Hero 卡片计算样式：", { background: heroBg.slice(0, 50), color: heroColor });
    }

    // 3. 点击周律动条 past date 反查已办
    const pulsePills = page.locator(".lv-pulse-pill");
    const pulseCount = await pulsePills.count();
    console.log(`周律动条柱子数量: ${pulseCount}`);
    if (pulseCount > 0) {
        await pulsePills.first().click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "02-pulse-date-filtered.png") });
        console.log("02: 周律动点击反查已办截图已捕获");
        // 清除日期筛选
        const clearBadge = page.locator(".lv-filter-clear-badge");
        if (await clearBadge.count()) await clearBadge.click();
        await page.waitForTimeout(400);
    }

    // 4. 走查 5 个快捷日常流水按钮
    const flowButtons = page.locator(".lv-flow-btn");
    const flowCount = await flowButtons.count();
    console.log(`总览快捷流水按钮数量: ${flowCount}`);
    for (let i = 0; i < flowCount; i++) {
        const btn = flowButtons.nth(i);
        const text = await btn.innerText();
        const svgCount = await btn.locator("svg").count();
        console.log(`  流按钮 ${i}: text="${text.trim().replace(/\n/g, ' ')}", svgCount=${svgCount}`);
    }

    // 5. 打开快速记录弹层，检查各子页签与胶囊
    await page.evaluate(() => {
        const tb = document.getElementById("toolbar");
        const bolt = tb?.querySelector('[data-name="siyuan-home-bolt"]')
            ?? Array.from(tb?.children ?? []).find((c) => (c.getAttribute("aria-label") || "").includes("快速记录"));
        if (bolt) bolt.click();
        else {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            if (p && p.openQuickCapture) p.openQuickCapture();
        }
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(AUDIT_SHOTS, "03-quick-capture-fuel.png") });

    // 切换至生理指标
    const vitalPill = page.locator(".lv-pill-tab").filter({ hasText: /血压/ });
    if (await vitalPill.count()) {
        await vitalPill.click();
        await page.waitForTimeout(400);
        await page.locator("#lv-vital-sys").fill("145");
        await page.locator("#lv-vital-dia").fill("92");
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "04-quick-capture-vitals-high-warning.png") });
        console.log("04: 生理指标高压预警截图已捕获");
    }

    // 切换至家务打卡
    const chorePill = page.locator(".lv-pill-tab").filter({ hasText: /家务/ });
    if (await chorePill.count()) {
        await chorePill.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "05-quick-capture-chore.png") });
        console.log("05: 家务打卡快捷胶囊截图已捕获");
    }

    // 切换至待买采购
    const shopPill = page.locator(".lv-pill-tab").filter({ hasText: /待买/ });
    if (await shopPill.count()) {
        await shopPill.click();
        await page.waitForTimeout(400);
        // 点击 [日用品] 胶囊
        const dailyChip = page.locator(".lv-dt-chip").filter({ hasText: /日用品/ }).first();
        if (await dailyChip.count()) await dailyChip.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "06-quick-capture-shopping-daily.png") });
        console.log("06: 粗粒度待买日用品截图已捕获");
    }

    // 关闭快录弹层
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // 6. 切换至台账页面
    await page.locator("#lv-rail-tab-ledger").click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(AUDIT_SHOTS, "07-ledger-table-overview.png") });
    console.log("07: 台账表格全景截图已捕获");

    // 测试 Shift 连续区间多选
    const checkBoxes = page.locator("tr.lv-row-link input[type='checkbox']");
    const checkCount = await checkBoxes.count();
    console.log(`台账当前表格行数: ${checkCount}`);
    if (checkCount >= 3) {
        await checkBoxes.nth(0).click();
        await page.keyboard.down("Shift");
        await checkBoxes.nth(2).click();
        await page.keyboard.up("Shift");
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "08-ledger-shift-multi-selected.png") });
        console.log("08: 台账 Shift 连续多选截图已捕获");

        // 检查批量操作栏
        const batchBar = page.locator(".lv-batch-bar");
        if (await batchBar.isVisible()) {
            console.log("批量操作栏已唤出：包含按钮：", await batchBar.locator("button").allInnerTexts());
        }
        // 清除选择
        await page.locator(".lv-batch-close").click();
        await page.waitForTimeout(300);
    }

    // 7. 测试右键上下文菜单
    const firstRow = page.locator("tr.lv-row-link").first();
    if (await firstRow.count()) {
        await firstRow.click({ button: "right" });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "09-ledger-row-context-menu.png") });
        console.log("09: 表格行原生右键菜单截图已捕获");
        // 点击背景关闭菜单
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
    }

    // 8. 切换至成员页面
    await page.locator("#lv-rail-tab-members").click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(AUDIT_SHOTS, "10-members-screen.png") });
    console.log("10: 成员页面截图已捕获");

    // 9. 切换至提醒与日历页面
    await page.locator("#lv-rail-tab-reminders").click();
    await page.waitForTimeout(1000);
    // 切换至日历视图
    const calModeBtn = page.locator("#lv-panel-reminders button").filter({ hasText: /日历/ }).first();
    if (await calModeBtn.count()) {
        await calModeBtn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "11-reminders-calendar-view.png") });
        console.log("11: 提醒日历视图截图已捕获");
    }

    // 10. 打开设置页
    await page.evaluate(() => {
        const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
        if (p) p.openSetting();
    });
    await page.waitForTimeout(1000);
    // 切换至数据管理
    const dataTabBtn = page.locator(".lv-settings__nav button").filter({ hasText: /数据/ });
    if (await dataTabBtn.count()) {
        await dataTabBtn.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(AUDIT_SHOTS, "12-settings-data-tab.png") });
        console.log("12: 设置数据管理页（含离线HTML导出与补能预设）截图已捕获");
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    console.log("=== 全流程详细截图捕获完成 ===");
    await browser.close();
})();
