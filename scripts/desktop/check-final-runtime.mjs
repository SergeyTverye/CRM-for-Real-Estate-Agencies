import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, lstat, realpath, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRuntimeResources } from './resource-policy.mjs';

export async function checkFinalRuntime(resources, { temporaryRoot = os.tmpdir() } = {}) {
  const app = await realpath(resources);
  await assertRuntimeResources(app);
  const parent = await realpath(temporaryRoot);
  const stage = await mkdtemp(path.join(parent, 'crm-final-runtime-'));
  let server;
  let exit;
  let closed = false;
  const code = value => console.log('FINAL_RUNTIME_' + value);
  try {
    const dirs = Object.fromEntries(['local', 'roaming', 'data', 'files', 'backups', 'temp', 'import'].map(name => [name, path.join(stage, name)]));
    await Promise.all(Object.values(dirs).map(dir => mkdir(dir)));
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, {
      NODE_ENV: 'production', CRM_DEPLOYMENT_MODE: 'desktop', CRM_DESKTOP_WORKER: '0',
      CRM_DESKTOP_SUPERVISED_UPGRADE: '1', LOCALAPPDATA: dirs.local, APPDATA: dirs.roaming,
      USERPROFILE: stage, HOME: stage, TEMP: dirs.temp, TMP: dirs.temp,
      DESKTOP_DATA_DIR: dirs.data, FILE_STORAGE_PATH: dirs.files, BACKUP_PATH: dirs.backups,
      IMPORT_STAGING_PATH: dirs.import, DATABASE_URL: 'file:' + path.join(dirs.data, 'crm.db').replaceAll('\\', '/'),
      DEPLOYMENT_ID: randomUUID(), INSTANCE_ID: randomUUID(), INSTANCE_ROLE: 'active',
      APP_TIMEZONE: 'Asia/Novosibirsk', COOKIE_SECURE: 'false',
      HOSTNAME: '127.0.0.1', PORT: String(port), APP_PORT: String(port), CRM_DESKTOP_PORT: String(port),
      AI_ENABLED: 'false', SCRAPER_ENABLED: 'false', BACKUP_TARGETS: '', NEXT_TELEMETRY_DISABLED: '1',
      PLAYWRIGHT_BROWSERS_PATH: path.join(app, 'chromium'),
    });
    env.SQLITE_DATABASE_URL = env.DATABASE_URL;
    const node = path.join(app, 'node', 'node.exe');
    const init = spawnSync(node, [path.join(app, 'init-db.cjs'), '--initialize'], {
      cwd: app, env, windowsHide: true, stdio: 'pipe', timeout: 60000,
    });
    if (init.error || init.status !== 0) {
      const spawnCode = ['ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'ETIMEDOUT', 'ENOBUFS'].includes(init.error?.code) ? init.error.code : 'OTHER';
      const detail = init.error ? 'SPAWN_' + spawnCode : Number.isInteger(init.status) ? 'EXIT_' + (init.status >>> 0) : 'SIGNAL';
      const diagnostic = String(init.stderr ?? '').split(/\r?\n/).find(line => /^INIT_DATABASE_FAILED_STAGE_(?:DIRECTORY|LOCATION|SECRETS|MIGRATIONS|ACCOUNT|PROBE)_CODE_(?:ENOENT|EACCES|EPERM|EINVAL|ETIMEDOUT|ENOBUFS|ERR_DLOPEN_FAILED|SQLITE_LOCAL_VOLUME_REQUIRED|SQLITE_CLOUD_PATH_FORBIDDEN|SQLITE_LOCAL_PATH_REQUIRED|SQLITE_MIGRATION_HISTORY_MISMATCH|SQLITE_INTEGRITY_FAILED|DESKTOP_SECRETS_INVALID|OTHER)$/.test(line));
      if (diagnostic) code(diagnostic);
      throw Error('FINAL_RUNTIME_INIT_FAILED_' + detail);
    }
    code('INIT_PASS');
    server = spawn(node, ['--require', path.join(app, 'graceful.cjs'), path.join(app, 'server.js')], {
      cwd: app, env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'],
    });
    let serverErrors = '';
    server.stderr.on('data', chunk => { serverErrors = (serverErrors + String(chunk)).slice(-16384); });
    server.stdin.on('error', () => {});
    let failed = false;
    server.on('error', () => { failed = true; });
    exit = new Promise(resolve => server.once('close', () => { closed = true; resolve(); }));
    const base = 'http://127.0.0.1:' + port;
    let ready = false;
    let readyDiagnostic = 'NO_RESPONSE';
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (failed || closed) throw Error('FINAL_RUNTIME_SERVER_EXIT');
      try {
        const response = await fetch(base + '/api/health/ready', { signal: AbortSignal.timeout(2000) });
        ready = response.ok;
        readyDiagnostic = 'HTTP_' + response.status;
        if (response.status === 503) {
          const report = await response.json();
          if (report?.checks?.database?.ok === false) readyDiagnostic += '_DATABASE_UNAVAILABLE';
          if (report?.checks?.fileStorage?.ok === false) readyDiagnostic += '_STORAGE_UNAVAILABLE';
        }
      } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) {
      try { await fetch(base + '/api/v1/desktop/setup', { signal: AbortSignal.timeout(5000) }); } catch {}
      code('READY_' + readyDiagnostic);
      if (/\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\b/.test(serverErrors)) code('SERVER_MODULE_NOT_FOUND');
      if (/\bERR_DLOPEN_FAILED\b/.test(serverErrors)) code('SERVER_NATIVE_LOAD_FAILED');
      if (/\b(?:ENOENT|SQLITE_CANTOPEN)\b/.test(serverErrors)) code('SERVER_ASSET_UNAVAILABLE');
      throw Error('FINAL_RUNTIME_READY_FAILED');
    }
    code('READY_PASS');
    const setup = await fetch(base + '/api/v1/desktop/setup', { signal: AbortSignal.timeout(10000) });
    if (!setup.ok || (await setup.json()).available !== true) throw Error('FINAL_RUNTIME_SETUP_FAILED');
    code('PRISMA_PASS');
    for (const [route, method] of [['/api/v1/settings/backups/control', 'GET'], ['/api/v1/operations/backups', 'POST']]) {
      const response = await fetch(base + route, {
        method, headers: { Origin: base }, redirect: 'manual', signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 401) throw Error('FINAL_RUNTIME_API_ROUTES_FAILED');
    }
    code('API_ROUTES_PASS');
    const page = await fetch(base + '/setup', { signal: AbortSignal.timeout(15000) });
    const html = await page.text();
    if (!page.ok || !html.includes('<html')) throw Error('FINAL_RUNTIME_PAGE_FAILED');
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"?#]+\/_next\/static\/[^"?#]+|\/_next\/static\/[^"?#]+)(?:[?][^"]*)?"/g)].map(match => match[1]))];
    if (!assets.length) throw Error('FINAL_RUNTIME_ASSETS_MISSING');
    for (const asset of assets) {
      const url = new URL(asset, base);
      if (url.origin !== base) throw Error('FINAL_RUNTIME_ASSET_ORIGIN');
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok || !(await response.arrayBuffer()).byteLength) throw Error('FINAL_RUNTIME_ASSET_FAILED');
    }
    code('PAGE_ASSETS_PASS');
  } finally {
    if (server && !closed) {
      server.stdin.write('STOP\n');
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 15000).unref())]);
      if (!closed) { server.kill(); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5000).unref())]); }
      if (!closed) throw Error('FINAL_RUNTIME_STOP_FAILED');
    }
    const info = await lstat(stage);
    const actual = await realpath(stage);
    if (info.isSymbolicLink() || !info.isDirectory() || path.dirname(actual) !== parent || !path.basename(actual).startsWith('crm-final-runtime-')) throw Error('FINAL_RUNTIME_CLEANUP_SCOPE');
    await rm(actual, { recursive: true, force: false });
  }
  code('PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkFinalRuntime(path.resolve(process.argv[2] ?? 'src-tauri/resources/app')).catch(error => {
    console.error(/^FINAL_RUNTIME_[A-Z_]+(?:[0-9]+)?$/.test(error.message) ? error.message : 'FINAL_RUNTIME_FAILED');
    process.exitCode = 1;
  });
}
