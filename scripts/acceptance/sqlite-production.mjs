// Bounded synthetic acceptance. No dotenv, installation, build, Git mutation or private inputs.
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import net from 'node:net';

const sha = b => createHash('sha256').update(b).digest('hex');
const { values: flags } = parseArgs({ options: {
  image: { type: 'string', default: 'crm-app:v32-clean-278b54f' },
  'expected-commit': { type: 'string', default: process.env.QA_EXPECTED_COMMIT || '278b54f0cbc003a1c87e492e0851b73ec93ba60d' },
  'project-suffix': { type: 'string', default: '' },
  'public-source': { type: 'string' },
  'inspect-db': { type: 'boolean' }, 'verify-artifacts': { type: 'boolean' }, 'backup-restore': { type: 'boolean' },
} });
const IMAGE = flags.image;
const COMMIT = flags['expected-commit'];
const NAME = 'crm-v32-sqliteqa' + (flags['project-suffix'] ? '-' + flags['project-suffix'] : '');
if (!/^crm-v32-sqliteqa(?:-[a-z0-9]+)?$/.test(NAME) || !/^[a-f0-9]{40}$/.test(COMMIT)) throw Error('INVALID_QA_IDENTITY');
const BASE = 'http://127.0.0.1:3567';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function helper() {
  const { createRequire } = await import('node:module');
  const require = createRequire('/app/package.json');
  const Database = require('better-sqlite3');
  if (process.argv.includes('--inspect-db')) {
    const db = new Database('/qa/data/crm.db', { readonly: true });
    const counts = {};
    for (const t of ['users','clients','communications','client_needs','tasks','properties','property_collections','commercial_offers','documents','_prisma_migrations']) counts[t] = db.prepare(`SELECT count(*) n FROM ${t}`).get().n;
    const documents = db.prepare('SELECT id,checksum,storage_key FROM documents').all();
    for (const d of documents) if (sha(await readFile(path.join('/qa/files', d.storage_key))) !== d.checksum) throw Error('DOCUMENT_CHECKSUM');
    console.log(JSON.stringify({ counts, integrity: db.pragma('integrity_check', { simple: true }), foreignKeyErrors: db.pragma('foreign_key_check').length, checkedFiles: documents.length }));
    db.close(); return;
  }
  if (process.argv.includes('--verify-artifacts')) {
    const { unzipSync } = require('fflate');
    const doc = unzipSync(await readFile('/qa/artifacts/offer.docx'));
    if (!new TextDecoder().decode(doc['word/document.xml']).includes('SQLITE-QA')) throw Error('DOCX_CONTENT');
    const book = unzipSync(await readFile('/qa/artifacts/collection.xlsx'));
    if (!book['xl/workbook.xml'] || !Object.values(book).some(b => new TextDecoder().decode(b).includes('SQLITE-QA'))) throw Error('XLSX_CONTENT');
    const exp = unzipSync(await readFile('/qa/artifacts/export.zip'));
    if (!exp['manifest.json'] || !new TextDecoder().decode(exp['clients.csv']).includes('SQLITE-QA')) throw Error('EXPORT_CONTENT');
    const pdf = await readFile('/qa/artifacts/offer.pdf');
    if (!pdf.subarray(0,5).equals(Buffer.from('%PDF-')) || !pdf.includes(Buffer.from('%%EOF'))) throw Error('PDF_FORMAT');
    console.log(JSON.stringify({ docxEntries: Object.keys(doc).length, xlsxEntries: Object.keys(book).length, exportEntries: Object.keys(exp).length, pdfBytes: pdf.length })); return;
  }
  const { createArchive } = await import('/app/src/modules/desktop-backup/infrastructure/archive.ts');
  const { SqliteSnapshotValidator } = await import('/app/src/modules/desktop-backup/infrastructure/sqlite-validator.ts');
  const { restoreArchive, GenerationStore } = await import('/app/src/modules/desktop-backup/application/restore.ts');
  const validator = new SqliteSnapshotValidator();
  const passphrase = randomBytes(32).toString('base64url');
  const { newRecoveryKey } = await import('/app/src/modules/desktop-backup/infrastructure/encryption.ts');
  const recoveryKey = newRecoveryKey();
  const make = () => createArchive({ outputDir:'/qa/backups', stagingRoot:'/qa/staging',
    source:{ async createConsistentSnapshot(dest) { const db=new Database('/qa/data/crm.db'); try {await db.backup(dest);} finally {db.close();} } },
    barrier:{run: work => work()}, validator,
    metadata:{deploymentId:process.env.DEPLOYMENT_ID,instanceId:randomUUID(),deviceId:randomUUID(),snapshotRevision:1,parentBackupId:null,crmVersion:COMMIT,schemaVersion:1000},
    passphrase,recoveryKey,recoveryKeySaved:true,settings:{timeZone:'Asia/Novosibirsk',locale:'ru-RU'},storage:{documents:'/qa/files'} });
  // Caller has stopped the only app writer: the barrier covers DB and files.
  const backup=await make();
  const restored=await restoreArchive({archivePath:backup.path,credential:{passphrase},schemaVersion:1000,validator,store:new GenerationStore('/qa/restore-store'),confirmed:true,
    hooks:{withStoppedRuntime:work=>work(),prepareStage:async()=>{},protectCurrent:async()=>{const p=await make();return {path:p.path,archive:p.archive,credential:{passphrase}};}}});
  await mkdir('/qa/restored/data',{recursive:true});
  await cp(path.join(restored.activePath,'database.sqlite'),'/qa/restored/data/crm.db',{errorOnExist:true,force:false});
  await cp(path.join(restored.activePath,'documents'),'/qa/restored/files',{recursive:true,errorOnExist:true,force:false});
  console.log(JSON.stringify({backupId:backup.archive.backupId,bytes:backup.archive.size,sha256:backup.archive.sha256,manifestSha256:backup.manifest.manifestSha256,restored:true,components:backup.manifest.components}));
}

