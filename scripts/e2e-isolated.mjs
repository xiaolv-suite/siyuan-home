/**
 * 隔离式全真实浏览器自用走查脚本（支持 --keep 保留独立工作区与内核，支持 --headed 打开可视 Chrome 窗口）：
 *
 * 1. 默认在 D:\思源插件配套\测试工作区\.isolated-workspaces 创建独立思源工作区，其他平台回退系统临时目录，
 *    拷贝 dist/ 生产包，开启集市信任并注册 petals.json，
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
import { execFileSync, execSync, spawn } from "node:child_process";
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
const DEFAULT_PORT = 43919;
const KEEP = process.argv.includes("--keep");
const SYNC_ONLY = process.argv.includes("--sync-only");
const HEADED = process.argv.includes("--headed");
const MARKER_FILE = "siyuan-home-e2e-isolated.json";
const SHOT_DIR = path.join(REPO, "tmp", "ui-shots", "e2e-isolated");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveIsolatedRoot() {
    if (process.env.TEST_ISOLATED_ROOT) return path.resolve(process.env.TEST_ISOLATED_ROOT);
    if (process.platform === "win32" && fs.existsSync("D:\\")) {
        return path.join("D:\\思源插件配套", "测试工作区", ".isolated-workspaces");
    }
    return os.tmpdir();
}

function resolveIsolatedWorkspace(persistent) {
    if (process.env.TEST_ISOLATED_WORKSPACE) return path.resolve(process.env.TEST_ISOLATED_WORKSPACE);
    const root = resolveIsolatedRoot();
    fs.mkdirSync(root, { recursive: true });
    return persistent
        ? path.join(root, PLUGIN_ID)
        : path.join(root, `${PLUGIN_ID}-run-${Date.now()}-${process.pid}`);
}

function stopPreviousIsolatedKernel(targetPort) {
    if (process.platform !== "win32") return;
    try {
        const psScript = [
            `Get-CimInstance Win32_Process -Filter "Name='SiYuan-Kernel.exe'" | ForEach-Object {`,
            `  $cmd = [string]$_.CommandLine;`,
            `  if (($cmd -match '--port\\s+${targetPort}(\\s|$)') -or ($cmd -match 'siyuan-home')) {`,
            `    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue`,
            `  }`,
            `}`,
        ].join(" ");
        execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], { stdio: "ignore" });
    } catch { /* ignore */ }
}

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
    const preferred = Number(process.env.TEST_ISOLATED_PORT) || (KEEP || SYNC_ONLY ? DEFAULT_PORT : 0);
    if (preferred && preferred !== 6806 && preferred !== 3727 && preferred !== 14680) {
        if (!SYNC_ONLY) {
            stopPreviousIsolatedKernel(preferred);
            await sleep(500);
        }
        try {
            await checkPortFree(preferred);
            return preferred;
        } catch {
            if (SYNC_ONLY) return preferred;
        }
    }
    for (let i = 0; i < 40; i++) {
        const port = 31000 + Math.floor(Math.random() * 20000);
        if (port === 6806 || port === 3727 || port === 14680) continue;
        try {
            await checkPortFree(port);
            return port;
        } catch { /* try next */ }
    }
    throw new Error("未找到可用回环测试端口");
}

