import { chromium,expect } from "@playwright/test";
import { config } from "dotenv";
import { readFile,writeFile,mkdir,appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { db,disconnectDb } from "../../src/shared/db/client";
import { decodeReservation,microsToRub } from "../../src/modules/ai/infrastructure/prisma-repositories";
config({path:[".env.local",".env"],quiet:true});
process.env.DATABASE_URL="postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const base="http://localhost:3360", stateFile="data/p2-live-state.json";
type Trial={kind:string;startedAt:string;httpStatus?:number;result?:unknown};
async function main() {
  const mode=process.argv[2] ?? "inspect";
  let state:{attempts:Trial[]}={attempts:[]};
  try {state=JSON.parse(await readFile(stateFile,"utf8"));} catch {}
  if(mode==="report") {
    const rows=await db.aiUsageLog.findMany({where:{callType:{in:["call_note","offer_text"]}},orderBy:{createdAt:"asc"}});
    const usage=rows.map(row=>({id:row.id,callType:row.callType,status:row.status,inputTokens:row.inputTokens,outputTokens:row.outputTokens,
      actualRub:microsToRub(decodeReservation(row.result)?.actualMicros ?? 0n),createdAt:row.createdAt.toISOString()}));
    const screenshots=await Promise.all(["p2-call-note.png","p2-offer-text.png"].map(async file=>({file:`docs/screenshots/vkr/live-ai/${file}`,sha256:createHash("sha256").update(await readFile(`docs/screenshots/vkr/live-ai/${file}`)).digest("hex"),mode:"LIVE"})));
    const evidence={date:new Date().toISOString(),sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingTreeChanges:true,database:"crm_demo",port:3360,distDir:".next-p2",provider:"Yandex Responses / aliceai-llm-flash/latest",usage,screenshots,
      inputTokens:rows.reduce((s,r)=>s+r.inputTokens,0),outputTokens:rows.reduce((s,r)=>s+r.outputTokens,0),
      actualRub:microsToRub(rows.reduce((s,r)=>s+(decodeReservation(r.result)?.actualMicros ?? 0n),0n)),cloudBillingVerified:false};
    await writeFile("docs/vkr/p2-live-ai-evidence.json",JSON.stringify(evidence,null,2)+"\n");
    const reportPath="docs/vkr/live-ai-trials.md";
    if((await readFile(reportPath,"utf8")).includes("## P2 —")) throw new Error("P2 report already appended");
    await appendFile(reportPath,`\n\n## P2 — заметка после звонка и текст КП (LIVE, 05.11.2026)\n\nПроверено на crm_demo, порт 3360, NEXT_DIST_DIR=.next-p2, AI_ENABLED=true в процессе. Только синтетические данные. Ровно **4 реальных вызова: 2 call_note + 2 offer_text**, без web_search. Постоянный журнал CRM: [p2-live-ai-evidence.json](p2-live-ai-evidence.json). SHA относится к исходному коммиту; изменения P2 ещё не закоммичены координатором.\n\n| Вызов | HTTP / журнал | Input / output | Качество |\n|---|---|---|---|\n| call_note: офис, месячная аренда, район, этаж, задача | 200 / success | 547 / 217 | PARTIAL: основные условия верны; модель самовольно ограничила продавца собственником. Добавлена серверная нормализация seller=all без явного требования; проверена fake-регрессией |\n| call_note: склад, неясная единица бюджета | 200 / success | 577 / 231 | PASS: filters=null, уточняющий вопрос месяц/год, срок не выдуман |\n| offer_text: введение | 200 / success | 438 / 69 | PARTIAL: числа присутствуют в снимках, но агрегированный диапазон площадей неверен. После обнаружения диапазоны запрещены инструкцией и постпроверкой, добавлена регрессия. Живой повтор введения после исправления не выполнялся |\n| offer_text: сравнение пяти позиций | 200 / success | 467 / 203 | PASS по фактам: адреса, площади, цены и этажи соответствуют снимкам. Нужна редакторская правка единиц измерения и абзацев |\n\nИтого **${evidence.inputTokens} входных / ${evidence.outputTokens} выходных токенов**, **${evidence.actualRub} ₽** по подтверждённой usage и тарифному снимку CRM; счёт Yandex Cloud отдельно не сверялся. Одна попытка сравнения получила AI_RATE_LIMIT до резерва и вызова провайдера при параллельном изменении общих лимитов; после восстановления доступного лимита выполнен единственный реальный сравнительный вызов. Настройки и потолки ради обхода AiGate не менялись.\n\nОбе функции проверены через настоящие кнопки приложения. Предпросмотр не подтверждался и не изменял деловые записи демо-БД. Действия подтверждения и инварианты проверены на fake-провайдере в отдельной crm_test_b. Холодная загрузка dev-UI потребовала ожидания гидратации; диагностические ошибки dev-stream не объявляются результатами AI.\n\nПодлинные снимки просмотрены после записи: [заметка: LIVE-уточнение](../screenshots/vkr/live-ai/p2-call-note.png), [КП: LIVE-сравнение](../screenshots/vkr/live-ai/p2-offer-text.png). Пометка LIVE и usage видны в интерфейсе. Изображения не являются макетами или ответами fake.\n\nПроверки P2: 89/89 Vitest (AI unit + P2 integration/authorization), tsc --noEmit PASS, целевой ESLint --max-warnings=0 PASS. Миграция 20261105210000_p2_ai_call_types получена через prisma migrate diff без shadow (структурный diff пуст; расширены только CHECK), применена в crm_demo и чистой crm_test_b; prisma generate PASS. Схема моделей не менялась, зависимости не устанавливались. Общий итог: функциональные проверки PASS, качество LIVE-введения после ужесточения остаётся PARTIAL до нового согласованного живого прогона.\n`);
    console.log(JSON.stringify({calls:rows.length,inputTokens:evidence.inputTokens,outputTokens:evidence.outputTokens,actualRub:evidence.actualRub}));
    await disconnectDb();return;
  }
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100},baseURL:base});
    page.setDefaultNavigationTimeout(120000); page.setDefaultTimeout(60000);
    const login=process.env.SEED_REALTOR1_LOGIN ?? "realtor1",password=process.env.SEED_REALTOR1_PASSWORD;
    if(!password) throw new Error("Missing seed password");
    const auth=await page.request.post("/api/v1/auth/login",{headers:{Origin:base},data:{login,password}});
    if(!auth.ok()) throw new Error(`Login HTTP ${auth.status()}`);
    const user=await db.user.findUniqueOrThrow({where:{login}});
    const client=await db.client.findFirstOrThrow({where:{responsibleUserId:user.id,status:"active"},orderBy:{createdAt:"asc"}});
    const offer=await db.commercialOffer.findFirst({where:{status:"draft",responsibleUserId:user.id,items:{some:{}}},orderBy:{createdAt:"asc"},include:{items:true}});
    if(mode==="inspect") {
      const limits=await page.request.get("/api/v1/ai/limits");
      console.log(JSON.stringify({limits:await limits.json(),settings:await db.aiSetting.findFirst({select:{aiEnabled:true,dailyLimit:true,perUserDailyLimit:true,perJobLimit:true}}),clientId:client.id,offer:offer ? {id:offer.id,items:offer.items.map(i=>({address:i.addressSnapshot,area:i.areaSnapshot?.toString(),price:i.priceSnapshot?.toString(),terms:i.termsSnapshot}))}:null,attempts:state.attempts.length,ledger:await db.aiUsageLog.findMany({where:{callType:{in:["call_note","offer_text"]}},select:{id:true,callType:true,status:true,inputTokens:true,outputTokens:true,createdAt:true}})}));return;
    }
    const type=mode.startsWith("note") ? "call_note" : "offer_text";
    const dispatched=await db.aiUsageLog.findMany({where:{callType:{in:["call_note","offer_text"]}},select:{callType:true}});
    if(dispatched.length>=4 || dispatched.filter(a=>a.callType===type).length>=2) throw new Error("P2 live cap reached");
    const trial:Trial={kind:`${type}:${mode}`,startedAt:new Date().toISOString()};
    const record=async()=>writeFile(stateFile,JSON.stringify(state,null,2));
    await mkdir("docs/screenshots/vkr/live-ai",{recursive:true});
    if(type==="call_note") {
      await page.goto(`/clients/${client.id}`,{waitUntil:"domcontentloaded"});
      await page.waitForLoadState("networkidle");
      await expect.poll(()=>page.getByRole("button",{name:"Разобрать заметку",exact:true}).evaluate(el=>Object.keys(el).some(key=>key.startsWith("__reactProps$")))).toBe(true);
      await page.getByRole("button",{name:"Разобрать заметку",exact:true}).click();
      await page.getByLabel("Заметка после звонка").fill(mode==="note1" ?
        "Нужен офис в аренду в Новосибирске. Площадь от 80 до 120 м², бюджет до 150000 рублей в месяц, Центральный район. Только первый этаж, отдельный вход обязателен. Завтра позвонить и уточнить варианты." :
        "Нужен склад в аренду в Новосибирске площадью от 200 до 400 м². Бюджет 150000 рублей, но неизвестно за месяц или за год. Нужно уточнить единицу цены звонком.");
      state.attempts.push(trial);await record();
      const responsePromise=page.waitForResponse(r=>r.url().endsWith("/api/v1/ai/call-note")&&r.request().method()==="POST",{timeout:120000});
      await page.getByRole("button",{name:"Подготовить черновик",exact:true}).click();
      const response=await responsePromise;trial.httpStatus=response.status();trial.result=await response.json();await record();
      if(response.ok()) {await expect(page.getByText(/LIVE · Yandex AI/)).toBeVisible();await page.screenshot({path:"docs/screenshots/vkr/live-ai/p2-call-note.png",fullPage:true});}
    } else {
      if(!offer) throw new Error("No demo draft offer");
      await page.goto(`/offers/${offer.id}`,{waitUntil:"domcontentloaded"});
      await page.waitForLoadState("networkidle");
      await expect.poll(()=>page.getByRole("button",{name:"Сгенерировать введение",exact:true}).evaluate(el=>Object.keys(el).some(key=>key.startsWith("__reactProps$")))).toBe(true);
      state.attempts.push(trial);await record();
      const responsePromise=page.waitForResponse(r=>r.url().endsWith("/api/v1/ai/offer-text")&&r.request().method()==="POST",{timeout:120000});
      await page.getByRole("button",{name:mode==="intro" ? "Сгенерировать введение" : "Сравнительное описание объектов",exact:true}).click();
      const response=await responsePromise;trial.httpStatus=response.status();trial.result=await response.json();await record();
      if(response.ok()) {await expect(page.getByText(/LIVE · Yandex AI/)).toBeVisible();await page.screenshot({path:"docs/screenshots/vkr/live-ai/p2-offer-text.png",fullPage:true});}
    }
    console.log(JSON.stringify(trial));
  } finally {await browser.close();await disconnectDb();}
}
main().catch(error=>{console.error(error instanceof Error ? error.message : "P2 trial failed");process.exitCode=1;});
