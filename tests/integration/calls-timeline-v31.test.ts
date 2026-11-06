import { beforeEach, describe, expect, it } from "vitest";
import { db, makeClient, makeNeed, makeProperty, nextAction, NEED_PARAMS, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { registerRequest } from "@/modules/requests/application/request-service";
import { getCallSourceReport, getCallSourceDetails } from "@/modules/reports/application/call-source-service";
import { getClientTimelinePage } from "@/modules/clients/application/timeline-service";
let u: TestUsers;
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
const base = { occurredAt: "2026-11-01T05:00:00.000Z", callAt: "2026-11-01T05:00:00.000Z", channelCode: "phone", sourceCode: "avito", summary: "Синтетический звонок" };
describe("AT-13 ручные звонки", () => {
  it.each([ ["spam", "invalid_or_spam"], ["wrong", "invalid_or_spam"], ["one_time", "one_off_service"] ])("%s без Client сохраняется в журнале и статистике", async (outcomeCode, resultCode) => {
    const r = await registerRequest(u.realtor1, {...base, outcomeCode, client:{mode:"none"}, outcome:{resultCode}});
    const row = await db.leadRequest.findUniqueOrThrow({where:{id:r.requestId}});
    expect(row.clientId).toBeNull(); expect(row.callAt?.toISOString()).toBe(base.callAt); expect(row.outcomeCode).toBe(outcomeCode);
    expect(await db.client.count()).toBe(0);
    expect((await getCallSourceReport(u.manager, {})).total).toEqual({calls:1,clients:0,needs:0,showings:0,deals:0});
  });
  it("перспективный звонок атомарно создаёт клиента, потребность и задачу по правилу объекта", async () => {
    const p = await makeProperty(u.realtor2);
    const r = await registerRequest(u.realtor1, {...base, outcomeCode:"prospective", propertyId:p.id, client:{mode:"new",client:{displayName:"Синтетический арендатор",contacts:[{contactType:"phone",value:"+79121112233"}]}}, outcome:{resultCode:"new_need",need:NEED_PARAMS,nextAction:nextAction()}});
    expect(r.responsibleUserId).toBe(u.realtor2.userId); expect(r.needId).toBeTruthy(); expect(r.taskId).toBeTruthy();
    const task = await db.task.findUniqueOrThrow({where:{id:r.taskId!},include:{needLinks:true,clientLinks:true}});
    expect(task.responsibleUserId).toBe(u.realtor2.userId); expect(task.needLinks[0]?.clientNeedId).toBe(r.needId);
    expect(task.clientLinks[0]?.clientId).toBe(r.clientId);
    expect(await db.auditLog.count({where:{action:"lead_request.registered",entityId:r.requestId}})).toBe(1);
  });
  it("ошибка следующей задачи откатывает также нового клиента и обращение", async () => {
    await expect(registerRequest(u.realtor1, {...base,client:{mode:"new",client:{displayName:"Rollback",contacts:[{contactType:"phone",value:"+79121112233"}]}},outcome:{resultCode:"new_need",need:NEED_PARAMS,nextAction:{...nextAction(),responsibleUserId:u.realtor2.userId}}})).rejects.toBeDefined();
    expect(await db.client.count()).toBe(0); expect(await db.leadRequest.count()).toBe(0); expect(await db.clientNeed.count()).toBe(0);
  });
  it("статистика: повторные звонки отдельно от клиентов, числители/знаменатель и drill-down совпадают", async () => {
    const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1,c.id); const p = await makeProperty(u.realtor1);
    for(let i=0;i<2;i++) await registerRequest(u.realtor1,{...base,client:{mode:"existing",clientId:c.id},outcome:{resultCode:"linked_existing_need",needId:n.id,nextAction:nextAction()}});
    await registerRequest(u.realtor1,{...base,client:{mode:"none"},outcome:{resultCode:"invalid_or_spam"}});
    await db.showing.create({data:{clientNeedId:n.id,propertyId:p.id,responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,scheduledAt:new Date("2026-11-02T05:00:00Z"),occurredAt:new Date("2026-11-02T05:00:00Z"),status:"completed"}});
    await db.deal.create({data:{propertyId:p.id,responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,legalEntityId:u.llcId,status:"completed",closedAt:new Date("2026-11-03T05:00:00Z"),parties:{create:{clientId:c.id,partyRole:"buyer"}}}});
    const report = await getCallSourceReport(u.manager,{sourceCode:"avito",from:"2026-11-01",to:"2026-11-01"});
    expect(report.total).toEqual({calls:3,clients:1,needs:2,showings:2,deals:2});
    expect(report.conversions.needs).toEqual({numerator:2,denominator:3,percent:66.7});
    for(const metric of ["calls","needs","showings","deals"] as const) expect((await getCallSourceDetails(u.manager,{metric})).items).toHaveLength(report.total[metric]);
    expect((await getCallSourceReport(u.manager,{outcomeCode:"spam"})).total.calls).toBe(1);
    expect((await getCallSourceReport(u.manager,{employeeId:u.realtor2.userId})).total.calls).toBe(0);
  });
  it("границы дня используют Asia/Novosibirsk, а не UTC", async () => {
    for(const at of ["2026-10-31T16:59:59Z","2026-10-31T17:00:00Z","2026-11-01T16:59:59Z","2026-11-01T17:00:00Z"])
      await registerRequest(u.realtor1,{...base,occurredAt:at,callAt:at,client:{mode:"none"},outcome:{resultCode:"one_off_service"}});
    expect((await getCallSourceReport(u.manager,{from:"2026-11-01",to:"2026-11-01"})).total.calls).toBe(2);
  });
});
describe("AT-14 таймлайн", () => {
  it("фильтры по потребности/виду/автору/периоду и каждый текущий этап", async () => {
    const c=await makeClient(u.realtor1); const n=await makeNeed(u.realtor1,c.id); await makeNeed(u.realtor1,c.id);
    await db.communication.create({data:{clientId:c.id,clientNeedId:n.id,authorUserId:u.realtor1.userId,communicationType:"call",occurredAt:new Date(base.occurredAt),comment:"Контрольная коммуникация"}});
    const page=await getClientTimelinePage(u.realtor1,c.id,{needId:n.id,kind:"communication",employeeId:u.realtor1.userId,from:"2026-11-01",to:"2026-11-01"});
    expect(page.items).toHaveLength(1); expect(page.needs).toHaveLength(2); expect(page.items[0]?.href).toContain("#");
    expect((await getClientTimelinePage(u.realtor1,c.id,{kind:"communication",employeeId:u.realtor2.userId})).items).toHaveLength(0);
    expect((await getClientTimelinePage(u.realtor1,c.id,{kind:"communication",from:"2026-11-02"})).items).toHaveLength(0);
  });
  it("курсор не теряет и не дублирует равновременные записи из разных источников", async () => {
    const c=await makeClient(u.realtor1); const at=new Date("2026-11-01T05:00:00Z");
    for(let i=0;i<7;i++) await db.communication.create({data:{clientId:c.id,authorUserId:u.realtor1.userId,communicationType:"call",occurredAt:at,comment:`Связь ${i}`}});
    for(let i=0;i<4;i++) await registerRequest(u.realtor1,{...base,client:{mode:"existing",clientId:c.id},outcome:{resultCode:"one_off_service"}});
    const all:string[]=[]; let cursor:string|undefined;
    do { const page=await getClientTimelinePage(u.realtor1,c.id,{pageSize:2,cursor}); all.push(...page.items.map(e=>`${e.kind}:${e.id}`)); cursor=page.nextCursor??undefined; } while(cursor);
    expect(all).toHaveLength(11); expect(new Set(all).size).toBe(11);
  });
  it("подборки, документы, косвенные и постсделочные задачи ведут к первичным записям", async () => {
    const c=await makeClient(u.realtor1); const n=await makeNeed(u.realtor1,c.id);
    const collection=await db.propertyCollection.create({data:{name:"Контрольная подборка",ownerUserId:u.realtor1.userId,needs:{create:{needId:n.id,linkedBy:u.realtor1.userId}}}});
    const doc=await db.document.create({data:{originalName:"Контрольный документ.pdf",documentTypeCode:"other",mimeType:"application/pdf",fileSize:10n,storageKey:"test-doc",uploadedBy:u.realtor1.userId,needLinks:{create:{clientNeedId:n.id}}}});
    const task=await db.task.create({data:{title:"Контроль после сделки",taskType:"postdeal",status:"planned",priority:"normal",responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,dueAt:new Date(),needLinks:{create:{clientNeedId:n.id}}}});
    const page=await getClientTimelinePage(u.realtor1,c.id,{});
    expect(page.items.find(e=>e.kind==="collection")?.href).toBe(`/collections/${collection.id}`);
    expect(page.items.find(e=>e.id===doc.id)?.href).toBe(`/api/v1/documents/${doc.id}/download`);
    expect(page.items.find(e=>e.id===task.id)?.kind).toBe("postdeal");
    expect(JSON.stringify(page)).not.toContain("storageKey");
  });
});

