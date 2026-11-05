import { beforeEach,it,expect } from "vitest";
import { db,resetDatabase,seedBase,makeClient,makeNeed,makeProperty,apiRequest,routeParams,sessionCookieFor,type TestUsers } from "../helpers/fixtures";
import { createOffer } from "@/modules/commercial-offers/application/offer-service";
import { POST as note } from "@/app/api/v1/ai/call-note/route";
import { POST as offerText } from "@/app/api/v1/ai/offer-text/route";
import { POST as confirmNote } from "@/app/api/v1/ai/call-note/confirm/route";
import { POST as confirmOffer } from "@/app/api/v1/ai/offer-text/confirm/route";
let users:TestUsers;
beforeEach(async()=>{await resetDatabase();users=await seedBase();});
it("foreign client and need return 404 even with AI disabled; no cost reservation",async()=>{
  const client=await makeClient(users.realtor2);const need=await makeNeed(users.realtor2,client.id);const cookie=await sessionCookieFor(users.realtor1);
  for(const context of [{kind:"client",id:client.id},{kind:"need",id:need.id}]) {
    const response=await note(apiRequest("POST","/api/v1/ai/call-note",{cookie,body:{context,note:"Нужен офис"}}),routeParams({}));
    expect(response.status).toBe(404);
  }
  expect(await db.aiUsageLog.count()).toBe(0);
});
it("foreign offer returns 404 and does not disclose its snapshots",async()=>{
  const client=await makeClient(users.realtor2);const need=await makeNeed(users.realtor2,client.id);const property=await makeProperty(users.realtor2);
  const offer=await createOffer(users.realtor2,{clientNeedId:need.id,items:[{propertyId:property.id}]});
  const cookie=await sessionCookieFor(users.realtor1);
  const response=await offerText(apiRequest("POST","/api/v1/ai/offer-text",{cookie,body:{offerId:offer.id,kind:"intro"}}),routeParams({}));
  expect(response.status).toBe(404);expect(await response.text()).not.toContain("addressSnapshot");expect(await db.aiUsageLog.count()).toBe(0);
  const confirmation=await confirmOffer(apiRequest("POST","/api/v1/ai/offer-text/confirm",{cookie,body:{offerId:offer.id,confirmed:true,text:"Офис",expectedUpdatedAt:new Date().toISOString()}}),routeParams({}));
  expect(confirmation.status).toBe(404);
});
it("a forged confirmation cannot create a need or task for another client",async()=>{
  const client=await makeClient(users.realtor2);const cookie=await sessionCookieFor(users.realtor1);
  const response=await confirmNote(apiRequest("POST","/api/v1/ai/call-note/confirm",{cookie,body:{context:{kind:"client",id:client.id},confirmed:true,filters:{operation:"sale"},task:{taskType:"call_or_contact",title:"Позвонить",description:null,dueAt:new Date().toISOString()},expectedUpdatedAt:null}}),routeParams({}));
  expect(response.status).toBe(404);expect(await db.clientNeed.count()).toBe(0);expect(await db.task.count()).toBe(0);
});
