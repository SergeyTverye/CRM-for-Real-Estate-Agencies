/** Explicitly authorized SR-09 LIVE check; ≤8 calls, no scraper traffic.
 * Restores manager settings and logs out even after a failed assertion. */
import "dotenv/config";
import { mkdir,writeFile,readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { db,disconnectDb,Prisma } from "@/shared/db/client";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { decodeReservation,microsToRub } from "@/modules/ai/infrastructure/prisma-repositories";

async function main() {
  if (!process.argv.includes("--live") || new URL(process.env.DATABASE_URL ?? "").pathname!=="/crm_demo") throw new Error("EXPLICIT_LIVE_DEMO_REQUIRED");
  const base="http://localhost:3412",started=new Date();
  const previous=await readFile("docs/integrations/ai-analysis-v31-live.json","utf8").then(s=>JSON.parse(s)).catch(()=>({usage:[],steps:[]}));
  if(previous.usage.length>5)throw new Error("SESSION_LIVE_CAP_REACHED");
  const browser=await chromium.launch({headless:true,executablePath:process.env.SCRAPER_CHROME_PATH});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  let original:Record<string,unknown>|undefined;
  let calls=0;
  const steps:{step:string;status:string;detail?:unknown}[]=[];
  const post=async(path:string,data:unknown)=>{
    const response=await context.request.post(`${base}/api/v1/${path}`,{headers:{origin:base},data,timeout:180000});
    const body=await response.json();
    if(!response.ok()) throw new Error(`${path}:${body.error?.code ?? response.status()}`);
    return body;
  };
  try {
    await post("auth/login",{login:process.env.SEED_MANAGER_LOGIN,password:process.env.SEED_MANAGER_PASSWORD});
    const get=await context.request.get(`${base}/api/v1/settings/ai`);if(!get.ok())throw new Error("SETTINGS_UNAVAILABLE");
    const setting=(await get.json()).setting;
    const keys=["aiEnabled","scraperEnabled","browserEnabled","enabledSources","webSearchManualAllowed","webSearchAutoFallback","model","webModel","searchContextSize","perUserDailyLimit","perJobLimit","dailyLimit","monthlyBudgetRub"];
    original=Object.fromEntries(keys.map(key=>[key,setting[key]]));
    const changed=await context.request.put(`${base}/api/v1/settings/ai`,{headers:{origin:base},data:{...original,aiEnabled:true,monthlyBudgetRub:"100",perUserDailyLimit:30,dailyLimit:100,expectedUpdatedAt:setting.updatedAt}});
    if(!changed.ok())throw new Error("TEMP_BUDGET_UPDATE_FAILED");
    const before=(await db.aiUsageLog.findMany({where:{createdAt:{gte:started}},select:{id:true}})).length;
    const possible=await db.externalListing.findMany({where:{sourceMethod:"scraper",source:"onrealt",operation:"sale",description:{not:null},address:{not:null}},include:{snapshots:{orderBy:{fetchedAt:"desc"},take:1}},orderBy:{firstSeenAt:"desc"},take:60});
    const rows=possible.filter(r=>/^\d+$/u.test(r.sourceListingId ?? "") && (r.description?.length ?? 0)>200 && r.snapshots.length).slice(0,2);
    if(rows.length!==2)throw new Error("REAL_SAVED_CANDIDATES_REQUIRED");
    const filters=SearchFilters.parse({operation:"sale",requiredFeatures:["удобная планировка"]});
    const input={listingIds:rows.map(r=>r.id),filters};
    const batchInput={...input,listingIds:[rows[0]!.id]};
    const first=await post("property-search/analysis/batch",batchInput);calls++;
    steps.push({step:"batch",status:"PASS",detail:first.items.map((r:{source:string;url:string;evidence:unknown;cacheHit:boolean})=>({source:r.source,url:r.url,evidence:r.evidence,cacheHit:r.cacheHit}))});
    const countAfterBatch=await db.aiUsageLog.count({where:{createdAt:{gte:started}}});
    const repeat=await post("property-search/analysis/batch",batchInput);
    if(!repeat.items.every((r:{cacheHit:boolean})=>r.cacheHit) || await db.aiUsageLog.count({where:{createdAt:{gte:started}}})!==countAfterBatch) throw new Error("CACHE_REPEAT_FAILED");
    steps.push({step:"repeat-cache-no-call",status:"PASS"});
    const owner=await db.user.findUniqueOrThrow({where:{login:process.env.SEED_MANAGER_LOGIN!},select:{id:true}});
    const run=await db.searchRun.create({data:{userId:owner.id,filters:filters as Prisma.InputJsonValue,status:"success",startedAt:new Date(),finishedAt:new Date(),city:filters.city}});
    for(const row of rows) {
      await db.searchRunResult.create({data:{runId:run.id,listingId:row.id,verdict:"needs_review",criteria:[{criterion:"удобная планировка",state:"unknown",source:"rule",evidence:"Уточнить у продавца"}]}});
      const snapshot=row.snapshots[0]!;
      await db.externalListingSnapshot.create({data:{listingId:row.id,searchRunId:run.id,normalized:snapshot.normalized as Prisma.InputJsonValue,priceRub:snapshot.priceRub,areaM2:row.areaM2,fetchedAt:snapshot.fetchedAt}});
    }
    const page=await context.newPage();
    await page.goto(`${base}/property-search?runId=${run.id}`,{waitUntil:"networkidle",timeout:120000});
    await page.getByRole("tab",{name:/Требуют проверки/}).click();
    await page.locator(`[data-listing-id="${rows[0]!.id}"] input[type=checkbox]`).check();
    const panel=page.getByRole("region",{name:"Анализ объявлений ИИ"});
    await panel.getByRole("button",{name:"Проверить неизвестные признаки",exact:true}).click();
    await panel.getByText("· из кеша",{exact:false}).first().waitFor({timeout:30000});
    await mkdir("docs/screenshots/vkr/live-ai",{recursive:true});
    await panel.screenshot({path:"docs/screenshots/vkr/live-ai/v31-analysis-batch.png"});
    await page.getByRole("button",{name:"Выделить страницу",exact:true}).click();
    const compareResponse=page.waitForResponse(r=>r.url().endsWith("/analysis/compare") && r.request().method()==="POST",{timeout:120000});
    await panel.getByRole("button",{name:"Сравнить объекты",exact:true}).click();calls++;
    const comparison=await compareResponse;const comparisonBody=await comparison.json();
    steps.push({step:"compare",status:comparison.ok()?"PASS":"FAIL",detail:comparison.ok()?{text:comparisonBody.text,questions:comparisonBody.questions}:comparisonBody.error?.code});
    await panel.getByText("Сведения объявления не заменяют",{exact:false}).first().waitFor({timeout:10000});
    await panel.screenshot({path:"docs/screenshots/vkr/live-ai/v31-analysis-compare.png"});
    if(calls>=8)throw new Error("LIVE_CAP_REACHED");
    const text=await post("property-search/analysis/collection-text",input);calls++;
    steps.push({step:"collection-text",status:"PASS",detail:{text:text.text}});
    const after=await db.aiUsageLog.count({where:{createdAt:{gte:started}}});
    if(after-before>8)throw new Error("LIVE_CAP_EXCEEDED");
    steps.push({step:"ui-real-component",status:"PASS",detail:{runId:run.id}});
  } finally {
    if(original) {
      const current=await context.request.get(`${base}/api/v1/settings/ai`);
      if(current.ok()) {
        const setting=(await current.json()).setting;
        const restored=await context.request.put(`${base}/api/v1/settings/ai`,{headers:{origin:base},data:{...original,expectedUpdatedAt:setting.updatedAt}});
        steps.push({step:"restore-settings",status:restored.ok()?"PASS":"FAIL"});
      }
    }
    const usage=await db.aiUsageLog.findMany({where:{createdAt:{gte:started}},orderBy:{createdAt:"asc"}});
    const journal=usage.map(row=>{const reservation=decodeReservation(row.result);return {id:row.id,callType:row.callType,model:row.model,status:row.status,inputTokens:row.inputTokens,outputTokens:row.outputTokens,costRub:reservation?microsToRub(reservation.chargedMicros):(row.actualCostRub ?? row.estimatedCostRub).toString(),createdAt:row.createdAt.toISOString()};});
    const attempts=previous.attempts ?? (previous.usage.length ? [{started:previous.started,steps:previous.steps,usage:previous.usage}] : []);
    await writeFile("docs/integrations/ai-analysis-v31-live.json",JSON.stringify({started:started.toISOString(),steps,usage:[...previous.usage,...journal],attempts:[...attempts,{started:started.toISOString(),steps,usage:journal}]},null,2)+"\n");
    await post("auth/logout",{}).catch(()=>undefined);
    await browser.close();await disconnectDb();
    console.log(JSON.stringify({steps:steps.map(s=>({step:s.step,status:s.status})),paidCalls:usage.length}));
  }
}
void main().catch(error=>{console.error(error instanceof Error ? error.message.replace(/postgresql:\/\/\S+/gu,"[DATABASE]"):"LIVE_FAILED");process.exitCode=1;});
