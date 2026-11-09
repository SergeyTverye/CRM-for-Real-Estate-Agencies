// Authorized bounded LIVE harness. No auth state, contacts or provider payloads persisted.
const fs=require('node:fs/promises'), cp=require('node:child_process'), {randomUUID}=require('node:crypto');
const {chromium}=require('playwright'),{Client}=require('pg');
require('dotenv').config({quiet:true});
const origin='http://127.0.0.1:3386',sources=['cian','mirkvartir','onrealt','domclick','yandex','youla','avito'];
const env={...process.env,NEXT_DIST_DIR:'.next-v323-quality',DATABASE_URL:'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo',APP_ORIGIN:origin,CRM_DEPLOYMENT_MODE:'server',NODE_ENV:'production',AI_ENABLED:'true',SCRAPER_ENABLED:'true',SCRAPER_BROWSER_ENABLED:'true',SCRAPER_DEMO_FIXTURES:'false',COOKIE_SECURE:'false',LOG_LEVEL:'warn',SCRAPER_CHROME_PATH:chromium.executablePath(),SCRAPER_BROWSER_EXECUTABLE_PATH:chromium.executablePath(),BROWSER_SESSION_ALLOWED_SOURCES:'cian,yandex'};
let children=[],browser,context,page,old,paid=0,baseline,client;
let evidence={mode:'LIVE',startedAt:new Date().toISOString(),database:'crm_demo',origin,scenarios:[],ai:[],screenshots:[],defects:[],limits:{rub:1,calls:3,depth:{maxPages:1,limit:5}},checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const print=x=>console.log(JSON.stringify(x));
async function api(method,path,data){
 if(method==='POST'&&/analysis\/(parse|rank)$/.test(path)){const u=await usage();if(paid>=3||Number(u.committedRub)-Number(baseline.committedRub)>0.7)throw Error('OPERATOR_BUDGET_GATE');paid++;}
 const t=Date.now(),r=await context.request.fetch(origin+path,{method,headers:{Origin:origin},...(data===undefined?{}:{data}),timeout:120000});
 return {status:r.status(),ms:Date.now()-t,body:await r.json().catch(()=>({nonJson:true}))};
}
async function usage(){return (await api('GET','/api/v1/ai/usage')).body;}
async function save(){evidence.updatedAt=new Date().toISOString();await fs.writeFile('docs/vkr/live-search-v323-quality.json',JSON.stringify(evidence,null,2)+'\n');}
async function shot(name,locator){if(locator)await locator.scrollIntoViewIfNeeded();await sleep(500);const file='docs/screenshots/vkr/v323-search/'+name+'.png';await page.screenshot({path:file});evidence.screenshots.push({file,width:1366,height:768,deviceScaleFactor:2,mode:'LIVE'});return file;}
async function start(args,name){const p=cp.spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(p);let text='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{text+=d.toString();});p.on('exit',()=>{if(p.exitCode)print({process:name,exit:p.exitCode,message:text.split('\n').filter(l=>/Error|Could not|EADDR|production build/.test(l)).map(l=>l.replace(/https?:\/\/[^ ]+/g,'[URL]')).join(' ').slice(0,300)});});}
const scenarios=[
 {id:'a',name:'Офис 50–100 м² аренда, Академгородок',loc:['Академгородок (Советский район)'],purpose:'Офис',op:'rent',areaFrom:50,areaTo:100},
 {id:'b',name:'Двухкомнатная квартира продажа до 5 млн, Бердск',loc:['Бердск'],kind:'flat',op:'sale',priceTo:5000000},
 {id:'c',name:'Склад от 300 м² аренда, Обь + Новосибирск',loc:['Обь','Новосибирск'],purpose:'Склад',op:'rent',areaFrom:300},
 {id:'d',name:'Квартира аренда, Кольцово',loc:['Кольцово'],kind:'flat',op:'rent'},
 {id:'e',name:'Дом/коттедж продажа, Новосибирская область',loc:['Новосибирская область целиком'],kind:'house',op:'sale'},
 {id:'f',name:'Апартаменты продажа, Новосибирск',loc:['Новосибирск'],kind:'apartments',op:'sale'},
 {id:'g',name:'Любое нежилое до 50 000/мес, Новосибирск и пригороды',loc:['Новосибирск и пригороды'],kind:'non_residential',op:'rent',priceTo:50000},
];
async function form(s){
 await page.goto(origin+'/property-search');await page.getByRole('heading',{name:'Поиск объектов',exact:true}).waitFor();
 for(const l of s.loc)if(!await page.getByRole('button',{name:l+' ✓',exact:true}).count())await page.getByRole('button',{name:l,exact:true}).click();
 if(!s.loc.includes('Новосибирск')&&await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).count())await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).click();
 await page.locator('label').filter({hasText:/^\s*Операция/}).locator('select').selectOption(s.op);
 if(s.kind)await page.getByLabel('Тип объекта',{exact:true}).selectOption(s.kind);
 if(s.rooms)await page.getByLabel(s.rooms,{exact:true}).check();
 if(s.purpose)await page.getByLabel(s.purpose,{exact:true}).check();
 for(const [key,label]of [['priceTo','Цена до'],['areaFrom','Площадь от, м²'],['areaTo','Площадь до, м²']])if(s[key])await page.getByLabel(label,{exact:true}).fill(String(s[key]));
 await page.getByRole('button',{name:'Расширенные фильтры',exact:true}).click();
 await page.getByLabel('Страниц на источник',{exact:true}).fill('1');await page.getByLabel('Объявлений на источник',{exact:true}).fill('5');await page.getByLabel('Общий срок, секунд',{exact:true}).fill('120');
}
async function waitRun(id){let p;for(let i=0;i<145;i++){p=(await api('GET',`/api/v1/property-search/runs/${id}/progress`)).body;if(!['running','queued'].includes(p.status))return p;await sleep(1000);}await api('POST',`/api/v1/property-search/runs/${id}/cancel`,{});return p;}
async function run(index){const s=scenarios[index],t=Date.now();await form(s);
 if(s.rooms)await shot('quality-room-filter',page.getByRole('group',{name:'Комнаты · любое из выбранных'}));
 const response=page.waitForResponse(r=>r.url()===origin+'/api/v1/property-search/runs'&&r.request().method()==='POST',{timeout:60000}); response.catch(()=>{});
 await page.getByRole('button',{name:'Искать',exact:true}).click();await page.getByRole('button',{name:'Подтверждаю запуск',exact:true}).click();
 const r=await response;const created=await r.json();if(!r.ok())throw Error('SEARCH_CREATE_'+r.status());const progress=await waitRun(created.id);
 const result=(await api('GET',`/api/v1/property-search/runs/${created.id}/results?pageSize=200`)).body;
 const samples=(result.rows??[]).slice(0,12).map(r=>({listingId:r.listingId,source:r.source,verdict:r.verdict,title:r.snapshot?.title,city:r.snapshot?.city,address:r.snapshot?.address,price:r.snapshot?.price,priceUnit:r.snapshot?.priceUnit,area:r.snapshot?.area,criteria:r.criteria?.map(c=>({...c,evidence:String(c.evidence).replace(/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}/giu,"[email]").replace(/(?:\+?\d[\s().-]*){10,15}/gu,"[телефон]")}))}));
 if(s.rooms){await page.getByRole('tab',{name:/Совпадения/}).click();await sleep(1500);await shot('quality-room-results',page.getByRole('tablist',{name:'Статусы результатов'}));}
 const item={id:s.id,name:s.name,runId:created.id,elapsedMs:Date.now()-t,filters:created.filters,status:progress.status,total:result.total,counts:result.counts,sources:progress.sources.map(x=>({source:x.source,status:x.status,resultCount:x.resultCount,reason:x.statusReasonRu,needsUserAction:x.needsUserAction,depthReached:x.depthReached,durationMs:x.durationMs})),samples};
 evidence.scenarios.push(item);await save();return item;
}
async function parse(text){await page.goto(origin+'/property-search');await page.getByRole('button',{name:'Расширенные фильтры',exact:true}).click();await page.getByLabel('Запрос или уточнение',{exact:true}).fill(text);
 const rp=page.waitForResponse(r=>r.url().endsWith('/analysis/parse')&&r.request().method()==='POST',{timeout:120000}); rp.catch(()=>{});if(paid>=3)throw Error('CALL_CEILING');paid++;
 await page.getByRole('button',{name:'Разобрать и показать изменения',exact:true}).click();const r=await rp,b=await r.json();
 const item={text,status:r.status(),filters:b.filters,clarificationQuestion:b.clarificationQuestion,diff:b.diff,cost:b.costRub};evidence.ai.push(item);await save();return item;}
