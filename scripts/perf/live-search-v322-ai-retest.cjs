// Bounded LIVE operator harness. Secrets stay in process memory; never persist auth state.
const fs = require('node:fs/promises');
const cp = require('node:child_process');
const { chromium } = require('playwright');
const readline = require('node:readline');
const root = process.cwd();
const origin = 'http://127.0.0.1:3374';
const env = {...process.env, NEXT_DIST_DIR:'.next-v322-rc2', DATABASE_URL:'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo', APP_ORIGIN:origin, AI_ENABLED:'true', SCRAPER_ENABLED:'true', SCRAPER_DEMO_FIXTURES:'false', COOKIE_SECURE:'false', CRM_DEPLOYMENT_MODE:'server', NODE_ENV:'production'};
const evidence = {mode:'LIVE', startedAt:new Date().toISOString(), scenarios:[], screenshots:[], defects:[]};
let attemptedPaidCalls=0; let children=[], logs=[], browser, context, page, originalSettings, baseline, filters, runs=[];
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const clean = s=>{for(const [k,v] of Object.entries(env))if(v && v.length >= 8 && /KEY|SECRET|PASSWORD|TOKEN/.test(k))s=s.split(v).join('[REDACTED]');return s;};
const print = x=>console.log(clean(JSON.stringify(x)));
async function stop(){for(const child of children)if(child.exitCode===null)await new Promise(resolve=>{const p=cp.spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('exit',resolve);p.on('error',resolve);});children=[];}
async function start(mode='live'){
 const e={...env};if(mode==='unavailable')throw new Error('LIVE provider failure disabled');if(mode==='missing')e.YANDEX_CLOUD_API_KEY='';
 for(const args of [['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3374'],['node_modules/tsx/dist/cli.mjs','src/worker/property-search-worker.ts']]){
  const p=cp.spawn(process.execPath,args,{cwd:root,env:e,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(p);for(const out of [p.stdout,p.stderr])out.on('data',d=>logs.push(clean(d.toString())));
 }
 for(let i=0;i<30;i++){try{const r=await context.request.get(origin+'/api/health/ready',{timeout:2000});if(r.ok())return {ready:true,pids:children.map(p=>p.pid)};}catch{}await sleep(500);}
 return {ready:false,pids:children.map(p=>p.pid),logs:logs.slice(-5)};
}
async function api(method,path,data){if(method==='POST' && /analysis\/(parse|compare|rank|batch|collection-text)$/.test(path)){const u=await usage();if(++attemptedPaidCalls>10 || (baseline && Number(u.committedRub)-Number(baseline.committedRub)>2.0))throw new Error('Operator budget gate: no dispatch');}const t=Date.now();const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin},...(data?{data}:{}),timeout:120000});const body=await r.json().catch(()=>({nonJson:true}));return {status:r.status(),ms:Date.now()-t,body};}
async function usage(){return (await api('GET','/api/v1/ai/usage')).body;}
async function setting(changes){const got=await api('GET','/api/v1/settings/ai');const s=got.body.setting;const keys=['aiEnabled','scraperEnabled','browserEnabled','enabledSources','webSearchManualAllowed','webSearchAutoFallback','model','webModel','searchContextSize','perUserDailyLimit','perJobLimit','dailyLimit','monthlyBudgetRub'];const data=Object.fromEntries(keys.map(k=>[k,s[k]]));return api('PUT','/api/v1/settings/ai',{...data,...changes,expectedUpdatedAt:s.updatedAt});}
async function shot(name,selector){if(selector)await page.locator(selector).first().scrollIntoViewIfNeeded();await sleep(600);const file='docs/screenshots/vkr/v322-search-ai/'+name+'.png';await fs.mkdir(root+'/docs/screenshots/vkr/v322-search-ai',{recursive:true});await page.screenshot({path:root+'/'+file});evidence.screenshots.push({file,width:1366,height:768,capturedAt:new Date().toISOString(),url:page.url()});return file;}
async function search(name,f,sources){const before=await usage(),t=Date.now();const created=await api('POST','/api/v1/property-search/runs',{filters:{...f,sources},sources,idempotencyKey:require('node:crypto').randomUUID(),depth:{maxPages:1,limit:5},deadlineMs:55000,confirmedPaid:false});if(created.status!==200)return {name,created};const id=created.body.id;let progress;for(let i=0;i<70;i++){progress=await api('GET',`/api/v1/property-search/runs/${id}/progress`);if(!['queued','running'].includes(progress.body.status))break;await sleep(1000);}const results=await api('GET',`/api/v1/property-search/runs/${id}/results?pageSize=200`);const after=await usage();const item={name,id,startedAt:new Date(t).toISOString(),elapsedMs:Date.now()-t,filters:f,sources,progress:progress.body,results:results.body,aiUsageBefore:before,aiUsageAfter:after};runs.push(item);evidence.scenarios.push(item);return {name,id,elapsedMs:item.elapsedMs,status:progress.body.status,total:results.body.total,counts:results.body.counts,sources:progress.body.sources,spendDeltaRub:Number(after.committedRub)-Number(before.committedRub)};}
async function save(){await fs.mkdir(root+'/docs/vkr',{recursive:true});evidence.updatedAt=new Date().toISOString();const dest=root+'/docs/vkr/live-search-v322-ai.json'; const previous=JSON.parse(await fs.readFile(dest,'utf8'));previous.retest=evidence;await fs.writeFile(dest,clean(JSON.stringify(previous,null,2))+'\n');}
async function main(){browser=await chromium.launch({headless:true,executablePath:'C:/Users/tvery/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe'});context=await browser.newContext({viewport:{width:1366,height:768},locale:'ru-RU'});page=await context.newPage();print(await start());const login=await api('POST','/api/v1/auth/login',{login:env.SEED_MANAGER_LOGIN,password:env.SEED_MANAGER_PASSWORD});print({loginStatus:login.status});originalSettings=(await api('GET','/api/v1/settings/ai')).body;baseline=await usage();evidence.baselineUsage=baseline;print({settings:originalSettings,baseline,availability:await api('GET','/api/v1/property-search/availability')});
 const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:false});for await(const line of rl){if(line==='EXIT')break;try{print(await eval('(async()=>{'+line+'})()'));await save();}catch(e){print({error:clean(e.message)});}}
}
main().catch(e=>print({fatal:clean(e.message)})).finally(async()=>{await stop();await context?.request.dispose();await browser?.close();evidence.processesStoppedAt=new Date().toISOString();await save();});
