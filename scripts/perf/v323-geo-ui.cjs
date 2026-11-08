const fs=require('node:fs');const cp=require('node:child_process');const {chromium}=require('playwright');const dotenv=require('dotenv');
const env={...process.env,...dotenv.parse(fs.readFileSync('.env')),NEXT_DIST_DIR:'.next-v323-geo',DATABASE_URL:'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo',APP_ORIGIN:'http://127.0.0.1:3381',AI_ENABLED:'false',SCRAPER_ENABLED:'true',SCRAPER_BROWSER_ENABLED:'false',SCRAPER_DEMO_FIXTURES:'false',COOKIE_SECURE:'false',NODE_ENV:'production'};
const origin=env.APP_ORIGIN;const children=[];let browser,page;const evidence={mode:'LIVE',aiCalls:0,scenarios:[],screenshots:[]};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function start(args,name){const out=fs.openSync('geo-'+name+'.log','w');const p=cp.spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore',out,out]});children.push(p);}
async function main(){
 start(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3381'],'server');
 start(['node_modules/tsx/dist/cli.mjs','src/worker/property-search-worker.ts'],'worker');
 browser=await chromium.launch({headless:true,executablePath:'C:/Users/tvery/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 const context=await browser.newContext({viewport:{width:1366,height:768},locale:'ru-RU'});page=await context.newPage();
 // No browser traffic leaves loopback; only bounded worker requests reach the sources.
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(let i=0;i<60;i++){try{if((await context.request.get(origin+'/api/health/ready',{timeout:1000})).ok())break;}catch{}await sleep(1000);}
 const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{Origin:origin},data:{login:env.SEED_MANAGER_LOGIN,password:env.SEED_MANAGER_PASSWORD}});evidence.loginStatus=login.status();if(!login.ok())throw new Error('LOGIN_FAILED');
 fs.mkdirSync('docs/screenshots/vkr/v323-search',{recursive:true});
 for(const scenario of [{id:'office-akademgorodok',location:'Академгородок (Советский район)',purpose:'Офис',area:true},{id:'warehouse-ob',location:'Обь',purpose:'Склад'},{id:'flat-berdsk',location:'Бердск',kind:'flat'}]){
  await page.goto(origin+'/property-search');await page.getByRole('heading',{name:'Поиск объектов',exact:true}).waitFor();
  await page.getByRole('button',{name:scenario.location,exact:true}).click();await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).click();
  await page.locator('label').filter({hasText:/^\s*Операция/}).locator('select').selectOption(scenario.kind?'sale':'rent');
  if(scenario.kind)await page.getByLabel('Тип объекта',{exact:true}).selectOption(scenario.kind);else await page.getByLabel(scenario.purpose,{exact:true}).check();
  if(scenario.area){await page.getByLabel('Площадь от, м²',{exact:true}).fill('50');await page.getByLabel('Площадь до, м²',{exact:true}).fill('100');}
  // Restrict UI searches to Mir Kvartir, one page/five cards, 20s deadline; matrix already probes all sources.
  const sources=['Циан','OnRealt','Домклик','Яндекс Недвижимость','Юла','Авито'];
  for(const label of sources){const box=page.getByLabel(label,{exact:true});if(await box.count()&&await box.isChecked())await box.uncheck();}
  await page.getByLabel('Найти локацию',{exact:true}).scrollIntoViewIfNeeded();
  const file='docs/screenshots/vkr/v323-search/'+scenario.id+'.png';await page.screenshot({path:file});evidence.screenshots.push({file,width:1366,height:768});
  const savedFilters=await page.evaluate(()=>document.body.innerText.includes('Выбрано:'));
  await page.getByRole('button',{name:'Расширенные фильтры',exact:true}).click();
  await page.getByLabel('Страниц на источник',{exact:true}).fill('1');await page.getByLabel('Объявлений на источник',{exact:true}).fill('5');await page.getByLabel('Общий срок, секунд',{exact:true}).fill('20');
  await page.getByRole('button',{name:'Искать',exact:true}).click();
  await page.waitForURL(/runId=/);const runId=new URL(page.url()).searchParams.get('runId');let progress;
  for(let i=0;i<35;i++){const r=await context.request.get(origin+'/api/v1/property-search/runs/'+runId+'/progress');progress=await r.json();if(!['queued','running'].includes(progress.status))break;await sleep(1000);}
  await page.getByText('Состояние источников',{exact:true}).scrollIntoViewIfNeeded();
  const resultsFile='docs/screenshots/vkr/v323-search/'+scenario.id+'-results.png';await page.screenshot({path:resultsFile});evidence.screenshots.push({file:resultsFile,width:1366,height:768});
  evidence.scenarios.push({id:scenario.id,runId,status:progress?.status,sources:progress?.sources});
  await page.getByRole('tab',{name:'Мои поиски',exact:true}).click();await page.getByLabel('Название поиска',{exact:true}).fill('v323 '+scenario.id);await page.getByRole('button',{name:'Сохранить условия',exact:true}).click();await page.getByText('Поиск сохранён',{exact:true}).waitFor();
  const saved=await context.request.get(origin+'/api/v1/property-search/saved-searches');const rows=await saved.json();const entry=rows.find(r=>r.name==='v323 '+scenario.id);evidence.scenarios.push({id:scenario.id,formLocationShown:savedFilters,saved:!!entry,locations:entry?.filters.locations,propertyKinds:entry?.filters.propertyKinds,areaFrom:entry?.filters.areaFrom,areaTo:entry?.filters.areaTo});
  if(entry)await context.request.delete(origin+'/api/v1/property-search/saved-searches/'+entry.id,{headers:{Origin:origin}});
 }
 console.log(JSON.stringify({loginStatus:evidence.loginStatus,scenarios:evidence.scenarios.length,screenshots:evidence.screenshots.length}));
}
main().catch(async e=>{evidence.error=e.message;if(page){evidence.page={url:page.url(),title:await page.title(),headings:await page.locator('h1,h2,[role=alert]').allTextContents()};await page.screenshot({path:'docs/screenshots/vkr/v323-search/diagnostic.png'}).catch(()=>{});}console.log('UI_ERROR '+JSON.stringify(evidence.page)+' '+e.message);process.exitCode=1;}).finally(async()=>{await browser?.close();for(const p of children)if(p.exitCode===null)await new Promise(r=>{const k=cp.spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('exit',r);k.on('error',r);});evidence.processesStopped=true;fs.writeFileSync('docs/vkr/v323-geo-ui.json',JSON.stringify(evidence,null,2)+'\n');});
