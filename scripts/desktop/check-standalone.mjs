import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
const root=process.cwd();
const stage=await mkdtemp(path.join(os.tmpdir(),'crm-desktop-http-synthetic-'));
for(const name of ['data','files','backups']) await mkdir(path.join(stage,name));
const listener=net.createServer();
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const base='http://127.0.0.1:'+port;
const env={...process.env,NODE_ENV:'production',CRM_DEPLOYMENT_MODE:'desktop',CRM_DESKTOP_PORT:String(port),HOSTNAME:'127.0.0.1',PORT:String(port),COOKIE_SECURE:'false',
  DATABASE_URL:'file:'+path.join(stage,'data','crm.db').replaceAll('\\','/'),SQLITE_DATABASE_URL:'file:'+path.join(stage,'data','crm.db').replaceAll('\\','/'),
  DESKTOP_DATA_DIR:path.join(stage,'data'),FILE_STORAGE_PATH:path.join(stage,'files'),BACKUP_PATH:path.join(stage,'backups'),IMPORT_STAGING_PATH:path.join(stage,'data','import'),
  DEPLOYMENT_ID:randomUUID(),INSTANCE_ID:randomUUID(),APP_TIMEZONE:'Asia/Novosibirsk',LOG_LEVEL:'silent',CRM_DESKTOP_SUPERVISED_UPGRADE:'1',AI_ENABLED:'false',SCRAPER_ENABLED:'false'};
function check(ok,code){if(!ok)throw Error(code);console.log('PASS '+code)}
const init=spawn(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'scripts/desktop/init-db.ts','--initialize'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
check(await new Promise(resolve=>init.on('exit',c=>resolve(c===0))),'init-synthetic-sqlite');
await cp('.next-desktop-agent-check/static','.next-desktop-agent-check/standalone/.next-desktop-agent-check/static',{recursive:true});
const server=spawn(process.execPath,[path.join(root,'.next-desktop-agent-check/standalone/server.js')],{env,windowsHide:true,stdio:'ignore'});
try{
  let ready=false;
  for(let i=0;i<160;i++){if(server.exitCode!==null)throw Error('SERVER_EXIT');try{ready=(await fetch(base+'/api/health/ready')).ok}catch{} if(ready)break; await new Promise(r=>setTimeout(r,300));}
  check(ready,'standalone-readiness');
  const page = await fetch(base+'/setup');
  check(page.status===200,'setup-page');
  const html=await page.text();
  const asset=html.match(/src="([^"]+_next[^"]+\.js[^"]*)"/);
  check(!!asset && (await fetch(new URL(asset[1].replaceAll('&amp;','&'),base))).ok,'standalone-static-assets');
  const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/health/ready',{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)});check(hostStatus===403,'reject-host');
  check((await fetch(base+'/api/health/ready',{headers:{origin:'http://evil.invalid'}})).status===403,'reject-origin-on-read');
  const password=randomBytes(24).toString('hex')+'x9';
  const options=body=>({method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});
  check((await fetch(base+'/api/v1/desktop/setup',{...options({}),headers:{'content-type':'application/json',origin:'http://evil.invalid'}})).status===403,'reject-cross-origin-setup');
  const setup=await fetch(base+'/api/v1/desktop/setup',options({login:'director',displayName:'Synthetic director',password,mode:'demo',dataDirectory:'default',localDiskConfirmed:true}));
  check(setup.ok,'setup-transaction');
  const login=await fetch(base+'/api/v1/auth/login',options({login:'director',password}));
  check(login.ok,'login');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  check(!!cookie && /httponly/i.test(login.headers.get('set-cookie') ?? ''),'http-only-session');
  const clients=await fetch(base+'/api/v1/clients',{headers:{cookie}});
  check(clients.ok,'authenticated-clients');
  check((await fetch(base+'/setup',{redirect:'manual'})).status===307,'setup-closed');
  console.log('SYNTHETIC_STANDALONE_SMOKE_PASS');
}finally{server.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve)})}
