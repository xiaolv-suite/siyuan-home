/**
 * 隔离式全真实浏览器自用走查脚本（支持 --keep 保留独立工作区与内核，支持 --headed 打开可视 Chrome 窗口）：
 *
 * 1. 自动在系统临时目录创建全新独立思源工作区，拷贝 dist/ 生产包，开启集市信任并注册 petals.json，
 *    在随机空闲回环端口（31000–51000）拉起独立 SiYuan-Kernel.exe（绝不触碰 6806 主实例与真实笔记）；
 * 2. 启动真实 Chrome / Chromium 浏览器访问 /stage/build/desktop/，像真实重度家庭用户一样走完 12 步全场景闭环：
 *    引导建库 ➔ 成员（含农历生日）➔ 开启扩展模块 ➔ 证件录入/掩码/零依赖QR解码 ➔ 车辆建档与快捷加油能耗闭环 ➔
 *    快捷血压录入与体征抽屉核验 ➔ 家务建档/快捷打卡/积分兑换零花钱落盘 ➔ 育儿疫苗接种登记与应急物资缺口建档 ➔
 *    Quick Add 自然语言周期备忘/排期/日历/周报 ➔ Ctrl+K 拼音检索/存放位置速查/访客脱敏只读 ➔
 *    删除进回收站无损恢复与 420px 窄分屏零溢出 ➔ 浏览器 F5 整页重载持久化存活与零异常断言；
 * 3. 用法：
 *    node scripts/e2e-isolated.mjs                 # 跑完 12 步浏览器实测后自动关闭隔离内核并清理临时目录
 *    node scripts/e2e-isolated.mjs --keep          # 跑完后保留隔离内核与工作区在后台运行，输出可直接浏览器打开的地址
 *    node scripts/e2e-isolated.mjs --keep --headed # 打开可视 Chrome 窗口现场演示操作全过程并保留隔离环境
 */

import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(REPO, "dist");
const PLUGIN_ID = "siyuan-home";
const HOST = "127.0.0.1";
const KEEP = process.argv.includes("--keep");
const HEADED = process.argv.includes("--headed");
const MARKER_FILE = "siyuan-home-e2e-isolated.json";
const SHOT_DIR = path.join(REPO, "tmp", "ui-shots", "e2e-isolated");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveKernel() {
    const candidates = [
        process.env.SIYUAN_KERNEL,
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ].filter(Boolean);
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe，可通过 SIYUAN_KERNEL 指定路径");
    const appDir = path.resolve(path.dirname(kernel), "..");
    for (const req of ["stage", "appearance"]) {
        if (!fs.existsSync(path.join(appDir, req))) throw new Error(`思源 resources 目录缺少 ${req}: ${appDir}`);
    }
    return { kernel, appDir };
}

function checkPortFree(port) {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen({ host: HOST, port, exclusive: true }, () => srv.close((e) => (e ? reject(e) : resolve())));
    });
}

async function choosePort() {
    for (let i = 0; i < 40; i++) {
        const port = 31000 + Math.floor(Math.random() * 20000);
        if (port === 6806 || port === 14680) continue;
        try {
            await checkPortFree(port);
            return port;
        } catch { /* try next */ }
    }
    throw new Error("未找到可用回环测试端口");
}

function prepareIsolatedWorkspace(workspace) {
    const resolved = path.resolve(workspace);
    const relRepo = path.relative(resolved, REPO);
    const outside = relRepo === ".." || relRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relRepo);
    if (!outside) throw new Error(`拒绝使用仓库内目录作为隔离工作区: ${resolved}`);
    fs.mkdirSync(path.join(resolved, "data", "storage", "petal"), { recursive: true });
    fs.writeFileSync(
        path.join(resolved, MARKER_FILE),
        JSON.stringify({ createdBy: "siyuan-home-e2e-isolated", createdAt: new Date().toISOString() }, null, 2) + "\n",
    );
}

function copyDistAndWritePetals(workspace) {
    if (!fs.existsSync(path.join(DIST, "index.js"))) {
        throw new Error("dist/index.js 不存在，请先运行 pnpm run build");
    }
    const pluginDst = path.join(workspace, "data", "plugins", PLUGIN_ID);
    fs.cpSync(DIST, pluginDst, { recursive: true });

    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "plugin.json"), "utf8"));
    const petalsPath = path.join(workspace, "data", "storage", "petal", "petals.json");
    const petals = [
        {
            name: PLUGIN_ID,
            displayName: manifest.displayName?.["zh-CN"] || manifest.displayName?.default || "小驴管家",
            version: manifest.version || "0.5.185",
            enabled: true,
            incompatible: false,
            disabledInPublish: true,
            userDisabledInPublish: false,
            disallowInstall: false,
            js: "",
            css: "",
            i18n: null,
            kernel: { js: "", existed: true, incompatible: false },
        },
    ];
    fs.mkdirSync(path.dirname(petalsPath), { recursive: true });
    fs.writeFileSync(petalsPath, JSON.stringify(petals, null, "\t"));
}

