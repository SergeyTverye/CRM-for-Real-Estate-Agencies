import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { db,resetDatabase,seedBase,makeClient,makeNeed,makeProperty,inDays,type TestUsers } from "../helpers/fixtures";
import { previewCallNote,confirmCallNote,previewOfferText,confirmOfferText } from "@/modules/ai/application/p2-service";
import { createOffer } from "@/modules/commercial-offers/application/offer-service";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { createSearchAi } from "@/modules/ai/infrastructure/create-search-ai";
import { PrismaAiLedger,PrismaAiSettings,PrismaAiTariffs } from "@/modules/ai/infrastructure/prisma-repositories";
import { resetConfigCache,getConfig } from "@/shared/config/env";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";
let users:TestUsers;
const filters = {operation:"rent",priceUnit:"rub_month",areaFrom:40,areaTo:120,priceTo:"150000",purposes:["office"]};
const task = {taskType:"call_or_contact",title:"Позвонить по подбору",description:null,dueAt:inDays(1)};
beforeEach(async()=>{vi.stubEnv("AI_ENABLED","true");resetConfigCache();await resetDatabase();users=await seedBase();await db.aiSetting.create({data:{aiEnabled:true}});await seedAiTariffs(db);});
afterEach(()=>{vi.unstubAllEnvs();resetConfigCache();});
function fake(text:string) {
  const provider = new FakeResponsesProvider(()=>({text}));
  return {provider,ai:createSearchAi(getConfig(),{ledger:new PrismaAiLedger(),settings:new PrismaAiSettings(),tariffs:new PrismaAiTariffs()},provider)};
}
it("preview writes only cost ledger, confirmation atomically creates active need and next task",async()=>{
  const client = await makeClient(users.realtor1,{displayName:"Иван Петров"});
  const context = {kind:"client",id:client.id};
  const f=fake(JSON.stringify({filters,taskType:task.taskType,taskTitle:task.title,taskDescription:null,taskDueAt:task.dueAt,clarificationQuestion:null}));
  const result=await previewCallNote(users.realtor1,{context,note:"Иван Петров ищет офис 80 м², 150000 руб. в месяц, +7 900 123-45-67"},f.ai);
  expect(f.provider.requests[0]!.input).not.toMatch(/Иван|Петров|900/);
  expect(await db.clientNeed.count()).toBe(0);expect(await db.task.count()).toBe(0);expect(await db.searchRun.count()).toBe(0);
  expect(await db.aiUsageLog.findFirst()).toMatchObject({callType:"call_note",status:"success",inputTokens:100,outputTokens:50});
  expect((await db.aiUsageLog.findFirst())?.searchRunId).toBeNull();
  expect(await db.aiBudgetReservation.findFirst()).toMatchObject({status:"settled"});
  const saved=await confirmCallNote(users.realtor1,{context,confirmed:true,filters:result.filters,task:result.task,expectedUpdatedAt:null});
  expect(await db.clientNeed.findUnique({where:{id:saved.id}})).toMatchObject({status:"active",operationType:"rent",commercialPurpose:"office"});
  expect(await db.taskNeed.count({where:{clientNeedId:saved.id}})).toBe(1);
});
it("uses client, contact-person and staff names only for redaction before dispatch", async () => {
  const client = await makeClient(users.realtor1, { displayName: "Злата Белозерова" });
  await db.clientContactPerson.create({ data: { clientId: client.id, fullName: "Назар Дубровский" } });
  await db.user.update({ where: { id: users.realtor2.userId }, data: { displayName: "Мирон Свиридов" } });
  const f = fake(JSON.stringify({filters,taskType:task.taskType,taskTitle:task.title,taskDescription:null,taskDueAt:null,clarificationQuestion:null}));
  await previewCallNote(users.realtor1, { context: {kind:"client",id:client.id}, note: "со златой белозеровой, назару дубровскому и мирону свиридову нужен офис 80 м²" }, f.ai);
  expect(f.provider.requests).toHaveLength(1);
  expect(f.provider.requests[0]!.input).not.toMatch(/злат|белозер|назар|дубровск|мирон|свирид/iu);
  expect(f.provider.requests[0]!.input).toContain("80 м²");
});
it("preserves public offer snapshot addresses while removing contacts", async () => {
  const client = await makeClient(users.realtor1, {displayName:"Иван Петров"});
  const need = await makeNeed(users.realtor1, client.id);
  const property = await makeProperty(users.realtor1, {addressText:"Красный Проспект, 25", area:"80",price:"100000"});
  const offer = await createOffer(users.realtor1,{clientNeedId:need.id,items:[{propertyId:property.id}]});
  await db.commercialOfferItem.updateMany({where:{commercialOfferId:offer.id},data:{termsSnapshot:"улица Ивана Петрова; +7 900 123-45-67; test@example.ru"}});
  const f = fake('{"text":"Площадь 80 м²"}');
  await previewOfferText(users.realtor1,{offerId:offer.id,kind:"intro"},f.ai);
  const payload = f.provider.requests[0]!.input;
  expect(payload).toContain("Красный Проспект, 25"); expect(payload).toContain("улица Ивана Петрова");
  expect(payload).not.toMatch(/900|test@example/);
});
it("explicit confirmation and task due date required; invalid creation leaves no partial need",async()=>{
  const client=await makeClient(users.realtor1);const data={context:{kind:"client",id:client.id},filters,task,expectedUpdatedAt:null};
  await expect(confirmCallNote(users.realtor1,{...data,confirmed:false})).rejects.toThrow();
  await expect(confirmCallNote(users.realtor1,{...data,confirmed:true,task:{...task,dueAt:null}})).rejects.toThrow();
  expect(await db.clientNeed.count()).toBe(0);expect(await db.task.count()).toBe(0);
});
it("existing need update adds task in same transaction and rejects stale version",async()=>{
  const client=await makeClient(users.realtor1);const need=await makeNeed(users.realtor1,client.id);
  const old=await db.clientNeed.findUniqueOrThrow({where:{id:need.id}});
  const data={context:{kind:"need",id:need.id},confirmed:true,filters,task,expectedUpdatedAt:old.updatedAt.toISOString()};
  await confirmCallNote(users.realtor1,data);
  expect(await db.taskNeed.count({where:{clientNeedId:need.id}})).toBe(2);
  await expect(confirmCallNote(users.realtor1,data)).rejects.toMatchObject({code:"STALE_UPDATE"});
  expect(await db.taskNeed.count({where:{clientNeedId:need.id}})).toBe(2);
});
it("offer uses snapshot, not changed Property; draft remains unsaved until explicit confirmation",async()=>{
  const client=await makeClient(users.realtor1,{displayName:"Иван Петров"});const need=await makeNeed(users.realtor1,client.id);
  const property=await makeProperty(users.realtor1,{area:"80",price:"100000"});
  const offer=await createOffer(users.realtor1,{clientNeedId:need.id,items:[{propertyId:property.id}]});
  await db.property.update({where:{id:property.id},data:{area:"999",price:"999999"}});
  const f=fake(JSON.stringify({text:"Площадь 80 м², цена 100000 ₽."}));
  const preview=await previewOfferText(users.realtor1,{offerId:offer.id,kind:"comparison"},f.ai);
  expect(f.provider.requests[0]!.input).not.toMatch(/Иван|Петров|999999|999/);
  expect((await db.commercialOffer.findUniqueOrThrow({where:{id:offer.id}})).introText).toBeNull();
  await confirmOfferText(users.realtor1,{offerId:offer.id,confirmed:true,text:preview.text,expectedUpdatedAt:preview.expectedUpdatedAt});
  expect(await db.commercialOffer.findUnique({where:{id:offer.id}})).toMatchObject({introText:preview.text,status:"draft"});
  expect(await db.aiUsageLog.findFirst()).toMatchObject({callType:"offer_text",status:"success"});
});
it("unsupported provider numbers settle actual cost as error and never save offer text",async()=>{
  const client=await makeClient(users.realtor1);const need=await makeNeed(users.realtor1,client.id);const property=await makeProperty(users.realtor1);
  const offer=await createOffer(users.realtor1,{clientNeedId:need.id,items:[{propertyId:property.id}]});
  const f=fake('{"text":"Площадь 987654 м²"}');
  await expect(previewOfferText(users.realtor1,{offerId:offer.id,kind:"intro"},f.ai)).rejects.toThrow();
  expect(await db.aiUsageLog.findFirst()).toMatchObject({status:"error",inputTokens:100,outputTokens:50});
  expect((await db.commercialOffer.findUniqueOrThrow({where:{id:offer.id}})).introText).toBeNull();
});
it("disabled AI has a clear message and makes no provider call or reservation",async()=>{
  const client=await makeClient(users.realtor1);vi.stubEnv("AI_ENABLED","false");resetConfigCache();
  const f=fake("{}");
  await expect(previewCallNote(users.realtor1,{context:{kind:"client",id:client.id},note:"Нужен офис"},f.ai)).rejects.toMatchObject({code:"AI_DISABLED"});
  expect(f.provider.requests).toHaveLength(0);expect(await db.aiUsageLog.count()).toBe(0);
});
