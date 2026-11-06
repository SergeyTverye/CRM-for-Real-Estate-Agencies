import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access } from 'node:fs/promises';
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
const server=http.createServer((req,res)=>{res.end('ready');}).listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
for (const name of ['notifications', 'search', 'backup']) await writeFile(path.join(app, 'workers', name + '.cjs'), "setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));");
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
} finally {
  if (child.exitCode === null) {
    // No native Job Object surrounds this JS-only harness. Restrict failure
    // cleanup to the exact process tree launched above, never all node.exe.
    spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