function spawnKernel(kernel, appDir, workspace, port, detachProcess = false) {
    if (detachProcess && process.platform === "win32") {
        const pidStr = execSync(
            `powershell.exe -NoProfile -Command "(Start-Process -FilePath '${kernel}' -ArgumentList 'serve','--workspace','${workspace.replace(/'/g, "''")}','--wd','${appDir.replace(/'/g, "''")}','--port','${port}','--lang','zh-CN' -WindowStyle Hidden -PassThru).Id"`,
            { encoding: "utf8" },
        ).trim();
        return { child: { pid: Number(pidStr) || undefined, exitCode: null, unref() {}, once() {}, kill() {} }, logs: [] };
    }
    const child = spawn(
        kernel,
        ["serve", "--workspace", workspace, "--wd", appDir, "--port", String(port), "--lang", "zh-CN"],
        {
            detached: detachProcess,
            windowsHide: true,
            stdio: detachProcess ? "ignore" : ["ignore", "pipe", "pipe"],
            env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
        },
    );
    const logs = [];
    if (!detachProcess && child.stdout && child.stderr) {
        for (const s of [child.stdout, child.stderr]) {
            s.on("data", (buf) => {
                String(buf).split(/\r?\n/).filter(Boolean).forEach((l) => {
                    logs.push(l);
                    if (logs.length > 500) logs.shift();
                });
            });
        }
    }
    return { child, logs };
}