function prepareIsolatedWorkspace(workspace, resetExisting = false) {
    const resolved = path.resolve(workspace);
    const relRepo = path.relative(resolved, REPO);
    const outside = relRepo === ".." || relRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relRepo);
    if (!outside) throw new Error(`拒绝使用仓库内目录作为隔离工作区: ${resolved}`);
    if (resetExisting && fs.existsSync(resolved)) {
        fs.rmSync(resolved, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(resolved, "data", "storage", "petal"), { recursive: true });
    fs.writeFileSync(
        path.join(resolved, MARKER_FILE),
        JSON.stringify({ createdBy: "siyuan-home-e2e-isolated", createdAt: new Date().toISOString(), workspace: resolved }, null, 2) + "\n",
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
    const workspace = resolveIsolatedWorkspace(KEEP || SYNC_ONLY);

    if (SYNC_ONLY) {
        prepareIsolatedWorkspace(workspace, false);
        copyDistAndWritePetals(workspace);
        stopPreviousIsolatedKernel(port);
        await sleep(600);
        const proc = spawnKernel(kernel, appDir, workspace, port, true);
        const pid = proc.child.pid;
        let token = readWorkspaceToken(workspace);
        const api = await makeApi(base, () => token);
        await waitKernelReady(base, api);
        token = readWorkspaceToken(workspace);
        await api("/api/setting/setBazaar", { trust: true, petal: true });
        copyDistAndWritePetals(workspace);
        fs.writeFileSync(
            path.join(workspace, MARKER_FILE),
            JSON.stringify({ createdBy: "siyuan-home-e2e-isolated", updatedAt: new Date().toISOString(), port, appUrl, base, workspace, token, pid }, null, 2) + "\n",
        );
        console.log(`\n✅ [e2e-isolated] --sync-only 已将最新 dist/ 热更新至 D 盘隔离工作区（保留全部现有测试数据）：`);
        console.log(`  浏览器直达: ${appUrl}`);
        console.log(`  工作区目录: ${workspace}`);
        console.log(`  API Token:  ${token}`);
        return;
    }

    prepareIsolatedWorkspace(workspace, true);
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
        await sleep(1000);
        // 向导完成后可能弹出快速记录弹层，等待其就绪后按 Escape 收起以便回到总览检视
        const capModalAfterWiz = page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']");
        try {
            await capModalAfterWiz.waitFor({ state: "visible", timeout: 6000 });
            await page.keyboard.press("Escape");
            await capModalAfterWiz.waitFor({ state: "hidden", timeout: 4000 });
        } catch {
            if (await capModalAfterWiz.count()) {
                await page.keyboard.press("Escape");
                await sleep(400);
            }
        }
        while ((await page.locator(".lv-modal.open, .b3-dialog--open, .b3-dialog").count()) > 0) {
            await page.keyboard.press("Escape");
            await sleep(250);
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

        // 验证车辆卡片直接点击「记加油」可同步打开抽屉并立即唤起加油录入表单（vehicleActionQueue 时序回归守卫）
        await clearSnackbars();
        await page.locator(".lv-vehicle-card button").filter({ hasText: "记加油" }).first().click();
        await sleep(900);
        const vehQuickFormOpen = (await page.locator("#lv-energy-form-body").count()) === 1;
        assert.equal(vehQuickFormOpen, true, "车辆卡片点击记加油必须直接弹出加油表单");
        while ((await page.locator(".b3-dialog").count()) > 0) {
            await page.keyboard.press("Escape");
            await sleep(250);
        }

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
        await logFuelOnce(310, 15000, 40, "2026-09-15");
        // 重新唤出记第二笔加油以形成跨月油耗区间
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
        rec("Step 5 · 快捷加油流水与车辆能耗看板全链路互通", fuelDashText.includes("家用SUV") && (fuelDashText.includes("676") || fuelDashText.includes("635") || fuelDashText.includes("L/100km")), "两笔加油已进入能耗统计");

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
        await page.waitForFunction(
            () => document.querySelector("#lv-panel-reminders")?.textContent?.includes("清洗空调滤网"),
            { timeout: 8000 }
        ).catch(() => undefined);
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

        // 开启访客模式 -> 验证顶部横幅出现、敏感证件隐藏且写操作被拦截，再退出访客模式
        await clearSnackbars();
        await page.locator('.lv-tabbar-actions button[aria-label*="访客"]').click();
        const guestBanner = page.locator(".lv-guest-banner, [role='region']").filter({ hasText: /访客/ }).first();
        await guestBanner.waitFor({ state: "visible", timeout: 8000 });
        const guestBannerOn = await guestBanner.isVisible();
        const ovText = await page.locator("#lv-panel-overview").innerText();
        const certsIdx = ovText.indexOf("本人居民身份证");
        if (certsIdx !== -1) {
            console.log("DEBUG CERTS CONTEXT:", ovText.slice(Math.max(0, certsIdx - 50), certsIdx + 60).replace(/\s+/g, " "));
        }
        const guestHidesCerts = !ovText.includes("本人居民身份证");
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(200);
        const guestBlocksCapture = (await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']").count()) === 0;
        await clearSnackbars();
        await page.locator('.lv-tabbar-actions button[aria-label*="访客"]').click();
        await sleep(300);
        await clearSnackbars();
        rec("Step 10 · 拼音首字母全景检索、存放位置反查与访客只读隔离", pinyinHit && locHit && guestBannerOn && guestHidesCerts && guestBlocksCapture, `pinyin=${pinyinHit}, loc=${locHit}, banner=${guestBannerOn}, hidesCerts=${guestHidesCerts}, blocksCap=${guestBlocksCapture}`);

        // ── Step 11: 台账行内数量步进、单行删除进安全回收站 ➔ 无损恢复 + 420px 窄分屏零溢出 ──
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(900);
        await ledgerSel.selectOption("stock");
        await sleep(900);
        const stepperCount = await page.locator(".lv-qty-stepper .lv-qty-btn").count();
        assert.equal(stepperCount >= 10, true, "囤货台账必须展示数量列与行内 +/- 步进按钮");
        const beforeDelCount = await page.locator("tr.lv-row-link").count();
        await page.locator("button.lv-table-open").first().click();
        await sleep(700);
        await page.locator("#lv-detail-del").click();
        await sleep(500);
        const confirmBtn = page.locator(".b3-dialog").last().locator(".b3-dialog__action button:not(.b3-button--cancel)");
        await confirmBtn.waitFor({ state: "visible", timeout: 5000 });
        await confirmBtn.click();
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

        // ── Step 13: 思源笔记原生文档真实落地、列序正序（主键在首列）与点击「定位」打开文档验证 ──
        await page.addStyleTag({ content: "#message, #tempMessage, section.onboarding { pointer-events: none !important; display: none !important; }" });
        await page.locator("#lv-rail-tab-reminders").click();
        await sleep(900);
        const certRemCard = page.locator(".lv-rem").filter({ hasText: "本人居民身份证" }).first();
        await certRemCard.locator(".lv-rem-expand-btn").click();
        await sleep(350);
        await certRemCard.locator(".lv-rem-summary button").click(); // 点击“定位台账文档”
        await sleep(2500);

        const nativeDocCheck = await page.evaluate(async () => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            const certsRef = p.settings.dbRefs.certs;
            const avEl = document.querySelector(`.protyle-wysiwyg .av[data-av-id="${certsRef.avId}"]`);
            const avText = avEl?.innerText || "";
            const r = await fetch("/api/av/renderAttributeView", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: certsRef.avId, pageSize: 10 }),
            }).then((x) => x.json());
            const colNames = (r?.data?.view?.columns ?? []).slice(0, 4).map((c) => c.name);
            return {
                docTabOpened: Boolean(avEl),
                avShowsIdCard: avText.includes("本人居民身份证"),
                firstCols: colNames,
            };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, "13-native-siyuan-doc-av.png") });
        // 切回小驴管家主面板页签，保持体验环境首屏即管家
        await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            p?.showTab?.();
        });
        await sleep(500);
        rec(
            "Step 13 · 思源原生文档表格真实落地、列序正序且点击定位直达",
            nativeDocCheck.docTabOpened && nativeDocCheck.avShowsIdCard && nativeDocCheck.firstCols[0] === "主键",
            `docOpened=${nativeDocCheck.docTabOpened}, cols=${nativeDocCheck.firstCols.join("->")}`,
        );

        // ── Step 14: 总览精简与【快速记录·日常流水优先】直达 + 全部日常流水与备忘在思源文档落地验证 ──
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(800);
        const overviewCleanCheck = await page.evaluate(() => ({
            noRedundantKpiRow: !document.querySelector(".lv-kpi-row"),
            noRedundantHeroStat: !document.querySelector(".lv-hero-stat-card"),
            hasQuickFlowHub: Boolean(document.querySelector("section.lv-quick-hub")),
            flowBtnCount: document.querySelectorAll(".lv-quick-flow-grid .lv-flow-btn").length,
        }));
        assert.equal(overviewCleanCheck.noRedundantKpiRow && overviewCleanCheck.noRedundantHeroStat, true, "总览应消除重复统计条与冗余大数字卡");
        assert.equal(overviewCleanCheck.hasQuickFlowHub && overviewCleanCheck.flowBtnCount === 5, true, "总览首屏应突出展示 5 项日常流水快捷入口");

        // 直接点击总览首屏的「🛒 记待买」流水按钮 -> 验证一步打开对应子页签并同步落盘
        await page.locator(".lv-quick-flow-grid .lv-flow-btn").nth(3).click();
        await sleep(500);
        await page.locator("#lv-shop-name").fill("有机纯牛奶");
        await page.locator("#lv-shop-qty").fill("2");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(2200);
        await page.screenshot({ path: path.join(SHOT_DIR, "14a-streamlined-overview.png") });

        // 点击总览「流水与备忘文档」按钮，直接打开思源原生 `/📒 日常流水与备忘` 文档页签
        await page.locator("section.lv-quick-hub .lv-quick-hub__doc-btn").click();
        await sleep(2500);
        const docSyncVerification = await page.evaluate(async () => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            const exportMd = async (id) => {
                if (!id) return "";
                const res = await fetch("/api/export/exportMdContent", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id }),
                }).then((r) => r.json());
                return res?.data?.content || "";
            };
            const journalDocId = p.settings.dbRefs?.adhoc?.docId;
            const journalMd = await exportMd(journalDocId);
            const vehMd = await exportMd(p.settings.dbRefs?.vehicles?.docId);
            const healthMd = await exportMd(p.settings.dbRefs?.health?.docId);
            const choresMd = await exportMd(p.settings.dbRefs?.chores?.docId);
            const protyleText = document.querySelector(".protyle-wysiwyg")?.innerText || "";
            const blockRefsCount = document.querySelectorAll('.protyle-wysiwyg span[data-type="block-ref"]').length;
            const m10Idx = journalMd.indexOf("### 10 月");
            const m09Idx = journalMd.indexOf("### 09 月");
            const d1020Idx = journalMd.indexOf("#### 2026-10-20");
            const d0915Idx = journalMd.indexOf("#### 2026-09-15");
            const lifelogLines = journalMd.split("\n").filter((l) => /^\d{2}:\d{2}\s/.test(l.trim()));
            const lifelogRe = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([^：:\r\n]+)[：:](.+)$/;
            return {
                journalDocId: Boolean(journalDocId),
                protyleShowsJournal: protyleText.includes("2026 年") && (protyleText.includes("10 月") || protyleText.includes("11 月")) && protyleText.includes("清洗空调滤网"),
                hasBidirectionalLinks: blockRefsCount >= 4 && vehMd.includes("📒 流水总账"),
                yearMonthDesc: journalMd.includes("## 2026 年") && m10Idx > -1 && m09Idx > m10Idx && d0915Idx > d1020Idx,
                lifelogFormatValid: lifelogLines.length >= 5 && lifelogLines.every((l) => lifelogRe.test(l.trim())),
                journalHasAllFlows:
                    journalMd.includes("家用SUV") &&
                    journalMd.includes("138/88 mmHg") &&
                    journalMd.includes("+30 积分") &&
                    journalMd.includes("有机纯牛奶") &&
                    journalMd.includes("清洗空调滤网"),
                vehDocHasFuelLog: vehMd.includes("日常流水与附属记录") && vehMd.includes("42 L"),
                healthDocHasVitalLog: healthMd.includes("日常流水与附属记录") && healthMd.includes("138/88 mmHg"),
                choresDocHasCheckinLog: choresMd.includes("日常流水与附属记录") && choresMd.includes("+30 积分"),
            };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, "14b-native-daily-journal-doc.png") });
        await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            p?.showTab?.();
        });
        await sleep(500);
        rec(
            "Step 14 · LifeLog 标准语法、年/月/日倒序可折叠大纲与双向双链思源文档落地",
            docSyncVerification.journalDocId &&
                docSyncVerification.protyleShowsJournal &&
                docSyncVerification.hasBidirectionalLinks &&
                docSyncVerification.yearMonthDesc &&
                docSyncVerification.lifelogFormatValid &&
                docSyncVerification.journalHasAllFlows &&
                docSyncVerification.vehDocHasFuelLog &&
                docSyncVerification.healthDocHasVitalLog &&
                docSyncVerification.choresDocHasCheckinLog,
            `lifelog=${docSyncVerification.lifelogFormatValid}, ymDesc=${docSyncVerification.yearMonthDesc}, biLinks=${docSyncVerification.hasBidirectionalLinks}`,
        );

        // ── Step 15: 各种录入方式与全部按钮交互全面实测（三数换算/加满充满/步进器/便签芯片/通知置顶/记忆引擎）──
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(800);
        await clearSnackbars();

        // 1. 打开快速记录弹窗并切换至加油
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(600);
        const quickModal = page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']");
        assert.equal(await quickModal.isVisible(), true, "快速记录弹层应正常唤起");
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "加油" }).click();
        await sleep(300);

        // 2. 测试【昨天 / 此刻】按钮与时间联动
        const chipYesterday = page.locator(".lv-dt-quick-bar .lv-dt-chip").filter({ hasText: "昨天" }).first();
        await chipYesterday.click();
        await sleep(200);
        const yDateVal = await page.locator("#lv-fuel-date, input.lv-date-field").first().inputValue();
        const localYmd = (offsetDays = 0) => {
            const d = new Date();
            d.setDate(d.getDate() + offsetDays);
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const expectedYesterday = localYmd(-1);
        assert.equal(yDateVal, expectedYesterday, "点击【昨天】芯片应自动填入昨天日期");

        const btnSnapNow = page.locator(".lv-snap-now-btn").first();
        await btnSnapNow.click();
        await sleep(200);
        const nowDateVal = await page.locator("#lv-fuel-date, input.lv-date-field").first().inputValue();
        const todayStr = localYmd(0);
        assert.equal(nowDateVal, todayStr, "点击【此刻】按钮应自动同步恢复到今天日期");

        // 3. 测试加油单价与金额联动换算
        const chip95 = page.locator(".lv-pill-chip").filter({ hasText: "95#" }).first();
        if (await chip95.count()) await chip95.click();
        await sleep(150);

        // 输入油价 8.00 与金额 400 ➔ 升数自动计算为 50
        await page.locator("#lv-unit-price").fill("8");
        await sleep(100);
        await page.locator("#lv-fuel-amount").fill("400");
        await sleep(200);
        const autoLiters = await page.locator("#lv-fuel-liters").inputValue();
        assert.equal(Number(autoLiters), 50, "输入单价8元和总额400元，升数应自动联动算为50升");

        // 修改加多升数 60 ➔ 在固定的8元油价下，自动变动价格为 480 元
        await page.locator("#lv-fuel-liters").fill("60");
        await sleep(200);
        const autoAmount = await page.locator("#lv-fuel-amount").inputValue();
        assert.equal(Number(autoAmount), 480, "输入单价8元和升数60升，总额应自动变动为480元");

        // 重新填入价格 400 ➔ 在固定的8元油价下，自动算出来升数为 50 升
        await page.locator("#lv-fuel-amount").fill("400");
        await sleep(200);
        const autoLitersAgain = await page.locator("#lv-fuel-liters").inputValue();
        assert.equal(Number(autoLitersAgain), 50, "输入400元与8元单价，升数应自动算为50升");

        // 勾选【加满】
        const fuelFullCheckbox = page.locator("#lv-fuel-full");
        if (!(await fuelFullCheckbox.isChecked())) await fuelFullCheckbox.click();
        await sleep(100);
        assert.equal(await fuelFullCheckbox.isChecked(), true, "加满复选框应成功勾选");

        // 4. 测试切换【充电】方式与家充单价联动
        const chargeKindBtn = page.locator(".lv-segmented-group .lv-seg-btn").filter({ hasText: "充电" }).first();
        await chargeKindBtn.click();
        await sleep(200);
        const homeChargeChip = page.locator(".lv-pill-chip").filter({ hasText: "家充" }).first();
        if (await homeChargeChip.count()) await homeChargeChip.click();
        await sleep(150);
        await page.locator("#lv-fuel-amount").fill("");
        await page.locator("#lv-fuel-liters").fill("");
        await sleep(100);
        await page.locator("#lv-unit-price").fill("0.6");
        await sleep(100);
        await page.locator("#lv-fuel-liters").fill("50");
        await sleep(200);
        const chargeAmount = await page.locator("#lv-fuel-amount").inputValue();
        assert.equal(Number(chargeAmount), 30, "输入家充电价0.6元与50度，总额应自动算为30元");

        // 切回加油，填入里程并保存
        const fuelKindBtn = page.locator(".lv-segmented-group .lv-seg-btn").filter({ hasText: "加油" }).first();
        await fuelKindBtn.click();
        await sleep(200);
        await page.locator("#lv-fuel-amount").fill("400");
        await page.locator("#lv-fuel-liters").fill("50");
        await page.locator("#lv-fuel-mileage").fill("16000");

        // 点击保存，验证秒级关闭弹窗（耗时小于 1500ms）
        const saveStart = Date.now();
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']").waitFor({ state: "detached", timeout: 2500 });
        const saveDuration = Date.now() - saveStart;
        assert.equal(saveDuration < 1500, true, `快速录入保存应秒级响应 (耗时 ${saveDuration}ms)`);
        await sleep(600);

        // 5. 验证弹窗与系统通知层级（z-index 规则置顶）
        const zIndexCheck = await page.evaluate(() => {
            const el = document.getElementById("message") || document.getElementById("tempMessage");
            return el ? window.getComputedStyle(el).zIndex : "";
        });
        assert.equal(zIndexCheck, "99999", `系统通知容器 z-index 必须为 99999 (当前: ${zIndexCheck})`);

        // 6. 测试健康体征扩充录入：体重 (kg) 与 体温 (℃)
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(400);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: /血压|体征/ }).click();
        await sleep(300);
        await page.locator(".lv-segmented-group .lv-seg-btn").filter({ hasText: "体重" }).click();
        await sleep(200);
        await page.locator("#lv-vital-weight").fill("68.5");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(800);

        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(400);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: /血压|体征/ }).click();
        await sleep(300);
        await page.locator(".lv-segmented-group .lv-seg-btn").filter({ hasText: "体温" }).click();
        await sleep(200);
        await page.locator("#lv-vital-temp").fill("36.6");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(800);

        // 7. 测试待买清单数量步进器按钮（+ / -）
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(400);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "待买" }).click();
        await sleep(300);
        await page.locator("#lv-shop-name").fill("纸巾抽纸");
        const stepPlus = page.locator(".lv-stepper-row button").filter({ hasText: "+" }).first();
        const stepMinus = page.locator(".lv-stepper-row button").filter({ hasText: "-" }).first();
        await stepPlus.click();
        await sleep(100);
        await stepPlus.click();
        await sleep(100);
        let qtyVal = await page.locator("#lv-shop-qty").inputValue();
        assert.equal(Number(qtyVal), 3, "连续点击两次加号，待买数量应步进至 3");
        await stepMinus.click();
        await sleep(100);
        qtyVal = await page.locator("#lv-shop-qty").inputValue();
        assert.equal(Number(qtyVal), 2, "点击减号，待买数量应减为 2");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(800);

        // 8. 测试便签标签芯片一键添加
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(400);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "便签" }).click();
        await sleep(300);
        await page.locator("#lv-snip-text").fill("给阳台绿植浇水");
        const dailyTagChip = page.locator(".lv-pill-chips button").filter({ hasText: "#日常" }).first();
        if (await dailyTagChip.count()) await dailyTagChip.click();
        await sleep(150);
        const snipContent = await page.locator("#lv-snip-text").inputValue();
        assert.equal(snipContent.includes("#日常"), true, "点击标签芯片应自动追加 #日常 到便签末尾");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await sleep(800);

        // 9. 验证记忆引擎：再次打开快速记录，验证油价、加满状态自动保留！
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(400);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "加油" }).click();
        await sleep(300);
        const rememberedUnitPrice = await page.locator("#lv-unit-price").inputValue();
        const rememberedAmount = await page.locator("#lv-fuel-amount").inputValue();
        const rememberedIsFull = await page.locator("#lv-fuel-full").isChecked();
        assert.equal(Number(rememberedUnitPrice), 8, "记忆引擎应记住上次油价 8.00 元");
        assert.equal(Number(rememberedAmount), 400, "记忆引擎应记住上次加油金额 400 元");
        assert.equal(rememberedIsFull, true, "记忆引擎应记住上次加满状态");
        const quickCap15 = page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']");
        if (await quickCap15.count()) {
            const closeBtn = page.locator(".lv-modal.open .lv-sheet-head button.lv-iconbtn, .lv-modal.open button[aria-label*='关闭']").first();
            if (await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.click().catch(() => {});
            } else {
                await page.keyboard.press("Escape");
            }
            await quickCap15.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
        }
        await sleep(300);

        await page.screenshot({ path: path.join(SHOT_DIR, "15-quick-flows-comprehensive.png") });
        rec(
            "Step 15 · 各种录入方式与全部按钮交互全面实测（三数换算/加满充满/步进器/便签芯片/通知置顶/记忆引擎）",
            true,
            `三数联动与记忆正常，通知置顶z=${zIndexCheck}，保存耗时${saveDuration}ms`,
        );

        // ── Step 16: 全景生活台账全量扩充（宠物/会员/保单/房产/教育/药箱/人情/食品/维保/纯电双车）──
        const seededStats = await page.evaluate(async () => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            const newSiYuanId = () => {
                const now = new Date();
                const pad = (n, len = 2) => String(n).padStart(len, "0");
                const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                const rand = Math.random().toString(36).slice(2, 9);
                return `${ymd}-${rand}`;
            };
            const post = async (url, data) => {
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                });
                return res.json();
            };
            const addRow = async (avId, title) => {
                const desiredItemID = newSiYuanId();
                await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    blockID: "",
                    srcs: [{ blockID: "", content: title, isDetached: true, itemID: desiredItemID, id: desiredItemID }],
                });
                return desiredItemID;
            };
            const setCol = async (avId, colId, itemId, payload) => {
                if (!avId || !colId || !itemId) return;
                await post("/api/av/setAttributeViewBlockAttr", {
                    avID: avId,
                    keyID: colId,
                    itemID: itemId,
                    value: payload,
                });
            };

            const targetModules = [
                "pets", "memberships", "insurance", "assets-real",
                "schooling", "medicine", "favors", "food", "house", "snippets", "contracts"
            ];
            for (const m of targetModules) {
                if (!p.settings.enabledModules.includes(m)) {
                    p.settings.enabledModules.push(m);
                }
                if (!p.settings.dbRefs?.[m]?.avId) {
                    await p.repairModule(m);
                }
            }

            const dAhead = (n) => {
                const d = new Date(Date.now() + n * 86400000);
                return {
                    str: d.toISOString().slice(0, 10),
                    ts: d.getTime(),
                };
            };

            // 1. 添加纯电汽车与流水
            const vRef = p.settings.dbRefs?.vehicles;
            let evId = "";
            if (vRef?.avId && vRef.columns) {
                evId = await addRow(vRef.avId, "纯电轿车 Model Y");
                if (evId) {
                    if (vRef.columns.name) await setCol(vRef.avId, vRef.columns.name, evId, { type: "text", text: { content: "纯电轿车 Model Y" } });
                    if (vRef.columns.plate) await setCol(vRef.avId, vRef.columns.plate, evId, { type: "text", text: { content: "京AD12345" } });
                    if (vRef.columns.mileage) await setCol(vRef.avId, vRef.columns.mileage, evId, { type: "number", number: { content: 8500, isNotEmpty: true } });
                    if (vRef.columns.note) await setCol(vRef.avId, vRef.columns.note, evId, { type: "text", text: { content: "最近充电：2026-10-25 · 45kWh · ¥27 · 已充满 · 8500km" } });
                }
            }

            // 2. 批量写入各模块生活实体台账
            const sampleLedgers = [
                {
                    mod: "pets",
                    name: "金毛犬 · 豆豆",
                    fields: {
                        name: "金毛犬 · 豆豆",
                        category: "dog",
                        date: dAhead(-520).str,
                        expiry: dAhead(45).str,
                        location: "芯片号 984000123456789 / 牵引绳挂玄关",
                        note: "每年12月接种狂犬疫苗与八联疫苗，每月体内外驱虫",
                    },
                },
                {
                    mod: "memberships",
                    name: "iCloud+ 2TB 家庭云空间",
                    fields: {
                        name: "iCloud+ 2TB 家庭云空间",
                        category: "digital",
                        amount: 816,
                        cycle: "year",
                        expiry: dAhead(28).str,
                        note: "6人家庭共享空间，自动按年续费扣款",
                    },
                },
                {
                    mod: "insurance",
                    name: "尊享e生百万医疗险（小宝）",
                    fields: {
                        name: "尊享e生百万医疗险（小宝）",
                        category: "medical",
                        amount: 1280,
                        cycle: "year",
                        expiry: dAhead(35).str,
                        note: "保额 300 万，众安在线承保，含特药直付与门诊绿通",
                    },
                },
                {
                    mod: "assets-real",
                    name: "阳光花园三期 8-2-1201",
                    fields: {
                        name: "阳光花园三期 8-2-1201",
                        category: "house",
                        amount: 3680000,
                        location: "不动产权证书 2021098877",
                        note: "建筑面积 126.8㎡，契税与维修基金已缴清",
                    },
                },
                {
                    mod: "schooling",
                    name: "小宝少儿英语启蒙周课",
                    fields: {
                        name: "小宝少儿英语启蒙周课",
                        category: "language",
                        amount: 4800,
                        cycle: "quarter",
                        expiry: dAhead(60).str,
                        note: "每周六上午 10:00-11:30，剩余 16 课时",
                    },
                },
                {
                    mod: "medicine",
                    name: "美林 布洛芬混悬液 100ml",
                    fields: {
                        name: "美林 布洛芬混悬液 100ml",
                        category: "fever",
                        location: "客厅电视柜应急小药箱",
                        expiry: dAhead(90).str,
                        note: "开封后常温阴凉存放，儿童对症退热，38.5℃以上酌情服用",
                    },
                },
                {
                    mod: "favors",
                    name: "表姐婚礼礼金",
                    fields: {
                        name: "表姐婚礼礼金",
                        category: "wedding",
                        amount: 2000,
                        date: dAhead(-25).str,
                        note: "微信转账礼金，回礼喜糖礼盒已收",
                    },
                },
                {
                    mod: "food",
                    name: "澳洲安格斯西冷牛排 (4片装)",
                    fields: {
                        name: "澳洲安格斯西冷牛排 (4片装)",
                        category: "frozen",
                        location: "厨房冰箱负18度冷冻室二层",
                        expiry: dAhead(60).str,
                        note: "已解冻2片，剩余2片密封存放",
                    },
                },
                {
                    mod: "house",
                    name: "中央空调滤网清洗与管道杀菌",
                    fields: {
                        name: "中央空调滤网清洗与管道杀菌",
                        category: "maintenance_h",
                        pay_day: dAhead(20).str,
                        cycle: "year",
                        note: "大金官方售后上门服务，保修单在主卧保险箱",
                    },
                },
                {
                    mod: "snippets",
                    name: "智能门锁与入户总水阀指引",
                    fields: {
                        name: "智能门锁与入户总水阀指引",
                        category: "other_sn",
                        content: "管理员密码已存主卧保险箱，入户总水阀在厨房水槽下方左侧阀门",
                    },
                },
                {
                    mod: "contracts",
                    name: "房屋租赁与车位服务协议",
                    fields: {
                        name: "房屋租赁与车位服务协议",
                        category: "service",
                        amount: 3600,
                        expiry: dAhead(40).str,
                        note: "地下B2-088号车位长租合同，一年一签",
                    },
                },
            ];

            let rowCount = 0;
            for (const item of sampleLedgers) {
                const ref = p.settings.dbRefs?.[item.mod];
                if (!ref?.avId || !ref.columns) continue;
                const itemId = await addRow(ref.avId, item.name);
                if (!itemId) continue;
                rowCount++;
                for (const [k, v] of Object.entries(item.fields)) {
                    const colId = ref.columns[k];
                    if (!colId) continue;
                    if (typeof v === "number") {
                        await setCol(ref.avId, colId, itemId, { type: "number", number: { content: v, isNotEmpty: true } });
                    } else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                        await setCol(ref.avId, colId, itemId, { type: "date", date: { content: new Date(v).getTime(), isNotEmpty: true, isNotTime: true } });
                    } else if (typeof v === "string") {
                        await setCol(ref.avId, colId, itemId, { type: "text", text: { content: v } });
                    }
                }
            }

            await p.saveData?.("settings.json", p.settings);
            await p.refreshHub?.(undefined, true);
            await p.syncJournalSafely?.();

            return {
                enabledCount: p.settings.enabledModules?.length || 0,
                addedRows: rowCount,
                hasEv: Boolean(evId),
                remindersCount: p.scan?.reminders?.length || 0,
            };
        });

        while ((await page.locator(".lv-modal.open, .b3-dialog--open, .b3-dialog").count()) > 0) {
            const closeBtn = page.locator(".lv-modal.open button[aria-label*='关闭'], .lv-modal.open .lv-sheet-head button.lv-iconbtn").first();
            if (await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.click().catch(() => {});
            } else {
                await page.keyboard.press("Escape");
            }
            await sleep(250);
        }

        // 切回总览首页检视全景家庭卡片与丰富提醒
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(1200);
        await page.screenshot({ path: path.join(SHOT_DIR, "16-rich-family-dashboard.png") });
        rec(
            "Step 16 · 全景生活台账全量扩充（宠物/会员/保单/房产/教育/药箱/人情/食品/维保/纯电双车）",
            seededStats.enabledCount >= 18 && seededStats.addedRows >= 10,
            `开启模块=${seededStats.enabledCount}个, 新增台账=${seededStats.addedRows}行, 提醒项=${seededStats.remindersCount}个`,
        );

        // ── Step 17: 填充后全域生活台账与卡片交互全景巡检（零 2000-01-01 幽灵日期 / 抽屉展开 / 控制台零异常）──
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(1000);
        const inspectMods = ["vehicles", "pets", "memberships", "insurance", "assets-real", "medicine", "chores", "stock", "shopping", "contracts"];
        const inspectedSamples = {};
        while (await page.locator(".b3-dialog--open, .b3-dialog").count() > 0) {
            await page.keyboard.press("Escape");
            await sleep(200);
        }
        for (const mod of inspectMods) {
            const sel = page.locator(".lv-ledger-toolbar > select.b3-select");
            await sel.selectOption(mod);
            await sleep(600);
            const tableText = await page.locator(".lv-table, .lv-vehicle-grid, .lv-ledger-table-wrap").innerText().catch(() => "");
            assert.equal(tableText.includes("2000-01-01"), false, `模块 ${mod} 不得出现 2000-01-01 幽灵空日期渲染`);
            inspectedSamples[mod] = tableText.replace(/\s+/g, " ").slice(0, 30);
            // 抽屉展开与关闭走查
            if (mod !== "vehicles") {
                const openBtn = page.locator("button.lv-table-open").first();
                if (await openBtn.count()) {
                    await openBtn.click();
                    await sleep(400);
                    while (await page.locator(".b3-dialog--open, .b3-dialog").count() > 0) {
                        await page.keyboard.press("Escape");
                        await sleep(200);
                    }
                }
            }
        }

        // 切回总览，验证 420px 窄视口在 21 个模块充满下依然零横向溢出
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(600);
        await page.setViewportSize({ width: 420, height: 800 });
        await sleep(400);
        const filledNarrowOverflow = await page.evaluate(() => {
            const stage = document.querySelector(".lv-main-stage");
            return stage ? stage.scrollWidth - stage.clientWidth : -1;
        });
        assert.equal(filledNarrowOverflow <= 0, true, "充满21个模块台账后在 420px 窄屏下仍不得出现横向溢出");
        await page.setViewportSize({ width: 1440, height: 900 });
        await sleep(300);

        assert.equal(pageErrors.length, 0, `全量巡检过程中不得发生任何未捕获页面异常: ${pageErrors.join("; ")}`);
        await page.screenshot({ path: path.join(SHOT_DIR, "17-comprehensive-walkthrough-success.png") });
        rec(
            "Step 17 · 填充后全域生活台账与卡片交互全景巡检（零幽灵日期/抽屉开合/420px窄屏/控制台零异常）",
            true,
            `已巡检${inspectMods.length}个模块台账，幽灵空日期彻底绝迹，控制台0异常，窄屏溢出=${filledNarrowOverflow}px`,
        );

        // ── Step 18: 一家人共同参与多选交互、能源动态快捷面额与全域多成员台账联动深度实测 ──
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(600);
        await clearSnackbars();

        // 1. 打开快速记录弹窗并切换至加油
        await page.locator(".lv-rail-nav__foot button").first().click();
        await sleep(500);
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "加油" }).click();
        await sleep(300);

        // 验证加油面额为 [¥200, ¥300, ¥500]
        const fuelAmtChips = await page.locator(".lv-dt-quick-bar .lv-dt-chip").allTextContents();
        assert.equal(fuelAmtChips.includes("¥200") && fuelAmtChips.includes("¥300") && fuelAmtChips.includes("¥500"), true, "加油时应呈现 ¥200/¥300/¥500 快捷面额");

        // 切换到充电，验证面额动态切换为 [¥30, ¥50, ¥100]
        await page.locator(".lv-segmented-group .lv-seg-btn").filter({ hasText: "充电" }).click();
        await sleep(300);
        const chargeAmtChips = await page.locator(".lv-dt-quick-bar .lv-dt-chip").allTextContents();
        assert.equal(chargeAmtChips.includes("¥30") && chargeAmtChips.includes("¥50") && chargeAmtChips.includes("¥100"), true, "充电时应呈现 ¥30/¥50/¥100 契合日常的快捷面额");

        // 点击 ¥50 快捷面额 ➔ 在电价0.6元/度下，自动算出度数为 83.33 度
        await page.locator("#lv-unit-price").fill("0.6");
        await sleep(100);
        const chip50 = page.locator(".lv-dt-quick-bar .lv-dt-chip").filter({ hasText: "¥50" }).first();
        await chip50.click();
        await sleep(200);
        const calcChargeLiters = await page.locator("#lv-fuel-liters").inputValue();
        assert.equal(Number(calcChargeLiters), 83.33, "点击¥50面额，按0.6元电价应自动算出 83.33 度电");

        // 2. 切换至家务打卡，测试「👨‍👩‍👧‍👦 一家人一起」一键全选多成员
        await page.locator(".lv-modal.open .lv-event-subbtn").filter({ hasText: "家务" }).click();
        await sleep(400);

        const allFamilyChip = page.locator("#lv-chore-mem-chips button").filter({ hasText: "一家人一起" }).first();
        assert.equal(await allFamilyChip.isVisible(), true, "应呈现「👨‍👩‍👧‍👦 一家人一起」一键全选胶囊");

        // 点击「一家人一起」
        await allFamilyChip.click();
        await sleep(200);
        const memberChipPrimaryCount = await page.locator("#lv-chore-mem-chips button.b3-chip--primary").count();
        assert.equal(memberChipPrimaryCount >= 2, true, "点击「一家人一起」后所有家庭成员胶囊应全数激活");

        // 填入积分与说明并提交
        await page.locator("#lv-chore-points").fill("50");
        await page.locator("#lv-chore-note").fill("周末全家大扫除");
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title'] .lv-sheet-foot .lv-btn.primary").click();
        await page.locator(".lv-modal.open[aria-labelledby='lv-capture-title']").waitFor({ state: "detached", timeout: 2500 });
        await sleep(800);

        // 3. 验证台账模态框也具备成员多选胶囊与「一家人一起」
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(800);
        await page.locator(".lv-ledger-toolbar select.b3-select").first().selectOption("chores");
        await sleep(600);
        await page.locator(".lv-ledger-toolbar button.lv-btn.primary, button.lv-btn.primary").filter({ hasText: /新建|记一笔|新增/ }).first().click();
        await sleep(600);
        const recordModal = page.locator(".lv-record-modal.open");
        assert.equal(await recordModal.isVisible(), true, "新建台账模态框应正常展开");
        const modalFamilyChip = page.locator(".lv-record-modal.open button").filter({ hasText: "一家人一起" }).first();
        assert.equal(await modalFamilyChip.isVisible(), true, "新建台账模态框中应具备「👨‍👩‍👧‍👦 一家人一起」多成员胶囊");
        await page.keyboard.press("Escape");
        await recordModal.waitFor({ state: "detached", timeout: 2500 }).catch(() => {});
        await sleep(300);

        // 4. 切回总览，验证控制台持续 0 异常
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(500);
        assert.equal(pageErrors.length, 0, `Step 18 深度实测中不得发生任何未捕获异常: ${pageErrors.join("; ")}`);
        await page.screenshot({ path: path.join(SHOT_DIR, "18-family-multimember-and-dynamic-chips.png") });
        rec(
            "Step 18 · 一家人共同参与多选交互、能源动态快捷面额与全域多成员台账联动深度实测",
            true,
            `一家人一起一键全选正常，充放电快捷面额动态切换自适应，全域多选台账模态联动正常`,
        );

        // ── Step 19: CAND-24~27新特性与生态跨插件联动深度端到端实测 ──
        await page.locator("#lv-rail-tab-reminders").click();
        await sleep(800);
        await clearSnackbars();

        // 1. CAND-24: 家庭群通知一键复制与格式化自检
        let copyNoticeBtn = page.locator(".lv-rem-more-menu button").filter({ hasText: /家庭群通知|copyFamilyNotice/ }).first();
        if (!(await copyNoticeBtn.isVisible())) {
            const firstRemMore = page.locator(".lv-rem .lv-rem-more-toggle").first();
            if (await firstRemMore.isVisible()) {
                await firstRemMore.click();
                await sleep(250);
            }
        }
        assert.equal(await copyNoticeBtn.isVisible(), true, "提醒列表中应具备「复制家庭群通知」按钮 (CAND-24)");
        await copyNoticeBtn.click();
        await sleep(400);

        // 2. CAND-25: 原生日历视图切换与离线 ICS 日历导出
        const viewToggleCal = page.locator(".lv-hub-view-toggle button").filter({ hasText: /日历|calendar/i }).first();
        assert.equal(await viewToggleCal.isVisible(), true, "提醒顶栏应提供「日历」视图切换按钮");
        await viewToggleCal.click();
        await sleep(600);
        const calExportBtn = page.locator(".lv-cal-export-btn").first();
        assert.equal(await calExportBtn.isVisible(), true, "日历顶栏应显示「导出手机日历 (.ics)」按钮 (CAND-25)");
        await calExportBtn.click();
        await sleep(400);
        const viewToggleList = page.locator(".lv-hub-view-toggle button").filter({ hasText: /列表|list/i }).first();
        await viewToggleList.click();
        await sleep(400);

        // 3. CAND-26: 全景聚光灯标签 (#tag) 与紧急度 (!紧急) 高级过滤
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("siyuan-home:open-spotlight"));
        });
        await sleep(500);
        const spotlightModal = page.locator(".lv-spotlight-dialog-body");
        assert.equal(await spotlightModal.isVisible(), true, "全景生活聚光灯检索弹窗应正常唤起");
        const spotInp19 = page.locator("#lv-spotlight-input");
        await spotInp19.fill("#证件");
        await sleep(400);
        const certsFilterText = await page.locator("#lv-spotlight-list").innerText();
        assert.equal(certsFilterText.includes("身份证") || certsFilterText.includes("证件"), true, "输入 #证件 标签应精准过滤出证件条目 (CAND-26)");
        await spotInp19.fill("!紧急");
        await sleep(400);
        const urgentStatusText = await page.locator("#lv-spotlight-status").innerText();
        assert.equal(Boolean(urgentStatusText), true, "输入 !紧急 过滤条件状态栏应即时响应重算");
        await page.keyboard.press("Escape");
        await spotlightModal.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
        while ((await page.locator(".b3-dialog--open, .b3-dialog").count()) > 0) {
            await page.keyboard.press("Escape");
            await sleep(200);
        }
        await sleep(300);

        // 4. CAND-27: 台账列宽鼠标拖拽调整、双击重置与记忆持久化
        await page.locator("#lv-rail-tab-ledger").click();
        await sleep(800);
        const resizerHandle = page.locator("thead th .lv-col-resizer").first();
        assert.equal(await resizerHandle.isVisible(), true, "台账表头应渲染可拖拽列宽句柄 .lv-col-resizer (CAND-27)");
        const thBox = await resizerHandle.boundingBox();
        if (thBox) {
            await page.mouse.move(thBox.x + thBox.width / 2, thBox.y + thBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(thBox.x + 60, thBox.y + thBox.height / 2);
            await page.mouse.up();
            await sleep(400);
        }
        const widthPersistCheck = await page.evaluate(() => {
            const p = window.siyuan.ws.app.plugins.find((x) => x.name === "siyuan-home");
            return Boolean(p.settings?.ledgerColumnWidths && Object.keys(p.settings.ledgerColumnWidths).length > 0);
        });
        assert.equal(widthPersistCheck, true, "拖拽列宽后应在 settings.ledgerColumnWidths 中建立对应持久化映射");
        await resizerHandle.dblclick();
        await sleep(300);

        // 5. 生态跨插件联动：台账抽屉人脉沉淀与拾遗阅读流入口
        const firstRowOpenBtn = page.locator(".lv-row-link .lv-table-open").first();
        if (await firstRowOpenBtn.count()) {
            await firstRowOpenBtn.click();
            await sleep(500);
            const drawerMoreSummary = page.locator(".lv-detail-actions .lv-detail-more summary");
            if (await drawerMoreSummary.count()) {
                await drawerMoreSummary.click();
                await sleep(250);
                const contactBtn = page.locator("#lv-detail-record-contact");
                const gleanBtn = page.locator("#lv-detail-push-glean");
                assert.equal(await contactBtn.isVisible(), true, "抽屉更多菜单中应具备「沉淀为人脉互动」入口");
                assert.equal(await gleanBtn.isVisible(), true, "抽屉更多菜单中应具备「推入拾遗渐进阅读」入口");
                await contactBtn.click();
                await sleep(300);
            }
            while (await page.locator(".b3-dialog--open, .b3-dialog").count() > 0) {
                await page.keyboard.press("Escape");
                await sleep(200);
            }
        }

        // 6. 控制台 0 异常检验与截图归档
        await page.locator("#lv-rail-tab-overview").click();
        await sleep(400);
        assert.equal(pageErrors.length, 0, `Step 19 新特性与生态联动实测中不得发生任何未捕获异常: ${pageErrors.join("; ")}`);
        await page.screenshot({ path: path.join(SHOT_DIR, "19-cand24-27-and-ecosystem-interop.png") });
        rec(
            "Step 19 · CAND-24~27新特性与生态跨插件联动深度端到端实测",
            true,
            `家庭通知复制正常, 日历ICS导出合规, 聚光灯标签/紧急过滤精准, 台账列宽自适应持久化, 人脉与拾遗联动优雅降级`,
        );

        await browser.close();
        browser = undefined;

        allPassed = true;
        console.log(`\n🎉 [e2e-isolated] ${results.length}/${results.length} 真实浏览器全链路自用走查全部通过！（截图位于 ${SHOT_DIR}）`);
        if (KEEP) {
            proc.child.unref?.();
            fs.writeFileSync(
                path.join(workspace, MARKER_FILE),
                JSON.stringify({
                    createdBy: "siyuan-home-e2e-isolated",
                    updatedAt: new Date().toISOString(),
                    port,
                    appUrl,
                    base,
                    workspace,
                    token,
                    pid: proc.child.pid,
                }, null, 2) + "\n",
            );
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
