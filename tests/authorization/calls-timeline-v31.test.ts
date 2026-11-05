import { beforeEach, expect, it } from "vitest";
import { db, apiRequest, routeParams, sessionCookieFor, makeClient, makeNeed, makeProperty, nextAction, NEED_PARAMS, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { getClientTimelinePage } from "@/modules/clients/application/timeline-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { getCallSourceReport, getCallSourceDetails } from "@/modules/reports/application/call-source-service";
import { GET as timeline } from "@/app/api/v1/clients/[id]/timeline/route";
import { GET as sources } from "@/app/api/v1/reports/call-sources/route";
let u:TestUsers;
beforeEach(async()=>{await resetDatabase();u=await seedBase();});
it("чужой клиент: сервис и прямой API возвращают 404",async()=>{
 const c=await makeClient(u.realtor2,{displayName:"Закрытая карточка"});
 await expect(getClientTimelinePage(u.realtor1,c.id,{})).rejects.toMatchObject({code:"NOT_FOUND"});
 const response=await timeline(apiRequest("GET",`/api/v1/clients/${c.id}/timeline`,{cookie:await sessionCookieFor(u.realtor1)}),routeParams({id:c.id}));
 expect(response.status).toBe(404);expect(await response.text()).not.toContain("Закрытая");
});
it("таймлайн исключает чужие задачи, документы со смешанными ссылками и личные подборки",async()=>{
 const own=await makeClient(u.realtor1),foreign=await makeClient(u.realtor2); const n=await makeNeed(u.realtor1,own.id);
 await db.task.create({data:{title:"Закрытая задача",responsibleUserId:u.realtor2.userId,createdBy:u.realtor2.userId,taskType:"other",status:"planned",priority:"normal",dueAt:new Date(),clientLinks:{create:{clientId:own.id}}}});
 await db.task.create({data:{title:"Смешанная задача",responsibleUserId:u.realtor1.userId,createdBy:u.realtor1.userId,taskType:"other",status:"planned",priority:"normal",dueAt:new Date(),clientLinks:{create:[{clientId:own.id},{clientId:foreign.id}]}}});
 await db.document.create({data:{originalName:"Закрытый файл",documentTypeCode:"other",mimeType:"text/plain",fileSize:10n,storageKey:"secret-file",uploadedBy:u.realtor1.userId,clientLinks:{create:[{clientId:own.id},{clientId:foreign.id}]}}});
 await db.propertyCollection.create({data:{name:"Закрытая подборка",ownerUserId:u.realtor2.userId,visibility:"private",needs:{create:{needId:n.id,linkedBy:u.realtor2.userId}}}});
 const result=JSON.stringify(await getClientTimelinePage(u.realtor1,own.id,{}));
 for(const text of ["Закрытая задача","Смешанная задача","Закрытый файл","Закрытая подборка","secret-file"])expect(result).not.toContain(text);
 expect(JSON.stringify(await getClientTimelinePage(u.manager,own.id,{}))).not.toContain("Закрытая подборка");
 await expect(getClientTimelinePage(u.realtor1,own.id,{needId:(await makeNeed(u.realtor2,foreign.id)).id})).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("статистика и drill-down риелтора ограничены scope даже при фильтре чужого сотрудника",async()=>{
 const base={occurredAt:new Date().toISOString(),channelCode:"phone",sourceCode:"avito",client:{mode:"none"},outcome:{resultCode:"invalid_or_spam"}};
 await registerRequest(u.realtor1,{...base,summary:"Своё"});const foreign=await registerRequest(u.realtor2,{...base,summary:"Закрытый звонок"});
 expect((await getCallSourceReport(u.realtor1,{})).total.calls).toBe(1);
 expect((await getCallSourceReport(u.manager,{})).total.calls).toBe(2);
 expect((await getCallSourceReport(u.realtor1,{employeeId:u.realtor2.userId})).total.calls).toBe(0);
 const details=JSON.stringify(await getCallSourceDetails(u.realtor1,{}));expect(details).not.toContain(foreign.requestId);expect(details).not.toContain("Закрытый звонок");
 const response=await sources(apiRequest("GET","/api/v1/reports/call-sources",{cookie:await sessionCookieFor(u.realtor1)}),routeParams({}));
 expect(response.status).toBe(200);expect((await response.json()).total.calls).toBe(1);
});
it("свой зарегистрированный звонок не раскрывает переданного по объекту клиента через метрики", async () => {
 const p = await makeProperty(u.realtor2);
 const r = await registerRequest(u.realtor1, { occurredAt: new Date().toISOString(), channelCode: "phone", sourceCode: "avito", propertyId: p.id, summary: "Передан по правилу объекта", client: { mode: "new", client: { displayName: "Переданный клиент", contacts: [{ contactType: "phone", value: "+79121112233" }] } }, outcome: { resultCode: "new_need", need: NEED_PARAMS, nextAction: nextAction() } });
 expect((await getCallSourceReport(u.realtor1, {})).total).toEqual({ calls: 1, clients: 0, needs: 0, showings: 0, deals: 0 });
 const dto = JSON.stringify(await getCallSourceDetails(u.realtor1, {}));
 expect(dto).not.toContain(r.clientId); expect(dto).not.toContain(r.needId); expect(dto).not.toContain("Переданный клиент");
});
