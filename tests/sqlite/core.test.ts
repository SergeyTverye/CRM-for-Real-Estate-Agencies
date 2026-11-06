import { globalSearch } from "@/modules/search/application/search-service";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { loadAccessibleNeed, changeNeedState } from "@/modules/needs/application/need-service";
import { updateClient } from "@/modules/clients/application/client-service";
import { createDeal, getDeal } from "@/modules/deals/application/deal-service";
import { listArchive } from "@/modules/archive/application/archive-service";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { getCallSourceReport } from "@/modules/reports/application/call-source-service";
import { listReactivatedClients } from "@/modules/reports/application/reactivation-query";
import { listCalendar as calendarItems } from "@/modules/calendar/application/calendar-service";
import { createTask, completeTask } from "@/modules/tasks/application/task-service";
import { createSqliteClient } from "@/shared/db/sqlite-client";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { db, disconnectDb } from "@/shared/db/client";
import { seedBase, makeClient, makeNeed, makeProperty, type TestUsers, TEST_PASSWORD } from "../helpers/fixtures";
import { login, logout } from "@/modules/auth/application/auth-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { recordCommunication } from "@/modules/communications/application/communication-service";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { transaction } from "@/shared/db/client";
import { aggregatePlanner } from "@/modules/calendar/application/planner-service";
import { listCalendar } from "@/modules/calendar/application/calendar-service";
import { createCollection, addItems, getCollection, linkNeed, collectionToOffer } from "@/modules/collections/application/collection-service";
import { uploadDocument, openDocumentForDownload } from "@/modules/documents/application/document-service";
import { PrismaAiLedger, PrismaAiSettings, decodeReservation } from "@/modules/ai/infrastructure/prisma-repositories";
import { AiGate } from "@/modules/ai/domain/gate";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { getConfig } from "@/shared/config/env";
import { toSqliteUnits } from "@/shared/db/sqlite-money";

