import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = c => { throw Object.assign(new Error(c), { safeCode: c }); };
const sha = b => createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function localPath(v) {
  if (typeof v !== 'string' || !/^[a-z]:[\\/]/i.test(v) || /[\x00-\x1f<>"|?*]/.test(v) ||
    v.slice(2).includes(':') || /(^|[\\/])\.\.?([\\/]|$)/.test(v) ||
    v.split(/[\\/]/).some(p => /[ .]$/.test(p))) fail('PATH_REJECTED');
  return path.win32.normalize(v);
}
export function contained(root, t) {
  const rel = path.win32.relative(localPath(root), localPath(t));
  return Boolean(rel) && !rel.startsWith('..') && !path.win32.isAbsolute(rel);
}
export function loopback(v) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(v)) fail('RUNTIME_URL_REJECTED');
  if (Number(new URL(v).port) > 65535) fail('RUNTIME_URL_REJECTED');
  return new URL(v).origin;
}
function options(args) {
  const r = {}; const flags = new Set(['execute-new-installed']);
   const vals = new Set(['launcher', 'launcher-sha256', 'source-commit', 'evidence-root']);
  for (let i = 0; i < args.length; i++) {
    const k = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || Object.hasOwn(r, k)) fail('ARGUMENT_REJECTED');
    if (flags.has(k)) r[k] = true;
    else if (vals.has(k) && args[i + 1] && !args[i + 1].startsWith('--')) r[k] = args[++i];
    else fail('ARGUMENT_REJECTED');
  } return r;
}
async function main() {
  const o = options(process.argv.slice(2));
  if (!o['execute-new-installed']) fail('EXPLICIT_EXECUTION_REQUIRED');
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('WINDOWS_X64_REQUIRED');
   for (const k of ['DEBUG', 'PWDEBUG', 'NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_DEBUG', 'NODE_DEBUG']) if (process.env[k]) fail('UNSAFE_CONTROLLER_ENVIRONMENT');
   if (process.execArgv.some(a => /inspect|debug/.test(a))) fail('UNSAFE_CONTROLLER_ENVIRONMENT');
  for (const k of ['DATABASE_URL', 'TEST_DATABASE_URL', 'FILE_STORAGE_PATH', 'SQLITE_DATABASE_URL']) if (process.env[k]) fail('INHERITED_DATA_ENVIRONMENT');
  if (!/^[a-f0-9]{40}$/i.test(o['source-commit'] ?? '')) fail('SOURCE_REFERENCE_REQUIRED');
  const system = localPath(process.env.SystemRoot ?? '');
  const ps = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const baseEnv = { SystemRoot: system, WINDIR: system, SystemDrive: system.slice(0, 2), PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: system + '\\System32;' + system + '\\System32\\WindowsPowerShell\\v1.0', COMSPEC: path.join(system, 'System32/cmd.exe') };
  const powershell = async (code, env = baseEnv, c = 'SYSTEM_INSPECTION_FAILED') => {
    try {
      return (await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + code, 'utf16le').toString('base64')], { env, windowsHide: true, timeout: 15000, maxBuffer: 1 << 20 })).stdout.trim();
    } catch { fail(c); }
  };
  const canonical = async v => {
    const p = localPath(v);
    await powershell(`$p=$env:QA_CHECK_PATH;while($p){if(Test-Path -LiteralPath $p){$i=Get-Item -Force -LiteralPath $p;if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE'}};$q=[IO.Directory]::GetParent($p);if(!$q){break};$p=$q.FullName}`, { ...baseEnv, QA_CHECK_PATH: p }, 'CANONICAL_PREFLIGHT_FAILED');
    try { if ((await fs.realpath(p)).toLowerCase() !== p.replace(/[\\/]$/, '').toLowerCase()) fail('CANONICAL_MISMATCH'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return p;
  };
  const file = async p => { p = await canonical(p); if (!(await fs.stat(p)).isFile()) fail('FILE_REQUIRED'); return p; };
  const shaFile = async p => createHash('sha256').update(await fs.readFile(await file(p))).digest('hex');
  const qa = await canonical(path.join(workspace, 'data/qa-v32-installed-upgrade-fault'));
  if ((await canonical(o['evidence-root'] ?? '')).toLowerCase() !== qa.toLowerCase()) fail('EVIDENCE_ROOT_REJECTED');
  const launcher = await file(o.launcher ?? '');
  if (path.basename(launcher).toLowerCase() !== 'realestatecrm.exe' || contained(workspace, launcher)) fail('INSTALLED_LAUNCHER_REQUIRED');
  if (!/^[a-f0-9]{64}$/i.test(o['launcher-sha256'] ?? '') || (await shaFile(launcher)) !== o['launcher-sha256'].toLowerCase()) fail('NEW_ARTIFACT_HASH_MISMATCH');
  const install = path.dirname(launcher);
  const nodeExe = await file(path.join(install, 'app/node/node.exe'));
  await file(path.join(install, 'app/server.js'));
   const initialOwnership = await powershell(`if(@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count){throw 'OTHER_APP'};try{$m=[Threading.Mutex]::OpenExisting('Local\\RealEstateCRM.Desktop.Writer');$m.Dispose();throw 'OTHER_WRITER'}catch [Threading.WaitHandleCannotBeOpenedException]{};'CLEAR'`, baseEnv, 'OWNERSHIP_PREFLIGHT_FAILED');
   if (initialOwnership !== 'CLEAR') fail('OTHER_LAUNCHER_OR_WRITER');
  await fs.mkdir(qa, { recursive: true }); await canonical(qa);
  const id = randomUUID(); const run = path.join(qa, id);
  try { await fs.lstat(run); fail('EXISTING_RUN_ROOT_REJECTED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(run); await canonical(run);
  await powershell(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& "$env:SystemRoot\\System32\\icacls.exe" $env:QA_RUN /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null;if($LASTEXITCODE){throw 'ACL'}`, { ...baseEnv, QA_RUN: run }, 'ACL_PREFLIGHT_FAILED');
  const prof = path.join(run, 'profile'); const lad = path.join(prof, 'lad', 'RealEstateCRM');
  for (const d of [path.join(prof, 'lad'), path.join(prof, 'roam'), path.join(prof, 'tmp'), lad]) await fs.mkdir(d, { recursive: true });
   const dataRoot = path.join(lad, 'data'), backupRoot = path.join(lad, 'backups');
   const runtime = path.join(lad, 'logs', 'runtime.json');
   const env = { ...baseEnv, LOCALAPPDATA: path.join(prof, 'lad'), APPDATA: path.join(prof, 'roam'),
     TEMP: path.join(prof, 'tmp'), TMP: path.join(prof, 'tmp'), USERPROFILE: prof, HOME: prof };
   const checks = [], ownedNodes = new Set();
   let child, base, cookie, launchError, launchedAt, previousPid, supervisorPid, stage = 'PREFLIGHT';
   let password = randomBytes(24).toString('hex') + 'Aa7!';
   const result = { schema: 2, status: 'RUNNING', syntheticDataOnly: true, runId: id,
     launcherSha256: o['launcher-sha256'].toLowerCase(), sourceCommit: o['source-commit'],
     sourceReference: 'coordinator-reference-not-binary-provenance', checks };
   const note = code => checks.push({ code, status: 'PASS' });
   const alive = () => { if (launchError || !child || child.exitCode !== null || child.signalCode !== null) fail('OWN_LAUNCHER_EXITED'); };
   const absent = async p => { await canonical(p); try { await fs.lstat(p); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };
   const scope = async p => { if (!contained(run, p)) fail('OWN_SCOPE_REJECTED'); return canonical(p); };
   const installedNode = async script => {
     try { return (await exec(nodeExe, ['-e', script], { cwd: path.join(install, 'app'), env,
       windowsHide: true, timeout: 30000, maxBuffer: 1048576 })).stdout.trim(); }
     catch { fail('INSTALLED_NODE_FAILED'); }
   };
   const noOther = async () => {
     const clear = await powershell(`if(@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count){throw 'OTHER'};try{$m=[Threading.Mutex]::OpenExisting('Local\\RealEstateCRM.Desktop.Writer');$m.Dispose();throw 'WRITER'}catch [Threading.WaitHandleCannotBeOpenedException]{};'CLEAR'`);
     if (clear !== 'CLEAR') fail('OTHER_LAUNCHER_OR_WRITER');
   };
   async function identity() {
     alive(); await scope(runtime);
     const descendants = JSON.parse(await powershell(`$all=@(Get-CimInstance Win32_Process);$parents=@(${child.pid});$owned=@();for($i=0;$i -lt 4;$i++){$next=@($all | Where-Object {$parents -contains $_.ParentProcessId -and $_.ExecutablePath -ieq $env:QA_NODE});foreach($p in $next){$owned+= [int]$p.ProcessId};$parents=@($next | ForEach-Object {[int]$_.ProcessId})};ConvertTo-Json -Compress -InputObject @($owned)`, { ...baseEnv, QA_NODE: nodeExe }));
     if (!Array.isArray(descendants) || descendants.some(p => !Number.isSafeInteger(p) || p < 1)) fail('DESCENDANT_IDENTITY_REJECTED');
     for (const pid of descendants) ownedNodes.add(pid);
     if (await absent(runtime)) return false;
     const stat = await fs.stat(runtime);
     if (stat.size > 4096 || !stat.isFile()) fail('RUNTIME_METADATA_REJECTED');
     const info = JSON.parse(await fs.readFile(runtime, 'utf8'));
     if (info.pid === previousPid || stat.mtimeMs < launchedAt - 2000) return false;
     if (!Number.isSafeInteger(info.pid) || info.pid < 1) fail('RUNTIME_PID_REJECTED');
     const owner = await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${info.pid}';if(!$p -or $p.ParentProcessId -ne ${child.pid} -or $p.ExecutablePath -ine $env:QA_NODE){throw 'OWNER'};$s=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${info.pid}' | Where-Object {$_.ExecutablePath -ieq $env:QA_NODE -and $_.CommandLine -match 'server\\.js'});if($s.Count -ne 1){throw 'SERVER'};'OWNED:'+ [string]$s[0].ProcessId`, { ...baseEnv, QA_NODE: nodeExe });
     const serverPid = /^OWNED:([1-9]\d*)$/.exec(owner)?.[1];
     if (!serverPid) fail('RUNTIME_ANCESTRY_REJECTED');
     ownedNodes.add(info.pid); ownedNodes.add(Number(serverPid));
     supervisorPid = info.pid;
     base = loopback(info.url);
     if (info.version !== bundle.version) fail('RUNTIME_VERSION_MISMATCH');
     return true;
   }
   let bundle;
   async function start() {
     await noOther();
     if (!await absent(runtime)) {
       const old = JSON.parse(await fs.readFile(await file(runtime), 'utf8'));
       previousPid = old.pid;
       await fs.unlink(await scope(runtime));
     }
     launchedAt = Date.now(); launchError = false; base = undefined; cookie = undefined;
     child = spawn(launcher, ['--smoke', '--smoke-seconds=300'], { cwd: install, env, stdio: 'ignore', windowsHide: true });
     child.on('error', () => { launchError = true; });
   }
   async function ready() {
     const deadline = Date.now() + 150000;
     while (Date.now() < deadline) {
       alive();
       if (await identity()) {
         const r = await fetch(base + '/api/health/ready', { redirect: 'manual', signal: AbortSignal.timeout(3000) });
         await r.arrayBuffer();
         if (r.ok) return;
         if (r.status !== 503) fail('READY_HTTP_FAILED');
       }
       await sleep(250);
     }
     fail('READY_TIMEOUT');
   }
   async function stopOwn() {
     if (child && child.exitCode === null && child.signalCode === null) {
       const done = new Promise(resolve => child.once('exit', resolve));
       if (!child.kill()) fail('OWNED_STOP_FAILED');
       await Promise.race([done, sleep(20000).then(() => fail('OWNED_STOP_TIMEOUT'))]);
     }
     previousPid = supervisorPid ?? previousPid; supervisorPid = undefined;
     child = undefined;
     if (ownedNodes.size) {
       const gone = await powershell(`$ids=@(${[...ownedNodes].join(',')});$end=[DateTime]::UtcNow.AddSeconds(10);do{$p=@(Get-CimInstance Win32_Process | Where-Object {$ids -contains $_.ProcessId -and $_.ExecutablePath -ieq $env:QA_NODE});if(!$p.Count){'GONE';break};[Threading.Thread]::Sleep(100)}while([DateTime]::UtcNow -lt $end);if($p.Count){'REMAINING'}`, { ...baseEnv, QA_NODE: nodeExe });
       if (gone !== 'GONE') fail('OWNED_NODE_REMAINS');
       ownedNodes.clear();
     }
     await noOther();
   }
   async function request(route, method = 'GET', body) {
     if (!await identity()) fail('FRESH_RUNTIME_REQUIRED');
     const headers = { Origin: base };
     if (cookie) headers.Cookie = cookie;
     if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
     const r = await fetch(base + route, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000),
       body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
     if (!r.ok) fail('INSTALLED_API_HTTP_FAILED');
     const sessions = r.headers.getSetCookie().filter(v => v.startsWith('crm_session='));
     if (sessions.length > 1) fail('SESSION_COOKIE_AMBIGUOUS');
     if (sessions.length) {
       const value = sessions[0].split(';')[0];
       if (!/^crm_session=[A-Za-z0-9_-]+$/.test(value)) fail('SESSION_COOKIE_REJECTED');
       cookie = value;
     }
     const bytes = Buffer.from(await r.arrayBuffer());
     if (bytes.length > 1048576) fail('RESPONSE_BOUND');
     return route.endsWith('/download') ? bytes : bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
   }
   const migration = '20261106220000_backup_queue_journal';
   let dbPath, storage, clientId, docId, storedDocumentKey;
   const q = JSON.stringify;
   async function sql(work, writable = false) {
     await file(await scope(dbPath));
     return JSON.parse(await installedNode(`const D=require('better-sqlite3');const db=new D(${q(dbPath)},{readonly:${!writable}});try{${work}}finally{db.close()}`));
   }
   async function projection() {
     return sql(`if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw Error('INTEGRITY');
       const H=require('node:crypto');const hash=v=>H.createHash('sha256').update(JSON.stringify(v)).digest('hex');
       const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
       const tables={};for(const n of names){const rows=db.prepare('SELECT * FROM "'+n.replaceAll('"','""')+'"').all();tables[n]=hash(rows.map(r=>JSON.stringify(r)).sort())}
       const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
       const ledger=db.prepare('SELECT * FROM _prisma_migrations ORDER BY migration_name,id').all();
       const document=db.prepare('SELECT * FROM documents WHERE id=?').get(${q(docId)});
       const client=db.prepare('SELECT * FROM clients WHERE id=?').get(${q(clientId)});
       if(!document||!client)throw Error('ROWS');
       process.stdout.write(JSON.stringify({tables,schemaHash:hash(schema),ledger,clientHash:hash(client),documentHash:hash(document),storageKey:document.storage_key,checksum:document.checksum,size:document.file_size}));`);
   }
   async function storedHash() {
     if (typeof storedDocumentKey !== 'string' || !storedDocumentKey || /[\\:]/.test(storedDocumentKey) || storedDocumentKey.split('/').some(s => !s || s === '.' || s === '..')) fail('DOCUMENT_KEY_REJECTED');
     const p = path.join(storage, ...storedDocumentKey.split('/'));
     if (!contained(storage, p)) fail('DOCUMENT_SCOPE_REJECTED');
     return shaFile(await scope(p));
   }
   async function archives() {
     await scope(backupRoot);
     return (await fs.readdir(backupRoot)).filter(n => /^[a-f0-9-]{36}\.crmbackup$/.test(n)).sort();
   }
   try {
     stage = 'BUNDLE_PREFLIGHT';
      bundle = JSON.parse(await fs.readFile(await file(path.join(install, 'app/desktop-manifest.json')), 'utf8'));
      if (typeof bundle?.version !== 'string' || !bundle.version) fail('BUNDLE_VERSION_REQUIRED');
      note('bundle-manifest-preflight');
      stage = 'NATIVE_ABI_PREFLIGHT';
     if (!/^v24\./.test(await installedNode('process.stdout.write(process.version)'))) fail('INSTALLED_NODE24_REQUIRED');
     await installedNode("const D=require('better-sqlite3');const d=new D(':memory:');d.close()");
     note('installed-node24-native-abi');
     stage = 'SMOKE_SETUP';
     await start(); await ready();
     const setup = await request('/api/v1/desktop/setup');
     if (!setup.available || localPath(setup.dataDirectory).toLowerCase() !== dataRoot.toLowerCase()) fail('OWN_SETUP_DIRECTORY_REQUIRED');
     await request('/api/v1/desktop/setup', 'POST', { login: 'qa-upgrade-fault', displayName: 'QA Synthetic Upgrade', password, mode: 'empty', dataDirectory: 'default', localDiskConfirmed: true });
     const login = async () => { cookie = undefined; await request('/api/v1/auth/login', 'POST', { login: 'qa-upgrade-fault', password }); if (!cookie) fail('LOGIN_COOKIE_MISSING'); };
     await login();
     const clientName = `QA SYNTHETIC UPGRADE ${id}`;
     const client = await request('/api/v1/clients', 'POST', { displayName: clientName, clientKind: 'person', contacts: [] });
     clientId = client.id;
     const uuid = v => { if (!/^[a-f0-9-]{36}$/.test(v ?? '')) fail('ENTITY_ID_REJECTED'); return v; };
     uuid(clientId);
     const docBytes = Buffer.from(`SYNTHETIC upgrade fault ${id}\n`), fileHash = sha(docBytes);
     const fd = new FormData(); fd.append('file', new Blob([docBytes], { type: 'text/plain' }), 'synthetic-fault.txt');
     fd.append('documentTypeCode', 'other'); fd.append('linkKind', 'client'); fd.append('linkId', clientId);
     docId = uuid((await request('/api/v1/documents', 'POST', fd)).id);
     if (sha(await request(`/api/v1/documents/${docId}/download`)) !== fileHash) fail('UPLOAD_DOWNLOAD_HASH_MISMATCH');
     await stopOwn();
     const pointer = path.join(dataRoot, 'runtime-generations/current.json');
     if (await absent(pointer)) { dbPath = path.join(dataRoot, 'crm.db'); storage = path.join(lad, 'files'); }
     else {
       const { generation } = JSON.parse(await fs.readFile(await file(await scope(pointer)), 'utf8'));
       uuid(generation);
       const active = path.join(dataRoot, 'runtime-generations/generations', generation);
       dbPath = path.join(active, 'database.sqlite'); storage = path.join(active, 'documents');
     }
     await scope(storage);
     await sql("db.pragma('wal_checkpoint(TRUNCATE)');process.stdout.write('{}')", true);
     const pristine = await projection(); storedDocumentKey = pristine.storageKey;
     if (pristine.checksum !== fileHash || Number(pristine.size) !== docBytes.length || await storedHash() !== fileHash) fail('STORED_DOCUMENT_MISMATCH');
     await fs.copyFile(await file(dbPath), await scope(path.join(run, 'pristine.sqlite')), fs.constants.COPYFILE_EXCL);
     const markerPath = path.join(dataRoot, 'desktop-version.json');
     const markerBefore = await fs.readFile(await file(await scope(markerPath)), 'utf8');
     if (JSON.parse(markerBefore).version !== bundle.version) fail('INITIAL_VERSION_MISMATCH');
     const queueLedger = pristine.ledger.filter(r => r.migration_name === migration);
     if (queueLedger.length !== 1 || !queueLedger[0].finished_at || queueLedger[0].rolled_back_at !== null || !pristine.tables.backup_queue_journals) fail('QUEUE_BASELINE_REQUIRED');
     note('synthetic-client-document-pristine-baseline');
     stage = 'INJECT_FAULT';
     await sql(`db.transaction(()=>{if(db.prepare('DELETE FROM _prisma_migrations WHERE migration_name=?').run(${q(migration)}).changes!==1)throw Error('LEDGER')}).immediate();db.pragma('wal_checkpoint(TRUNCATE)');process.stdout.write('{}')`, true);
     const injectedMarker = JSON.stringify({ version: '0.0.0-synthetic-upgrade-fault' });
     await fs.writeFile(await scope(markerPath), injectedMarker, { mode: 0o600 });
     const baseline = await projection();
     const businessTables = p => Object.fromEntries(Object.entries(p.tables).filter(([n]) => n !== '_prisma_migrations'));
     if (q(businessTables(pristine)) !== q(businessTables(baseline)) || pristine.schemaHash !== baseline.schemaHash ||
         q(baseline.ledger) !== q(pristine.ledger.filter(r => r.migration_name !== migration))) fail('INJECTION_CHANGED_BUSINESS_DATA');
     await fs.copyFile(await file(dbPath), await scope(path.join(run, 'injected-preupgrade.sqlite')), fs.constants.COPYFILE_EXCL);
     const beforeIdentity = (await fs.stat(await file(dbPath), { bigint: true })).ino;
     if (beforeIdentity === 0n) fail('FILE_IDENTITY_UNAVAILABLE');
     const beforeArchives = await archives();
     const journal = path.join(dataRoot, 'pending-upgrade.json');
     if (!await absent(journal)) fail('PRIOR_UPGRADE_JOURNAL_REJECTED');
     result.baseline = { projectionSha256: sha(q(baseline)), databaseSha256: await shaFile(dbPath),
       markerSha256: sha(injectedMarker), documentSha256: fileHash, ledgerSha256: sha(q(baseline.ledger)) };
     note('pending-ledger-existing-queue-conflict-zero-business-change');
     stage = 'FAULT_START';
     await start();
     const deadline = Date.now() + 150000;
     while (!launchError && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
       try { if (await identity()) fail('FAULTY_UPGRADE_UNEXPECTEDLY_READY'); }
       catch (e) {
         if (e.safeCode !== 'OWN_LAUNCHER_EXITED' || launchError || child.exitCode === null || child.exitCode === 0 || child.signalCode !== null) throw e;
         break;
       }
       await sleep(250);
     }
     if (launchError || child.signalCode !== null || child.exitCode === null || child.exitCode === 0) fail('EXPECTED_MIGRATION_FAILURE_EXIT_MISSING');
     result.faultExitCode = child.exitCode;
     await stopOwn();
     stage = 'ROLLBACK_ASSERTS';
     const newArchives = (await archives()).filter(n => !beforeArchives.includes(n));
     if (newArchives.length !== 1) fail('EXACT_PROTECTIVE_ARCHIVE_REQUIRED');
     const archivePath = await file(await scope(path.join(backupRoot, newArchives[0])));
     const bytes = await fs.readFile(archivePath);
     if (bytes.length < 32 || bytes.length > 256 * 1024 * 1024 || bytes.subarray(0, 8).toString() !== 'CRMBKP1\n') fail('ARCHIVE_FORMAT_REJECTED');
     const headerLength = bytes.readUInt32BE(8);
     if (!headerLength || headerLength > 8192 || bytes.length < 12 + headerLength + 20) fail('ARCHIVE_HEADER_BOUND');
     const header = JSON.parse(bytes.subarray(12, 12 + headerLength).toString('utf8'));
     const wrapOk = w => w && /^[a-f0-9]{24}$/.test(w.nonce) && /^[a-f0-9]{64}$/.test(w.ciphertext) && /^[a-f0-9]{32}$/.test(w.tag);
     const enc = header.encryption;
     if (header.formatVersion !== 1 || enc?.alg !== 'AES-256-GCM-chunked' || enc.kdf !== 'scrypt' || enc.params?.N !== 32768 || enc.params.r !== 8 || enc.params.p !== 1 || !/^[a-f0-9]{32}$/.test(enc.params.salt) || !/^[a-f0-9]{16}$/.test(header.noncePrefix) || !wrapOk(header.phraseWrap) || !wrapOk(header.recoveryWrap)) fail('ARCHIVE_HEADER_REJECTED');
     result.archive = { size: bytes.length, sha256: sha(bytes), header: 'CRMBKP1_AES256GCM_SCRYPT' };
     if (!await absent(journal)) fail('PRODUCT_ROLLBACK_JOURNAL_NOT_REMOVED');
     if ((await fs.stat(await file(dbPath), { bigint: true })).ino === beforeIdentity) fail('PRODUCT_ROLLBACK_DB_NOT_REPLACED');
     const after = await projection();
     if (q(after) !== q(baseline)) fail('ROLLBACK_DATABASE_PROJECTION_MISMATCH');
     if (await fs.readFile(await file(markerPath), 'utf8') !== injectedMarker) fail('ROLLBACK_VERSION_MISMATCH');
     if (await storedHash() !== fileHash) fail('ROLLBACK_DOCUMENT_MISMATCH');
     result.rollback = { databaseReplaced: true, journalRemoved: true, projectionSha256: sha(q(after)),
       databaseSha256: await shaFile(dbPath), markerSha256: sha(injectedMarker), documentSha256: fileHash };
     note('compiled-rollback-replaced-db-removed-journal-restored-injected-baseline');
     stage = 'RECOVER';
     const row = queueLedger[0], columns = Object.keys(row);
     await sql(`db.transaction(()=>{if(db.prepare('SELECT count(*) n FROM _prisma_migrations WHERE migration_name=?').get(${q(migration)}).n)throw Error('LEDGER');db.prepare(${q('INSERT INTO _prisma_migrations (' + columns.map(c => '"' + c + '"').join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')}).run(...${q(Object.values(row))})}).immediate();process.stdout.write('{}')`, true);
     if (q(await projection()) !== q(pristine)) fail('RECOVERY_CHANGED_BASELINE');
     await start(); await ready(); await login();
     const recoveredClient = await request(`/api/v1/clients/${clientId}`);
     if (recoveredClient.id !== clientId || recoveredClient.displayName !== clientName) fail('RECOVERY_CLIENT_MISMATCH');
     if (sha(await request(`/api/v1/documents/${docId}/download`)) !== fileHash) fail('RECOVERY_DOWNLOAD_MISMATCH');
     if (JSON.parse(await fs.readFile(await file(markerPath), 'utf8')).version !== bundle.version || !await absent(journal)) fail('RECOVERY_VERSION_OR_JOURNAL_MISMATCH');
     note('healthy-installed-reupgrade-login-client-download-version');
     await stopOwn();
     if (await storedHash() !== fileHash) fail('FINAL_STORED_DOCUMENT_MISMATCH');
     const final = await projection();
     if (q(final.ledger) !== q(pristine.ledger) || final.tables.backup_queue_journals !== pristine.tables.backup_queue_journals) fail('FINAL_LEDGER_OR_QUEUE_MISMATCH');
     result.status = 'PASS';
   } catch (e) {
     result.status = 'FAIL';
     result.error = { stage, code: e.safeCode ?? `${stage}_FAILED` };
     checks.push({ code: stage, status: 'FAIL' });
   } finally {
     password = undefined; cookie = undefined;
     try { await stopOwn(); note('strict-owned-job-teardown'); }
     catch { result.status = 'FAIL'; result.cleanupError = 'OWNED_TEARDOWN_FAILED'; }
     await fs.writeFile(await scope(path.join(run, 'result.json')), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
   }
   if (result.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', code: e.safeCode ?? 'PREFLIGHT_FAILED' }));
  process.exitCode = 1;
});
