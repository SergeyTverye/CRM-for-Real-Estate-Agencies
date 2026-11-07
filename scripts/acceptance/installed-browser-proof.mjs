// Opt-in only. Controller uses existing playwright-core; the CRM uses installed resources only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };
export function localPath(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || /[\x00-\x1f<>"|?*]/.test(value) ||
      value.slice(2).includes(':') || /(^|[\\/])\.\.?([\\/]|$)/.test(value) ||
      value.split(/[\\/]/).some(p => /[ .]$/.test(p))) fail('PATH_REJECTED');
  return path.win32.normalize(value);
}
export function contained(root, target) {
  const rel = path.win32.relative(localPath(root), localPath(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.win32.isAbsolute(rel);
}
export function loopback(value) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value)) fail('RUNTIME_URL_REJECTED');
  const url = new URL(value);
  if (Number(url.port) > 65535) fail('RUNTIME_URL_REJECTED');
  return url.origin;
}
function options(args) {
  const result = {};
  const flags = new Set(['execute-new-installed', 'allow-portable-chromium']);
  const values = new Set(['launcher', 'installer', 'launcher-sha256', 'installer-sha256', 'source-commit', 'evidence-root', 'chromium', 'observe-seconds']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || Object.hasOwn(result, key)) fail('ARGUMENT_REJECTED');
    if (flags.has(key)) result[key] = true;
    else if (values.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) result[key] = args[++i];
    else fail('ARGUMENT_REJECTED');
  }
  return result;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const o = options(process.argv.slice(2));
  if (!o['execute-new-installed']) fail('EXPLICIT_EXECUTION_REQUIRED');
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('WINDOWS_X64_REQUIRED');
  for (const key of ['DEBUG', 'PWDEBUG', 'NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_DEBUG', 'NODE_DEBUG']) {
    if (process.env[key]) fail('UNSAFE_CONTROLLER_ENVIRONMENT');
  }
  if (!/^[a-f0-9]{40}$/i.test(o['source-commit'] ?? '')) fail('SOURCE_REFERENCE_REQUIRED');
  const observe = Number(o['observe-seconds'] ?? 120);
  if (!Number.isInteger(observe) || observe < 10 || observe > 600) fail('OBSERVATION_BOUND_REJECTED');
  const system = localPath(process.env.SystemRoot ?? '');
  const ps = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const baseEnv = { SystemRoot: system, WINDIR: system, SystemDrive: system.slice(0, 2),
    PATH: `${system}\\System32;${system}\\System32\\WindowsPowerShell\\v1.0`,
    COMSPEC: path.join(system, 'System32/cmd.exe') };
  async function powershell(code, env = baseEnv) {
    try {
      return (await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(
        "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" + code, 'utf16le').toString('base64')],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
    } catch { fail('SYSTEM_INSPECTION_FAILED'); }
  }
  // Node lstat alone does not expose all Windows reparse tags. Inspect every ancestor in Windows.
  async function canonical(value) {
    const p = localPath(value);
    await powershell(`$p=$env:QA_CHECK_PATH;while($p){if(Test-Path -LiteralPath $p){$i=Get-Item -Force -LiteralPath $p;if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE'}};$q=[IO.Directory]::GetParent($p);if(!$q){break};$p=$q.FullName}`, { ...baseEnv, QA_CHECK_PATH: p });
    // Also reject aliases, short names and unexpected canonical resolution for existing paths.
    try { if ((await fs.realpath(p)).toLowerCase() !== p.replace(/[\\/]$/, '').toLowerCase()) fail('CANONICAL_MISMATCH'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    return p;
  }
  async function file(p) {
    p = await canonical(p);
    if (!(await fs.stat(p)).isFile()) fail('FILE_REQUIRED');
    return p;
  }
  async function hash(p) { return createHash('sha256').update(await fs.readFile(await file(p))).digest('hex'); }
  const qa = await canonical(path.join(workspace, 'data/qa-v32-installed-browser'));
  if ((await canonical(o['evidence-root'] ?? '')).toLowerCase() !== qa.toLowerCase()) fail('EVIDENCE_ROOT_REJECTED');
  const launcher = await file(o.launcher ?? '');
  if (path.basename(launcher).toLowerCase() !== 'realestatecrm.exe' || contained(workspace, launcher)) fail('INSTALLED_LAUNCHER_REQUIRED');
  const installer = await file(o.installer ?? '');
  for (const p of [installer, launcher]) {
    if (/(^|[\\/])(private-data|secrets)([\\/]|$)/i.test(p)) fail('RESOURCE_SCOPE_REJECTED');
  }
  const launcherHash = await hash(launcher), installerHash = await hash(installer);
  for (const [actual, expected] of [[launcherHash, o['launcher-sha256']], [installerHash, o['installer-sha256']]]) {
    if (!/^[a-f0-9]{64}$/i.test(expected ?? '') || actual !== expected.toLowerCase()) fail('NEW_ARTIFACT_HASH_MISMATCH');
  }
  const install = path.dirname(launcher);
  const node = await file(path.join(install, 'app/node/node.exe'));
  const server = await file(path.join(install, 'app/server.js'));
  let chromiumPath;
  let browserKind = 'supplied-packaged-chromium';
  if (o.chromium) {
    const supplied = localPath(o.chromium);
    if (!contained(path.join(install, 'app/chromium'), supplied) || path.basename(supplied).toLowerCase() !== 'chrome.exe') fail('PACKAGED_CHROMIUM_SCOPE_REJECTED');
    chromiumPath = await file(supplied);
  }
  else if (o['allow-portable-chromium']) {
    chromiumPath = await file('D:/chrome-win64/chrome.exe'); browserKind = 'EXPLICIT_PORTABLE_FALLBACK';
  } else fail('EXPLICIT_CHROMIUM_REQUIRED');
  async function noOtherLauncher() {
    const result = await powershell(`if(@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count){throw 'OTHER_APP'};try{$m=[Threading.Mutex]::OpenExisting('Local\\RealEstateCRM.Desktop.Writer');$m.Dispose();throw 'OTHER_WRITER'}catch [Threading.WaitHandleCannotBeOpenedException]{};'CLEAR'`);
    if (result !== 'CLEAR') fail('OTHER_LAUNCHER_OR_WRITER');
  }
  await noOtherLauncher();
  await fs.mkdir(qa, { recursive: true }); await canonical(qa);
  const id = randomUUID();
  const run = path.join(qa, `run-${id}`);
  await fs.mkdir(run); await canonical(run);
  // Protect only our newly created run; never adjust parent or installed-resource ACLs.
  await powershell(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& "$env:SystemRoot\\System32\\icacls.exe" $env:QA_RUN /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null;if($LASTEXITCODE){throw 'ACL'}`, { ...baseEnv, QA_RUN: run });
  const dirs = {};
  for (const name of ['localappdata', 'roaming', 'temp', 'home']) {
    dirs[name] = path.join(run, name); await fs.mkdir(dirs[name]); await canonical(dirs[name]);
  }
  const env = { ...baseEnv, LOCALAPPDATA: dirs.localappdata, APPDATA: dirs.roaming,
    TEMP: dirs.temp, TMP: dirs.temp, USERPROFILE: dirs.home, HOME: dirs.home };
  const runtime = path.join(dirs.localappdata, 'RealEstateCRM/logs/runtime.json');
  const stopFile = path.join(run, 'STOP');
  const checks = [];
  const result = { schema: 1, status: 'RUNNING', syntheticDataOnly: true, runId: id,
    sourceCommit: o['source-commit'], sourceReference: 'coordinator-supplied-read-only-reference-not-binary-provenance',
    launcherSha256: launcherHash, installerSha256: installerHash, nativeUi: 'NOT_ASSERTED_SEPARATE_OBSERVATION_REQUIRED',
    runtime: { controllerNode: process.version, browserKind }, checks, screenshots: [] };
  let child, context, base, page, browser, supervisorPid;
  let stage = 'START';
  let password = randomBytes(24).toString('hex') + 'Aa7!';
  const login = 'qa-' + randomBytes(10).toString('hex');
  const clientName = `QA SYNTHETIC ${id}`;
  let networkFailed = false, pageFailed = false;
  async function writeNew(p, data) {
    if (!contained(run, p)) fail('WRITE_SCOPE_REJECTED');
    await canonical(p); await fs.writeFile(p, data, { flag: 'wx' });
  }
  function alive() { if (!child || child.exitCode !== null || child.signalCode !== null) fail('OWN_LAUNCHER_EXITED'); }
  async function until(condition, ms, code) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { alive(); if (await condition()) return; await sleep(250); }
    fail(code);
  }
  async function identity() {
    await canonical(runtime);
    const stat = await fs.stat(runtime);
    if (!stat.isFile() || stat.size > 4096) fail('RUNTIME_METADATA_REJECTED');
    let info;
    try { info = JSON.parse(await fs.readFile(runtime, 'utf8')); } catch { fail('RUNTIME_METADATA_REJECTED'); }
    base = loopback(info.url);
    if (!Number.isSafeInteger(info.pid) || info.pid < 1) fail('RUNTIME_PID_REJECTED');
    const owned = await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${info.pid}';if(!$p -or $p.ParentProcessId -ne ${child.pid} -or $p.ExecutablePath -ine $env:QA_NODE){throw 'OWNER'};$s=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${info.pid}' | Where-Object {$_.ExecutablePath -ieq $env:QA_NODE -and $_.CommandLine -match 'server\\.js'});if($s.Count -ne 1){throw 'SERVER'};'OWNED'`, { ...baseEnv, QA_NODE: node });
    if (owned !== 'OWNED') fail('RUNTIME_ANCESTRY_REJECTED');
    supervisorPid = info.pid;
  }
  async function start() {
    await noOtherLauncher(); await canonical(run);
    const previousSupervisor = supervisorPid;
    child = spawn(launcher, [], { cwd: install, env, stdio: 'ignore', windowsHide: false });
    child.on('error', () => { pageFailed = true; });
    await until(async () => {
      try { await fs.access(runtime); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
      if (previousSupervisor) {
        await canonical(runtime);
        if ((await fs.stat(runtime)).size > 4096) fail('RUNTIME_METADATA_REJECTED');
        let pending;
        try { pending = JSON.parse(await fs.readFile(runtime, 'utf8')); } catch { fail('RUNTIME_METADATA_REJECTED'); }
        if (pending.pid === previousSupervisor) return false;
      }
      await identity(); return true;
    }, 180000, 'RUNTIME_TIMEOUT');
  }
  async function stopOwned() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // ChildProcess retains the Windows process handle. Never reopen PID, kill by name or signal global stop.
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (!child.kill()) fail('OWNED_STOP_FAILED');
    await Promise.race([exited, sleep(20000).then(() => fail('OWNED_STOP_TIMEOUT'))]);
    child = undefined;
    await untilNoWriter();
  }
  async function untilNoWriter() {
    // Deliberately fail rather than retry/terminate any process found after teardown.
    await noOtherLauncher();
  }
  async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 30000 }); }
  async function healthy() {
    alive(); await identity();
    if (networkFailed) fail('BROWSER_NETWORK_FAILURE');
    if (pageFailed) fail('BROWSER_OR_LAUNCHER_ERROR');
    const loading = page.getByRole('status').filter({ hasText: /Загрузка|Загружаем/ });
    await loading.first().waitFor({ state: 'hidden', timeout: 30000 });
    if (await page.getByRole('alert').filter({ visible: true }).count()) fail('VISIBLE_UI_ALERT');
    if (await page.getByText(/Сервер недоступен|Не удалось загрузить|Internal Server Error|Application error/).first().isVisible()) fail('VISIBLE_SERVER_ERROR');
  }
  async function shot(name) {
    await healthy();
    if (await page.locator('input[type="password"]').count()) fail('SECRET_SCREENSHOT_REJECTED');
    if (/\/login/.test(new URL(page.url()).pathname)) fail('LOGIN_SCREENSHOT_REJECTED');
    const directory = await canonical(path.join(workspace, 'docs/screenshots/vkr'));
    await fs.mkdir(directory, { recursive: true }); await canonical(directory);
    const filename = `v32-installed-${id}-${name}.png`;
    const target = await canonical(path.join(directory, filename));
    try { await fs.access(target); fail('SCREENSHOT_EXISTS'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
    result.screenshots.push(filename);
    await fs.writeFile(await canonical(path.join(directory, `v32-installed-${id}-${name}.md`)),
      `Real installed application, synthetic demo data only.\nSource reference: ${o['source-commit']} (coordinator supplied).\nLauncher SHA-256: ${launcherHash}\nInstaller SHA-256: ${installerHash}\nBrowser: ${browserKind}. Not native WebView evidence.\n`, { flag: 'wx' });
  }
  async function check(code, action) { stage = code; await action(); await healthy(); checks.push({ code, status: 'PASS' }); }
  async function goto(route) {
    await identity(); const response = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 });
    if (!response?.ok()) fail('DOCUMENT_HTTP_FAILURE');
  }
  async function hydrated() {
    await page.waitForFunction(() => Object.keys(document.querySelector('form') ?? {}).some(k => k.startsWith('__reactProps')), undefined, { timeout: 30000 });
  }
  try {
    await start();
    const v = await exec(node, ['--version'], { env, windowsHide: true, timeout: 10000 });
    if (!/^v24\.\d+\.\d+\s*$/.test(v.stdout)) fail('BUNDLED_NODE_VERSION_REJECTED');
    result.runtime.bundledNode = v.stdout.trim();
    // Read runtime version using a new in-memory SQLite connection, never a profile DB.
    const sqlite = await exec(node, ['-e', "const D=require('better-sqlite3');const d=new D(':memory:');process.stdout.write(d.prepare('select sqlite_version() as v').get().v);d.close()"],
      { cwd: path.join(install, 'app'), env, windowsHide: true, timeout: 10000 });
    if (!/^\d+\.\d+\.\d+$/.test(sqlite.stdout)) fail('SQLITE_VERSION_REJECTED');
    result.runtime.sqlite = sqlite.stdout;
    result.runtime.serverSha256 = await hash(server);
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, env,
      args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    result.runtime.chromium = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== base) { networkFailed = true; await route.abort('blockedbyclient'); }
      else await route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', () => { pageFailed = true; });
    page.on('requestfailed', () => { networkFailed = true; });
    page.on('response', r => { if (r.status() >= 400) networkFailed = true; });
    await check('FIRST_SETUP_FORM', async () => {
      await goto('/setup'); await visible(page.getByRole('heading', { name: 'Первый запуск CRM', exact: true }));
      await hydrated(); await visible(page.getByLabel('Начальные данные'));
      // Setup contains a password input: deliberately no screenshot of the form.
    });
    await check('SETUP_DEMO_AND_UI_LOGIN', async () => {
      await page.getByLabel('Имя руководителя').fill('QA Synthetic Manager');
      await page.getByLabel('Логин', { exact: true }).fill(login);
      await page.locator('input[name="password"]').fill(password);
      await page.getByLabel('Начальные данные').selectOption('demo');
      await page.getByLabel('Подтверждаю хранение базы на локальном диске').check();
      await page.getByRole('button', { name: 'Создать и перейти ко входу' }).click();
      await page.waitForURL(/\/login\?setup=complete/, { timeout: 90000 });
      await hydrated(); await page.getByLabel('Логин', { exact: true }).fill(login);
      await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.waitForURL(/\/today(?:\?|$)/, { timeout: 60000 });
    });
    const screens = [
      ['TODAY', '/today', 'Сегодня', async () => visible(page.getByText('Просрочено', { exact: true }).first())],
      ['PLANNER', '/calendar', 'Планер', async () => visible(page.getByText('Нагрузка по неделям', { exact: true }))],
      ['CLIENTS', '/clients', 'Клиенты', async () => visible(page.getByRole('table').first())],
      ['PROPERTIES', '/properties', 'Объекты', async () => visible(page.getByRole('table').first())],
      ['TASKS', '/tasks', 'Задачи', async () => visible(page.getByRole('link', { name: '+ Новая задача', exact: true }))],
      ['OFFERS', '/offers', 'Коммерческие предложения', async () => visible(page.getByRole('link', { name: '+ Предложение', exact: true }))],
      ['LOCAL_BACKUP_SETTINGS', '/settings/backups', 'Локальная установка и резервные копии', async () => {
        await visible(page.getByRole('region', { name: 'Локально', exact: true }));
        await visible(page.getByRole('button', { name: 'Настроить расписание', exact: true }));
      }],
    ];
    for (const [code, route, heading, extra] of screens) await check(code, async () => {
      await goto(route); await visible(page.getByRole('heading', { name: heading, exact: true }));
      await extra();
      // Never capture backup settings/cloud-config values, even on a fresh profile.
      if (code !== 'LOCAL_BACKUP_SETTINGS') await shot(code.toLowerCase());
    });
    let cardRoute;
    await check('CREATE_SYNTHETIC_CLIENT_UI', async () => {
      await goto('/clients'); await page.getByRole('link', { name: '+ Новый клиент', exact: true }).click();
      await hydrated(); await page.getByLabel('Имя / наименование', { exact: true }).fill(clientName);
      await page.getByRole('button', { name: 'Создать клиента', exact: true }).click();
      await visible(page.getByRole('heading', { name: clientName, exact: true }));
      cardRoute = new URL(page.url()).pathname;
      if (!/^\/clients\/[a-f0-9-]{36}$/.test(cardRoute)) fail('CLIENT_ROUTE_REJECTED');
      await shot('synthetic-client');
    });
    await check('PERSISTENCE_AFTER_OWNED_RESTART', async () => {
      await page.goto('about:blank'); await stopOwned(); await start();
      await context.clearCookies(); await goto('/login'); await hydrated();
      await page.getByLabel('Логин', { exact: true }).fill(login);
      await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.waitForURL(/\/today(?:\?|$)/, { timeout: 60000 });
      await goto(cardRoute); await visible(page.getByRole('heading', { name: clientName, exact: true }));
      await shot('client-after-restart'); await goto('/today');
    });
    stage = 'COORDINATOR_OBSERVATION';
    await writeNew(path.join(run, 'ready.json'), JSON.stringify({ schema: 1, runId: id, pid: child.pid,
      url: base, stopFile, observationSeconds: observe, nativeUi: 'NOT_ASSERTED', syntheticDataOnly: true,
      launcherSha256: launcherHash, sourceCommit: o['source-commit'] }, null, 2));
    console.log(JSON.stringify({ status: 'BROWSER_CHECKS_COMPLETE_NATIVE_OBSERVATION_WINDOW', runId: id, readyFile: path.join(run, 'ready.json') }));
    const end = Date.now() + observe * 1000;
    while (Date.now() < end) {
      alive(); await canonical(stopFile);
      try { const stat = await fs.stat(stopFile); if (!stat.isFile() || stat.size !== 0) fail('STOP_FILE_REJECTED'); break; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      await sleep(500);
    }
    result.status = 'PASS';
  } catch (e) {
    result.status = 'FAIL';
    result.error = { stage, code: e.safeCode ?? 'UNEXPECTED_OR_UI_ASSERTION_FAILURE' };
    checks.push({ code: stage, status: 'FAIL' });
  } finally {
    password = undefined;
    try { if (browser) await browser.close(); } catch { result.status = 'FAIL'; result.cleanupError = 'BROWSER_CLOSE_FAILED'; }
    try { await stopOwned(); } catch { result.status = 'FAIL'; result.cleanupError = 'OWNED_TEARDOWN_FAILED'; }
    result.counts = { passed: checks.filter(c => c.status === 'PASS').length, failed: checks.filter(c => c.status === 'FAIL').length, total: checks.length };
    result.finishedAt = new Date().toISOString();
    await writeNew(path.join(run, 'result.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ status: result.status, runId: id, counts: result.counts }));
  if (result.status !== 'PASS') process.exitCode = 1;
}

function selfTest() {
  assert.equal(contained('D:/qa', 'D:/qa/run/a'), true);
  assert.equal(contained('D:/qa', 'D:/qa-other/a'), false);
  assert.equal(contained('D:/qa', 'D:/qa'), false);
  for (const p of ['\\\\server\\share', 'D:/qa/../secret', 'D:/qa/a:stream', 'D:/qa/trailing.', 'D:/qa/./a']) assert.throws(() => localPath(p));
  assert.equal(loopback('http://127.0.0.1:12345'), 'http://127.0.0.1:12345');
  for (const url of ['http://localhost:1234', 'https://127.0.0.1:1', 'http://127.0.0.1:99999', 'http://127.0.0.1:1/private']) assert.throws(() => loopback(url));
  assert.throws(() => options(['--execute-new-installed', '--unknown']));
  console.log('PURE_HELPERS_PASS');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') selfTest();
  else main().catch(e => { console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', code: e.safeCode ?? 'PREFLIGHT_FAILED' })); process.exitCode = 1; });
}