let users: TestUsers;
const file = process.env.DATABASE_URL!.slice(5);
beforeAll(async () => { users = await seedBase(); }, 60000);
afterAll(async()=>{ await disconnectDb(); });
describe("DT-05 SQLite real application core",()=>{
  it("logs in with Argon2 and persists hashed session, logout revokes it",async()=>{
    const result=await login(users.realtor1.login,TEST_PASSWORD,{ip:"127.0.0.1",userAgent:"sqlite-test"},{delay:false});
    expect(result.token).toBeTruthy();
    const sessions=await db.userSession.findMany({where:{userId:users.realtor1.userId}});
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(result.token);
    await logout({...users.realtor1,sessionId:sessions[0]!.id});
    expect((await db.userSession.findUniqueOrThrow({where:{id:sessions[0]!.id}})).revokedAt).not.toBeNull();
  });
  it("client → incoming call → need/task → planner → local collection → offer → private StorageAdapter document → audit",async()=>{
    const client=await makeClient(users.realtor1,{displayName:"СИНТЕТИЧЕСКИЙ клиент Ёж"});
    const callAt=new Date().toISOString();
    const request=await registerRequest(users.realtor1,{
      occurredAt:callAt,callAt,channelCode:"phone",sourceCode:"other",
      client:{mode:"existing",clientId:client.id},
      outcome:{resultCode:"new_need",need:{operationType:"rent",propertyType:"commercial",budgetMax:"99999999999999.99"},nextAction:{title:"Позвонить",dueAt:"2026-11-06T17:30:00Z",taskType:"call_or_contact"}},
    });
    expect(request.needId).toBeTruthy(); expect(request.taskId).toBeTruthy();
    await recordCommunication(users.realtor1,{clientId:client.id,clientNeedId:request.needId,leadRequestId:request.requestId,communicationType:"call",channelCode:"phone",comment:"Синтетический звонок"});
    await transaction(tx=>assertNeedInvariants(tx,[request.needId!]));
    const need=await db.clientNeed.findUniqueOrThrow({where:{id:request.needId!}});
    expect(need.budgetMax!.toFixed(2)).toBe("99999999999999.99");
    const range={from:"2026-11-01T00:00:00Z",to:"2026-12-01T00:00:00Z"};
    const planner=await aggregatePlanner(users.realtor1,range,new Date("2026-11-05T00:00Z"));
    const calendar=await listCalendar(users.realtor1,range,{now:new Date("2026-11-05T00:00Z")});
    expect(planner.total).toBe(calendar.length);
    expect(planner.days.some(d=>d.day==="2026-11-07")).toBe(true);
    const property=await makeProperty(users.realtor1,{price:"99999999999999.99"});
    const collection=await createCollection(users.realtor1,{name:"Локальная подборка"});
    await addItems(users.realtor1,collection.id,[{propertyId:property.id}]);
    let card=await getCollection(users.realtor1,collection.id);
    await linkNeed(users.realtor1,collection.id,{needId:need.id,expectedUpdatedAt:card.updatedAt.toISOString()});
    card=await getCollection(users.realtor1,collection.id);
    const offer=await collectionToOffer(users.realtor1,collection.id,{needId:need.id,itemIds:card.items.map(i=>i.id)});
    expect(await db.commercialOfferItem.count({where:{commercialOfferId:offer.id}})).toBe(1);
    const document=await uploadDocument(users.realtor1,new File(["synthetic document"],"synthetic.txt",{type:"text/plain"}),{documentTypeCode:"other",linkKind:"need",linkId:need.id});
    const opened=await openDocumentForDownload(users.realtor1,document.id);
    const chunks:Buffer[]=[]; for await(const chunk of opened.stream)chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("synthetic document");
    await expect(openDocumentForDownload(users.realtor2,document.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    const audit = await db.auditLog.findMany({ where: { entityId: collection.id }, select: { action: true } });
    expect(audit.map(a=>a.action)).toEqual(expect.arrayContaining(["collection_created","collection_items_added","collection_need_linked","collection_offer_created"]));
    expect(existsSync(file)).toBe(true);
  });
  it("preserves Unicode search scopes, FK, checks, scaled arithmetic and exact storage",async()=>{
    const rows=await db.client.findMany({where:{displayName:{contains:"синтетический",mode:"insensitive"}}});
    expect(rows).toHaveLength(1);
    const p=await makeProperty(users.realtor1,{price:"0.10"});
    const changed=await db.property.update({where:{id:p.id},data:{price:{increment:"0.20"}}});
    expect(changed.price!.toFixed(2)).toBe("0.30");
    await expect(db.property.update({where:{id:p.id},data:{price:"-1.00"}})).rejects.toThrow();
    await expect(db.clientContact.create({data:{clientId:randomUUID(),contactType:"phone",rawValue:"synthetic"}})).rejects.toThrow();
    expect(()=>toSqliteUnits("0.001",{precision:16,scale:2})).toThrow("SQLITE_DECIMAL_SCALE");
    expect(()=>toSqliteUnits(0.1,{precision:16,scale:2})).toThrow("SQLITE_DECIMAL_NUMBER_UNSAFE");
    const native=new Database(file);
    expect(native.prepare("SELECT typeof(price) AS type, price FROM properties WHERE id=?").get(p.id)).toEqual({type:"integer",price:30});
    expect(native.pragma("journal_mode",{simple:true})).toBe("wal");
    expect(native.pragma("integrity_check",{simple:true})).toBe("ok");
    native.close();
  });
  it("rolls back invalid active need without next action",async()=>{
    const client=await makeClient(users.realtor1);
    await expect(makeNeed(users.realtor1,client.id,{nextAction:undefined})).rejects.toThrow();
    expect(await db.clientNeed.count({where:{clientId:client.id}})).toBe(0);
  });
  it("reserves AI budget concurrently across independent repositories without overrun",async()=>{
    await db.aiSetting.create({data:{aiEnabled:true,perUserDailyLimit:100,perJobLimit:100,dailyLimit:100,monthlyBudgetRub:"2.50"}});
    const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters:{}}});
    const tariff={id:"synthetic",model:"synthetic",effectiveFrom:new Date("2020-01-01Z"),inputMicrosPerMillion:1000000n,outputMicrosPerMillion:1000000n,webSearchMicrosPerCall:1000000n,webInputTokenAllowance:128000};
    const attempts=await Promise.allSettled(Array.from({length:12},()=>new AiGate(new PrismaAiLedger(),envAiLimits(getConfig()),new PrismaAiSettings()).check("parse",{userId:users.realtor1.userId,active:true},{
      id:run.id,ownerUserId:users.realtor1.userId,requestId:randomUUID(),fingerprint:"synthetic",model:tariff.model,tariff,estimatedUsage:{inputTokens:1000000,outputTokens:0},estimatedWebCalls:0,
    })));
    expect(attempts.filter(a=>a.status==="fulfilled")).toHaveLength(2);
    for(const result of attempts)if(result.status==="rejected")expect(result.reason.message).toBe("AI_BUDGET_EXHAUSTED");
    const rows=await db.aiUsageLog.findMany();
    expect(rows.reduce((sum,r)=>sum+decodeReservation(r.result)!.chargedMicros,0n)).toBe(2000000n);
    expect(await db.aiBudgetReservation.count({where:{status:"reserved"}})).toBe(2);
  });

  it("enforces client/need/deal/archive/owner/global-search boundaries and stale updates",async()=>{
    const client=await makeClient(users.realtor1,{displayName:"ЗакрытаяКириллица"});
    const need=await makeNeed(users.realtor1,client.id);
    await expect(getClientCard(users.realtor2,client.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(transaction(tx=>loadAccessibleNeed(tx,users.realtor2,need.id))).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(JSON.stringify(await globalSearch(users.realtor2,"закрытаякириллица"))).not.toContain(client.id);
    expect(JSON.stringify(await globalSearch(users.realtor1,"закрытаякириллица"))).toContain(client.id);
    await expect(listArchive(users.realtor1,{})).rejects.toMatchObject({code:"FORBIDDEN"});
    const property=await makeProperty(users.realtor1);
    await db.propertyOwner.create({data:{propertyId:property.id,clientId:client.id,ownershipShare:"1.0000"}});
    expect((await getPropertyCard(users.realtor2,property.id)).canSeeOwners).toBe(false);
    expect(JSON.stringify((await getPropertyCard(users.realtor2,property.id)).owners)).not.toContain("ЗакрытаяКириллица");
    const deal=await createDeal(users.realtor1,{propertyId:property.id,legalEntityId:users.llcId,parties:[{clientId:client.id,partyRole:"tenant"}],commissions:[{amount:"0.10"},{amount:"0.20"}]});
    await expect(getDeal(users.realtor2,deal.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    expect((await db.dealCommission.aggregate({where:{dealId:deal.id},_sum:{amount:true}}))._sum.amount!.toFixed(2)).toBe("0.30");
    const before=await db.client.findUniqueOrThrow({where:{id:client.id}});
    await updateClient(users.realtor1,client.id,{expectedUpdatedAt:before.updatedAt.toISOString(),displayName:"Изменённый"});
    await expect(updateClient(users.realtor1,client.id,{expectedUpdatedAt:before.updatedAt.toISOString(),displayName:"Потерянный"})).rejects.toMatchObject({code:"STALE_UPDATE"});
    await expect(changeNeedState(users.realtor1,need.id,{expectedUpdatedAt:(await db.clientNeed.findUniqueOrThrow({where:{id:need.id}})).updatedAt.toISOString(),status:"paused"})).rejects.toThrow();
  });
  it("planner SQL aggregates 1500 rows, reports and epoch interval SQL work",async()=>{
    const dueAt=new Date("2026-12-09T18:00:00Z");
    await db.task.createMany({data:Array.from({length:1500},(_,i)=>({title:"Синтетическая нагрузка "+i,taskType:"other",status:"planned",priority:"normal",dueAt,responsibleUserId:users.realtor1.userId,createdBy:users.realtor1.userId}))});
    const range={from:"2026-12-09T17:00:00Z",to:"2026-12-10T17:00:00Z",type:"task"};
    const aggregate=await aggregatePlanner(users.realtor1,range,new Date("2026-12-08T17:00Z"));
    expect(aggregate.total).toBe(1500);
    expect(aggregate.days[0]!.day).toBe("2026-12-10");
    expect((await aggregatePlanner(users.realtor2,range)).total).toBe(0);
    const report=await getCallSourceReport(users.manager,{});
    expect(report.total.calls).toBeGreaterThan(0);
    expect(report.total.needs).toBeGreaterThan(0);
    expect(await listReactivatedClients(new Date("2026-11-01Z"),new Date("2026-12-01Z"),90)).toEqual([]);
  });
  it("task completion cannot remove the last next action; serialized reads cannot see rollback data",async()=>{
    const c=await makeClient(users.realtor1),n=await makeNeed(users.realtor1,c.id);
    const t=await db.task.findUniqueOrThrow({where:{id:n.taskId}});
    await expect(completeTask(users.realtor1,t.id,{expectedUpdatedAt:t.updatedAt.toISOString()})).rejects.toThrow();
    expect((await db.task.findUniqueOrThrow({where:{id:t.id}})).status).toBe("planned");
    const repeated=await createTask(users.realtor1,{title:"Повтор",taskType:"other",dueAt:"2026-11-06T03:00:00Z",recurrenceRule:"FREQ=DAILY;COUNT=2"});
    const task=await db.task.findUniqueOrThrow({where:{id:repeated.id}});
    const done=await completeTask(users.realtor1,task.id,{expectedUpdatedAt:task.updatedAt.toISOString()});
    expect(done.nextInstanceId).toBeTruthy();
    expect((await db.task.findUniqueOrThrow({where:{id:done.nextInstanceId!}})).dueAt.toISOString()).toBe("2026-11-07T03:00:00.000Z");
    let signal!:()=>void;
    const inside=new Promise<void>(r=>{signal=r;});
    let release!:()=>void;
    const unblock=new Promise<void>(r=>{release=r;});
    const writer=transaction(async tx=>{
      await tx.dictionaryItem.create({data:{category:"synthetic",code:"rollback",displayName:"Temporary"}});
      signal(); await unblock; throw new Error("rollback probe");
    }).catch(e=>expect(e.message).toBe("rollback probe"));
    await inside;
    const reader=db.dictionaryItem.count({where:{category:"synthetic",code:"rollback"}});
    release(); await writer;
    expect(await reader).toBe(0);
    const independent=createSqliteClient(process.env.DATABASE_URL!);
    expect(await independent.user.count()).toBe(3);
    await independent.$disconnect();
    expect((await calendarItems(users.realtor2,{from:"2026-11-06T00:00Z",to:"2026-11-08T00:00Z"})).length).toBe(0);
  });


  it("keeps template document role predicates and Unicode equality exact",async()=>{
    await db.legalEntity.create({data:{entityType:"LLC",displayName:"ЁЖ %_ Точный"}});
    expect(await db.legalEntity.count({where:{displayName:{equals:"ёж %_ точный",mode:"insensitive"}}})).toBe(1);
    expect(await db.legalEntity.count({where:{displayName:{equals:"ёж",mode:"insensitive"}}})).toBe(0);
    const owner=await makeClient(users.realtor1);
    const doc=await uploadDocument(users.realtor1,new File(["synthetic role test"],"role.txt",{type:"text/plain"}),{documentTypeCode:"other",linkKind:"client",linkId:owner.id});
    const template=await db.documentTemplate.create({data:{code:"synthetic-role",name:"Synthetic",format:"docx",allowedSources:["client"]}});
    const version=await db.documentTemplateVersion.create({data:{templateId:template.id,version:1,markdownBody:"synthetic",manifestYaml:"schemaVersion: 1",checksum:"synthetic",createdBy:users.manager.userId}});
    await db.document.update({where:{id:doc.id},data:{templateVersionId:version.id,valuesSnapshot:{accessRoles:["manager"]}}});
    await expect(openDocumentForDownload(users.realtor1,doc.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    const allowed=await openDocumentForDownload(users.manager,doc.id); allowed.stream.destroy();
    await db.document.update({where:{id:doc.id},data:{valuesSnapshot:{accessRoles:["realtor"]}}});
    const readable=await openDocumentForDownload(users.realtor1,doc.id); readable.stream.destroy();
    expect((await db.documentTemplate.findUniqueOrThrow({where:{id:template.id}})).allowedSources).toEqual(["client"]);
  });


  it("demonstrates stock adapter Decimal rounding and verifies actual PRAGMAs",async()=>{
    const { PrismaBetterSqlite3 }=await import("@prisma/adapter-better-sqlite3");
    const stock=await new PrismaBetterSqlite3({url:":memory:"}).connect();
    try {
      await stock.executeScript("CREATE TABLE probe(amount DECIMAL(16,2));");
      await stock.executeRaw({sql:"INSERT INTO probe(amount) VALUES (?)",args:["99999999999999.99"],argTypes:[{scalarType:"decimal",arity:"scalar"}]});
      const result=await stock.queryRaw({sql:"SELECT amount,typeof(amount) AS storage_type FROM probe",args:[],argTypes:[]});
      expect(result.rows[0]![1]).toBe("real");
      expect(String(result.rows[0]![0])).not.toBe("99999999999999.99");
    } finally { await stock.dispose(); }
    expect(await db.$queryRawUnsafe("PRAGMA foreign_keys")).toEqual([{foreign_keys:1n}]);
    expect(await db.$queryRawUnsafe("PRAGMA busy_timeout")).toEqual([{timeout:10000n}]);
    expect(await db.$queryRawUnsafe("PRAGMA journal_mode")).toEqual([{journal_mode:"wal"}]);
  });

});

