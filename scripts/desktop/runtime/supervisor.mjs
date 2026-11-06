import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, rm, readdir, copyFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const app = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.LOCALAPPDATA, 'RealEstateCRM');
const dirs = Object.fromEntries(['data','files','backups','logs'].map(n => [n, path.join(root,n)]));
const children = new Set();
let stopping = false;
let backupBusy = false;
let activeOperation = Promise.resolve();
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
  if (p.exitCode !== null || p.signalCode !== null) return;
  p.stdin?.on('error', () => {});
  p.stdin?.write('STOP\n');
  const end = new Promise(resolve => p.once('exit', resolve));
  await Promise.race([end, new Promise(r => setTimeout(r, 12000).unref())]);
  if (p.exitCode === null && p.signalCode === null) p.kill();
  await Promise.race([end, new Promise(r => setTimeout(r, 2000).unref())]);
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; ready = false;
  // Do not kill a restore/backup halfway through its generation switch. No
  // operation may restart writers after shutdown has begun.
  await activeOperation;
  // Workers finish before the server; Job Object is the final containment boundary.
  await Promise.all([...children].reverse().map(stopChild));
  if (!children.size && code === 0) { process.env.CRM_BACKUP_WRITERS_STOPPED='1'; try { await runOnce(path.join(app,'backup-command.cjs'),'backup-close',['--on-close']); } catch { log('CLOSING_BACKUP_FAILED'); } finally { delete process.env.CRM_BACKUP_WRITERS_STOPPED; } }
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
  const code = await new Promise((resolve,reject) => { p.once('exit',resolve); p.once('error',reject); });
  if (code !== 0) throw Error(name.toUpperCase() + '_FAILED');
}
async function fileHash(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
let nativeBusy = false;
async function nativeDialogs() {
  if (nativeBusy || stopping) return; nativeBusy = true;
  try {
    const root = path.join(dirs.data, 'backup-settings', 'native-dialogs');
    for (const file of (await readdir(root).catch(() => [])).filter(n => /^[a-f0-9-]{36}\.request\.json$/.test(n))) {
      const id = file.slice(0,36), request = JSON.parse(await readFile(path.join(root,file),'utf8'));
      if (Date.now() - Date.parse(request.createdAt) > 120000) { await rm(path.join(root,file),{force:true}); continue; }
      const announced = path.join(root,id+'.announced');
      try { await writeFile(announced,'',{flag:'wx',mode:0o600}); log('NATIVE_' + (request.kind === 'export' ? 'EXPORT' : 'FOLDER') + ':' + id); } catch (e) { if(e.code!=='EEXIST') throw e; }
      const choice = path.join(root,id+'.path');
      let target; try { target = await readFile(choice,'utf8'); } catch(e) { if(e.code==='ENOENT') continue; throw e; }
      let result;
      try {
        if (!target) result = {status:'cancelled'};
        else if(request.kind === 'folder') result = {status:'selected',directory:target};
        else {
          if (!/^[a-f0-9-]{36}$/.test(request.backupId)) throw Error('EXPORT_ID');
          const source = path.join(dirs.backups,'portable',request.backupId+'.crmbackup');
          const metadata = JSON.parse(await readFile(source+'.json','utf8')).archive;
          if ((await lstat(source)).isSymbolicLink() || (await stat(source)).size !== metadata.size || await fileHash(source) !== metadata.sha256) throw Error('EXPORT_CHECKSUM');
          if(!path.isAbsolute(target) || !target.endsWith('.crmbackup')) throw Error('EXPORT_PATH');
          await assertLocalDirectory(path.dirname(target));
          try { await lstat(target); throw Error('EXPORT_EXISTS'); } catch(e) { if(e.code!=='ENOENT') throw e; }
          const temp = target+'.'+id+'.pending';
          try { await copyFile(source,temp,1); if(await fileHash(temp)!==metadata.sha256) throw Error('EXPORT_CHECKSUM'); await rename(temp,target); }
          finally { await rm(temp,{force:true}); }
          result={status:'exported'};
        }
      } catch { result={status:'failed'}; }
      await writeFile(path.join(root,id+'.result.json'),JSON.stringify(result),{flag:'wx',mode:0o600});
      await rm(path.join(root,file),{force:true}); await rm(choice,{force:true}); await rm(announced,{force:true});
    }
  } finally { nativeBusy=false; }
}
async function configureActiveGeneration() {
  const pointer = path.join(dirs.data, 'runtime-generations', 'current.json');
  let generation;
  try { generation = JSON.parse(await readFile(pointer, 'utf8')).generation; }
  catch (e) { if (e.code === 'ENOENT') return; throw Error('GENERATION_POINTER_INVALID'); }
  if (!/^[a-f0-9-]{36}$/.test(generation)) throw Error('GENERATION_POINTER_INVALID');
  const active = path.join(dirs.data, 'runtime-generations', 'generations', generation);
  await assertLocalDirectory(active);
  process.env.DATABASE_URL = 'file:' + path.join(active, 'database.sqlite').replaceAll('\\','/');
  process.env.SQLITE_DATABASE_URL = process.env.DATABASE_URL;
  process.env.FILE_STORAGE_PATH = path.join(active, 'documents');
}
async function configureHandoff() {
  try { const state = JSON.parse(await readFile(path.join(dirs.data, 'handoff-state.json'), 'utf8')); process.env.INSTANCE_ROLE = state.readOnly ? 'standby' : 'active'; }
  catch (e) { if (e.code !== 'ENOENT') throw Error('HANDOFF_STATE_INVALID'); }
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
  await configureActiveGeneration();
  await configureHandoff();
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
  // The authenticated manager API only publishes fixed command IDs, never executable paths.
  const commandsDir = path.join(dirs.data, 'backup-settings', 'commands');
  const nativeTimer = setInterval(() => { void nativeDialogs().catch(() => log('NATIVE_DIALOG_FAILED')); },500);
  nativeTimer.unref();
  const pollCommands = setInterval(() => {
    if (backupBusy || stopping || !ready) return;
    backupBusy = true;
    activeOperation = (async () => {
      const commands = (await readdir(commandsDir).catch(() => [])).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).sort();
      if (!commands.length) return;
      ready = false;
      await Promise.all([...children].map(stopChild));
      if (children.size) throw Error('BACKUP_WRITERS_STILL_RUNNING');
      process.env.CRM_BACKUP_WRITERS_STOPPED = '1';
      try { await runOnce(path.join(app,'backup-command.cjs'), 'backup-command', [commands[0].slice(0,-5)]); }
      finally { delete process.env.CRM_BACKUP_WRITERS_STOPPED; }
      if (stopping) return;
      await configureActiveGeneration(); await configureHandoff();
      const restarted = child(path.join(app,'server.js'),'server'); await waitReady(restarted);
      ready = true;
      for (const name of ['notifications','search','backup']) child(path.join(app,'workers',name+'.cjs'),name);
    })().catch(() => { log('BACKUP_COMMAND_FAILED'); void shutdown(1); }).finally(() => { backupBusy = false; });
  }, 1000);
  pollCommands.unref();
  createInterface({ input:process.stdin }).on('line', line => {
    if (line === 'STOP') void shutdown();
    if (line === 'BACKUP' && !backupBusy && !stopping && ready) {
      backupBusy = true;
      activeOperation = (async () => {
        ready = false;
        await Promise.all([...children].map(stopChild));
        if (children.size) throw Error('BACKUP_WRITERS_STILL_RUNNING');
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
