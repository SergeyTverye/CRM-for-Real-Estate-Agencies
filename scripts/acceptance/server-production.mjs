// Synthetic-only production acceptance. No root dotenv, installs, builds or existing CRM stacks.
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, cpSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: flags } = parseArgs({ options: {
  image: { type: 'string', default: 'crm-app:v32-acceptance' },
  provenance: { type: 'string', default: 'Existing image: content base ba8d271, supplied APP_COMMIT fb9a792; NOT a clean checkout/build certification.' },
  'expected-commit': { type: 'string' },
  'project-prefix': { type: 'string', default: 'crm-v32-qa' },
  'restore-project-prefix': { type: 'string', default: 'crm-v32-qa-restore' },
  'project-suffix': { type: 'string', default: '' },
  'wait-image-seconds': { type: 'string', default: '0' },
} });
const projects = [flags['project-prefix'], flags['restore-project-prefix']].map(p => p + (flags['project-suffix'] ? '-' + flags['project-suffix'] : ''));
if (projects[0] === projects[1] || projects.some(p => !/^crm-v32-[a-z0-9][a-z0-9-]*$/.test(p))) throw new Error('Invalid/distinct QA project names required');
const waitSeconds = Number(flags['wait-image-seconds']);
if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 300) throw new Error('Image wait must be 0..300 seconds');

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const compose = path.join(repo, 'scripts/acceptance/server-production/compose.yaml');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve(repo, 'data/qa-v32-prod', stamp);
if (!root.startsWith(repo + path.sep) || existsSync(root)) throw new Error('Unsafe/nonfresh own root');
mkdirSync(root, { recursive: true });
const results = [], commands = [], secrets = [];
const redact = s => secrets.reduce((v, secret) => v.replaceAll(secret, '[REDACTED]'), String(s));
const evidence = { started: new Date().toISOString(), root, results, commands,
  requestedImage: flags.image, provenance: flags.provenance, hostNode: process.version,
  exclusions: 'No private inputs, full regressions, Windows desktop acceptance, rebuild or install.' };