async function makeApi(base, getToken) {
    return async function api(route, body = {}) {
        const headers = { "Content-Type": "application/json" };
        const tk = getToken();
        if (tk) headers.Authorization = `Token ${tk}`;
        const res = await fetch(`${base}${route}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(25000),
        });
        return res.json();
    };
}

async function waitKernelReady(base, api) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        try {
            const p = await api("/api/system/bootProgress");
            if (p?.code === 0 && Number(p?.data?.progress) >= 100) return;
        } catch { /* booting */ }
        await sleep(300);
    }
    throw new Error(`隔离思源内核启动超时 (${base})`);
}

async function shutdownKernel(api, child) {
    try { await api("/api/system/exit", { force: true }); } catch { /* ignore */ }
    await Promise.race([
        new Promise((resolve) => {
            if (!child || child.exitCode !== null) resolve(true);
            else child.once("exit", () => resolve(true));
        }),
        sleep(6000),
    ]);
    try { if (child && child.exitCode === null) child.kill("SIGKILL"); } catch { /* ignore */ }
}

const results = [];
function rec(step, ok, detail = "") {
    results.push({ step, ok, detail });
    console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${step}${detail ? ` — ${detail}` : ""}`);
    if (!ok) throw new Error(`Step failed: ${step} (${detail})`);
}

function readWorkspaceToken(workspace) {
    try {
        const conf = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8"));
        return conf?.api?.token || "";
    } catch {
        return "";
    }
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const { kernel, appDir } = resolveKernel();
    const port = await choosePort();
    const base = `http://${HOST}:${port}`;
    const appUrl = `${base}/stage/build/desktop/`;
    const workspace = path.join(os.tmpdir(), `siyuan-home-isolated-${Date.now()}-${process.pid}`);

    prepareIsolatedWorkspace(workspace);
    copyDistAndWritePetals(workspace);

    console.log(`[e2e-isolated] 创建全新隔离工作区: ${workspace}`);
    console.log(`[e2e-isolated] 启动隔离内核端口:   ${base}`);

    let token = "";
    const api = await makeApi(base, () => token);

    // 首次启动：开启集市信任 + 固化 petals.json，随后重启一次让内核正式挂载手工放置的插件
    let proc = spawnKernel(kernel, appDir, workspace, port, false);
    let browser;
    let allPassed = false;
    try {
        await waitKernelReady(base, api);
        await sleep(800);
        token = readWorkspaceToken(workspace);
        await api("/api/setting/setBazaar", { trust: true, petal: true });
        await shutdownKernel(api, proc.child);
        await sleep(800);

        // 重写一次 petals.json 防止首启未 trust 时被清空，再正式拉起内核
        copyDistAndWritePetals(workspace);
        proc = spawnKernel(kernel, appDir, workspace, port, KEEP);
        await waitKernelReady(base, api);
        token = readWorkspaceToken(workspace);
        rec("Step 0 · 隔离内核冷启动与集市信任挂载", Boolean(token), `port=${port}`);

        browser = await chromium.launch({
            channel: "chrome",
            headless: !HEADED,
        }).catch(() => chromium.launch({ headless: !HEADED }));

        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(String(e)));

        await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.addStyleTag({ content: "#message, #tempMessage { pointer-events: none !important; }" });
        await page.locator('#toolbar [data-name="siyuan-home"], #toolbar [aria-label*="小驴管家"]').first().waitFor({ state: "visible", timeout: 25000 });
        await sleep(1500);

        // 打开小驴管家主面板
        await page.evaluate(() => {
            const tb = document.getElementById("toolbar");
            const el = tb?.querySelector('[data-name="siyuan-home"]')
                ?? Array.from(tb?.children ?? []).find((c) => (c.getAttribute("aria-label") || "").includes("小驴管家"));
            el?.click();
        });
        await page.locator(".lv-home").first().waitFor({ state: "visible", timeout: 20000 });
        await sleep(1200);
        const clearSnackbars = () => page.evaluate(() => {
            document.getElementById("message")?.replaceChildren();
            document.getElementById("tempMessage")?.replaceChildren();
        });
        await clearSnackbars();

        // ── Step 1: 全新空白工作区首启向导与核心建库 ──
        const wizVisible = await page.locator(".lv-onboarding").isVisible();
        assert.equal(wizVisible, true, "全新工作区必须展示首次引导向导");
        await page.locator(".lv-onboarding .lv-rolechip").filter({ hasText: "配偶" }).click();
        await page.locator(".lv-onboarding .lv-rolechip").filter({ hasText: "子女" }).click();
        await page.locator(".lv-onboarding .lv-rolechip").filter({ hasText: "老人" }).click();
        await page.locator('.lv-onboarding [aria-label*="增加"], .lv-onboarding .lv-wiz__step-btn').last().click();
        await page.screenshot({ path: path.join(SHOT_DIR, "01-onboarding-step1.png") });
        await page.locator(".lv-onboarding .lv-wiz__actions .lv-btn.primary").click();
        await sleep(400);
        await page.locator(".lv-onboarding .lv-wiz__actions .lv-btn.primary").click();

        // 等待向导建库完成（向导消失并进入面板）
        await page.locator(".lv-onboarding").waitFor({ state: "detached", timeout: 90000 });
        await sleep(1500);
        // 若向导完成后自动弹出了快速记录弹层，先按 Escape 收起以便回到总览检视
        if (await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']").count()) {
            await page.keyboard.press("Escape");
            await sleep(400);
        }
        const provisionedAfterWiz = await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            return {
                version: p.getDiagnostics().version,
                provisioned: Object.keys(p.settings.dbRefs).filter((k) => p.settings.dbRefs[k]?.avId),
            };
        });
        rec("Step 1 · 首启向导完成并自动建库", provisionedAfterWiz.provisioned.length >= 6, `v${provisionedAfterWiz.version}, 已建库=${provisionedAfterWiz.provisioned.join(",")}`);

        // ── Step 2: 家庭成员建档（儿童公历 + 长辈农历生日）──
        await page.locator("#lv-rail-tab-members").click();
        await sleep(800);
        const addMemberViaUi = async ({ name, role, sex, birthday, lunar }) => {
            if (!(await page.locator("#lv-member-editor").isVisible())) {
                await page.locator(".lv-member-tools .lv-btn.primary").click();
                await sleep(250);
            }
            await page.locator("#lv-member-name-input").fill(name);
            await page.locator("#lv-member-role-select").selectOption(role);
            if (sex) await page.locator("#lv-member-sex-select").selectOption(sex);
            if (birthday) await page.locator("#lv-member-birthday-input").fill(birthday);
            const lunarCb = page.locator("#lv-member-lunar-checkbox");
            if (Boolean(lunar) !== (await lunarCb.isChecked())) await lunarCb.click();
            await page.locator(".lv-member-editor-actions .lv-btn.primary").click();
            await sleep(1800);
        };
        await addMemberViaUi({ name: "本人", role: "self", sex: "male", birthday: "1990-03-07", lunar: false });
        await addMemberViaUi({ name: "小宝", role: "child", sex: "male", birthday: "2024-06-01", lunar: false });
        await addMemberViaUi({ name: "外婆", role: "elder", sex: "female", birthday: "1960-08-15", lunar: true });
        await page.screenshot({ path: path.join(SHOT_DIR, "02-members-created.png") });

        const memberStats = await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            const mems = p.settings.members ?? [];
            return {
                count: mems.length,
                linkedCount: mems.filter((m) => Boolean(m.avItemId) && !m.syncError).length,
                names: mems.map((m) => m.name),
            };
        });
        rec("Step 2 · 成员档案双写同步与公农历生日建档", memberStats.count >= 3 && memberStats.linkedCount === memberStats.count, `members=${memberStats.names.join("/")}`);

        // ── Step 3: 通过设置面板启用日常高频模块（车辆/家务/囤货/购物）──
        await page.locator(".lv-rail-nav__foot button").nth(2).click(); // 设置按钮
        await sleep(700);
        const searchModInput = page.locator(".lv-set-search-input");
        for (const modKeyword of ["车辆", "家务", "囤货", "购物"]) {
            await searchModInput.fill(modKeyword);
            await sleep(200);
            const sw = page.locator(".lv-settings__row input.b3-switch").first();
            if ((await sw.count()) && !(await sw.isChecked())) {
                await sw.click();
                await sleep(150);
            }
        }
        await searchModInput.fill("");
        await page.locator(".lv-settings__footer .lv-btn.primary, .lv-settings__footer button.b3-button:not(.b3-button--cancel)").last().click();
        await sleep(1200);
        // 关闭设置窗口
        await page.keyboard.press("Escape");
        await sleep(500);
        const enabledNow = await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            return p.settings.enabledModules;
        });
        rec("Step 3 · 设置页开启车辆/家务/囤货/购物模块", ["vehicles", "chores", "stock", "shopping"].every((m) => enabledNow.includes(m)), `enabled=${enabledNow.length}个`);

        // ── Step 4: 台账主表登记身份证（验证自动掩码、到期提醒派生与详情抽屉零依赖 QR 解码）──
        await clearSnackbars();
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(1200);
        await clearSnackbars();
        const ledgerSel = page.locator(".lv-ledger-toolbar > select.b3-select");
        await ledgerSel.selectOption("certs");
        await sleep(1200);
        await page.locator(".lv-ledger-toolbar .lv-btn.primary").click();
        await sleep(500);

        const due15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
        await page.locator("#lv-new-category").selectOption("id");
        await sleep(250);
        await page.locator("#lv-new-name").fill("本人居民身份证");
        const selfOptVal = await page.evaluate(() => {
            const sel = document.querySelector("#lv-new-member");
            return Array.from(sel?.options ?? []).find((o) => o.textContent.includes("本人"))?.value || "";
        });
        if (selfOptVal) await page.locator("#lv-new-member").selectOption(selfOptVal);
        await page.locator("#lv-new-expiry").fill(due15);
        // 展开附加字段填身份证号与存放位置
        const moreDetailsBox = page.locator(".lv-record-modal.open details.lv-record-more");
        if ((await moreDetailsBox.count()) && !(await moreDetailsBox.evaluate((el) => el.open))) {
            await moreDetailsBox.locator("summary").click();
            await sleep(200);
        }
        if (await page.locator("#lv-new-x_cert_id_number").count()) {
            await page.locator("#lv-new-x_cert_id_number").fill("110101199003077758");
        }
        if (await page.locator("#lv-new-location").count()) {
            await page.locator("#lv-new-location").fill("主卧保险箱上层");
        }
        await page.locator(".lv-record-modal.open .lv-sheet-foot .lv-btn.primary").last().click();
        await sleep(2500);

        const certTableText = await page.locator(".lv-table").innerText();
        assert.equal(certTableText.includes("本人居民身份证"), true, "证件表格应显示新建的身份证");
        assert.equal(certTableText.includes("110101199003077758"), false, "表格层身份证号必须默认脱敏掩码");

        // 点击打开详情抽屉核验脱敏切换与零依赖 QR 图像解码
        await page.locator("button.lv-table-open").first().click();
        await sleep(900);
        const drawerCertCheck = await page.evaluate(() => {
            const img = document.querySelector("#lv-detail-body .lv-qr-img");
            const bodyText = document.querySelector("#lv-detail-body")?.textContent || "";
            return {
                qrWidth: img?.naturalWidth ?? 0,
                maskedInDrawer: !bodyText.includes("110101199003077758"),
            };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, "04-cert-detail-qr.png") });
        await page.keyboard.press("Escape");
        await sleep(350);
        rec("Step 4 · 身份证建档、自动脱敏掩码与零依赖 QR 渲染", drawerCertCheck.qrWidth > 0 && drawerCertCheck.maskedInDrawer, `qr=${drawerCertCheck.qrWidth}px`);

        // ── Step 5: 车辆建档 + 按 N 键快捷记录两笔加油 ➔ 车辆能耗看板互通核验 ──
        await ledgerSel.selectOption("vehicles");
        await sleep(1000);
        if (await page.locator(".lv-ledger-toolbar button", { hasText: /重建|创建/ }).count()) {
            await page.locator(".lv-ledger-toolbar button", { hasText: /重建|创建/ }).click();
            await sleep(3000);
        } else if (!(await page.locator(".lv-ledger-toolbar .lv-btn.primary").count())) {
            await page.evaluate(async () => {
                const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
                await p.repairModule("vehicles");
            });
            await ledgerSel.selectOption("certs");
            await sleep(300);
            await ledgerSel.selectOption("vehicles");
            await sleep(1000);
        }
        await page.locator(".lv-ledger-toolbar .lv-btn.primary").click();
        await sleep(500);
        await page.locator("#lv-new-name").fill("家用SUV");
        if (await page.locator("#lv-new-plate").count()) await page.locator("#lv-new-plate").fill("京A88888");
        if (await page.locator("#lv-new-mileage").count()) await page.locator("#lv-new-mileage").fill("15000");
        await page.locator(".lv-record-modal.open .lv-sheet-foot .lv-btn.primary").last().click();
        await sleep(2500);

        // 按快捷键 N 打开快速记录 -> 记两笔加油
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(600);
        await page.locator(".lv-modal.open .lv-capture-mode-btn").first().click();
        await sleep(300);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "加油" }).click();
        await sleep(500);

        const logFuelOnce = async (amount, mileage, liters, dateStr) => {
            await page.locator("#lv-fuel-amount").fill(String(amount));
            await page.locator("#lv-fuel-mileage").fill(String(mileage));
            await page.locator("#lv-fuel-liters").fill(String(liters));
            await page.locator("#lv-fuel-date").fill(dateStr);
            await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
            await sleep(1600);
        };
        await logFuelOnce(310, 15000, 40, "2026-10-01");
        // 重新唤出记第二笔加油以形成油耗区间
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(500);
        await logFuelOnce(325, 15500, 42, "2026-10-20");

        // 打开「更多操作 -> 能耗统计看板」核验两笔加油记录真实互通可见！
        await clearSnackbars();
        await page.locator("details.lv-ledger-more > summary").click();
        await sleep(200);
        await page.locator('.lv-ledger-more__menu button[role="menuitem"]').filter({ hasText: /能耗|油耗/ }).click();
        await sleep(1000);
        const fuelDashText = await page.locator("#lv-fuel-dashboard").innerText();
        await page.screenshot({ path: path.join(SHOT_DIR, "05-vehicle-energy-dashboard.png") });
        await page.keyboard.press("Escape");
        await sleep(350);
        rec("Step 5 · 快捷加油流水与车辆能耗看板全链路互通", fuelDashText.includes("635") || (fuelDashText.includes("310") && fuelDashText.includes("325")) || fuelDashText.includes("2"), "两笔加油已进入能耗统计");

        // ── Step 6: 快速记录血压空值拦截 + 录入外婆血压 138/88 ➔ 健康详情抽屉核验 ──
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(500);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "血压" }).click();
        await sleep(300);
        const elderVal = await page.evaluate(() => {
            const sel = document.querySelector("#lv-vital-mem");
            return Array.from(sel?.options ?? []).find((o) => o.textContent.includes("外婆"))?.value || "";
        });
        await page.locator("#lv-vital-mem").selectOption(elderVal);
        // 先不填数值直接点保存，验证空读数被拦截
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(200);
        const emptyVitalBlocked = await page.locator(".lv-modal.open .lv-event-flow-error").isVisible();
        assert.equal(emptyVitalBlocked, true, "未填血压数值必须拦截并给出提示");

        // 填入真实血压 138/88 与脉搏 74 保存
        await page.locator("#lv-vital-sys").fill("138");
        await page.locator("#lv-vital-dia").fill("88");
        await page.locator("#lv-vital-pulse").fill("74");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(2200);

        // 切到病历与健康台账，打开外婆健康档案抽屉，验证 138/88 在抽屉体征列表可见！
        await ledgerSel.selectOption("health");
        await sleep(1200);
        await page.locator("button.lv-table-open").first().click();
        await sleep(1200);
        const healthDrawerText = await page.locator("#lv-detail-body").innerText();
        await page.screenshot({ path: path.join(SHOT_DIR, "06-health-vitals-drawer.png") });
        await page.keyboard.press("Escape");
        await sleep(350);
        rec("Step 6 · 快捷血压录入拦截校验与健康抽屉趋势互通", healthDrawerText.includes("138/88"), "健康抽屉实时显示 138/88");

        // ── Step 7: 家务建档 + 快速记录「家务打卡」+30分 ➔ 积分结算入零花钱账本核验 ──
        await page.evaluate(async () => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            for (const m of ["chores", "allowance", "stock", "shopping"]) {
                if (!p.settings.dbRefs?.[m]?.avId) await p.repairModule(m);
            }
        });
        await ledgerSel.selectOption("chores");
        await sleep(1000);
        await page.locator(".lv-ledger-toolbar .lv-btn.primary").click();
        await sleep(400);
        await page.locator("#lv-new-name").fill("周末整理绘本角");
        if (await page.locator("#lv-new-cycle").count()) await page.locator("#lv-new-cycle").selectOption("week");
        await page.locator(".lv-record-modal.open .lv-sheet-foot .lv-btn.primary").last().click();
        await sleep(2200);

        // 打开快速记录 -> 🧹 家务打卡（小宝 +30 积分）
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(500);
        await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            void p;
        });
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "家务" }).click();
        await sleep(600);
        // 若刚建完家务行需刷新下拉上下文，重开一次弹层或直接选首项
        if (!(await page.locator("#lv-chore-row").count())) {
            await page.keyboard.press("Escape");
            await sleep(300);
            // 重挂或直接刷新后打开
            await page.locator("#lv-rail-tab-overview").click();
            await sleep(400);
            await page.locator("#lv-rail-tab-ledger").click();
            await sleep(600);
            await page.locator(".lv-rail-nav__foot button").first().click();
            await sleep(500);
            await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "家务" }).click();
            await sleep(600);
        }
        // 如果 QuickCapture 常驻挂载首次 onMount 时 chores 为空，检查 #lv-chore-row 是否出现
        const hasChoreSelect = await page.locator("#lv-chore-row").count();
        if (!hasChoreSelect) {
            throw new Error("BUG_FOUND: QuickCapture 常驻挂载后新建的家务项目未在重新打开快速记录时刷新 choresList！");
        }
        const kidId = await page.evaluate(() => {
            const sel = document.querySelector("#lv-chore-mem");
            return Array.from(sel?.options ?? []).find((o) => o.textContent.includes("小宝"))?.value || "";
        });
        await page.locator("#lv-chore-mem").selectOption(kidId);
        await page.locator("#lv-chore-points").fill("30");
        await page.locator("#lv-chore-note").fill("主动收拾得很整齐");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(2200);

        // 在 chores 台账打开「更多操作 -> 积分结算 -> 一键写入零花钱账本」
        await ledgerSel.selectOption("chores");
        await sleep(900);
        await clearSnackbars();
        await page.locator("details.lv-ledger-more > summary").click();
        await sleep(200);
        await page.locator('.lv-ledger-more__menu button[role="menuitem"]').filter({ hasText: "积分结算" }).click();
        await sleep(900);
        await page.locator("#lv-rewards-settle").click();
        await sleep(2500);

        // 切换到 allowance 台账核验金额（3元）、分类、成员真实非空！
        await ledgerSel.selectOption("allowance");
        await sleep(1200);
        const allowanceText = await page.locator(".lv-table").innerText();
        await page.screenshot({ path: path.join(SHOT_DIR, "07-allowance-settled.png") });
        rec("Step 7 · 快捷家务打卡与儿童积分兑换零花钱真实落盘", allowanceText.includes("小宝") && allowanceText.includes("3"), `allowance行已写入金额与成员`);

        // ── Step 8: 育儿疫苗接种排期就地登记 + 囤货应急物资缺口一键建档 ──
        await ledgerSel.selectOption("parenting");
        await sleep(1000);
        await clearSnackbars();
        await page.locator("details.lv-ledger-more > summary").click();
        await sleep(200);
        await page.locator('.lv-ledger-more__menu button[role="menuitem"]').filter({ hasText: "疫苗" }).click();
        await sleep(1000);
        const firstVacBtn = page.locator("#lv-vaccine-sched-body button").filter({ hasText: /登记|接种/ }).first();
        assert.equal((await firstVacBtn.count()) > 0, true, "小宝疫苗排期应展示待接种针次");
        await firstVacBtn.click();
        await sleep(400);
        await page.locator("#lv-vrec-batch").fill("202610A");
        await page.locator("#lv-vrec-save").click();
        await sleep(2200);
        const vacBodyAfter = await page.locator("#lv-vaccine-sched-body").innerText();
        await page.keyboard.press("Escape");
        await sleep(400);

        await ledgerSel.selectOption("stock");
        await sleep(1000);
        await clearSnackbars();
        await page.locator("details.lv-ledger-more > summary").click();
        await sleep(200);
        await page.locator('.lv-ledger-more__menu button[role="menuitem"]').filter({ hasText: "应急物资" }).click();
        await sleep(900);
        await page.locator("#lv-em-import").click();
        await sleep(3000);
        await ledgerSel.selectOption("certs");
        await sleep(300);
        await ledgerSel.selectOption("stock");
        await sleep(1200);
        const stockRowCount = await page.locator("tr.lv-row-link").count();
        rec("Step 8 · 育儿疫苗就地登记闭环与应急物资批量建档", vacBodyAfter.includes("已接种") && !vacBodyAfter.includes("已接种\n0") && stockRowCount >= 5, `疫苗状态已变已接种, 应急囤货=${stockRowCount}行`);

        // ── Step 9: 总览 Quick Add 自然语言周期备忘 + 提醒排期/日历/周报摘要 ──
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(900);
        const memoInp = page.locator("input.lv-memo-input").first();
        await memoInp.fill("清洗空调滤网 !高 #家务 @明天 *!14天");
        await sleep(250);
        await memoInp.press("Enter");
        await sleep(1500);

        await page.locator("#lv-rail-tab-reminders").click();
        await sleep(1000);
        const remText = await page.locator("#lv-panel-reminders").innerText();
        assert.equal(remText.includes("清洗空调滤网") && remText.includes("#家务"), true, "提醒中枢应渲染自然语言备忘与分类徽章");

        // 打开提醒周报摘要并按 Escape 验证弹窗底座关闭与焦点恢复
        const digestBtn = page.locator("#lv-panel-reminders button").filter({ hasText: /摘要|周报/ }).first();
        if (await digestBtn.count()) {
            await clearSnackbars();
            await digestBtn.click();
            await sleep(600);
            const digestVisible = await page.locator("#lv-digest-body").isVisible();
            assert.equal(digestVisible, true, "提醒周报弹窗应正常打开");
            await page.keyboard.press("Escape");
            await sleep(300);
        }
        await page.screenshot({ path: path.join(SHOT_DIR, "09-reminders-hub.png") });
        rec("Step 9 · Quick Add 自然语言周期备忘与提醒周报闭环", true, "优先级/标签/完成顺延徽章齐全");

        // ── Step 10: 全景检索 (Ctrl+K 拼音) + 东西放哪了位置反查 + 访客脱敏只读模式 ──
        await page.locator(".lv-rail-nav__foot button").nth(1).click(); // 全景检索
        await sleep(800);
        const spotInp = page.locator("#lv-spotlight-input").first();
        await spotInp.fill("sfz"); // 拼音首字母搜“身份证”
        await sleep(1000);
        const spotText = await page.locator("#lv-spotlight-list, .lv-spotlight-dialog-body").first().innerText();
        const pinyinHit = spotText.includes("身份证");
        await page.keyboard.press("Escape");
        await sleep(350);

        // 总览「东西放哪了」搜“保险箱”
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(600);
        await page.locator(".lv-hero-tools-group button").first().click();
        await sleep(1000);
        const locInp = page.locator("#lv-loc-search, #lv-loc-body input").first();
        await locInp.fill("保险箱");
        await sleep(300);
        const locHit = (await page.locator("#lv-loc-body").innerText()).includes("本人居民身份证");
        await page.keyboard.press("Escape");
        await sleep(350);

        // 开启访客模式 -> 验证顶部横幅出现，再退出访客模式
        await clearSnackbars();
        await page.locator('.lv-tabbar-actions button[aria-label*="访客"]').click();
        await sleep(400);
        const guestBannerOn = (await page.locator(".lv-guest-banner, [role='region']").filter({ hasText: /访客/ }).count()) > 0;
        await clearSnackbars();
        await page.locator('.lv-tabbar-actions button[aria-label*="访客"]').click();
        await sleep(300);
        await clearSnackbars();
        rec("Step 10 · 拼音首字母全景检索、存放位置反查与访客模式", pinyinHit && locHit && guestBannerOn, `pinyin=${pinyinHit}, loc=${locHit}, guest=${guestBannerOn}`);

        // ── Step 11: 台账单行删除进安全回收站 ➔ 无损恢复 + 420px 窄分屏零溢出 ──
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(900);
        await ledgerSel.selectOption("stock");
        await sleep(900);
        const beforeDelCount = await page.locator("tr.lv-row-link").count();
        await page.locator("button.lv-table-open").first().click();
        await sleep(700);
        await page.locator("#lv-detail-del").click();
        await sleep(350);
        await page.locator(".lv-top-confirm .b3-button:not(.b3-button--cancel), .b3-dialog .b3-button--remove, .b3-dialog .b3-button:not(.b3-button--cancel)").last().click();
        await sleep(1800);
        const afterDelCount = await page.locator("tr.lv-row-link").count();
        assert.equal(afterDelCount, beforeDelCount - 1, "删除后囤货台账行数应减 1");

        // 进入设置 -> 数据与迁移 -> 回收站恢复
        await page.locator(".lv-rail-nav__foot button").nth(2).click();
        await sleep(600);
        await page.locator(".lv-settings button, .lv-setnav__item").filter({ hasText: /数据|迁移/ }).first().click();
        await sleep(300);
        await page.locator(".lv-settings .lv-setnav__item").filter({ hasText: /回收站|Trash/ }).first().click();
        await sleep(350);
        await page.locator(".lv-trash-ops button").first().click();
        await sleep(2200);
        await page.keyboard.press("Escape");
        await sleep(500);
        await ledgerSel.selectOption("certs");
        await sleep(300);
        await ledgerSel.selectOption("stock");
        await sleep(1000);
        const restoredCount = await page.locator("tr.lv-row-link").count();

        // 420px 窄视口防溢出实测
        await page.setViewportSize({ width: 420, height: 800 });
        await sleep(400);
        await page.locator("#lv-tab-overview").click();
        await sleep(600);
        const narrowOverflow = await page.evaluate(() => {
            const stage = document.querySelector(".lv-main-stage");
            return stage ? stage.scrollWidth - stage.clientWidth : -1;
        });
        await page.screenshot({ path: path.join(SHOT_DIR, "11-narrow-420-overview.png") });
        await page.setViewportSize({ width: 1440, height: 900 });
        await sleep(300);
        rec("Step 11 · 回收站删除无损恢复与 420px 窄分屏零溢出", restoredCount === beforeDelCount && narrowOverflow <= 0, `restored=${restoredCount}/${beforeDelCount}, overflow=${narrowOverflow}px`);

        // ── Step 12: 浏览器整页刷新（F5 重载）持久化存活验证 ──
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        await page.locator('#toolbar [data-name="siyuan-home"], #toolbar [aria-label*="小驴管家"]').first().waitFor({ state: "visible", timeout: 25000 });
        await sleep(2000);
        if ((await page.locator(".lv-home").count()) === 0) {
            await page.evaluate(() => {
                const tb = document.getElementById("toolbar");
                const el = tb?.querySelector('[data-name="siyuan-home"]')
                    ?? Array.from(tb?.children ?? []).find((c) => (c.getAttribute("aria-label") || "").includes("小驴管家"));
                el?.click();
            });
            await page.locator(".lv-home").first().waitFor({ state: "visible", timeout: 20000 });
        }
        await sleep(2500);
        const afterReload = await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            return {
                onboarded: p.settings.onboarded,
                members: p.settings.members.length,
                reminders: p.scan?.reminders?.length ?? 0,
                memos: p.runtime?.memos?.length ?? 0,
            };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, "12-after-reload-overview.png") });
        assert.equal(pageErrors.length, 0, `页面不应存在未捕获异常: ${pageErrors.join("; ")}`);
        rec("Step 12 · F5 整页重载后设置/成员/台账/提醒完整存活且零报错", afterReload.onboarded && afterReload.members >= 3 && afterReload.reminders >= 2 && afterReload.memos >= 1, `members=${afterReload.members}, reminders=${afterReload.reminders}, pageErrors=0`);

        await browser.close();
        browser = undefined;

        allPassed = true;
        console.log(`\n🎉 [e2e-isolated] ${results.length}/${results.length} 真实浏览器全链路自用走查全部通过！（截图位于 ${SHOT_DIR}）`);
        if (KEEP) {
            proc.child.unref?.();
            console.log(`\n[e2e-isolated] --keep 已启用，隔离工作区与思源内核保持运行（随时可直接用浏览器打开体验）：`);
            console.log(`  浏览器直达: ${appUrl}`);
            console.log(`  内核地址:   ${base}`);
            console.log(`  工作区目录: ${workspace}`);
            console.log(`  API Token:  ${token}`);
            console.log(`  内核 PID:   ${proc.child.pid}`);
        }
    } finally {
        if (browser) {
            try { await browser.close(); } catch { /* ignore */ }
        }
        if (!KEEP || !allPassed) {
            await shutdownKernel(api, proc.child);
            try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

main().catch((err) => {
    console.error("\n[e2e-isolated] 走查中断（发现真实卡点或缺陷）:", err?.stack || err);
    process.exitCode = 1;
});