async function main(){if(process.env.V323_RESUME==='true'){evidence=JSON.parse(await fs.readFile('docs/vkr/live-search-v323-quality.json','utf8'));paid=evidence.usage?.attemptedPaidCalls??evidence.ai.length+(evidence.ranking?1:0)+(evidence.retests?.length??0);delete evidence.processesStopped;delete evidence.settingsRestored;}client=new Client({connectionString:env.DATABASE_URL});await client.connect();
 old=(await client.query('select * from ai_settings limit 1')).rows[0];if(!old)throw Error('SETTINGS_MISSING'); await fs.writeFile('data/v323-quality-settings-original.json',JSON.stringify(old));
 const now=new Date(),month=now.toISOString().slice(0,7),day=now.toISOString().slice(0,10);
 const rows=(await client.query('select result,actual_cost_rub,estimated_cost_rub,created_at from ai_usage_logs')).rows;
 const committed=rows.reduce((n,r)=>n+BigInt(r.result?.chargedMicros??Math.ceil(Number(r.actual_cost_rub??r.estimated_cost_rub??0)*1000000)),0n);
 const budget=process.env.V323_RESUME==='true'?evidence.limits.monthlyCeilingRub:(Number(committed/10000n)/100+1).toFixed(2);env.YANDEX_AI_MAX_MONTHLY_COST_RUB=budget;env.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR='100';
 const dayCalls=rows.filter(r=>Date.now()-new Date(r.created_at).getTime()<86400000).length; const dayCeiling=process.env.V323_RESUME==='true'?evidence.limits.dailyCeilingCalls:dayCalls+3; void day; void month;
 await client.query('update ai_settings set ai_enabled=true,scraper_enabled=true,browser_enabled=true,cian_auto_browser=true,yandex_auto_browser=true,enabled_sources=$1,web_search_manual_allowed=false,web_search_auto_fallback=false,monthly_budget_rub=$2,daily_limit=$3,per_user_daily_limit=$3,per_job_limit=2 where id=$4',[sources,budget,dayCeiling,old.id]);
 evidence.limits.monthlyCeilingRub=budget;evidence.limits.dailyCeilingCalls=dayCeiling;
 await start(['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3386'],'server');
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:2,locale:'ru-RU'});page=await context.newPage();page.on("dialog",dialog=>dialog.type()==="beforeunload"?dialog.accept():dialog.dismiss());
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(let i=0;i<90;i++){try{if((await context.request.get(origin+'/api/health/ready',{timeout:1000})).ok())break;}catch{}await sleep(1000);}
 const login=await api('POST','/api/v1/auth/login',{login:env.SEED_MANAGER_LOGIN,password:env.SEED_MANAGER_PASSWORD});evidence.loginStatus=login.status;if(login.status!==200)throw Error('LOGIN_FAILED');const currentUsage=await usage();baseline=process.env.V323_RESUME==='true'?{committedRub:evidence.baseline.committedRub,total:evidence.baseline.totalCalls}:currentUsage;evidence.baseline={committedRub:baseline.committedRub,totalCalls:baseline.total}; const exactBudget=process.env.V323_RESUME==='true'?evidence.limits.monthlyCeilingRub:(Math.floor(Number(baseline.committedRub)*100)/100+1).toFixed(2); await client.query('update ai_settings set monthly_budget_rub=$1 where id=$2',[exactBudget,old.id]); evidence.limits.monthlyCeilingRub=exactBudget;
 await start(['node_modules/tsx/dist/cli.mjs','src/worker/property-search-worker.ts'],'worker');
 await fs.mkdir('docs/screenshots/vkr/v323-search',{recursive:true});await save();print({ready:true,loginStatus:login.status,budget,dayCeiling});
 await page.goto(origin+'/property-search');await page.getByRole('button',{name:'Бердск',exact:true}).click();
 if(await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).count())throw Error('IMPLICIT_CITY_NOT_REPLACED');
 await page.goto(origin+'/property-search');await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).click();await page.getByRole('button',{name:'Бердск',exact:true}).click();
 if(!await page.getByRole('button',{name:'Новосибирск ✓',exact:true}).count())throw Error('EXPLICIT_CITY_WAS_REPLACED');
 evidence.checks.push({name:'implicit city replaced; explicitly clicked city retained',passed:true});
 scenarios.push({...scenarios[1],id:'b_rooms',name:'Двухкомнатная в Бердске до 5 млн · rooms=2',rooms:'2'});
 for(let i=0;i<scenarios.length;i++){if(evidence.scenarios.some(x=>x.id===scenarios[i].id))continue;const item=await run(i);print({scenario:item.id,status:item.status,total:item.total,counts:item.counts,ms:item.elapsedMs});}
 if(evidence.ai.length===0){
 const parsed=await parse('Двушка в Бердске до 5 млн');
 if(parsed.status!==200||!parsed.filters?.rooms?.includes('2'))throw Error('AI_ROOMS_NOT_APPLIED');
 await page.getByRole('button',{name:'Подтвердить условия',exact:true}).click();
 await page.getByLabel('2',{exact:true}).waitFor();
 evidence.ai[0].confirmedRooms=await page.getByLabel('2',{exact:true}).isChecked();
 await shot('quality-ai-rooms',page.getByRole('group',{name:'Комнаты · любое из выбранных'}));
 await save();
 }
}
main().catch(e=>{evidence.error=e.code??e.message;print({fatal:e.code??e.message});process.exitCode=1;}).finally(async()=>{
 if(context&&baseline){try{const u=await usage();evidence.usage={attemptedPaidCalls:paid,committedDeltaRub:Number((Number(u.committedRub)-Number(baseline.committedRub)).toFixed(6)),totalCallsDelta:u.total-baseline.total};}catch{}}
 await browser?.close();for(const p of children.reverse())if(p.exitCode===null)await new Promise(r=>{const k=cp.spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('exit',r);k.on('error',r);});
 if(old){const keys=['ai_enabled','scraper_enabled','browser_enabled','cian_auto_browser','yandex_auto_browser','enabled_sources','web_search_manual_allowed','web_search_auto_fallback','monthly_budget_rub','daily_limit','per_user_daily_limit','per_job_limit'];await client.query(`update ai_settings set ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} where id=$${keys.length+1}`,[...keys.map(k=>old[k]),old.id]);evidence.settingsRestored=true;}
 await client?.end();evidence.processesStopped=true;await save();
});
