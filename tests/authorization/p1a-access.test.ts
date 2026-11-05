import { GET as checklistGet } from "@/app/api/v1/deals/[id]/checklist/route";
import { POST as revisionPost } from "@/app/api/v1/offers/[id]/revision/route";
import { beforeEach, expect, it } from "vitest";
import { apiRequest, routeParams, sessionCookieFor, db, makeClient, makeNeed, makeProperty, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { createOffer, createOfferRevision } from "@/modules/commercial-offers/application/offer-service";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";
import { createDeal } from "@/modules/deals/application/deal-service";
import { initializeChecklist, getChecklist, updateChecklistItem } from "@/modules/deals/application/checklist-service";
import { exportRegister } from "@/modules/export/application/register-export";
import { getReportDetail } from "@/modules/reports/application/report-service";
let u: TestUsers;
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
it("rejects foreign offers/revisions/documents/checklists and scopes CSV registers", async () => {
 const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1,c.id); const p = await makeProperty(u.realtor1);
 const o = await createOffer(u.realtor1, { clientNeedId: n.id, items: [{ propertyId: p.id }] });
 const offer = await db.commercialOffer.findUniqueOrThrow({ where: { id: o.id } });
 await expect(createOfferRevision(u.realtor2,o.id,{expectedUpdatedAt:offer.updatedAt.toISOString()})).rejects.toMatchObject({status:404});
 await expect(generateOfferDocument(u.realtor2,o.id)).rejects.toMatchObject({status:404});
 const d = await createDeal(u.realtor1,{propertyId:p.id,legalEntityId:u.llcId,parties:[{clientId:c.id,partyRole:"tenant"}],commissions:[{amount:"12345",status:"received"}]});
 await initializeChecklist(u.realtor1,d.id); const item=(await getChecklist(u.realtor1,d.id)).items[0]!;
 await expect(getChecklist(u.realtor2,d.id)).rejects.toMatchObject({status:404});
 const cookie = await sessionCookieFor(u.realtor2);
 expect((await checklistGet(apiRequest("GET", `/api/v1/deals/${d.id}/checklist`, { cookie }), routeParams({ id: d.id }))).status).toBe(404);
 expect((await revisionPost(apiRequest("POST", `/api/v1/offers/${o.id}/revision`, { cookie, body: { expectedUpdatedAt: offer.updatedAt.toISOString() } }), routeParams({ id: o.id }))).status).toBe(404);
 await expect(updateChecklistItem(u.realtor2,d.id,item.id,{expectedUpdatedAt:item.updatedAt.toISOString(),status:"verified"})).rejects.toMatchObject({status:404});
 for(const kind of ["deals","commissions","tasks"]) {const out=await exportRegister(u.realtor2,kind,{view:"all",status:kind==="tasks"?"all":undefined}); expect(out.count).toBe(0); expect(out.csv.charCodeAt(0)).toBe(0xfeff); expect(out.csv).not.toContain(c.id);}
 expect((await exportRegister(u.manager,"deals",{status:"draft"})).count).toBe(1);
 await expect(getReportDetail(u.realtor1,"newRequests")).rejects.toMatchObject({status:403});
});
