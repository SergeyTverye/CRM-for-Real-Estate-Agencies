import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PG_HOST = '127.0.0.1';
const PG_PORT = 55432;
const PG_ADMIN_URL = 'postgresql://crm:crm_test_password@127.0.0.1:55432/postgres';
const SYNTHETIC_TEST_PASSWORD = 'TestPassw0rd!';
const DB_PREFIX = 'transfer_proof_test_';
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };

export function localPath(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || /[\x00-\x1f<>"|?*]/.test(value) ||
      value.slice(2).includes(':') || /(^|[\\/])\.\.\.?([\\/]|$)/.test(value) ||
      value.split(/[\\/]/).some(p => /[ .]$/.test(p))) fail('PATH_REJECTED');
  return path.win32.normalize(value);
}
export function contained(root, target) {
  const rel = path.win32.relative(localPath(root), localPath(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.win32.isAbsolute(rel);
}
export function loopback(value) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value)) fail('RUNTIME_URL_REJECTED');
  if (Number(new URL(value).port) > 65535) fail('RUNTIME_URL_REJECTED');
  return new URL(value).origin;
}
export function dbName(value) {
  if (!new RegExp('^' + DB_PREFIX + '[0-9a-f]{32}$').test(value)) fail('TRANSFER_DB_NAME_REJECTED');
  return value;
}
function options(args) {
  const result = {};
  const flags = new Set(['execute-new-installed']);
  const values = new Set(['launcher', 'launcher-sha256', 'source-commit', 'evidence-root', 'observe-seconds']);
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
  if (process.execArgv.some(a => /inspect|debug/.test(a))) fail('UNSAFE_CONTROLLER_ENVIRONMENT');
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'FILE_STORAGE_PATH', 'SQLITE_DATABASE_URL']) {
    if (process.env[key]) fail('INHERITED_DATA_ENVIRONMENT');
  }
  if (!/^[a-f0-9]{40}$/i.test(o['source-commit'] ?? '')) fail('SOURCE_REFERENCE_REQUIRED');
  const observe = Number(o['observe-seconds'] ?? 60);
  if (!Number.isInteger(observe) || observe < 10 || observe > 600) fail('OBSERVATION_BOUND_REJECTED');
  const system = localPath(process.env.SystemRoot ?? '');
  const ps = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const baseEnv = { SystemRoot: system, WINDIR: system, SystemDrive: system.slice(0, 2),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PATH: system + '\\System32;' + system + '\\System32\\WindowsPowerShell\\v1.0',
    COMSPEC: path.join(system, 'System32/cmd.exe') };
  async function powershell(code, env = baseEnv, stageCode = 'SYSTEM_INSPECTION_FAILED') {
    try {
      return (await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(
        "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" + code, 'utf16le').toString('base64')],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
    } catch { fail(stageCode); }
  }
  async function canonical(value) {
    const p = localPath(value);
    await powershell(`$p=$env:QA_CHECK_PATH;while($p){if(Test-Path -LiteralPath $p){$i=Get-Item -Force -LiteralPath $p;if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE'}};$q=[IO.Directory]::GetParent($p);if(!$q){break};$p=$q.FullName}`, { ...baseEnv, QA_CHECK_PATH: p }, 'CANONICAL_PREFLIGHT_FAILED');
    try { if ((await fs.realpath(p)).toLowerCase() !== p.replace(/[\\/]$/, '').toLowerCase()) fail('CANONICAL_MISMATCH'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    return p;
  }
  async function file(p) {
    p = await canonical(p);
    if (!(await fs.stat(p)).isFile()) fail('FILE_REQUIRED');
    return p;
  }
  async function shaFile(p) { return createHash('sha256').update(await fs.readFile(await file(p))).digest('hex'); }
  const qa = await canonical(path.join(workspace, 'data/qa-v32-installed-transfer'));
  if ((await canonical(o['evidence-root'] ?? '')).toLowerCase() !== qa.toLowerCase()) fail('EVIDENCE_ROOT_REJECTED');
  const launcher = await file(o.launcher ?? '');
  if (path.basename(launcher).toLowerCase() !== 'realestatecrm.exe' || contained(workspace, launcher)) fail('INSTALLED_LAUNCHER_REQUIRED');
  if (!/^[a-f0-9]{64}$/i.test(o['launcher-sha256'] ?? '') ||
      (await shaFile(launcher)) !== o['launcher-sha256'].toLowerCase()) fail('NEW_ARTIFACT_HASH_MISMATCH');
  const install = path.dirname(launcher);
  const node = await file(path.join(install, 'app/node/node.exe'));
  await file(path.join(install, 'app/server.js'));
  async function noOtherLauncher() {
    const result = await powershell(`if(@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count){throw 'OTHER_APP'};try{$m=[Threading.Mutex]::OpenExisting('Local\\RealEstateCRM.Desktop.Writer');$m.Dispose();throw 'OTHER_WRITER'}catch [Threading.WaitHandleCannotBeOpenedException]{};'CLEAR'`, baseEnv, 'OWNERSHIP_PREFLIGHT_FAILED');
    if (result !== 'CLEAR') fail('OTHER_LAUNCHER_OR_WRITER');
  }
  await noOtherLauncher();
  await fs.mkdir(qa, { recursive: true }); await canonical(qa);
  const id = randomUUID();
  const run = path.join(qa, id);
  try { await fs.lstat(run); fail('EXISTING_RUN_ROOT_REJECTED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(run); await canonical(run);
  await powershell(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& "$env:SystemRoot\\System32\\icacls.exe" $env:QA_RUN /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null;if($LASTEXITCODE){throw 'ACL'}`, { ...baseEnv, QA_RUN: run }, 'ACL_PREFLIGHT_FAILED');
  const profile = path.join(run, 'profile');
  const dirs = {};
  for (const name of ['localappdata', 'roaming', 'temp']) { dirs[name] = path.join(profile, name); await fs.mkdir(dirs[name], { recursive: true }); }
  const dataRoot = path.join(dirs.localappdata, 'RealEstateCRM', 'data');
  const runtime = path.join(dirs.localappdata, 'RealEstateCRM', 'logs', 'runtime.json');
  const sourceStorage = path.join(run, 'pg-source-files');
  const targetFile = path.join(run, 'converted.db');
  const targetStorage = path.join(run, 'sqlite-files');
  await fs.mkdir(sourceStorage); await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const name = dbName(DB_PREFIX + id.replaceAll('-', ''));
  const freshUrl = 'postgresql://crm:crm_test_password@' + PG_HOST + ':' + PG_PORT + '/' + name;
  const checks = [];
  let child, base, cookie;
  const ownedNodes = new Set();
  let stage = 'PREFLIGHT';
  const result = { schema: 1, status: 'RUNNING', syntheticDataOnly: true, runId: id,
    sourceCommit: o['source-commit'], sourceReference: 'coordinator-supplied-read-only-reference-not-binary-provenance',
    launcherSha256: o['launcher-sha256'].toLowerCase(), database: name, checks };
  const note = code => checks.push({ code, status: 'PASS' });
  function alive() { if (!child || child.exitCode !== null || child.signalCode !== null) fail('OWN_LAUNCHER_EXITED'); }
  async function until(condition, ms, code) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { alive(); if (await condition()) return; await sleep(300); }
    fail(code);
  }
  async function copyTree(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail('STORAGE_LINK_FORBIDDEN');
      const src = path.join(from, entry.name), dst = path.join(to, entry.name);
      if (contained(run, src) === false || contained(run, dst) === false) fail('WRITE_SCOPE_REJECTED');
      if (entry.isDirectory()) await copyTree(src, dst);
      else if (entry.isFile()) await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
      else fail('STORAGE_ENTRY_UNSUPPORTED');
    }
  }
  async function identity() {
    await canonical(runtime);
    const stat = await fs.stat(runtime);
    if (!stat.isFile() || stat.size > 4096) fail('RUNTIME_METADATA_REJECTED');
    let info;
    try { info = JSON.parse(await fs.readFile(runtime, 'utf8')); } catch { fail('RUNTIME_METADATA_REJECTED'); }
    base = loopback(info.url);
    if (!Number.isSafeInteger(info.pid) || info.pid < 1) fail('RUNTIME_PID_REJECTED');
    const owned = await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${info.pid}';if(!$p -or $p.ParentProcessId -ne ${child.pid} -or $p.ExecutablePath -ine $env:QA_NODE){throw 'OWNER'};$s=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${info.pid}' | Where-Object {$_.ExecutablePath -ieq $env:QA_NODE -and $_.CommandLine -match 'server\\.js'});if($s.Count -ne 1){throw 'SERVER'};'OWNED:'+ [string]$s[0].ProcessId`, { ...baseEnv, QA_NODE: node });
    const serverPid = /^OWNED:([1-9]\d*)$/.exec(owned)?.[1];
    if (!serverPid) fail('RUNTIME_ANCESTRY_REJECTED');
    ownedNodes.add(info.pid); ownedNodes.add(Number(serverPid));
    return true;
  }
  async function stopOwned() {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      if (!child.kill()) fail('OWNED_STOP_FAILED');
      await Promise.race([exited, sleep(20000).then(() => fail('OWNED_STOP_TIMEOUT'))]);
    }
    child = undefined;
  }
  async function dropOwnDatabase() {
    dbName(name);
    const script = "const pg=await import('pg');const admin=new pg.default.Client({connectionString:" +
      JSON.stringify(PG_ADMIN_URL) + ",connectionTimeoutMillis:5000});await admin.connect();try{" +
      "const r=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[" + JSON.stringify(name) + "]);" +
      "if(!r.rowCount){console.log('OWN_DB_ABSENT');}else{await admin.query('DROP DATABASE \"" + name + "\" WITH (FORCE)');console.log('OWN_DB_DROPPED');}" +
      "}finally{await admin.end();}";
    const outcome = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: workspace, env: baseEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
      let out = '';
      p.stdout.on('data', d => { out += d; if (out.length > 200) out = out.slice(-200); });
      p.once('error', reject); p.once('exit', code => code === 0 ? resolve(out) : reject(new Error('TRANSFER_DROP_FAILED')));
    });
    if (/OWN_DB_ABSENT/.test(outcome)) return 'ABSENT';
    if (/OWN_DB_DROPPED/.test(outcome)) return 'DROPPED';
    throw new Error('TRANSFER_DROP_FAILED');
  }
  try {
    stage = 'FIXTURE_AND_TRANSFER';
    await canonical(run);
    for (const gen of ['src/generated/prisma', 'src/generated/prisma-sqlite']) {
      try { if (!(await fs.stat(path.join(workspace, gen))).isDirectory()) fail('GENERATED_CLIENT_MISSING'); }
      catch (e) { if (e.safeCode) throw e; fail('GENERATED_CLIENT_MISSING'); }
    }
    await writeFileStrict(run, path.join(run, 'SYNTHETIC-QA-ONLY.txt'), 'Disposable synthetic PG->SQLite installed proof. Never reuse this profile.');
    await writeFileStrict(run, path.join(run, 'fixture.transfer.mts'), fixtureSource());
    const fixtureEnv = { ...baseEnv, TEMP: dirs.temp, TMP: dirs.temp,
      TRANSFER_DATABASE_URL: freshUrl, TRANSFER_META_PATH: path.join(run, 'transfer-meta.json'),
      TRANSFER_SOURCE_STORAGE: sourceStorage, TRANSFER_TARGET_FILE: targetFile,
      TRANSFER_TARGET_STORAGE: targetStorage, TRANSFER_DISPLAY_NAME: 'QA TRANSFER ' + id.slice(0, 8) };
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--import', 'tsx', path.join(run, 'fixture.transfer.mts')],
        { cwd: workspace, env: fixtureEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
      let out = '', errTail = '';
      p.stdout.on('data', d => { out += d; if (out.length > 4096) out = out.slice(-4096); });
      p.stderr.on('data', d => { errTail += String(d); if (errTail.length > 4096) errTail = errTail.slice(-4096); });
      p.once('error', reject);
      p.once('exit', code => {
        if (code === 0 && /TRANSFER_OK/.test(out)) return resolve();
        const m = /"code":"([A-Z][A-Z0-9_]{0,90})"/.exec(errTail);
        if (m) return reject(Object.assign(new Error('FIXTURE_TRANSFER_FAILED'), { safeCode: m[1] }));
        if (/Top-level await|Cannot use import statement|ERR_REQUIRE_ESM|ERR_IMPORT_ASSERTION|SyntaxError|Transform failed|Unknown file extension|Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load tsx/i.test(errTail)) {
          return reject(Object.assign(new Error('FIXTURE_TRANSFER_FAILED'), { safeCode: 'FIXTURE_IMPORT_FAILED' }));
        }
        if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection refused|password authentication|does not exist|3D000|28P01/i.test(errTail)) {
          return reject(Object.assign(new Error('FIXTURE_TRANSFER_FAILED'), { safeCode: 'PG_FIXTURE_FAILED' }));
        }
        reject(Object.assign(new Error('FIXTURE_TRANSFER_FAILED'), { safeCode: 'FIXTURE_TRANSFER_FAILED' }));
      });
    });
    const meta = JSON.parse(await fs.readFile(path.join(run, 'transfer-meta.json'), 'utf8'));
    for (const key of ['login', 'clientId', 'needId', 'propertyId', 'templateId', 'documentId', 'fileSha256']) {
      if (typeof meta[key] !== 'string' || !meta[key]) fail('TRANSFER_META_REJECTED');
    }
    if (!/^[a-f0-9]{64}$/.test(meta.fileSha256)) fail('TRANSFER_META_REJECTED');
    if (!Number.isInteger(meta.files) || meta.files < 1) fail('TRANSFER_META_REJECTED');
    if (!Number.isInteger(meta.entitiesTotal) || meta.entitiesTotal < 1) fail('TRANSFER_META_REJECTED');
    if (meta.financial === undefined ||
        (meta.financial !== null && typeof meta.financial !== 'string' &&
         typeof meta.financial !== 'number' && typeof meta.financial !== 'object')) fail('TRANSFER_META_REJECTED');
    note('synthetic-source-seeded-tracked-migrations');
    note('actual-migrator-complete-entities-money-files');
    note('source-preserved-target-integrity-fk');
    stage = 'STAGE_GENERATION';
    const generation = randomUUID();
    const genDir = path.join(dataRoot, 'runtime-generations', 'generations', generation);
    await fs.mkdir(path.join(dataRoot, 'runtime-generations', 'generations'), { recursive: true });
    await fs.copyFile(targetFile, path.join(run, 'staged-database.sqlite'));
    await fs.mkdir(genDir, { recursive: true });
    await fs.copyFile(path.join(run, 'staged-database.sqlite'), path.join(genDir, 'database.sqlite'));
    await copyTree(targetStorage, path.join(genDir, 'documents'));
    if ((await shaFile(path.join(genDir, 'database.sqlite'))) !== (await shaFile(targetFile))) fail('STAGED_DATABASE_MISMATCH');
    await writeFileStrict(run, path.join(dataRoot, 'runtime-generations', 'current.json'), JSON.stringify({ generation }));
    note('migrated-generation-staged-for-installed-supervisor');
    stage = 'INSTALLED_SMOKE';
    const env = { ...baseEnv, LOCALAPPDATA: dirs.localappdata, APPDATA: dirs.roaming,
      TEMP: dirs.temp, TMP: dirs.temp, USERPROFILE: dirs.localappdata, HOME: dirs.localappdata };
    child = spawn(launcher, ['--smoke', '--smoke-seconds=' + Math.min(observe, 300)], { cwd: install, env, stdio: 'ignore', windowsHide: true });
    child.on('error', () => fail('OWN_LAUNCHER_ERROR'));
    await until(async () => {
      try { await fs.access(runtime); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
      return identity();
    }, 150000, 'RUNTIME_TIMEOUT');
    const v = await new Promise((resolve, reject) => {
      const p = spawn(node, ['--version'], { env: baseEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
      let out = ''; p.stdout.on('data', d => { out += d; });
      p.once('error', reject); p.once('exit', c => c === 0 ? resolve(out.trim()) : reject(new Error('NODE_VERSION_FAILED')));
    });
    if (!/^v24\.\d+\.\d+$/.test(v)) fail('BUNDLED_NODE24_REQUIRED');
    note('installed-smoke-ready-bundled-node24');
    async function api(route, method = 'GET', body) {
      await identity();
      const headers = { Origin: base };
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let response;
      try {
        response = await fetch(base + route, { method, headers,
          body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(20000) });
      } catch { fail('API_TRANSPORT_FAILED'); }
      if (response.status === 401 || response.status === 403) fail('API_UNAUTHORIZED_OR_FORBIDDEN');
      if (response.status < 200 || response.status >= 300) fail('API_HTTP_FAILURE');
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      if (text.length > 1024 * 1024) fail('API_RESPONSE_BOUND');
      try { return JSON.parse(text); } catch { return text; }
    }
    stage = 'INSTALLED_ASSERTS';
    const login = await api('/api/v1/auth/login', 'POST', { login: meta.login, password: SYNTHETIC_TEST_PASSWORD });
    if (!cookie || !login) fail('INSTALLED_LOGIN_FAILED');
    note('installed-login-migrated-credentials');
    const card = await api('/api/v1/clients/' + meta.clientId);
    if (card.id !== meta.clientId || card.displayName !== 'QA TRANSFER ' + id.slice(0, 8)) fail('MIGRATED_CLIENT_MISMATCH');
    note('migrated-client-visible-installed-api');
    const needCard = await api('/api/v1/needs/' + meta.needId);
    const needRow = needCard.need ?? needCard;
    if (needRow.id !== meta.needId || needRow.clientId !== meta.clientId) fail('MIGRATED_NEED_MISMATCH');
    note('migrated-need-linked-installed-api');
    const propertyCard = await api('/api/v1/properties/' + meta.propertyId);
    const propertyRow = propertyCard.property ?? propertyCard;
    if (propertyRow.id !== meta.propertyId || String(propertyRow.price) !== '120000.25') fail('MIGRATED_MONEY_MISMATCH');
    note('migrated-money-exact-installed-api');
    await identity();
    const fileHeaders = { Origin: base, Cookie: cookie };
    const fileResponse = await fetch(base + '/api/v1/documents/' + meta.documentId + '/download',
      { headers: fileHeaders, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!fileResponse.ok) fail('API_HTTP_FAILURE');
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (bytes.length > 64 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== meta.fileSha256) fail('MIGRATED_FILE_MISMATCH');
    note('migrated-document-bytes-sha256-template-chain');
    result.counts = { checks: checks.length, files: meta.files, entities: meta.entitiesTotal };
    result.evidence = { fileSha256: meta.fileSha256, financial: meta.financial };
    stage = 'TEARDOWN';
    await stopOwned();
    await noOtherLauncher();
    if ((await dropOwnDatabase()) !== 'DROPPED') fail('OWN_DATABASE_MISSING');
    note('owned-teardown-only-own-fresh-db-dropped');
    result.status = 'PASS'; stage = 'COMPLETE';
  } catch (e) {
    result.status = 'FAIL';
    result.error = { stage, code: e.safeCode ?? 'UNEXPECTED_OR_ASSERTION_FAILURE' };
    try { await stopOwned(); } catch { result.cleanupError = 'OWNED_TEARDOWN_FAILED'; }
    try {
      const dropped = await dropOwnDatabase();
      if (dropped === 'ABSENT') result.cleanup = 'OWN_DB_ABSENT_NEVER_CREATED';
    } catch { result.cleanupError = 'OWN_DATABASE_DROP_FAILED'; }
  } finally {
    await writeFileStrict(run, path.join(run, 'result.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ status: result.status === 'PASS' ? 'INSTALLED_PG_TRANSFER_PASS_SAFE_AGGREGATE_ONLY' : 'INSTALLED_PG_TRANSFER_FAIL_SAFE_AGGREGATE_ONLY', runId: id }));
  if (result.status !== 'PASS') process.exitCode = 1;
}

async function writeFileStrict(run, p, data) {
  if (!contained(run, p)) fail('WRITE_SCOPE_REJECTED');
  const handle = await fs.open(p, 'wx');
  try { await handle.writeFile(data); } finally { await handle.close(); }
}

function fixtureSource() {
  return String.raw`
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const fail = (code) => { try { console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', code })); } catch {} process.exit(1); throw new Error(code); };
const get = (k) => {
  const v = process.env[k];
  if (typeof v !== 'string' || !v) fail('TRANSFER_ENV_MISSING');
  return v;
};
const url = get('TRANSFER_DATABASE_URL');
const metaPath = get('TRANSFER_META_PATH');
const sourceStorage = get('TRANSFER_SOURCE_STORAGE');
const targetFile = get('TRANSFER_TARGET_FILE');
const targetStorage = get('TRANSFER_TARGET_STORAGE');
const displayName = get('TRANSFER_DISPLAY_NAME');
const found = /^postgresql:\/\/crm:crm_test_password@127\.0\.0\.1:55432\/(transfer_proof_test_[0-9a-f]{32})$/.exec(url);
if (!found) fail('TRANSFER_URL_REJECTED');
if (process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.FILE_STORAGE_PATH || process.env.SQLITE_DATABASE_URL) fail('INHERITED_DATA_ENVIRONMENT');
const dbName = found[1];
const admin = new pg.Client({ connectionString: 'postgresql://crm:crm_test_password@127.0.0.1:55432/postgres', connectionTimeoutMillis: 5000 });
await admin.connect();
await admin.query('CREATE DATABASE "' + dbName + '"');
const seed = new pg.Client({ connectionString: url });
try {
  await seed.connect();
  const migrations = readdirSync('prisma/migrations').filter((n) => /^\d/.test(n)).sort();
  if (!migrations.length) fail('TRACKED_MIGRATIONS_MISSING');
  for (const m of migrations) await seed.query(readFileSync(join('prisma/migrations', m, 'migration.sql'), 'utf8'));
} finally { await seed.end(); }
process.env.DATABASE_URL = url;
process.env.FILE_STORAGE_PATH = sourceStorage;
process.env.CRM_DEPLOYMENT_MODE = 'server';
process.env.AI_ENABLED = 'false';
process.env.SCRAPER_ENABLED = 'false';
await mkdir(sourceStorage, { recursive: true });
try {
  const { statSync } = await import('node:fs');
  if (!statSync('src/generated/prisma').isDirectory() || !statSync('src/generated/prisma-sqlite').isDirectory()) fail('GENERATED_CLIENT_MISSING');
} catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') fail('GENERATED_CLIENT_MISSING'); else if (!e.code) throw e; else fail('GENERATED_CLIENT_MISSING'); }
const fixtures = await import('../../../tests/helpers/fixtures');
const tpl = await import('../../../tests/helpers/template-fixtures');
const service = await import('@/modules/document-templates/application/template-service');
const { migratePgToSqlite } = await import('../../../scripts/desktop/migrate-pg-to-sqlite');
const { getConfig } = await import('@/shared/config/env');
if (getConfig().DATABASE_URL !== url) fail('TRANSFER_DB_MISMATCH');
if (process.env.FILE_STORAGE_PATH !== sourceStorage) fail('TRANSFER_STORAGE_MISMATCH');
await fixtures.resetDatabase();
if (getConfig().DATABASE_URL !== url) fail('TRANSFER_DB_MISMATCH');
const users = await fixtures.seedBase();
const client = await fixtures.makeClient(users.realtor1, { displayName });
const need = await fixtures.makeNeed(users.realtor1, client.id);
const property = await fixtures.makeProperty(users.realtor1, { price: '120000.25' });
const template = await service.saveTemplate(users.manager, { code: 'transfer_proof_synth', name: 'Synthetic transfer proof', format: 'markdown_docx', manifestYaml: tpl.clientYaml, markdownBody: '# synthetic' }, null);
const document = await service.generateFromTemplate(users.realtor1, template.id, { entityKind: 'client', entityId: client.id });
const dbc = fixtures.db;
const clientsBefore = await dbc.client.count();
const stored = await dbc.document.findFirstOrThrow({ where: { id: document.id } });
const fileHash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const sourceFile = join(sourceStorage, stored.storageKey);
const shaBefore = fileHash(sourceFile);
if (stored.checksum !== shaBefore) fail('SOURCE_FILE_CHECKSUM');
const report = await migratePgToSqlite({ sourceUrl: url, targetFile, sourceStorage, targetStorage });
if (report.status !== 'complete') fail('TRANSFER_NOT_COMPLETE');
for (const [entity, counts] of Object.entries(report.entities)) {
  if (counts.source !== counts.target) fail('COUNT_MISMATCH');
}
for (const [k, v] of Object.entries(report.financial)) {
  if (v.source !== v.target) fail('FINANCIAL_MISMATCH');
}
if (!report.files) fail('FILES_MISSING');
if (await dbc.client.count() !== clientsBefore) fail('SOURCE_CHANGED_DURING_TRANSFER');
if (fileHash(sourceFile) !== shaBefore) fail('SOURCE_FILE_CHANGED');
const Database = (await import('better-sqlite3')).default;
const native = new Database(targetFile, { readonly: true });
try {
  if (native.pragma('integrity_check', { simple: true }) !== 'ok') fail('SQLITE_INTEGRITY_FAILED');
  if (native.pragma('foreign_key_check').length) fail('RELATION_MISMATCH');
  const byId = (table, id) => native.prepare('SELECT id FROM "' + table + '" WHERE id = ?').get(id);
  if (byId('clients', client.id)?.id !== client.id) fail('TARGET_CLIENT_MISSING');
  if (byId('client_needs', need.id)?.id !== need.id) fail('TARGET_NEED_MISSING');
  if (byId('properties', property.id)?.id !== property.id) fail('TARGET_PROPERTY_MISSING');
  if (byId('document_templates', template.id)?.id !== template.id) fail('TARGET_TEMPLATE_MISSING');
  if (byId('documents', document.id)?.id !== document.id) fail('TARGET_DOCUMENT_MISSING');
  const versionsBefore = await dbc.documentTemplateVersion.count();
  const versionsAfter = native.prepare('SELECT count(*) AS n FROM "document_template_versions"').get().n;
  if (Number(versionsAfter) !== versionsBefore || !versionsBefore) fail('TARGET_TEMPLATE_VERSION_MISMATCH');
  const money = native.prepare('SELECT price AS value FROM "properties" WHERE id = ?').get(property.id);
  if (money == null) fail('TARGET_MONEY_MISSING');
} finally { native.close(); }
const { disconnectDb } = await import('@/shared/db/client');
await disconnectDb();
await admin.end();
await writeFile(metaPath, JSON.stringify({ login: users.realtor1.login, clientId: client.id, needId: need.id, propertyId: property.id, templateId: template.id, documentId: document.id, fileSha256: shaBefore, files: report.files, entitiesTotal: Object.keys(report.entities).length, financial: report.financial['Property.price'] ?? report.financial['property.price'] ?? null }));
console.log('TRANSFER_OK entities=' + Object.keys(report.entities).length + ' files=' + report.files);
`;
}

function selfTest() {
  assert.equal(contained('D:/qa', 'D:/qa/run/a'), true);
  assert.equal(contained('D:/qa', 'D:/qa-other/a'), false);
  assert.equal(contained('D:/qa', 'D:/qa'), false);
  for (const p of ['\\\\server\\share', 'D:/qa/../secret', 'D:/qa/a:stream', 'D:/qa/trailing.']) assert.throws(() => localPath(p));
  assert.equal(loopback('http://127.0.0.1:12345'), 'http://127.0.0.1:12345');
  for (const url of ['http://localhost:1', 'https://127.0.0.1:1', 'http://127.0.0.1:99999']) assert.throws(() => loopback(url));
  assert.equal(dbName(DB_PREFIX + '0'.repeat(32)), DB_PREFIX + '0'.repeat(32));
  assert.throws(() => dbName('crm_test'));
  assert.throws(() => dbName(DB_PREFIX + 'xyz'));
  assert.throws(() => options(['--execute-new-installed', '--unknown']));
  assert.equal(options(['--execute-new-installed'])['execute-new-installed'], true);
  console.log('PURE_HELPERS_PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') selfTest();
  else main().catch(e => { console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', code: e.safeCode ?? 'PREFLIGHT_FAILED' })); process.exitCode = 1; });
}
