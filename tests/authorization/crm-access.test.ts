import { beforeEach, describe, expect, it } from "vitest";
import { apiRequest, db, makeClient, makeNeed, makeProperty, readBody, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
import { GET as getClient, PATCH as patchClient } from "@/app/api/v1/clients/[id]/route";
import { GET as listClientsRoute } from "@/app/api/v1/clients/route";
import { GET as getNeed } from "@/app/api/v1/needs/[id]/route";
import { GET as getProperty, PATCH as patchProperty } from "@/app/api/v1/properties/[id]/route";
import { POST as grantRoute } from "@/app/api/v1/properties/[id]/grants/route";
import { DELETE as revokeRoute } from "@/app/api/v1/properties/[id]/grants/[grantId]/route";
import { GET as timelineRoute } from "@/app/api/v1/clients/[id]/timeline/route";
import { addPropertyOwner } from "@/modules/properties/application/property-service";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

describe("T05: риелтор не получает чужого клиента и его данные", () => {
  it("прямой GET/PATCH чужого Client по ID — 404, список и история закрыты", async () => {
    const { id } = await makeClient(u.realtor1, { displayName: "Клиент Риелтора Один" });
    const cookie = await sessionCookieFor(u.realtor2);
    expect((await getClient(apiRequest("GET", `/api/v1/clients/${id}`, { cookie }), routeParams({ id }))).status).toBe(404);
    expect((await timelineRoute(apiRequest("GET", `/api/v1/clients/${id}/timeline`, { cookie }), routeParams({ id }))).status).toBe(404);
    const patch = await patchClient(
      apiRequest("PATCH", `/api/v1/clients/${id}`, { cookie, body: { expectedUpdatedAt: new Date().toISOString(), notes: "взлом" } }),
      routeParams({ id }),
    );
    expect(patch.status).toBe(404);
    const list = await readBody<{ items: { id: string }[]; total: number }>(await listClientsRoute(apiRequest("GET", "/api/v1/clients?q=Риелтора", { cookie }), routeParams({})));
    expect(list.total).toBe(0);
    // Владелец и руководитель — видят.
    expect((await getClient(apiRequest("GET", `/api/v1/clients/${id}`, { cookie: await sessionCookieFor(u.realtor1) }), routeParams({ id }))).status).toBe(200);
    expect((await getClient(apiRequest("GET", `/api/v1/clients/${id}`, { cookie: await sessionCookieFor(u.manager) }), routeParams({ id }))).status).toBe(200);
  });

  it("чужая ClientNeed по ID — 404", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id } = await makeNeed(u.realtor1, clientId);
    const res = await getNeed(apiRequest("GET", `/api/v1/needs/${id}`, { cookie: await sessionCookieFor(u.realtor2) }), routeParams({ id }));
    expect(res.status).toBe(404);
  });
});

describe("T05 / FR-27, FR-30: каталог объектов и контакты собственника", () => {
  async function propertyWithOwner() {
    const { id } = await makeProperty(u.realtor1);
    await addPropertyOwner(u.realtor1, id, {
      newClient: { displayName: "Собственник Сидоров", contacts: [{ contactType: "phone", value: "+7 912 999-88-77" }] },
      ownerRole: "собственник",
    });
    return id;
  }

  it("чужой объект виден в каталоге, но контакты собственника скрыты; изменять нельзя", async () => {
    const id = await propertyWithOwner();
    const cookie = await sessionCookieFor(u.realtor2);
    const res = await getProperty(apiRequest("GET", `/api/v1/properties/${id}`, { cookie }), routeParams({ id }));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await readBody(res));
    expect(text).toContain("ул. Тестовая");
    expect(text).not.toContain("Сидоров");
    expect(text).not.toContain("912");
    const patch = await patchProperty(apiRequest("PATCH", `/api/v1/properties/${id}`, { cookie, body: { expectedUpdatedAt: new Date().toISOString(), price: "1" } }), routeParams({ id }));
    expect(patch.status).toBe(403);
  });

  it("выдача grant открывает контакты, отзыв — немедленно закрывает; оба события в AuditLog", async () => {
    const id = await propertyWithOwner();
    const managerCookie = await sessionCookieFor(u.manager);
    const realtorCookie = await sessionCookieFor(u.realtor2);
    // Риелтор не может выдать доступ себе сам.
    const self = await grantRoute(apiRequest("POST", `/api/v1/properties/${id}/grants`, { cookie: realtorCookie, body: { userId: u.realtor2.userId } }), routeParams({ id }));
    expect(self.status).toBe(403);

    const g = await readBody<{ id: string }>(
      await grantRoute(apiRequest("POST", `/api/v1/properties/${id}/grants`, { cookie: managerCookie, body: { userId: u.realtor2.userId, comment: "показ" } }), routeParams({ id })),
    );
    const visible = JSON.stringify(await readBody(await getProperty(apiRequest("GET", `/api/v1/properties/${id}`, { cookie: realtorCookie }), routeParams({ id }))));
    expect(visible).toContain("Сидоров");
    expect(visible).toContain("+7 912 999-88-77");

    const rv = await revokeRoute(apiRequest("DELETE", `/api/v1/properties/${id}/grants/${g.id}`, { cookie: managerCookie }), routeParams({ id, grantId: g.id }));
    expect(rv.status).toBe(200);
    const hidden = JSON.stringify(await readBody(await getProperty(apiRequest("GET", `/api/v1/properties/${id}`, { cookie: realtorCookie }), routeParams({ id }))));
    expect(hidden).not.toContain("Сидоров");
    const actions = (await db.auditLog.findMany({ where: { entityId: id }, orderBy: { occurredAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["owner_contacts.granted", "owner_contacts.revoked"]);
  });
});
