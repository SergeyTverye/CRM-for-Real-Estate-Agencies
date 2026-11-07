import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw Error('SUPPORTED_NODE_REQUIRED');
const repo = resolve(import.meta.dirname, '../..');
process.chdir(repo);
const chrome = process.argv[2] ?? process.env.REGRESSION_CHROME_PATH;
if (!chrome) throw Error('EXPLICIT_REAL_CHROME_REQUIRED');
if (!existsSync(chrome)) throw Error('REAL_CHROME_REQUIRED');
const id = randomUUID();
const evidence = resolve('data/coordination/dual-regression', id);
mkdirSync(evidence, { recursive: true });
const base = realpathSync.native(tmpdir());
const root = mkdtempSync(join(base, 'dual-regression-'));
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { PATH: [dirname(process.execPath), join(env.SystemRoot ?? '/usr', 'System32'), '/usr/bin'].join(process.platform === 'win32' ? ';' : ':'), TEMP: root, TMP: root, TMPDIR: root, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'), NODE_ENV: 'test', REGRESSION_CHROME_PATH: chrome });
for (const dir of ['home', 'appdata', 'localappdata']) mkdirSync(join(root, dir));
function snapshot() {
  const files = {};
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(ts|tsx|mjs|sql|prisma)$/.test(file)) files[file.replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  }
  for (const dir of ['src', 'prisma', 'scripts/desktop', 'tests/integration', 'tests/authorization', 'tests/sqlite', 'tests/regression-synthetic']) walk(dir);
  const headRef = readFileSync('.git/HEAD', 'utf8').trim();
  const head = headRef.startsWith('ref: ') ? readFileSync(join('.git', headRef.slice(5)), 'utf8').trim() : headRef;
  return { at: new Date().toISOString(), headRef, head, files, aggregateSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}
const start = snapshot();
writeFileSync(join(evidence, 'start.json'), JSON.stringify(start, null, 2));
const runs = [];
try {
  const probe = spawnSync(process.execPath, ['-e', "const D=require('better-sqlite3');new D(':memory:').close();require('@node-rs/argon2');console.log(JSON.stringify({node:process.version,abi:process.versions.modules}))"], { env, encoding: 'utf8' });
  if (probe.status !== 0) throw Error('NATIVE_ABI_PREFLIGHT_FAILED');
  for (const backend of ['pg', 'sqlite']) {
    const work = join(root, backend); mkdirSync(work);
    const resultPath = join(evidence, `${backend}.results.json`);
    const runEnv = { ...env, REGRESSION_ROOT: work, REGRESSION_RESULTS_PATH: resultPath, REGRESSION_EVIDENCE_PATH: join(evidence, `${backend}.environment.json`), SYNTHETIC_CONTROL_DATABASE_URL: `postgresql://crm:crm_test_password@127.0.0.1:55432/synthetic_final_regression_test_${randomUUID().replaceAll('-', '')}` };
    const started = Date.now();
    // One foreground child per contour. No timeout, no detached process, no raw logs retained.
    const child = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', `tests/regression-synthetic/${backend}.config.mts`], { env: runEnv, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    const safe = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
    const profiles = [];
    function profilesUnder(dir) { for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { if (e.name.startsWith('crm-browser-session-') || e.name.startsWith('playwright_chromiumdev_profile-')) profiles.push(e.name); profilesUnder(join(dir, e.name)); } }
    profilesUnder(root);
    const run = { backend, exit: child.status, signal: child.signal, durationMs: Date.now() - started, node: process.version, abi: process.versions.modules, counts: safe?.counts ?? null, files: safe?.files.length ?? 0, remainingBrowserProfiles: profiles.length, excludedCases: 2, excludedFile: 'tests/integration/private-workbook-verifier.test.ts' };
    runs.push(run); writeFileSync(join(evidence, `${backend}.terminal.json`), JSON.stringify(run, null, 2));
    console.log(JSON.stringify(run));
  }
} finally {
  const end = snapshot();
  writeFileSync(join(evidence, 'end.json'), JSON.stringify(end, null, 2));
  const changedSources = [...new Set([...Object.keys(start.files), ...Object.keys(end.files)])].filter(p => start.files[p] !== end.files[p]);
  rmSync(root, { recursive: true, force: true });
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ id, runs, changedSources, headChanged: start.head !== end.head, temporaryRootRemoved: !existsSync(root), migrationMethod: 'PostgreSQL tracked migration SQL application, not Prisma deploy; SQLite actual migration/template setup', cleanCommitProof: false }, null, 2));
  console.log(JSON.stringify({ evidence, temporaryRootRemoved: !existsSync(root), changedSources }));
}
process.exitCode = runs.length === 2 && runs.every(r => r.exit === 0) ? 0 : 1;
