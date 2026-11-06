import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const app = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.LOCALAPPDATA, 'RealEstateCRM');
const dirs = Object.fromEntries(['data','files','backups','logs'].map(n => [n, path.join(root,n)]));
const children = new Set();
let stopping = false;
let backupBusy = false;
let ready = false;
let port;
const log = code => process.stdout.write(code + '\n');
async function assertLocalDirectory(dir) {
  let current = path.parse(dir).root;
  for (const part of path.relative(current, dir).split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('REPARSE_POINT_FORBIDDEN'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await mkdir(current); }
  }
}
function child(script, name, args = []) {
  const out = createWriteStream(path.join(dirs.logs, name + '.log'), { flags: 'a' });
  const p = spawn(process.execPath, ['--require', path.join(app,'graceful.cjs'), script, ...args], {
    cwd: app, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(p);
  p.stdout.pipe(out, { end: false }); p.stderr.pipe(out, { end: false });
  p.on('error', () => { log('CHILD_START_FAILED:' + name); void shutdown(1); });
  p.on('exit', code => {
    children.delete(p); out.end();
    if (!stopping && ready) { log('CHILD_EXIT:' + name + ':' + code); void shutdown(1); }
  });
  return p;
}
async function stopChild(p) {
  if (p.exitCode !== null) return;
  p.stdin?.write('STOP\n');
  const end = new Promise(resolve => p.once('exit', resolve));
  await Promise.race([end, new Promise(r => setTimeout(r, 12000).unref())]);
  if (p.exitCode === null) p.kill();
  await Promise.race([end, new Promise(r => setTimeout(r, 2000).unref())]);
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; ready = false;
  // Workers finish before the server; Job Object is the final containment boundary.
  await Promise.all([...children].reverse().map(stopChild));
  await rm(path.join(dirs.logs, 'runtime.json'), { force: true });
  log('STOPPED'); process.exit(code);
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve,reject) => { socket.once('error',reject); socket.listen(0,'127.0.0.1',resolve); });
  const value = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return value;
}
async function waitReady(server) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !stopping) {
    if (server.exitCode !== null) throw Error('SERVER_EXIT_BEFORE_READY');
    try { if ((await fetch('http://127.0.0.1:' + port + '/api/health/ready', { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await new Promise(r => setTimeout(r,300));
  }
  throw Error('READY_TIMEOUT');
}
async function runOnce(script, name, args = []) {
  const p = child(script,name,args);
  const code = await new Promise(resolve => p.once('exit',resolve));
  if (code !== 0) throw Error(name.toUpperCase() + '_FAILED');
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('WINDOWS_X64_REQUIRED');
  for (const dir of [root, ...Object.values(dirs)]) await assertLocalDirectory(dir);
  // ACL applied by native launcher before any secrets or database are created.
  const identityPath = path.join(dirs.data, 'identity.json');
  let identity;
  try { identity = JSON.parse(await readFile(identityPath,'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw Error('IDENTITY_INVALID');
    identity = { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() };
    await writeFile(identityPath, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  }
  port = await freePort();
  Object.assign(process.env, {
    NODE_ENV:'production', CRM_DESKTOP_WORKER:'1', CRM_DEPLOYMENT_MODE:'desktop', CRM_DESKTOP_PORT:String(port),
    HOSTNAME:'127.0.0.1', PORT:String(port), APP_PORT:String(port), COOKIE_SECURE:'false',
    DATABASE_URL:'file:' + path.join(dirs.data,'crm.db').replaceAll('\\','/'),
    SQLITE_DATABASE_URL:'file:' + path.join(dirs.data,'crm.db').replaceAll('\\','/'),
    DESKTOP_DATA_DIR:dirs.data, FILE_STORAGE_PATH:dirs.files, BACKUP_PATH:dirs.backups,
    IMPORT_STAGING_PATH:path.join(dirs.data,'import-staging'), DEPLOYMENT_ID:identity.deploymentId,
    INSTANCE_ID:identity.instanceId, APP_TIMEZONE:'Asia/Novosibirsk', CRM_DESKTOP_SUPERVISED_UPGRADE:'1',
    PLAYWRIGHT_BROWSERS_PATH:path.join(app,'chromium'), AI_ENABLED:'false', SCRAPER_ENABLED:'false',
  });
  const bundle = JSON.parse(await readFile(path.join(app,'desktop-manifest.json'),'utf8'));
  process.env.SCRAPER_CHROME_PATH = path.join(app,bundle.chromium);
  process.env.APP_VERSION = bundle.version;
  const upgrade = await import('./upgrade.cjs');
  await upgrade.prepareDesktopUpgrade();
  const server = child(path.join(app,'server.js'),'server');
  try { await waitReady(server); await upgrade.finishDesktopUpgrade(); }
  catch (e) { await stopChild(server); await upgrade.rollbackDesktopUpgrade(); throw e; }
  ready = true;
  for (const name of ['notifications','search','backup']) child(path.join(app,'workers',name + '.cjs'),name);
  const info = { url:'http://127.0.0.1:' + port, pid:process.pid, version:bundle.version };
  await writeFile(path.join(dirs.logs,'runtime.json'),JSON.stringify(info),{ mode:0o600 });
  log('READY ' + info.url);
  createInterface({ input:process.stdin }).on('line', line => {
    if (line === 'STOP') void shutdown();
    if (line === 'BACKUP' && !backupBusy) {
      backupBusy = true;
      void (async () => {
        ready = false;
        await Promise.all([...children].map(stopChild));
        await runOnce(path.join(app,'backup-now.cjs'),'backup-manual');
      })().then(() => log('BACKUP_COMPLETE'), () => log('BACKUP_FAILED')).finally(async () => {
        if (!stopping) { const restarted = child(path.join(app,'server.js'),'server'); await waitReady(restarted); ready = true; for (const name of ['notifications','search','backup']) child(path.join(app,'workers',name+'.cjs'),name); }
        backupBusy = false;
      }).catch(() => void shutdown(1));
    }
  });
  process.stdin.on('end', () => void shutdown());
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => void shutdown());
main().catch(error => { const safe = /^[A-Z_]+$/.test(error.message) ? error.message : 'RUNTIME_ERROR'; log('DESKTOP_START_FAILED:' + safe); void shutdown(1); });
