import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, apiRequest, sessionCookieFor, routeParams } from "../helpers/fixtures";
import { regroupForListings, getDuplicateGroup } from "@/modules/listing-duplicates/application/duplicate-service";
import { POST } from "@/app/api/v1/listing-duplicates/[id]/decisions/route";
import { GET } from "@/app/api/v1/listing-duplicates/[id]/route";
describe("listing duplicates authorization and seller privacy", () => {
  beforeEach(resetDatabase);
  it("только активные сотрудники, обе роли могут решать; ПДн продавцов/сырой snapshot не раскрываются", async () => {
    const { realtor1, realtor2, manager } = await seedBase();
    const rows = [];
    for (let i = 0; i < 2; i++) rows.push(await db.externalListing.create({ data: { source: i ? "avito" : "cian", sourceListingId: `auth-${i}`, url: `https://www.cian.ru/sale/commercial/${i + 1}/?phone=79999999999`, operation: "sale", sourceMethod: "scraper", priceUnit: "total", city: "Новосибирск", address: "Мира 58", areaM2: "100", floorNumber: 1, sellerType: "Иван Секретный", description: "Иван Секретный +79999999999 seller@example.org", purposes: ["office"] } }));
    await db.externalListingSnapshot.create({ data: { listingId: rows[0]!.id, normalized: { seller: { phone: "+79999999999", name: "Иван Секретный" }, description: "seller@example.org", storageKey: "private-storage" } } });
    const { groupIds } = await regroupForListings(rows.map(r => r.id)); const id = groupIds[0]!;
    expect((await GET(apiRequest("GET", `/api/v1/listing-duplicates/${id}`), routeParams({ id }))).status).toBe(401);
    for (const actor of [realtor1, realtor2, manager]) {
      const cookie = await sessionCookieFor(actor); const path = `/api/v1/listing-duplicates/${id}/decisions`;
      const response = await GET(apiRequest("GET", `/api/v1/listing-duplicates/${id}`, { cookie }), routeParams({ id }));
      expect(response.status).toBe(200); const body = await response.json(); const text = JSON.stringify(body);
      for (const secret of ["Иван Секретный", "79999999999", "seller@example.org", "private-storage", "normalized", "ownerConfirmation"]) expect(text).not.toContain(secret);
      const decision = await POST(apiRequest("POST", path, { cookie, body: { decision: "defer", confirmed: true, expectedUpdatedAt: body.updatedAt } }), routeParams({ id }));
      expect(decision.status).toBe(200);
      expect((await POST(apiRequest("POST", path, { cookie, origin: "https://foreign.example", body: {} }), routeParams({ id }))).status).toBe(403);
    }
    const cookie = await sessionCookieFor(realtor1); await db.user.update({ where: { id: realtor1.userId }, data: { isActive: false } });
    expect((await GET(apiRequest("GET", `/api/v1/listing-duplicates/${id}`, { cookie }), routeParams({ id }))).status).toBe(401);
    await expect(getDuplicateGroup({ ...manager, mustChangePassword: true }, id)).rejects.toMatchObject({ status: 403 });
  });
});
