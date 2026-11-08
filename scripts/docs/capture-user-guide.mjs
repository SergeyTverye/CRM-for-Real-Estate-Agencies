import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:3373';
const out='docs/user-guide/v3.2.2/images';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const manifest=[];
try {
for(const role of ['REALTOR1','MANAGER']) {
 const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:900},deviceScaleFactor:2});
 await context.route('**/*',route=>{const r=route.request(); if(new URL(r.url()).origin!==base || !['GET','HEAD'].includes(r.method())) return route.abort(); return route.continue();});
 if(role==='REALTOR1') {
  const login=await context.newPage(); await login.goto('/login',{waitUntil:'networkidle'});
  await login.screenshot({path:`${out}/login-raw.png`,animations:'disabled'}); await login.close();
 }
 const auth=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env[`SEED_${role}_LOGIN`],password:process.env[`SEED_${role}_PASSWORD`]}});
 if(!auth.ok()) throw Error(`Login ${role}: ${auth.status()}`);
 if((await auth.json()).mustChangePassword) throw Error('Demo password change required');
 const page=await context.newPage();
 const screens=role==='REALTOR1' ? [['today','/today'],['clients','/clients'],['client-new','/clients/new'],['request-new','/requests/new'],['needs','/needs'],['need-new','/needs/new'],['search','/property-search'],['collections','/collections'],['offers','/offers'],['offer-new','/offers/new'],['tasks','/tasks'],['task-new','/tasks/new'],['calendar','/calendar'],['notifications','/notifications'],['agreements','/agreements'],['agreement-new','/agreements/new']] : [['import','/import'],['reports','/reports']];
 for(const [kind,path] of [['client','/clients'],['need','/needs'],['offer','/offers'],['collection','/collections']]) {
 if(role==='MANAGER') break;
 await page.goto(path,{waitUntil:'networkidle'});
 const link=await page.locator('a[href]').evaluateAll((els,p)=>els.map(e=>e.getAttribute('href')).find(h=>new RegExp('^'+p+'/[a-f0-9-]{36}$','i').test(h)),path);
 if(link) screens.push([kind+'-detail',link]);
 }
 for(const [name,path] of screens) {
 const res=await page.goto(path,{waitUntil:'networkidle',timeout:60000});
 if(!res.ok()) throw Error(`${name} HTTP ${res.status()}`);
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${out}/${name}-raw.png`,fullPage:false,animations:'disabled'});
 await writeFile(`tmp/pdfs/guide/${name}-ui.txt`,await page.locator('body').innerText());
 manifest.push({name,path,role,viewport:'1440x900',deviceScaleFactor:2,capturedAt:new Date().toISOString()});
 if(name==='agreement-new') {
  const picker=page.locator('input[type=file]').first();
  if(await picker.count()) {
   await picker.setInputFiles([{name:'Пример договор.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic guide example only\n%%EOF')},{name:'Пример приложение.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic attachment only\n%%EOF')}]);
   await page.getByText('Документы договора',{exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`${out}/agreement-files-raw.png`,animations:'disabled'});
   await writeFile('tmp/pdfs/guide/agreement-files-ui.txt',await page.locator('body').innerText());
  }
 }
 if(name==='search') {
 const saved=page.getByRole('tab',{name:'Мои поиски',exact:true});
 if(await saved.count()) {await saved.click(); await page.screenshot({path:`${out}/saved-searches-raw.png`,animations:'disabled'}); await writeFile('tmp/pdfs/guide/saved-searches-ui.txt',await page.locator('body').innerText());}
 }
 }
 await context.request.post('/api/v1/auth/logout',{headers:{origin:base}});
 await context.close();
}
} finally {await browser.close(); await writeFile(`${out}/capture-manifest.json`,JSON.stringify(manifest,null,2));}
console.log(`Captured ${manifest.length} screens; no external or AI requests.`);
