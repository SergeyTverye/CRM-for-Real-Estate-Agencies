import { createServer } from "node:net";
import { config } from "dotenv";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { db, disconnectDb } from "../../src/shared/db/client";
import { decodeReservation } from "../../src/modules/ai/infrastructure/prisma-repositories";
import { rubToMicros } from "../../src/modules/ai/domain/cost";
import { periodKeys } from "../../src/modules/ai/domain/gate";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL="postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const refinement=process.argv.includes("--refine");
const base="http://127.0.0.1:3382";
const out="docs/screenshots/vkr/v323-assistant";
const evidence: {mode:string;startedAt:string;budgetRub:number;callLimit:number;events:unknown[];screenshots:string[];calls?:number;chargedRub?:string;ceilingRub?:string;blocked?:string}={mode:"LIVE",startedAt:new Date().toISOString(),budgetRub:3,callLimit:8,events:[],screenshots:[]};
let server:ChildProcess|undefined;
async function main(){
 await new Promise<void>((resolve,reject)=>{const probe=createServer();probe.once("error",reject);probe.listen(3382,"127.0.0.1",()=>probe.close(error=>error?reject(error):resolve()));});
 await mkdir(out,{recursive:true});
 try { Object.assign(evidence, JSON.parse(await readFile("docs/vkr/v323-ai-assistant-live.json","utf8"))); delete evidence.blocked; } catch (error) { if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error; }
 const setting=await db.aiSetting.findFirstOrThrow();
 const logs=await db.aiUsageLog.findMany();
 const month=periodKeys(new Date(),"Asia/Novosibirsk").monthKey;
 const committed=logs.reduce((sum,row)=>{const r=decodeReservation(row.result);return sum+(r?r.monthKey===month?r.chargedMicros:0n:periodKeys(row.createdAt,"Asia/Novosibirsk").monthKey===month?rubToMicros((row.actualCostRub??row.estimatedCostRub).toString()):0n);},0n);
 // CRM demo has existing spend. Keep its journal intact and cap ADDITIONAL spend at 3 RUB.
 const ceiling=((committed+3000000n)/10000n*10000n); const ceilingRub=evidence.ceilingRub??(Number(ceiling)/1e6).toFixed(2);
 evidence.ceilingRub=ceilingRub;
 await writeFile("docs/vkr/v323-ai-assistant-live.json",JSON.stringify(evidence,null,2));
 const day=periodKeys(new Date(),"Asia/Novosibirsk").dayKey;
 const todayLogs=logs.filter(l=>periodKeys(l.createdAt,"Asia/Novosibirsk").dayKey===day).length;
 const browser=await chromium.launch({headless:true});
 const updated=await db.aiSetting.update({where:{id:setting.id},data:{aiEnabled:true,monthlyBudgetRub:ceilingRub,perJobLimit:1,perUserDailyLimit:todayLogs+8,dailyLimit:todayLogs+8,webSearchManualAllowed:false,webSearchAutoFallback:false}});
 try{
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3382"],{env:{...process.env,NODE_ENV:"production",NEXT_DIST_DIR:".next-v323-assistant",AI_ENABLED:"true",COOKIE_SECURE:"false",YANDEX_AI_MAX_MONTHLY_COST_RUB:ceilingRub,YANDEX_AI_MAX_OUTPUT_TOKENS:"600",YANDEX_WEB_SEARCH_ENABLED:"false",LOG_LEVEL:"silent"},stdio:"ignore"});
  for(let i=0;i<90;i++){try{if((await fetch(base+"/api/health")).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
  const page=await browser.newPage({viewport:{width:1366,height:768},locale:"ru-RU",timezoneId:"Asia/Novosibirsk"});
  const api=async(method:string,path:string,body?:unknown)=>{const r=await page.request.fetch(base+path,{method,data:body,headers:{Origin:base},timeout:120000});if(!r.ok())throw new Error(`HTTP ${r.status()} ${path}`);return r.json();};
  if(!process.env.SEED_MANAGER_PASSWORD)throw new Error("Missing demo login credential");
  await api("POST","/api/v1/auth/login",{login:process.env.SEED_MANAGER_LOGIN??"manager",password:process.env.SEED_MANAGER_PASSWORD});
  const cookies=await page.context().cookies(base);
  const session=cookies.find(c=>c.name==="crm_session")?.value;
  if(!session)throw new Error("Demo login did not set session cookie");
  const e2e=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test","-c","tests/ai-chat.playwright.config.ts"],{env:{...process.env,E2E_CHAT_BASE_URL:base,E2E_CHAT_SESSION:session},stdio:["ignore","pipe","pipe"]});
  let e2eLog="";e2e.stdout?.on("data",d=>{e2eLog+=String(d);});e2e.stderr?.on("data",d=>{e2eLog+=String(d);});
  const code=await new Promise(resolve=>e2e.on("exit",resolve));
  await writeFile("data-v323-e2e.log",e2eLog);
  evidence.events.push({mode:"FAKE",test:"existing chat panel E2E",exitCode:code});
  if(code!==0)throw new Error("Panel E2E failed; see local log");
  const client=await db.client.findFirstOrThrow({where:{notes:{contains:"[DEMO-V241]"},needs:{some:{taskLinks:{some:{}}}}},select:{id:true},orderBy:{id:"asc"}});
  const need=await db.clientNeed.findFirstOrThrow({where:{clientId:client.id,taskLinks:{some:{}}},select:{id:true}});
  const task=await db.task.findFirstOrThrow({where:{needLinks:{some:{clientNeedId:need.id}}},select:{id:true}});
  const deal=await db.deal.findFirstOrThrow({where:{parties:{some:{client:{notes:{contains:"[DEMO-V241]"}}},every:{OR:[{clientId:null},{client:{notes:{contains:"[DEMO-V241]"}}}]}}},select:{id:true},orderBy:{id:"asc"}});
  const screens=[{kind:"client",id:client.id,path:`/clients/${client.id}`,q:"Какое следующее действие и что уточнить у клиента? Дай совет по переданной сводке без дополнительных инструментов."},{kind:"need",id:need.id,path:`/needs/${need.id}`,q:"Подготовь короткий черновик сообщения клиенту без отправки, только по сводке. Не используй инструменты."},{kind:"task",id:task.id,path:`/tasks/${task.id}`,q:"Как выполнить эту задачу, какие связанные записи проверить? Только по сводке без инструментов."},{kind:"deal",id:deal.id,path:`/deals/${deal.id}`,q:"Что проверить по чек-листу и какие сроки требуют внимания? Только по сводке без инструментов."},{kind:"today",path:"/today",q:"С чего начать сегодня? Оцени просрочки и приоритеты только по переданной сводке без инструментов."}];
  for(const [i,screen] of screens.entries()){
   if(refinement && !["need","task","deal"].includes(screen.kind))continue;
   if(evidence.events.some(e=>!!e&&typeof e==="object"&&"screen" in e&&e.screen===screen.kind&&"reply" in e&&e.reply&&(!refinement||("revision" in e&&e.revision===2))))continue;
   const count=await db.aiUsageLog.count({where:{createdAt:{gte:new Date(evidence.startedAt)}}});if(count>=8)throw new Error("Eight-call cap reached");
   await page.goto(base+screen.path,{waitUntil:"networkidle",timeout:90000});
   await page.getByRole("button",{name:"Открыть AI-помощника",exact:true}).click();
   const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
   const created=page.waitForResponse(r=>r.url().endsWith("/sessions")&&r.request().method()==="POST");
   await dialog.getByRole("button",{name:"Новый диалог",exact:true}).click();
   await created;
   await expect(dialog.getByLabel("Сообщение",{exact:true})).toBeEnabled();
   await expect(dialog.getByRole("combobox")).not.toHaveValue("");
   await dialog.getByLabel("Сообщение",{exact:true}).fill(screen.q);
   const responsePromise=page.waitForResponse(r=>r.url().endsWith("/messages")&&r.request().method()==="POST",{timeout:150000});
   await dialog.getByRole("button",{name:"Отправить",exact:true}).click();
   const response=await responsePromise;
   const body=await response.json();
   if(!response.ok()){evidence.events.push({screen:screen.kind,status:response.status(),code:body.error?.code});break;}
   const reply=body.messages?.filter((m:{role:string})=>m.role==="assistant").at(-1)?.content;
   evidence.events.push({screen:screen.kind,revision:refinement?2:1,reply:reply??null,warning:body.warning??null,actions:body.actions?.length??0});
   await expect(dialog.getByText("Выполняется…",{exact:true})).not.toBeVisible({timeout:30000});
   await expect(dialog.getByRole("button",{name:"Отправить",exact:true})).toBeDisabled();
   if(i<4){const file=`${String(i+1).padStart(2,"0")}-${screen.kind}-live.png`;await page.screenshot({path:`${out}/${file}`,animations:"disabled"});evidence.screenshots.push(file);}
   await dialog.getByRole("button",{name:"Закрыть",exact:true}).click();
   await writeFile("docs/vkr/v323-ai-assistant-live.json",JSON.stringify(evidence,null,2));
  }
 }finally{
  await browser.close();server?.kill();
  const own=await db.aiUsageLog.findMany({where:{createdAt:{gte:new Date(evidence.startedAt)},callType:"chat"}});
  evidence.calls=own.length;
  evidence.chargedRub=(Number(own.reduce((sum,l)=>sum+(decodeReservation(l.result)?.chargedMicros??rubToMicros((l.actualCostRub??l.estimatedCostRub).toString())),0n))/1e6).toFixed(6);
  // Restore only our own setting version; do not overwrite a concurrent operator's change.
  await db.aiSetting.updateMany({where:{id:setting.id,updatedAt:updated.updatedAt},data:{aiEnabled:setting.aiEnabled,monthlyBudgetRub:setting.monthlyBudgetRub,perJobLimit:setting.perJobLimit,perUserDailyLimit:setting.perUserDailyLimit,dailyLimit:setting.dailyLimit,webSearchManualAllowed:setting.webSearchManualAllowed,webSearchAutoFallback:setting.webSearchAutoFallback}});
 }
}
main().catch(e=>{evidence.blocked=e instanceof Error?e.message:"Trial failed";console.error(evidence.blocked);process.exitCode=1;}).finally(async()=>{await writeFile("docs/vkr/v323-ai-assistant-live.json",JSON.stringify(evidence,null,2));await disconnectDb();});