it("AT-13 реклама и внешнее объявление выбираются по названию и фильтруются в статистике", async () => {
  const p=await makeProperty(u.realtor2,{addressText:"Тестовый проспект, 13"});
  const ad=await db.advertisement.create({data:{propertyId:p.id,platformCode:"avito",status:"draft",responsibleUserId:u.realtor2.userId}});
  const ext=await db.externalListing.create({data:{source:"cian",url:"https://example.test/listing",sourceMethod:"manual",operation:"rent",priceUnit:"per_month",address:"Тестовый проспект, 14"}});
  const { pickCallContext }=await import("@/modules/requests/application/call-pickers");
  expect((await pickCallContext(u.realtor1,{kind:"advertisement",q:"проспект"})).items[0]?.id).toBe(ad.id);
  expect((await pickCallContext(u.realtor1,{kind:"external",q:"проспект"})).items).toEqual([]);
  await db.searchBookmark.create({data:{userId:u.realtor1.userId,listingId:ext.id}});
  expect((await pickCallContext(u.realtor1,{kind:"external",q:"проспект"})).items[0]?.id).toBe(ext.id);
  const r=await registerRequest(u.realtor1,{...base,advertisementId:ad.id,externalListingId:ext.id,client:{mode:"none"},outcome:{resultCode:"one_off_service"}});
  const row=await db.leadRequest.findUniqueOrThrow({where:{id:r.requestId}});expect(row.propertyId).toBe(p.id);expect(row.externalListingId).toBe(ext.id);expect(row.responsibleUserId).toBe(u.realtor2.userId);
  expect((await getCallSourceReport(u.realtor1,{advertisementId:ad.id})).total.calls).toBe(1);
  expect((await getCallSourceDetails(u.realtor1,{advertisementId:ad.id})).items[0]?.id).toBe(r.requestId);
});
it("AT-14 курсор для создания и выполнения одной задачи сохраняет оба события",async()=>{
  const c=await makeClient(u.realtor1);const at=new Date("2026-11-01T05:00:00Z");
  const task=await db.task.create({data:{title:"Выполненная задача",responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,taskType:"other",status:"completed",priority:"normal",dueAt:at,createdAt:at,completedAt:at,clientLinks:{create:{clientId:c.id}}}});
  const a=await getClientTimelinePage(u.realtor1,c.id,{kind:"task",pageSize:1});
  const b=await getClientTimelinePage(u.realtor1,c.id,{kind:"task",pageSize:1,cursor:a.nextCursor});
  expect(a.items[0]?.id).toBe(task.id);expect(b.items[0]?.id).toBe(task.id);expect(a.items[0]?.sortKind).not.toBe(b.items[0]?.sortKind);expect(b.nextCursor).toBeNull();
});
it("AT-14 фильтр потребности включает связанную сделку/документ и фактическое время показа",async()=>{
  const c=await makeClient(u.realtor1),n=await makeNeed(u.realtor1,c.id),p=await makeProperty(u.realtor1);
  const showing=await db.showing.create({data:{clientNeedId:n.id,propertyId:p.id,createdBy:u.realtor1.userId,responsibleUserId:u.realtor1.userId,scheduledAt:new Date("2026-11-01T05:00:00Z"),occurredAt:new Date("2026-11-02T05:00:00Z"),status:"completed"}});
  const deal=await db.deal.create({data:{propertyId:p.id,responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,legalEntityId:u.llcId,status:"draft",parties:{create:{clientId:c.id,partyRole:"buyer"}}}});
  const doc=await db.document.create({data:{originalName:"Документ сделки",documentTypeCode:"other",mimeType:"text/plain",fileSize:10n,storageKey:"deal-document",uploadedBy:u.realtor1.userId,dealLinks:{create:{dealId:deal.id}}}});
  const page=await getClientTimelinePage(u.realtor1,c.id,{needId:n.id});
  expect(page.items.find(e=>e.id===showing.id)?.at.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  expect(page.items.find(e=>e.id===deal.id)?.kind).toBe("deal");expect(page.items.find(e=>e.id===doc.id)?.kind).toBe("document");
});
it("AT-14 ссылка открывает старую первичную коммуникацию независимо от первой страницы", async () => {
  const c = await makeClient(u.realtor1);
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(await db.communication.create({ data: { clientId: c.id, authorUserId: u.realtor1.userId, communicationType: "call", occurredAt: new Date(2026, 10, 1 + i), comment: `Контакт ${i}` } }));
  const old = rows[0]!;
  const page = await getClientTimelinePage(u.realtor1, c.id, { kind: "communication", eventId: old.id, pageSize: 1 });
  expect(page.items.map(e => e.id)).toEqual([old.id]);
  expect(page.items[0]?.href).toContain(`eventId=${old.id}`);
  expect(page.nextCursor).toBeNull();
});
it("AT-13 контекст перенесённого внешнего объявления сохраняет правило ответственности", async () => {
  const p = await makeProperty(u.realtor2);
  const ext = await db.externalListing.create({ data: { source: "cian", url: "https://example.test/linked", sourceMethod: "manual", operation: "rent", priceUnit: "per_month", propertyId: p.id } });
  const r = await registerRequest(u.realtor1, { ...base, externalListingId: ext.id, client: { mode: "none" }, outcome: { resultCode: "one_off_service" } });
  expect(r.responsibleUserId).toBe(u.realtor2.userId);
  expect((await db.leadRequest.findUniqueOrThrow({ where: { id: r.requestId } })).propertyId).toBe(p.id);
  const other = await makeProperty(u.realtor1);
  await expect(registerRequest(u.realtor1, { ...base, externalListingId: ext.id, propertyId: other.id, client: { mode: "none" }, outcome: { resultCode: "one_off_service" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(await db.leadRequest.count()).toBe(1);
});
