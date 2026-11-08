import { config } from "dotenv";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { db, disconnectDb } from "../../src/shared/db/client";
import { assembleScreenContext } from "../../src/modules/ai-chat/application/screen-context";
import { redactScreenData } from "../../src/modules/ai-chat/application/tools";
import { instructions, chatTools } from "../../src/modules/ai-chat/domain/policy";
import type { Actor } from "../../src/modules/auth/domain/actor";
import type { ChatContext } from "../../src/modules/ai-chat/domain/context";
config({path:[".env.local",".env"],quiet:true});
Object.assign(process.env,{DATABASE_URL:"postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo",AI_ENABLED:"false"});
const base="http://127.0.0.1:3382";
async function main(){
 const u=await db.user.findFirstOrThrow({where:{login:"manager"}});
 const actor:Actor={userId:u.id,login:u.login,displayName:u.displayName,role:"manager",mustChangePassword:false,sessionId:u.id};
 console.log("Selecting synthetic client with linked task");
 const c=await db.client.findFirstOrThrow({where:{notes:{contains:"[DEMO-V241]"},needs:{some:{taskLinks:{some:{}}}}},select:{id:true},orderBy:{id:"asc"}});
 const n=await db.clientNeed.findFirstOrThrow({where:{clientId:c.id,taskLinks:{some:{}}},select:{id:true}});
 const t=await db.task.findFirstOrThrow({where:{needLinks:{some:{clientNeedId:n.id}}},select:{id:true}});
 console.log("Selecting synthetic deal");
 const d=await db.deal.findFirstOrThrow({
  where:{parties:{some:{client:{notes:{contains:"[DEMO-V241]"}}},every:{OR:[{clientId:null},{client:{notes:{contains:"[DEMO-V241]"}}}]}}},
  select:{id:true},orderBy:{id:"asc"}
 });
 console.log("Selecting synthetic agreement");
 const a=await db.agreement.findFirstOrThrow({where:{OR:[{client:{notes:{contains:"[DEMO-V241]"}}},{property:{description:{contains:"Синтетическая демонстрационная карточка"}}}]},select:{id:true}});
 console.log("Assembling seven offline contexts");
 const screens:{context:ChatContext;path:string;reply:string}[]=[
  {context:{kind:"client",id:c.id},path:`/clients/${c.id}`,reply:"DEMO / fake-провайдер. Следующее действие: уточните бюджет и согласуйте время контакта. Проверьте связанные открытые задачи. Черновик сообщения: «Здравствуйте! Подскажите, актуальны ли параметры и когда удобно обсудить следующий шаг?» Сообщение не отправлено."},
  {context:{kind:"need",id:n.id},path:`/needs/${n.id}`,reply:"DEMO / fake-провайдер. Уточните требования к площади и бюджету. Проверьте текущее следующее действие и историю показов; согласуйте срок нового контакта перед созданием задачи."},
  {context:{kind:"task",id:t.id},path:`/tasks/${t.id}`,reply:"DEMO / fake-провайдер. Откройте связанную потребность и проверьте срок. Зафиксируйте результат контакта, затем назначьте следующий шаг. Создание задачи требует заполнения формы и сохранения сотрудником."},
  {context:{kind:"deal",id:d.id},path:`/deals/${d.id}`,reply:"DEMO / fake-провайдер. Проверьте незавершённые пункты чек-листа, ответственных и контрольные даты. Уточните готовность документов у участников сделки. Изменения не выполнены."},
  {context:{kind:"agreement",id:a.id},path:`/agreements/${a.id}`,reply:"DEMO / fake-провайдер. Проверьте дату окончания договора и согласуйте дальнейшее действие. Юридически значимые условия проверяет сотрудник."},
  {context:{kind:"today"},path:"/today",reply:"DEMO / fake-провайдер. Начните с собственных просроченных задач; затем проверьте ближайшие сроки и приоритеты. Откройте первичные записи перед изменениями."},
  {context:{kind:"reports"},path:"/reports",reply:"DEMO / fake-провайдер. Проверьте просрочки и потребности без движения по drill-down. Период сводки — последние 30 дней."},
 ];
 await mkdir("docs/screenshots/vkr/v323-assistant",{recursive:true});
 const payloads=[];
 for(const s of screens){console.log(`Offline context: ${s.context.kind}`);const assembled=await assembleScreenContext(actor,s.context);payloads.push({screen:s.context.kind,provenance:"crm_demo; linked clients filtered by [DEMO-V241]; no external dispatch",context:await redactScreenData(actor,assembled.data)});}
 await writeFile("docs/vkr/v323-ai-assistant-payloads.json",JSON.stringify({mode:"OFFLINE_PREVIEW",destination:"https://ai.api.cloud.yandex.net/v1/responses",instructions,tools:chatTools,screens:payloads},null,2));
 if(process.argv.includes("--payload-only"))return;
 const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3382"],{stdio:"ignore",env:{...process.env,NODE_ENV:"production",NEXT_DIST_DIR:".next-v323-assistant",COOKIE_SECURE:"false",AI_ENABLED:"false",YANDEX_CLOUD_API_KEY:"",YANDEX_WEB_SEARCH_ENABLED:"false",LOG_LEVEL:"silent"}});
 const browser=await chromium.launch({headless:true});
 const results:unknown[]=[];
 try{
  for(let i=0;i<60;i++){try{if((await fetch(base+"/api/health")).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
  const page=await browser.newPage({viewport:{width:1366,height:768},locale:"ru-RU",timezoneId:"Asia/Novosibirsk"});
  const login=await page.request.post(base+"/api/v1/auth/login",{headers:{Origin:base},data:{login:process.env.SEED_MANAGER_LOGIN??"manager",password:process.env.SEED_MANAGER_PASSWORD}});if(!login.ok())throw new Error(`Demo login HTTP ${login.status()}`);
  const session=(await page.context().cookies(base)).find(c=>c.name==="crm_session")?.value;if(!session)throw new Error("Demo session missing");
  const child=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test","-c","tests/ai-chat.playwright.config.ts"],{env:{...process.env,E2E_CHAT_BASE_URL:base,E2E_CHAT_SESSION:session},stdio:["ignore","pipe","pipe"]});
  let log="";child.stdout.on("data",v=>{log+=String(v);});child.stderr.on("data",v=>{log+=String(v);});const code=await new Promise(r=>child.on("exit",r));await writeFile("data-v323-e2e.log",log);results.push({test:"panel E2E",exitCode:code});if(code!==0)throw new Error("Panel E2E failed");
  for(const [i,s] of screens.entries()){
   const chat={id:"00000000-0000-4000-8000-000000000081",title:"DEMO: проверка интерфейса",contextType:s.context.kind,contextId:s.context.id??null,messages:[] as unknown[],actions:[]};
   await page.route("**/api/v1/ai-chat/**",async route=>{const req=route.request();if(req.url().endsWith("/messages"))chat.messages=[{id:"reply",role:"assistant",content:s.reply,toolArgs:(await assembleScreenContext(actor,s.context)).links}];await route.fulfill({json:req.method()==="GET"&&req.url().endsWith("/sessions")?{items:[]}:chat});});
   await page.goto(base+s.path,{waitUntil:"networkidle",timeout:60000});await page.getByRole("button",{name:"Открыть AI-помощника",exact:true}).click();const dialog=page.getByRole("dialog");
   await dialog.getByRole("button",{name:"Новый диалог",exact:true}).click();await expect(dialog.getByLabel("Сообщение",{exact:true})).toBeEnabled();await dialog.getByLabel("Сообщение",{exact:true}).fill("Какое следующее действие?");await dialog.getByRole("button",{name:"Отправить",exact:true}).click();await expect(dialog.getByText(s.reply,{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual({width:1366,height:768});
   if(i<4)await page.screenshot({path:`docs/screenshots/vkr/v323-assistant/${String(i+1).padStart(2,"0")}-${s.context.kind}-demo.png`,animations:"disabled"});
   results.push({screen:s.context.kind,mode:"DEMO_FAKE",result:"PASS"});await dialog.getByRole("button",{name:"Закрыть",exact:true}).click();await page.unroute("**/api/v1/ai-chat/**");
  }
 }finally{await browser.close();server.kill();await writeFile("docs/vkr/v323-ai-assistant-browser.json",JSON.stringify({mode:"DEMO_FAKE",externalCalls:0,results},null,2));}
}
main().catch(e=>{console.error(e instanceof Error?e.stack:"Preview failed");process.exitCode=1;}).finally(disconnectDb);
