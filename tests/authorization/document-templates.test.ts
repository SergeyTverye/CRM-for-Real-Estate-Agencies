import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedBase, makeClient, makeNeed, makeProperty, db, apiRequest, sessionCookieFor, routeParams, type TestUsers } from "../helpers/fixtures";
import { clientYaml, collectionYaml } from "../helpers/template-fixtures";
import { saveTemplate, generateFromTemplate, openTemplateDocument, getTemplate, changeTemplateStatus } from "@/modules/document-templates/application/template-service";
import { documentScope } from "@/modules/access/domain/scopes";
import { POST } from "@/app/api/v1/templates/route";
import { POST as GENERATE } from "@/app/api/v1/templates/[id]/generate/route";
let u: TestUsers;
const meta = { code: "test_template", name: "Синтетический", format: "markdown_docx", manifestYaml: clientYaml, markdownBody: "{{client.displayName}}" };
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
describe("AT-15 authorization", () => {
  it("collection document access follows the normalized link after ownership changes", async () => {
    const c = await db.propertyCollection.create({ data: { name: "Синтетическая подборка", ownerUserId: u.realtor1.userId } });
    const other = await db.propertyCollection.create({ data: { name: "Открытая подборка", ownerUserId: u.realtor1.userId } });
    const p = await makeProperty(u.realtor1);
    await db.propertyCollectionItem.create({ data: { collectionId: c.id, propertyId: p.id, addedBy: u.realtor1.userId, status: "in_crm" } });
    const t = await saveTemplate(u.manager, { ...meta, code: "collection_access", manifestYaml: collectionYaml, markdownBody: "{{collection.name}}" }, null);
    const generated = await generateFromTemplate(u.realtor1, t.id, { entityKind: "collection", entityId: c.id });
    const id = generated.id!;
    expect(await db.document.count({ where: { id, ...documentScope(u.realtor1) } })).toBe(1);
    expect(await db.document.count({ where: { id, ...documentScope(u.realtor2) } })).toBe(0);
    await db.document.update({ where: { id }, data: { valuesSnapshot: { accessRoles: ["manager", "realtor"], source: { kind: "collection", ids: [other.id] } } } });
    await db.propertyCollection.update({ where: { id: c.id }, data: { ownerUserId: u.realtor2.userId } });
    expect(await db.document.count({ where: { id, ...documentScope(u.realtor1) } })).toBe(0);
    await expect(openTemplateDocument(u.realtor1, id)).rejects.toMatchObject({ status: 404 });
  });
  it("риелтор не управляет шаблонами даже прямым API", async () => {
    await expect(saveTemplate(u.realtor1, meta, null)).rejects.toMatchObject({ status: 403 });
    const t = await saveTemplate(u.manager, meta, null);
    await expect(getTemplate(u.realtor1, t.id)).rejects.toMatchObject({ status: 403 });
    await expect(changeTemplateStatus(u.realtor1, t.id, { status: "disabled", expectedUpdatedAt: t.updatedAt.toISOString() })).rejects.toMatchObject({ status: 403 });
    const res = await POST(apiRequest("POST", "/api/v1/templates", { cookie: await sessionCookieFor(u.realtor1), body: {} }), routeParams({})); expect(res.status).toBe(403);
  });
  it("чужая сущность, выбранная запись реестра и закрытая подборка не раскрываются", async () => {
    const t = await saveTemplate(u.manager, meta, null), a = await makeClient(u.realtor1), b = await makeClient(u.realtor2);
    await expect(generateFromTemplate(u.realtor1, t.id, { entityKind: "client", entityId: b.id })).rejects.toMatchObject({ status: 404 });
    const res = await GENERATE(apiRequest("POST", `/api/v1/templates/${t.id}/generate`, { cookie: await sessionCookieFor(u.realtor1), body: { entityKind: "client", entityId: b.id } }), routeParams({ id: t.id })); expect(res.status).toBe(404);
    const registry = await saveTemplate(u.manager, { ...meta, code: "registry", format: "xlsx_registry" }, null);
    await expect(generateFromTemplate(u.realtor1, registry.id, { entityKind: "client", entityId: a.id, selectedIds: [a.id, b.id] })).rejects.toMatchObject({ status: 404 });
    expect(await db.document.count()).toBe(0);
  });
  it("ограничения манифеста защищают готовый файл и поиск через общий documentScope", async () => {
    const a = await makeClient(u.realtor1);
    const t = await saveTemplate(u.manager, { ...meta, manifestYaml: clientYaml.replace('required: true', 'required: true\n    roles: [manager]') }, null);
    const generated = await generateFromTemplate(u.manager, t.id, { entityKind: "client", entityId: a.id });
    expect(await db.document.count({ where: { id: generated.id!, ...documentScope(u.realtor1) } })).toBe(0);
    await expect(openTemplateDocument(u.realtor1, generated.id!)).rejects.toMatchObject({ status: 404 });
  });
  it("доступ к сохранённому файлу перепроверяется после передачи клиента", async () => {
    const t = await saveTemplate(u.manager, meta, null), a = await makeClient(u.realtor1);
    const generated = await generateFromTemplate(u.realtor1, t.id, { entityKind: "client", entityId: a.id });
    await db.client.update({ where: { id: a.id }, data: { responsibleUserId: u.realtor2.userId } });
    await expect(openTemplateDocument(u.realtor1, generated.id!)).rejects.toMatchObject({ status: 404 });
  });
  it("чужие Need, Deal, Offer и private Collection не дают контекст генерации", async () => {
    const client = await makeClient(u.realtor2), need = await makeNeed(u.realtor2, client.id), property = await makeProperty(u.realtor2);
    const deal = await db.deal.create({ data: { propertyId: property.id, responsibleUserId: u.realtor2.userId, createdBy: u.realtor2.userId, legalEntityId: u.llcId, status: "draft" } });
    const offer = await db.commercialOffer.create({ data: { clientNeedId: need.id, responsibleUserId: u.realtor2.userId, createdBy: u.realtor2.userId, status: "draft" } });
    const collection = await db.propertyCollection.create({ data: { name: "Закрытая", ownerUserId: u.realtor2.userId } });
    const cases = [
      { kind: "need", id: need.id, source: "need", path: "need.operationType", type: "text" },
      { kind: "deal", id: deal.id, source: "deal", path: "deal.date", type: "date" },
      { kind: "offer", id: offer.id, source: "offer", path: "offer.date", type: "date" },
    ];
    for (const c of cases) {
      const yaml = `schemaVersion: 1\nentityKind: ${c.kind}\nsources: [${c.source}]\nfields:\n - {path: ${c.path}, label: Поле, type: ${c.type}}`;
      const t = await saveTemplate(u.manager, { ...meta, code: `denied_${c.kind}`, manifestYaml: yaml, markdownBody: `{{${c.path}}}` }, null);
      await expect(generateFromTemplate(u.realtor1, t.id, { entityKind: c.kind, entityId: c.id })).rejects.toMatchObject({ status: 404 });
    }
    const t = await saveTemplate(u.manager, { ...meta, code: "denied_collection", manifestYaml: collectionYaml, markdownBody: "{{collection.name}}" }, null);
    await expect(generateFromTemplate(u.realtor1, t.id, { entityKind: "collection", entityId: collection.id })).rejects.toMatchObject({ status: 404 });
  });
});
