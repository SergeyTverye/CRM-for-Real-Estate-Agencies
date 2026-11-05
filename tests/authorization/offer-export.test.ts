import { beforeEach, expect, it } from "vitest";
import { resetDatabase, seedBase, makeClient, makeNeed, makeProperty, apiRequest, routeParams, sessionCookieFor } from "../helpers/fixtures";
import { createOffer } from "@/modules/commercial-offers/application/offer-service";
import { getOfferPrintData } from "@/modules/commercial-offers/application/offer-print-data";
import { GET as pdfGet } from "@/app/api/v1/offers/[id]/pdf/route";
import { POST as docxPost } from "@/app/api/v1/offers/[id]/document/route";

beforeEach(resetDatabase);
it("returns 404 for another realtor's PDF, DOCX and print data; unauthenticated PDF returns 401", async () => {
  const u = await seedBase(); const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id); const p = await makeProperty(u.realtor1);
  const o = await createOffer(u.realtor1, { clientNeedId: n.id, items: [{ propertyId: p.id }] });
  const cookie = await sessionCookieFor(u.realtor2);
  expect((await pdfGet(apiRequest("GET", `/api/v1/offers/${o.id}/pdf`, { cookie }), routeParams({ id: o.id }))).status).toBe(404);
  expect((await docxPost(apiRequest("POST", `/api/v1/offers/${o.id}/document`, { cookie }), routeParams({ id: o.id }))).status).toBe(404);
  expect((await pdfGet(apiRequest("GET", `/api/v1/offers/${o.id}/pdf`), routeParams({ id: o.id }))).status).toBe(401);
  await expect(getOfferPrintData(u.realtor2, o.id)).rejects.toMatchObject({ status: 404 });
});
