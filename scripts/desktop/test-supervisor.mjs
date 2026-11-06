import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Synthetic process-contract test: no application DB, account, real profile,
// cloud credentials, Next build or Prisma generation is involved.
if (process.platform !== 'win32') throw Error('WINDOWS_TEST_REQUIRED');
const base = path.resolve('src-tauri/target/supervisor-check');
await mkdir(base, { recursive: true });
const stage = await mkdtemp(path.join(base, 'synthetic-'));
const app = path.join(stage, 'app');
await mkdir(path.join(app, 'workers'), { recursive: true });
for (const file of ['supervisor.mjs', 'graceful.cjs']) await copyFile(path.join('scripts/desktop/runtime', file), path.join(app, file));
await writeFile(path.join(app, 'desktop-manifest.json'), JSON.stringify({ version: 'synthetic', chromium: 'unused' }));
await writeFile(path.join(app, 'upgrade.cjs'), 'exports.prepareDesktopUpgrade=exports.finishDesktopUpgrade=exports.rollbackDesktopUpgrade=async()=>{};');
await writeFile(path.join(app, 'server.js'), `
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
fs.appendFileSync(path.join(process.env.DESKTOP_DATA_DIR,'starts'),'server\\n');
fs.appendFileSync(path.join(process.env.DESKTOP_DATA_DIR,'owned-pids'),String(process.pid)+'\\n');
const server=http.createServer((req,res)=>{res.end('ready');}).listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
for (const name of ['notifications', 'search', 'backup']) await writeFile(path.join(app, 'workers', name + '.cjs'), `
const fs=require('node:fs'),path=require('node:path');
fs.appendFileSync(path.join(process.env.DESKTOP_DATA_DIR,'owned-pids'),String(process.pid)+'\\n');
setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));
`);
await writeFile(path.join(app, 'backup-command.cjs'), `
const fs=require('node:fs'),path=require('node:path');
if(process.env.CRM_BACKUP_WRITERS_STOPPED!=='1')process.exit(2);
const dir=path.join(process.env.DESKTOP_DATA_DIR,'backup-settings','commands'),id=process.argv[2];
if(id==='--on-close')process.exit(0);
fs.writeFileSync(path.join(dir,id+'.started'),'synthetic');
setTimeout(()=>{fs.unlinkSync(path.join(dir,id+'.json'));fs.writeFileSync(path.join(dir,id+'.done'),'synthetic');},750);
`);
const child = spawn(process.execPath, [path.join(app, 'supervisor.mjs')], {
  env: { ...process.env, LOCALAPPDATA: path.join(stage, 'profile') },
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output += value; });
child.stderr.resume();
const completion = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
const data = path.join(stage, 'profile', 'RealEstateCRM', 'data');
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function waitFor(check) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await check()) return;
    if (child.exitCode !== null) throw Error('SUPERVISOR_EXIT_EARLY');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('SUPERVISOR_TEST_TIMEOUT');
}
async function runFailingCommandSmoke() {
  const failProfile = path.join(stage, 'failure-profile');
  const failApp = path.join(stage, 'failure-app');
  await mkdir(path.join(failApp, 'workers'), { recursive: true });
  for (const file of ['supervisor.mjs', 'graceful.cjs']) await copyFile(path.join('scripts/desktop/runtime', file), path.join(failApp, file));
  for (const name of ['notifications', 'search', 'backup']) await copyFile(path.join(app, 'workers', name + '.cjs'), path.join(failApp, 'workers', name + '.cjs'));
  await writeFile(path.join(failApp, 'desktop-manifest.json'), JSON.stringify({ version: 'synthetic-failure', chromium: 'unused' }));
  await writeFile(path.join(failApp, 'upgrade.cjs'), 'exports.prepareDesktopUpgrade=exports.finishDesktopUpgrade=exports.rollbackDesktopUpgrade=async()=>{};');
  await copyFile(path.join(app, 'server.js'), path.join(failApp, 'server.js'));
  await writeFile(path.join(failApp, 'backup-command.cjs'), `
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(process.env.DESKTOP_DATA_DIR,'backup-settings','commands'),id=process.argv[2];
fs.writeFileSync(path.join(dir,id+'.started'),'synthetic');
process.exit(7);
`);
  const failedChild = spawn(process.execPath, [path.join(failApp, 'supervisor.mjs')], {
    env: { ...process.env, LOCALAPPDATA: failProfile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let failOutput = '';
  failedChild.stdout.setEncoding('utf8'); failedChild.stdout.on('data', value => { failOutput += value; });
  failedChild.stderr.resume();
  const failData = path.join(failProfile, 'RealEstateCRM', 'data');
  const failCommands = path.join(failData, 'backup-settings', 'commands');
  const deadline = Date.now() + 15000;
  try {
    while (!failOutput.includes('READY ')) {
      if (failedChild.exitCode !== null) throw Error('FAILURE_SUPERVISOR_EXIT_EARLY');
      if (Date.now() > deadline) throw Error('FAILURE_SUPERVISOR_READY_TIMEOUT');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await mkdir(failCommands, { recursive: true });
    const id = randomUUID();
    await writeFile(path.join(failCommands, id + '.json'), '{}');
    const startedDeadline = Date.now() + 5000;
    while (!await exists(path.join(failCommands, id + '.started'))) {
      if (failedChild.exitCode !== null) throw Error('FAILURE_COMMAND_EXITED_BEFORE_START');
      if (Date.now() > startedDeadline) throw Error('FAILURE_COMMAND_START_TIMEOUT');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const code = await Promise.race([
      new Promise((resolve, reject) => { failedChild.once('exit', resolve); failedChild.once('error', reject); }),
      new Promise((_, reject) => setTimeout(() => reject(Error('FAILURE_SUPERVISOR_EXIT_TIMEOUT')), 10000)),
    ]);
    assert.equal(code, 1, 'nonzero backup command must make supervisor exit 1');
    assert.match(failOutput, /BACKUP_COMMAND_FAILED/);
    assert.equal(await exists(path.join(failProfile, 'RealEstateCRM', 'logs', 'runtime.json')), false, 'failure shutdown removes runtime metadata');
    const pidsFile = path.join(failData, 'owned-pids');
    const pids = (await readFile(pidsFile, 'utf8')).trim().split(/\s+/).filter(Boolean);
    assert.equal(pids.length, 4, 'synthetic server and three workers were owned by this supervisor');
    for (const pid of pids) {
      const probe = spawnSync(path.join(process.env.SystemRoot, 'System32/tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      const rows = probe.stdout.split(/\r?\n/).map(line => line.match(/^"([^"]+)","(\d+)"/)).filter(Boolean);
      assert.equal(rows.some(row => row[1].toLowerCase() === path.basename(process.execPath).toLowerCase() && row[2] === pid), false, `owned child ${pid} must be gone`);
    }
  } finally {
    if (failedChild.exitCode === null) spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(failedChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  console.log('SUPERVISOR_NONZERO_BACKUP_EXIT_PASS');
}
try {
  await waitFor(() => output.includes('READY '));
  const commands = path.join(data, 'backup-settings', 'commands');
  await mkdir(commands, { recursive: true });
  const first = randomUUID();
  await writeFile(path.join(commands, first + '.json'), '{}');
  await waitFor(() => exists(path.join(commands, first + '.done')));
  await waitFor(async () => (await readFile(path.join(data, 'starts'), 'utf8')).split('\n').filter(Boolean).length === 2);
  const second = randomUUID();
  await writeFile(path.join(commands, second + '.json'), '{}');
  await waitFor(() => exists(path.join(commands, second + '.started')));
  child.stdin.write('STOP\n');
  await waitFor(() => output.includes('STOPPED'));
  assert.equal(await completion, 0);
  assert.equal(await exists(path.join(commands, second + '.done')), true, 'shutdown must finish the in-flight command');
  assert.equal((await readFile(path.join(data, 'starts'), 'utf8')).split('\n').filter(Boolean).length, 2, 'shutdown must not restart writers');
  assert.equal(await exists(path.join(stage, 'profile/RealEstateCRM/logs/runtime.json')), false);
  console.log('SUPERVISOR_COMMAND_RESTART_AND_SHUTDOWN_PASS');
  await runFailingCommandSmoke();
} finally {
  if (child.exitCode === null) {
    // No native Job Object surrounds this JS-only harness. Restrict failure
    // cleanup to the exact process tree launched above, never all node.exe.
    spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  const resolvedStage = path.resolve(stage);
  assert.equal(path.dirname(resolvedStage), base);
  assert.ok(path.basename(resolvedStage).startsWith('synthetic-'));
  assert.equal((await lstat(resolvedStage)).isSymbolicLink(), false);
  assert.equal(await realpath(resolvedStage), resolvedStage);
  await rm(resolvedStage, { recursive: true, force: true });
}
