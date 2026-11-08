import { config } from 'dotenv';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
config({path:'.env',quiet:true});
// Run only against the coordinator's synthetic demo servers. Creates one request, task and offer per server.
const output='docs/ux/v322-click-measurements.json';
const manifests={before:JSON.parse(await readFile('docs/screenshots/vkr/v322-ux/before/manifest.json','utf8')),after:JSON.parse(await readFile('docs/screenshots/vkr/v322-ux/after/manifest.json','utf8'))};
const results=[];
const browser=await chromium.launch({headless:true});
const only=process.argv[2];
try {
for(const [phase,port,revision] of [['before',3370,'6ee543c'],['after',3371,'d881253']]){
 const baseURL=`http://127.0.0.1:${port}`;
 for(const role of ['REALTOR1','MANAGER']){
 const context=await browser.newContext({baseURL,viewport:{width:1366,height:768},locale:'ru-RU'});
 try{
 const login=await context.request.post('/api/v1/auth/login',{headers:{origin:baseURL},data:{login:process.env[`SEED_${role}_LOGIN`],password:process.env[`SEED_${role}_PASSWORD`]}});
 if(!login.ok() || (await login.json()).mustChangePassword)throw Error(`Вход не готов: ${phase}/${role}`);
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('dialog',d=>d.accept());
 const path=name=>manifests[phase].screenshots.find(x=>x.role===role && x.file===`${role.toLowerCase()}-${name}-1366x768.png`)?.path;
 const go=async url=>{await page.goto(url,{waitUntil:'networkidle'});await expect(page.locator('h1').first()).toBeVisible();};
 async function scenario(id,start,fn){
 if(only && only!==id)return;
 const steps=[];const click=async(locator,label)=>{await locator.click();steps.push(label);};
 try{await go(start);const evidence=await fn(click);results.push({phase,revision,role,scenario:id,start,clicks:steps.length,steps,status:'PASS',finalPath:new URL(page.url()).pathname+new URL(page.url()).search,evidence});console.log(`${phase} ${id}: ${steps.length} PASS`);}
 catch(e){results.push({phase,revision,role,scenario:id,start,clicks:steps.length,steps,status:'FAIL',error:String(e.message).slice(0,800)});await mkdir('data/v322-ux/inspect',{recursive:true});await writeFile(`data/v322-ux/inspect/${phase}-${id}-failure.txt`,await page.locator('body').innerText());console.log(`${phase} ${id}: FAIL (${steps.length})`);}
 }
 const save=async(click,locator,label,api,method)=>{
 const response=page.waitForResponse(r=>new URL(r.url()).pathname===api && r.request().method()===method);
 await click(locator,label);const r=await response;expect(r.ok()).toBeTruthy();return {api,method,http:r.status()};};
 if(role==='REALTOR1'){
 await scenario('1','/today',async click=>{
 await click(page.getByRole('button',{name:'Записать звонок',exact:true}),'Записать звонок');
 const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Записать звонок',exact:true})});
 await expect(dialog.getByLabel('Источник',{exact:false})).toBeVisible();
 await click(dialog.getByText('Новый клиент',{exact:true}),'Новый клиент');
 const prospective=dialog.getByText('Перспективное — Новая потребность',{exact:true});
 await click(prospective,'Перспективное — Новая потребность');
 await dialog.getByLabel('Имя / наименование',{exact:false}).fill(`СИНТЕТИКА UX ${phase} ${Date.now()}`);
 await dialog.getByPlaceholder('+7 900 000-00-00').fill(`+7 999 ${String(Date.now()).slice(-7)}`);
 await dialog.getByLabel('Источник',{exact:false}).selectOption('recommendation');
 await dialog.getByLabel('Операция',{exact:false}).selectOption('buy');
 await dialog.getByLabel('Тип недвижимости',{exact:false}).selectOption('residential');
 await dialog.getByLabel('Что сделать',{exact:false}).fill('СИНТЕТИКА UX · уточнить бюджет');
 const e=await save(click,dialog.getByRole('button',{name:'Зарегистрировать обращение',exact:true}),'Зарегистрировать обращение','/api/v1/requests','POST');
 await expect(dialog.getByText('Обращение зарегистрировано.',{exact:true})).toBeVisible();return {...e,nextActionConfirmed:await dialog.getByText(/создана потребность со следующим действием/).count()>0};
 });
 const clientPath=path('client-detail');
 await go(clientPath);const clientName=await page.locator('h1').innerText();
 await scenario('2a','/clients',async click=>{
 await page.locator('input[name=q]').fill(clientName);
 await click(page.getByRole('button',{name:'Применить',exact:true}),'Применить поиск клиента');await page.waitForLoadState('networkidle');
 if(phase==='before'){await click(page.locator(`a[href="${clientPath}"]`).filter({hasText:clientName}).first(),'Карточка клиента');await page.waitForLoadState('networkidle');await click(page.getByRole('link',{name:'История',exact:true}),'История');}
 else await click(page.locator(`a[href="${clientPath}?tab=history"]`).first(),'История из строки клиента');
 await expect(page.getByRole('heading',{name:'История клиента',exact:true})).toBeVisible();return {heading:'История клиента'};
 });
 await scenario('2b',`/clients?q=${encodeURIComponent(clientName)}`,async click=>{
 if(phase==='before'){await click(page.locator(`a[href="${clientPath}"]`).filter({hasText:clientName}).first(),'Карточка клиента');await page.waitForLoadState('networkidle');await click(page.getByRole('link',{name:/^Потребности/}).filter({has:page.locator('span')}).first(),'Потребности клиента');}
 else await click(page.locator(`a[href="${clientPath}?tab=needs"]`).first(),'Потребности из строки клиента');
 await page.waitForLoadState('networkidle');
 const needLink=page.locator('main table a[href^="/needs/"]').first();const needPath=await needLink.getAttribute('href');
 await click(needLink,'Открыть потребность');await page.waitForLoadState('networkidle');
 await click(page.getByRole('link',{name:'Изменить параметры',exact:true}),'Изменить параметры');await page.waitForLoadState('networkidle');
 const input=page.getByLabel('Район',{exact:true});await input.fill(await input.inputValue());
 const e=await save(click,page.getByRole('button',{name:'Сохранить',exact:true}),'Сохранить параметры',`/api/v1${needPath}`,'PATCH');
 await expect(page).toHaveURL(new RegExp(`${needPath}$`));return e;
 });
 await scenario('4',path('collection-detail'),async click=>{
 const select=page.getByLabel('Потребность для предложения',{exact:true});const need=await select.locator('option').nth(1).getAttribute('value');await select.selectOption(need);
 const card=page.locator('article').filter({has:page.locator('a[href^="/properties/"]')}).first();
 await click(card.getByRole('checkbox'),'Отметить один объект каталога');
 const collectionPath=new URL(page.url()).pathname;
 const e=await save(click,page.getByRole('button',{name:'Создать КП из выбранных',exact:true}),'Создать КП из выбранных',`/api/v1${collectionPath}/offer`,'POST');
 await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}$/);return {...e,selectedObjects:1};
 });
 await scenario('5a','/tasks',async click=>{
 await click(page.getByRole('link',{name:'+ Новая задача',exact:true}).first(),'Новая задача');await page.waitForLoadState('networkidle');
 await page.getByLabel('Что сделать',{exact:false}).fill(`СИНТЕТИКА UX ${phase} · контрольный звонок`);
 const e=await save(click,page.getByRole('button',{name:'Создать задачу',exact:true}),'Создать задачу','/api/v1/tasks','POST');
 await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);return e;
 });
 await scenario('5b','/tasks',async click=>{
 const row=page.locator('main tbody tr').filter({hasText:`СИНТЕТИКА UX ${phase} · контрольный звонок`}).filter({has:page.getByRole('button',{name:'Перенести',exact:true})}).first();
 const taskPath=await row.locator('a[href^="/tasks/"]').first().getAttribute('href');
 await click(row.getByRole('button',{name:'Перенести',exact:true}),'Перенести из строки задачи');
 const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Перенос срока',exact:true})});
 const input=dialog.locator('input[type="datetime-local"]');const original=await input.inputValue();
 const shifted=new Date(`${original}Z`);shifted.setUTCHours(shifted.getUTCHours()+1);const next=shifted.toISOString().slice(0,16);await input.fill(next);
 const e=await save(click,dialog.getByRole('button',{name:'Перенести',exact:true}),'Подтвердить перенос',`/api/v1${taskPath}`,'PATCH');
 await expect(dialog).not.toBeVisible();const saved=await (await context.request.get(`/api/v1${taskPath}`)).json();return {...e,originalLocalDeadline:original,newLocalDeadline:next,savedDeadline:saved.dueAt,syntheticTask:true};
 });
 await scenario('7','/advertisements',async click=>{
 await click(page.getByRole('link',{name:'Истекают (14 дн.)',exact:true}),'Истекающая реклама');await expect(page).toHaveURL(/view=expiring/);return {query:new URL(page.url()).search};
 });
 }else{
 await scenario('8','/reports',async click=>{
 if(phase==='before'){await click(page.locator('aside').getByRole('link',{name:'Задачи',exact:true}),'Задачи в меню');await page.waitForLoadState('networkidle');await click(page.getByRole('navigation',{name:'Режим списка задач'}).getByRole('link',{name:'Все',exact:true}),'Все задачи');}
 else await click(page.getByRole('link',{name:'Задачи сотрудников',exact:true}),'Задачи сотрудников');
 await expect(page).toHaveURL(/\/tasks\?view=all$/);return {heading:await page.locator('h1').innerText()};
 });
 }
 }finally{await context.request.post('/api/v1/auth/logout',{headers:{origin:baseURL}}).catch(()=>{});await context.close();}
 }
}
}finally{await browser.close();await writeFile(output,JSON.stringify({measuredAt:new Date().toISOString(),viewport:{width:1366,height:768},method:'Только переходы, раскрытия, выбор результата, отметки объектов и команды сохранения. Ввод и selectOption не считаются. Сохранения отправлены реальному API синтетической CRM; Параметры существующей потребности сохраняются без изменения значений; новая синтетическая задача реально переносится на час.',results},null,2)+'\n');}
if(results.some(x=>x.status!=='PASS'))process.exitCode=1;