async function main() {
  const results=[]; const commands=[]; const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const fixture=path.join(root,'data/qa-v32-sqliteprod',stamp);
  const network=`crm-v32-sqliteqa-${stamp.toLowerCase()}`;
  const docker=(args, input) => { commands.push('docker '+args.join(' ')); const r=spawnSync('docker',args,{encoding:'utf8',input,timeout:180000,maxBuffer:8*1024*1024}); if(r.status!==0) throw Error(`DOCKER_FAILED exit=${r.status} output_sha256=${sha((r.stderr||'')+(r.stdout||''))}`); return r.stdout.trim(); };
  const safeError=e=>`failure_sha256=${sha(String(e.message))}; locations=${String(e.stack).split('\n').filter(l=>/^\s+at /.test(l)).join(' | ')}`;
  const check=async(name,fn)=>{try {const detail=await fn();results.push({name,status:'PASS',detail});console.log('PASS '+name);return detail;}catch(e){const detail=safeError(e);results.push({name,status:'FAIL',detail});console.log('FAIL '+name+': '+detail);return null;}};
  const password=()=> 'Aa9!'+randomBytes(24).toString('base64url');
  let cookie=''; let realtorCookie=''; let managerPassword=password();
  const http=async(url,method='GET',body,expected=200,session=cookie)=>{
    const code=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);const r=await fetch(x.url,{...x.options,signal:AbortSignal.timeout(65000),redirect:'manual'});console.log(JSON.stringify({status:r.status,headers:[...r.headers],bytes:Buffer.from(await r.arrayBuffer()).toString('base64')}));`;
    const input=JSON.stringify({url:BASE+url,options:{method,headers:{origin:BASE,...(session?{cookie:session}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}});
    const out=spawnSync('docker',['exec','-i',NAME,'node','--input-type=module','-e',code],{input,encoding:'utf8',timeout:75000,maxBuffer:16*1024*1024});
    if(out.status!==0)throw Error('CONTAINER_HTTP_FAILED');
    const r=JSON.parse(out.stdout);r.headers=new Headers(r.headers);const bytes=Buffer.from(r.bytes,'base64');let data;try{data=JSON.parse(bytes.toString());}catch{data=null;}
    if(r.status!==expected) throw Error(`${method} ${url}: HTTP ${r.status}`);
    return {data,bytes,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
  };
  const json=async(...args)=>(await http(...args)).data;
  const env=['CRM_DEPLOYMENT_MODE=desktop','DATABASE_URL=file:/qa/data/crm.db','DESKTOP_DATA_DIR=/qa/data','FILE_STORAGE_PATH=/qa/files','BACKUP_PATH=/qa/backups','IMPORT_STAGING_PATH=/qa/staging',`DEPLOYMENT_ID=${randomUUID()}`,`INSTANCE_ID=${randomUUID()}`,'APP_TIMEZONE=Asia/Novosibirsk','COOKIE_SECURE=false','AI_ENABLED=false','SCRAPER_ENABLED=false','SCRAPER_BROWSER_ENABLED=false','YANDEX_WEB_SEARCH_ENABLED=false','BACKUP_TARGETS='];
  env.push('CRM_DESKTOP_PORT=3567');
  env.push(`QA_EXPECTED_COMMIT=${COMMIT}`);
  const appCommand=['node_modules/.bin/next','start','-p','3567','-H','0.0.0.0'];
  const mounts=['--mount',`type=bind,source=${fixture},target=/qa`,'--mount',`type=bind,source=${path.join(flags['public-source'] || root,'scripts/desktop')},target=/app/scripts/desktop,readonly`,'--mount',`type=bind,source=${fileURLToPath(import.meta.url)},target=/app/scripts/acceptance/sqlite-production.mjs,readonly`];
  const envArgs=env.flatMap(v=>['-e',v]);
  const execHelper=flag=>JSON.parse(docker(['run','--rm','--network','none',...mounts,...envArgs,'--entrypoint','node',IMAGE,'--import','tsx','/app/scripts/acceptance/sqlite-production.mjs',flag]).split('\n').at(-1));
  const wait=async()=>{for(let i=0;i<60;i++){try{await http('/api/health/ready');return;}catch{} await new Promise(r=>setTimeout(r,1000));}throw Error('READINESS_TIMEOUT');};
  let started=false;
  try {
    await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(3567,'127.0.0.1',()=>s.close(resolve));});
    const image=JSON.parse(docker(['image','inspect',IMAGE]))[0];
    if(!image.Config.Env.includes('APP_COMMIT='+COMMIT)||!image.Config.Env.includes('NODE_VERSION=24.22.2'))throw Error('IMAGE_IDENTITY_MISMATCH');
    if(docker(['ps','-a','--filter',`name=^/${NAME}$`,'--format','{{.Names}}']))throw Error('DEDICATED_CONTAINER_ALREADY_EXISTS');
    await mkdir(path.dirname(fixture),{recursive:true});
    await mkdir(fixture,{recursive:false});
    for(const p of ['data','files','backups','staging','artifacts'])await mkdir(path.join(fixture,p));
    results.push({name:'image',status:'PASS',detail:{id:image.Id,commit:COMMIT,node:'24.22.2'}});
    docker(['run','--rm','--network','none',...mounts,...envArgs,'--entrypoint','node',IMAGE,'--import','tsx','scripts/desktop/init-db.ts','--initialize']);
    results.push({name:'clean SQLite migration',status:'PASS'});
    docker(['network','create','--internal',network]);
    docker(['run','-d','--name',NAME,'--network',network,'-p','127.0.0.1:3567:3567',...mounts,...envArgs,IMAGE,...appCommand]);started=true;
    await check('readiness',async()=>{await wait();return await json('/api/health/ready');});
    await check('first manager via API',async()=>{const s=await json('/api/v1/desktop/setup');if(!s.available)throw Error('NOT_EMPTY');await json('/api/v1/desktop/setup','POST',{login:'sqliteqa.manager',displayName:'SQLITE-QA manager',password:managerPassword,mode:'empty',dataDirectory:'default',localDiskConfirmed:true});const r=await http('/api/v1/auth/login','POST',{login:'sqliteqa.manager',password:managerPassword});cookie=r.cookie;if(!cookie||!r.headers.get('set-cookie').includes('HttpOnly'))throw Error('SESSION_COOKIE');return await json('/api/v1/auth/me');});
    await check('roles and direct denial',async()=>{const u=await json('/api/v1/admin/users','POST',{login:'sqliteqa.realtor',displayName:'SQLITE-QA realtor',roleCode:'realtor'},201);let login=await http('/api/v1/auth/login','POST',{login:u.user.login,password:u.temporaryPassword});const rp=password();await http('/api/v1/auth/change-password','POST',{currentPassword:u.temporaryPassword,newPassword:rp},200,login.cookie);login=await http('/api/v1/auth/login','POST',{login:u.user.login,password:rp});realtorCookie=login.cookie;await http('/api/v1/admin/users','GET',undefined,403,realtorCookie);await http('/api/v1/archive','GET',undefined,403,realtorCookie);await http('/api/v1/admin/users','GET',undefined,401,'');return {realtorLogin:true,passwordChanged:true,realtorAdminDenied:true,realtorArchiveDenied:true,anonymousAdminDenied:true};});
    const client=await check('create client',()=>json('/api/v1/clients','POST',{displayName:'SQLITE-QA synthetic client'},201));
    if(client){await check('record call',()=>json('/api/v1/communications','POST',{clientId:client.id,communicationType:'call',resultCode:'completed',comment:'SQLITE-QA offline call'},201));}
    const dueAt=new Date(Date.now()+3600000).toISOString();
    const need=client&&await check('need plus next task',()=>json('/api/v1/needs','POST',{clientId:client.id,operationType:'rent',propertyType:'commercial',nextAction:{title:'SQLITE-QA next call',dueAt}},201));
    if(need)await check('calendar contains next task',async()=>{const r=await json('/api/v1/calendar?'+new URLSearchParams({from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString()}));if(!r.items.some(i=>i.sourceId===need.taskId))throw Error('TASK_NOT_IN_CALENDAR');return {items:r.items.length};});
    const property=await check('property',()=>json('/api/v1/properties','POST',{propertyType:'commercial',operationType:'rent',sourceType:'agency_listing',addressText:'SQLITE-QA synthetic office',area:'80',price:'123456.78'},201));
    const collection=await check('collection',()=>json('/api/v1/collections','POST',{name:'SQLITE-QA collection'},201));
    let offer,doc;
    if(property&&collection&&need){await check('collection to offer',async()=>{await json(`/api/v1/collections/${collection.id}/items`,'POST',{items:[{propertyId:property.id}]});let card=await json(`/api/v1/collections/${collection.id}`);await json(`/api/v1/collections/${collection.id}/needs`,'POST',{expectedUpdatedAt:card.updatedAt,needId:need.id});offer=await json(`/api/v1/collections/${collection.id}/offer`,'POST',{needId:need.id,itemIds:card.items.map(i=>i.id)});return offer;});}
    if(offer){doc=await check('DOCX generation and download',async()=>{const d=await json(`/api/v1/offers/${offer.id}/document`,'POST',{},201);const r=await http(`/api/v1/documents/${d.id}/download`);await writeFile(path.join(fixture,'artifacts/offer.docx'),r.bytes);return {id:d.id,bytes:r.bytes.length,sha256:sha(r.bytes)};});await check('PDF rendering',async()=>{const r=await http(`/api/v1/offers/${offer.id}/pdf`);await writeFile(path.join(fixture,'artifacts/offer.pdf'),r.bytes);return {bytes:r.bytes.length,sha256:sha(r.bytes)};});}
    if(collection)await check('XLSX export',async()=>{const r=await http(`/api/v1/collections/${collection.id}/export?format=xlsx`);await writeFile(path.join(fixture,'artifacts/collection.xlsx'),r.bytes);return {bytes:r.bytes.length,sha256:sha(r.bytes)};});
    await check('open data export',async()=>{const r=await http('/api/v1/export');await writeFile(path.join(fixture,'artifacts/export.zip'),r.bytes);return {bytes:r.bytes.length,sha256:sha(r.bytes)};});
    if(client&&doc&&realtorCookie)await check('foreign client and document direct denial',async()=>{await http(`/api/v1/clients/${client.id}`,'GET',undefined,404,realtorCookie);await http(`/api/v1/documents/${doc.id}/download`,'GET',undefined,404,realtorCookie);return {clientDenied:true,documentDenied:true};});
    await check('artifact structure and synthetic content',()=>execHelper('--verify-artifacts'));
    await check('SQLite integrity, counts and stored file checksums',()=>execHelper('--inspect-db'));
    await check('restart persistence and login',async()=>{docker(['restart',NAME]);await wait();await json('/api/v1/auth/me');if(client)await json(`/api/v1/clients/${client.id}`);if(doc){const r=await http(`/api/v1/documents/${doc.id}/download`);if(sha(r.bytes)!==doc.sha256)throw Error('RESTART_FILE_CHECKSUM');}const r=await http('/api/v1/auth/login','POST',{login:'sqliteqa.manager',password:managerPassword});cookie=r.cookie;return {existingSession:true,freshLogin:true,client:!!client,document:!!doc};});
    docker(['stop',NAME]);started=false;
    const backup=await check('encrypted generic archive and actual restore',()=>execHelper('--backup-restore'));
    if(backup){docker(['rm',NAME]);const restoredEnv=env.map(e=>e.startsWith('DATABASE_URL=')?'DATABASE_URL=file:/qa/restored/data/crm.db':e.startsWith('DESKTOP_DATA_DIR=')?'DESKTOP_DATA_DIR=/qa/restored/data':e.startsWith('FILE_STORAGE_PATH=')?'FILE_STORAGE_PATH=/qa/restored/files':e);docker(['run','-d','--name',NAME,'--network',network,'-p','127.0.0.1:3567:3567',...mounts,...restoredEnv.flatMap(v=>['-e',v]),IMAGE,...appCommand]);started=true;await check('restored production readiness login client document',async()=>{await wait();const r=await http('/api/v1/auth/login','POST',{login:'sqliteqa.manager',password:managerPassword});cookie=r.cookie;await json(`/api/v1/clients/${client.id}`);if(doc){const d=await http(`/api/v1/documents/${doc.id}/download`);if(sha(d.bytes)!==doc.sha256)throw Error('RESTORED_FILE_CHECKSUM');}return {readiness:true,login:true,client:true,document:!!doc};});}
  } catch(e){const detail=safeError(e);results.push({name:'harness',status:'FAIL',detail});console.log('FAIL harness: '+detail);}
  finally {
    if(started)try{docker(['stop',NAME]);}catch{}
    const summary={executedAt:new Date().toISOString(),image:IMAGE,commit:COMMIT,fixture,container:NAME,network,commands,results};
    const text=`# Production SQLite acceptance\n\n${summary.executedAt}\n\nImage: \`${IMAGE}\`; APP_COMMIT: \`${COMMIT}\`; Node 24.22.2, Linux Docker. Host orchestrator: ${process.version}.\nFixture: \`${fixture}\`. Container: \`${NAME}\`, loopback 3567, dedicated internal Docker network (no external egress). No PostgreSQL.\n\n**${results.filter(r=>r.status==='PASS').length} PASS / ${results.filter(r=>r.status==='FAIL').length} FAIL. Not full Desktop gates / T01–T10 PASS.**\n\n${results.map(r=>`- **${r.status} ${r.name}**${r.detail?': '+JSON.stringify(r.detail):''}`).join('\n')}\n\n## Reproduce\n\n\`node scripts/acceptance/sqlite-production.mjs\` (existing named QA container must be absent; script refuses reuse). Existing image only; no install/build/generation. Commands use public desktop scripts mounted read-only; normal runtime, supervised upgrade flag absent.\n\n## Boundaries\n\nSynthetic data only; no private/Excel/existing customer data, root dotenv or pre-existing backups read. Password/passphrase/recovery key remain in process memory, not in protocol. Generic archive API uses stopped single writer, native Linux SQLite and production encryption/restore modules, not DPAPI. No Windows launcher, native picker, supervisor, DPAPI or cloud compatibility claim. Container is stopped and isolated fixture retained.\n\n## Docker commands\n\n\`\`\`text\n${commands.join('\n')}\n\`\`\`\n`;
    const notes='\n## Ограничения и история прогонов\n\nHTTP исполнялся через `docker exec` внутри Linux-контейнера на `127.0.0.1:3567`: internal network исключает внешний egress. Порт опубликован только на loopback хоста, но доступ из браузера Windows-хоста не подтверждён. Локальные health/API не используют внешние сетевые probes. AI, scraper, web search и backup targets выключены.\n\nDOCX/XLSX проверены распаковкой и наличием synthetic content; PDF реально сформирован Chromium, проверены сигнатура/EOF и SHA-256, но визуальная вёрстка и извлечение текста PDF не проверялись. Созданы manager и один realtor, не полный T01 с тремя пользователями. Readiness сообщает deploymentMode=server (отдельный DEPLOYMENT_MODE), тогда как CRM_DEPLOYMENT_MODE=desktop и реальная SQLite подтверждены файлами/миграциями. Встроенный image healthcheck на 3000 не является этой проверкой readiness на 3567.\n\nПредварительные прогоны harness не были зелёными: отсутствовал родитель fixture-каталога; затем не были заданы CRM_DESKTOP_PORT и корректный recovery-key format, а HTTP с Windows-хоста не проходил в internal network. Исправлен только acceptance harness, не core. После этого полный прогон дал 21 PASS, а финальный с дополнительными RBAC-проверками — результаты выше. Подтверждённых core-дефектов в проверенном объёме не найдено; это не утверждение об отсутствии дефектов вне него. Все новые fixtures сохранены; архивные ключи не сохранены, поэтому для дальнейшей проверки оставлена уже восстановленная DB/files.\n';
    await mkdir(path.join(root,'docs/acceptance/desktop-v32'),{recursive:true});
    await writeFile(path.join(root,'docs/acceptance/desktop-v32/sqlite-production.md'),text+notes);
    await mkdir(fixture,{recursive:true});await writeFile(path.join(fixture,'results.json'),JSON.stringify(summary,null,2));
    console.log(`RESULT ${results.filter(r=>r.status==='PASS').length} PASS / ${results.filter(r=>r.status==='FAIL').length} FAIL`);
    if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
  }
}
if(process.argv.some(a=>['--inspect-db','--verify-artifacts','--backup-restore'].includes(a)))await helper();else await main();
