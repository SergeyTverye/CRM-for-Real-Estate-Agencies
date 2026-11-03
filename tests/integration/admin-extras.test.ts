import { beforeEach, describe, expect, it } from "vitest";
import { apiRequest, db, readBody, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
import {
  createLegalEntity,
  listActiveLegalEntities,
  listLegalEntities,
  updateLegalEntity,
} from "@/modules/legal-entities/application/legal-entity-service";
import { listAuditFacets, listAuditLog } from "@/modules/audit/application/audit-queries";
import { GET as listDictRoute, POST as createDictRoute } from "@/app/api/v1/admin/dictionaries/route";
import { PATCH as patchDictRoute } from "@/app/api/v1/admin/dictionaries/[id]/route";
import { GET as listLeRoute, POST as createLeRoute } from "@/app/api/v1/admin/legal-entities/route";
import { PATCH as patchLeRoute } from "@/app/api/v1/admin/legal-entities/[id]/route";
import { GET as activeLeRoute } from "@/app/api/v1/legal-entities/route";
import { DomainError, ForbiddenError, ValidationError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

describe("Администрирование: юридические субъекты (ИП/ООО)", () => {
  it("руководитель создаёт, переименовывает и деактивирует субъект; изменения в AuditLog", async () => {
    const le = await createLegalEntity(u.manager, { entityType: "IP", displayName: "ИП Новый" });
    expect(le.entityType).toBe("IP");
    await updateLegalEntity(u.manager, le.id, { displayName: "ИП Новый-2" });
    await updateLegalEntity(u.manager, le.id, { isActive: false });
    const actions = (await db.auditLog.findMany({ where: { entityId: le.id }, orderBy: { occurredAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["legal_entity.created", "legal_entity.renamed", "legal_entity.deactivated"]);
    expect((await listActiveLegalEntities()).map((x) => x.id)).not.toContain(le.id);
    const all = await listLegalEntities(u.manager);
    expect(all.find((x) => x.id === le.id)?.usage).toEqual({ deals: 0, agreements: 0, offers: 0 });
  });

  it("риелтор не может изменять юридические субъекты (сервер)", async () => {
    await expect(createLegalEntity(u.realtor1, { entityType: "LLC", displayName: "ООО Хак" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateLegalEntity(u.realtor1, u.llcId, { isActive: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listLegalEntities(u.realtor1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("валидация: форма ИП/ООО из codebook, уникальное наименование, последний активный не деактивируется", async () => {
    await expect(createLegalEntity(u.manager, { entityType: "JSC", displayName: "АО" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLegalEntity(u.manager, { entityType: "LLC", displayName: "ооо «тест»" })).rejects.toBeInstanceOf(ValidationError);
    await updateLegalEntity(u.manager, u.ipId, { isActive: false });
    await expect(updateLegalEntity(u.manager, u.llcId, { isActive: false })).rejects.toBeInstanceOf(DomainError);
  });

  it("API: риелтор получает 403 на админ-маршруты, но видит активные субъекты для выбора", async () => {
    const realtor = await sessionCookieFor(u.realtor1);
    expect((await listLeRoute(apiRequest("GET", "/api/v1/admin/legal-entities", { cookie: realtor }), routeParams({}))).status).toBe(403);
    const post = await createLeRoute(apiRequest("POST", "/api/v1/admin/legal-entities", { cookie: realtor, body: { entityType: "IP", displayName: "X" } }), routeParams({}));
    expect(post.status).toBe(403);
    const patch = await patchLeRoute(apiRequest("PATCH", `/api/v1/admin/legal-entities/${u.llcId}`, { cookie: realtor, body: { isActive: false } }), routeParams({ id: u.llcId }));
    expect(patch.status).toBe(403);
    const active = await activeLeRoute(apiRequest("GET", "/api/v1/legal-entities", { cookie: realtor }), routeParams({}));
    expect(active.status).toBe(200);
    const body = await readBody<{ items: { id: string; entityType: string; displayName: string }[] }>(active);
    expect(body.items.map((i) => i.id).sort()).toEqual([u.ipId, u.llcId].sort());
    expect(Object.keys(body.items[0]!).sort()).toEqual(["displayName", "entityType", "id"]);
  });

  it("API: руководитель создаёт субъект (201) и переименовывает его", async () => {
    const cookie = await sessionCookieFor(u.manager);
    const res = await createLeRoute(apiRequest("POST", "/api/v1/admin/legal-entities", { cookie, body: { entityType: "LLC", displayName: "ООО «Второе»" } }), routeParams({}));
    expect(res.status).toBe(201);
    const { id } = await readBody<{ id: string }>(res);
    const p = await patchLeRoute(apiRequest("PATCH", `/api/v1/admin/legal-entities/${id}`, { cookie, body: { displayName: "ООО «Второе+»" } }), routeParams({ id }));
    expect(p.status).toBe(200);
    expect((await db.legalEntity.findUniqueOrThrow({ where: { id } })).displayName).toBe("ООО «Второе+»");
  });
});

describe("Администрирование: API бизнес-справочников", () => {
  it("руководитель добавляет значение, меняет название/порядок и деактивирует его", async () => {
    const cookie = await sessionCookieFor(u.manager);
    const created = await createDictRoute(
      apiRequest("POST", "/api/v1/admin/dictionaries", { cookie, body: { category: "lead_source", code: "flyer", displayName: "Листовка", sortOrder: 50 } }),
      routeParams({}),
    );
    expect(created.status).toBe(201);
    const { id } = await readBody<{ id: string }>(created);
    const patch = await patchDictRoute(
      apiRequest("PATCH", `/api/v1/admin/dictionaries/${id}`, { cookie, body: { displayName: "Листовка у дома", sortOrder: 5, isActive: false } }),
      routeParams({ id }),
    );
    expect(patch.status).toBe(200);
    const item = await db.dictionaryItem.findUniqueOrThrow({ where: { id } });
    expect(item).toMatchObject({ code: "flyer", displayName: "Листовка у дома", sortOrder: 5, isActive: false });
    const list = await readBody<{ items: { code: string }[] }>(await listDictRoute(apiRequest("GET", "/api/v1/admin/dictionaries", { cookie }), routeParams({})));
    expect(list.items.some((i) => i.code === "flyer")).toBe(true);
  });

  it("риелтор получает 403; некорректный код отклоняется 400", async () => {
    const realtor = await sessionCookieFor(u.realtor1);
    expect((await listDictRoute(apiRequest("GET", "/api/v1/admin/dictionaries", { cookie: realtor }), routeParams({}))).status).toBe(403);
    const manager = await sessionCookieFor(u.manager);
    const bad = await createDictRoute(
      apiRequest("POST", "/api/v1/admin/dictionaries", { cookie: manager, body: { category: "lead_source", code: "Bad Code", displayName: "X" } }),
      routeParams({}),
    );
    expect(bad.status).toBe(400);
  });
});

describe("Администрирование: журнал аудита (только чтение)", () => {
  it("руководитель фильтрует журнал по типу, действию, автору и периоду; риелтору отказано", async () => {
    const le = await createLegalEntity(u.manager, { entityType: "IP", displayName: "ИП Аудит" });
    await updateLegalEntity(u.manager, le.id, { displayName: "ИП Аудит-2" });

    const all = await listAuditLog(u.manager, {});
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.items[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(all.items[all.items.length - 1]!.occurredAt.getTime());

    const byType = await listAuditLog(u.manager, { entityType: "LegalEntity", actorUserId: u.manager.userId });
    expect(byType.items.map((i) => i.action).sort()).toEqual(["legal_entity.created", "legal_entity.renamed"]);
    expect(byType.items[0]!.actor?.displayName).toBe(u.manager.displayName);

    const exact = await listAuditLog(u.manager, { action: "legal_entity.renamed" });
    expect(exact.total).toBe(1);
    expect(exact.items[0]!.before).toEqual({ displayName: "ИП Аудит" });
    const prefix = await listAuditLog(u.manager, { action: "legal_entity." });
    expect(prefix.total).toBe(2);

    const future = await listAuditLog(u.manager, { from: "2999-01-01" });
    expect(future.total).toBe(0);
    const past = await listAuditLog(u.manager, { to: "2000-01-01" });
    expect(past.total).toBe(0);

    const paged = await listAuditLog(u.manager, { entityType: "LegalEntity", pageSize: "1", page: "2" });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);

    const facets = await listAuditFacets(u.manager);
    expect(facets.entityTypes).toContain("LegalEntity");
    expect(facets.actions).toContain("legal_entity.created");

    await expect(listAuditLog(u.realtor1, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAuditLog(u.manager, { from: "03.11.2026" })).rejects.toBeInstanceOf(ValidationError);
  });
});
