import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedBase, makeClient, makeNeed, makeProperty, apiRequest, routeParams, sessionCookieFor } from "../helpers/fixtures";
import { createCollection, getCollection, addItems, linkNeed, updateItem } from "@/modules/collections/application/collection-service";
import { exportCollection } from "@/modules/collections/application/export-service";
import { GET } from "@/app/api/v1/collections/[id]/route";
describe("RBAC подборок", () => {
  beforeEach(resetDatabase);
  it("чужая private → API 404 даже manager; team видна, скрыты чужие связи и комментарии во всех экспортах", async () => {
    const { realtor1: a, realtor2: b, manager } = await seedBase();
    const privateCollection = await createCollection(a, { name: "Личная" });
    for (const actor of [b, manager]) { const response = await GET(apiRequest("GET", `/api/v1/collections/${privateCollection.id}`, { cookie: await sessionCookieFor(actor) }), routeParams({ id: privateCollection.id })); expect(response.status).toBe(404); }
    const c = await createCollection(a, { name: "Командная", visibility: "team" }); const p = await makeProperty(a); await addItems(a, c.id, [{ propertyId: p.id }]);
    let card = await getCollection(a, c.id);
    await updateItem(a, c.id, card.items[0]!.id, { expectedUpdatedAt: card.items[0]!.updatedAt.toISOString(), comment: "Закрытый комментарий клиента" });
    const client = await makeClient(a, { displayName: "Закрытый клиент" }); const need = await makeNeed(a, client.id);
    card = await getCollection(a, c.id); await linkNeed(a, c.id, { expectedUpdatedAt: card.updatedAt.toISOString(), needId: need.id });
    const visible = await getCollection(b, c.id); expect(visible.items).toHaveLength(1); expect(visible.needs).toHaveLength(0); expect(visible.canEdit).toBe(false); expect(JSON.stringify(visible)).not.toContain("Закрытый");
    const exported = await exportCollection(b, c.id, { format: "csv" }); expect(new TextDecoder().decode(exported.bytes)).not.toContain("Закрытый");
  });
  it("чужая потребность при привязке → 404, добавление чужому владельцу запрещено", async () => {
    const { realtor1: a, realtor2: b } = await seedBase(); const c = await createCollection(a, { name: "Моя" }); const client = await makeClient(b); const need = await makeNeed(b, client.id);
    const card = await getCollection(a, c.id);
    await expect(linkNeed(a, c.id, { expectedUpdatedAt: card.updatedAt.toISOString(), needId: need.id })).rejects.toMatchObject({ status: 404 });
    const team = await createCollection(b, { name: "Команда", visibility: "team" }); const p = await makeProperty(a);
    await expect(addItems(a, team.id, [{ propertyId: p.id }])).rejects.toMatchObject({ status: 404 });
  });
});