function run(args, label = args.slice(0, 3).join(' ')) {
  commands.push(['docker', ...args].map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' '));
  const r = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(path.join(root, 'commands.log'), redact(commands.join('\n') + '\n'));
  writeFileSync(path.join(root, 'execution.log'), redact((existsSync(path.join(root, 'execution.log')) ? readFileSync(path.join(root, 'execution.log'), 'utf8') : '') + `\n# ${label}\n${r.stdout ?? ''}${r.stderr ?? ''}`));
  if (r.status !== 0) throw new Error(`${label}: exit ${r.status}: ${redact((r.stderr || r.stdout || r.error?.message || '').slice(-2500))}`);
  return r.stdout.trim();
}
function pass(name, detail = '') { results.push({ name, status: 'PASS', detail }); console.log(`PASS ${name} ${detail}`); }
async function free(port) { await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(resolve)); }); }
function context(project, port, image, credentials, deployment) {
  const dir = path.join(root, project);
  for (const d of ['files', 'backups', 'import-staging']) mkdirSync(path.join(dir, d), { recursive: true });
  const password = randomBytes(24).toString('hex'); secrets.push(password);
  const env = { COMPOSE_PROJECT_NAME: project, APP_IMAGE: image, APP_PORT: port, REPO_ROOT: repo.replaceAll('\\', '/'), QA_DATA: dir.replaceAll('\\', '/'),
    POSTGRES_DB: 'qa_synthetic', POSTGRES_USER: 'qa_synthetic', POSTGRES_PASSWORD: password,
    DEPLOYMENT_ID: deployment, INSTANCE_ID: project, ...credentials };
  const envFile = path.join(dir, 'qa.env');
  writeFileSync(envFile, Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  const dc = (...args) => run(['compose', '--project-name', project, '--env-file', envFile, '-f', compose, ...args]);
  return { project, port, dir, dc, url: `http://127.0.0.1:${port}` };
}
async function ready(c) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    try { if ((await fetch(c.url + '/api/health/ready', { signal: AbortSignal.timeout(3000) })).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`${c.project}: readiness timeout`);
}
async function request(c, cookie, route, options = {}, statuses = [200]) {
  const r = await fetch(c.url + '/api/v1' + route, { ...options, headers: { origin: c.url, ...(cookie ? { cookie } : {}), ...options.headers }, signal: AbortSignal.timeout(120000) });
  const data = Buffer.from(await r.arrayBuffer());
  if (!statuses.includes(r.status)) throw new Error(`${route}: HTTP ${r.status}: ${redact(data.toString().slice(0, 1200))}`);
  return { r, data, json: () => JSON.parse(data.toString()) };
}
const post = data => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const sha = b => createHash('sha256').update(b).digest('hex');
async function login(c, credentials, key) {
  const res = await request(c, null, '/auth/login', post({ login: credentials[`SEED_${key}_LOGIN`], password: credentials[`SEED_${key}_PASSWORD`] }));
  const cookie = res.r.headers.get('set-cookie')?.split(';')[0];
  if (!cookie || res.json().mustChangePassword) throw new Error('Session not usable');
  secrets.push(cookie);
  if (!/httponly/i.test(res.r.headers.get('set-cookie')) || !/samesite=lax/i.test(res.r.headers.get('set-cookie'))) throw new Error('Cookie security flags');
  return cookie;
}
try {
  await free(3555); await free(3556);
  for (const project of projects) {
    if (run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])) throw new Error(`Existing own project ${project}; refusing reuse`);
    if (run(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])) throw new Error(`Existing own volume ${project}; refusing reuse`);
  }
  const imageDeadline = Date.now() + waitSeconds * 1000;
  let image;
  while (!image) {
    try { image = run(['image', 'inspect', flags.image, '--format', '{{.Id}}']); }
    catch (e) {
      if (Date.now() >= imageDeadline) throw e;
      console.log('Image not available; waiting up to 15 seconds (bounded image wait).');
      await new Promise(r => setTimeout(r, Math.min(15000, imageDeadline - Date.now())));
    }
  }
  evidence.image = image;
  evidence.imageCommit = run(['run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', 'process.stdout.write(process.env.APP_COMMIT ?? "unknown")']);
  if (flags['expected-commit'] && evidence.imageCommit !== flags['expected-commit']) throw new Error('Image APP_COMMIT mismatch');
  evidence.postgresImage = run(['image', 'inspect', 'postgres:18.6-bookworm', '--format', '{{.Id}}']);
  const credentials = {};
  for (const key of ['MANAGER', 'REALTOR1', 'REALTOR2']) {
    credentials[`SEED_${key}_LOGIN`] = `qa_${key.toLowerCase()}`;
    credentials[`SEED_${key}_PASSWORD`] = randomBytes(24).toString('hex') + 'Aa7!';
    secrets.push(credentials[`SEED_${key}_PASSWORD`]);
  }
  const deployment = randomUUID();
  const c = context(projects[0], 3555, image, credentials, deployment);
  const rt = context(projects[1], 3556, image, credentials, deployment);
  evidence.projects = [c.project, rt.project];
  c.dc('up', '-d', '--wait', '--wait-timeout', '240', 'app', 'worker', 'search-worker');
  await ready(c);
  evidence.node = c.dc('exec', '-T', 'app', 'node', '--version');
  evidence.runtimeCommit = c.dc('exec', '-T', 'app', 'node', '-e', 'process.stdout.write(process.env.APP_COMMIT ?? "unknown")');
  if (evidence.runtimeCommit !== evidence.imageCommit) throw new Error('Runtime/image commit mismatch');
  evidence.postgres = c.dc('exec', '-T', 'db', 'psql', '-U', 'qa_synthetic', '-d', 'qa_synthetic', '-Atc', 'SHOW server_version');
  evidence.seedUsers = c.dc('exec', '-T', 'db', 'psql', '-U', 'qa_synthetic', '-d', 'qa_synthetic', '-Atc', 'SELECT count(*) FROM users');
  if (evidence.seedUsers !== '3') throw new Error('Seed user count != 3');
  pass('clean migrations + seed + app/workers healthy', '3 synthetic users');
  const cookies = await Promise.all(['MANAGER', 'REALTOR1', 'REALTOR2'].map(k => login(c, credentials, k)));
  const users = await Promise.all(cookies.map(async cookie => (await request(c, cookie, '/auth/me')).json()));
  if (users.map(u => u.role).join(',') !== 'manager,realtor,realtor') throw new Error('Roles mismatch');
  pass('three concurrent HTTP sessions + roles + HttpOnly/SameSite');
  await request(c, null, '/clients', {}, [401]);
  const clients = await Promise.all(cookies.slice(1).map(async (cookie, i) => (await request(c, cookie, '/clients', post({ displayName: `SYNTHETIC QA ${stamp} ${i}` }), [201])).json()));
  const tasks = await Promise.all(cookies.slice(1).map(async (cookie, i) => (await request(c, cookie, '/tasks', post({ title: `Synthetic control task ${i}`, taskType: 'call_or_contact', dueAt: new Date(Date.now() + 86400000).toISOString(), links: { clientIds: [clients[i].id] } }), [201])).json()));
  for (let i = 0; i < 2; i++) {
    await request(c, cookies[i + 1], `/clients/${clients[i].id}`);
    await request(c, cookies[i + 1], `/clients/${clients[1-i].id}`, {}, [403,404]);
    await request(c, cookies[i + 1], `/tasks/${tasks[1-i].id}`, {}, [403,404]);
    await request(c, cookies[0], `/clients/${clients[i].id}`);
    await request(c, cookies[0], `/tasks/${tasks[i].id}`);
  }
  await request(c, cookies[1], '/import/jobs', {}, [403]);
  await request(c, cookies[1], '/export', {}, [403]);
  pass('RBAC client/task cross IDs + manager visibility + manager-only endpoints');
  const control = Buffer.from(`Synthetic production acceptance ${stamp}\n`);
  const form = new FormData();
  form.set('file', new Blob([control], { type: 'text/plain' }), 'synthetic-control.txt');
  form.set('documentTypeCode', 'other'); form.set('linkKind', 'client'); form.set('linkId', clients[0].id);
  const doc = (await request(c, cookies[1], '/documents', { method: 'POST', body: form }, [201])).json();
  for (const cookie of [cookies[0], cookies[1]]) if (sha((await request(c, cookie, `/documents/${doc.id}/download`)).data) !== sha(control)) throw new Error('Download checksum');
  await request(c, cookies[2], `/documents/${doc.id}/download`, {}, [403,404]);
  await request(c, null, `/documents/${doc.id}/download`, {}, [401]);
  evidence.control = { clientId: clients[0].id, documentId: doc.id, sha256: sha(control) };
  pass('protected document upload/download + cross-ID/anonymous denial + SHA256');
  // Generate only a tiny synthetic workbook inside the existing image, using its installed ExcelJS.
  const generator = `const ExcelJS=require('exceljs'); (async()=>{const w=new ExcelJS.Workbook();const s=w.addWorksheet('Synthetic');s.addRow(['Жилая продажа']);s.addRow(['Адрес','Площадь','Цена','Комнаты','Этаж','Этажность']);s.addRow(['СИНТЕТИЧЕСКИЙ QA адрес ${stamp}',54,6500000,2,5,9]);await w.xlsx.writeFile('/data/import-staging/qa-fixture.xlsx')})().catch(()=>process.exit(1));`;
  c.dc('exec', '-T', 'app', 'node', '-e', generator);
  const fixture = readFileSync(path.join(c.dir, 'import-staging/qa-fixture.xlsx'));
  const upload = new FormData(); upload.set('file', new Blob([fixture]), 'qa-fixture.xlsx');
  const countProperties = () => c.dc('exec', '-T', 'db', 'psql', '-U', 'qa_synthetic', '-d', 'qa_synthetic', '-Atc', 'SELECT count(*) FROM properties');
  const before = countProperties();
  const job = (await request(c, cookies[0], '/import/jobs', { method: 'POST', body: upload }, [201])).json();
  const dry = (await request(c, cookies[0], `/import/jobs/${job.id}`)).json();
  if (dry.job.status !== 'dry_run_ready' || countProperties() !== before || !dry.sections.some(s => s.status === 'recognized')) throw new Error('Dry-run validation/no-write');
  const committed = (await request(c, cookies[0], `/import/jobs/${job.id}/commit`, post({ sections: dry.sections.filter(s => s.status === 'recognized').map(s => s.sectionKey) }))).json();
  evidence.import = { jobId: job.id, committed };
  if (Number(countProperties()) !== Number(before) + 1) throw new Error('Import did not create one property');
  const exported = await request(c, cookies[0], '/export');
  if (exported.data[0] !== 0x50 || exported.data[1] !== 0x4b) throw new Error('Export not ZIP');
  writeFileSync(path.join(c.dir, 'synthetic-export.zip'), exported.data);
  pass('synthetic XLSX dry-run (no domain writes) + commit + export ZIP');
  c.dc('restart', 'db', 'app', 'worker', 'search-worker'); await ready(c);
  await request(c, cookies[1], `/clients/${clients[0].id}`);
  if (sha((await request(c, cookies[1], `/documents/${doc.id}/download`)).data) !== sha(control)) throw new Error('Restart file loss');
  await login(c, credentials, 'MANAGER');
  pass('restart persistence DB + files + session + fresh login');
  // Quiesce writers before backup so restore row-count comparison is deterministic.
  c.dc('stop', 'app', 'worker', 'search-worker');
  const backup = c.dc('--profile', 'ops', 'run', '--rm', '-T', '--no-deps', 'backup', 'bash', '/app/ops/backup/scripts/backup.sh', '--trigger', 'manual').split(/\r?\n/).at(-1);
  if (!/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/.test(backup)) throw new Error('Invalid backup id');
  evidence.backupId = backup;
  c.dc('--profile', 'ops', 'run', '--rm', '-T', '--no-deps', 'backup', 'bash', '/app/ops/backup/scripts/verify.sh', backup);
  pass('actual pg_dump + files archive + manifest/checksums + verify', backup);
  cpSync(path.join(c.dir, 'backups', backup), path.join(rt.dir, 'backups', backup), { recursive: true, errorOnExist: true });
  rt.dc('up', '-d', '--wait', 'db');
  rt.dc('--profile', 'ops', 'run', '--rm', '-T', '--no-deps', 'backup', 'bash', '/app/ops/backup/scripts/restore-data.sh', backup, '--confirm');
  pass('actual isolated pg_restore + files restore + manifest row counts/checksums');
  rt.dc('up', '-d', '--wait', '--wait-timeout', '240', 'app', 'worker', 'search-worker'); await ready(rt);
  const restoredCookies = await Promise.all(['MANAGER', 'REALTOR1', 'REALTOR2'].map(k => login(rt, credentials, k)));
  await request(rt, restoredCookies[0], `/clients/${clients[0].id}`);
  await request(rt, restoredCookies[1], `/tasks/${tasks[0].id}`);
  if (sha((await request(rt, restoredCookies[1], `/documents/${doc.id}/download`)).data) !== sha(control)) throw new Error('Restored API checksum mismatch');
  await request(rt, restoredCookies[2], `/documents/${doc.id}/download`, {}, [403,404]);
  pass('restored app/workers healthy + 3 logins + control rows + API SHA256 + RBAC');
  evidence.status = 'PASS (server synthetic scope only)';
  // Preserve volumes/artifacts; stop only these explicitly owned projects.
  rt.dc('stop'); c.dc('stop');
  evidence.handles = 'Both owned projects stopped; volumes and synthetic artifacts retained. No existing CRM touched.';
} catch (e) {
  evidence.status = 'FAIL'; evidence.error = redact(e.message); console.error(evidence.error); process.exitCode = 1;
} finally {
  evidence.finished = new Date().toISOString();
  writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${path.join(root, 'result.json')}`);
}
