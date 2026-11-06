import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, apiRequest, sessionCookieFor, routeParams, type TestUsers } from "../helpers/fixtures";
import { GET as pickContext } from "@/app/api/v1/requests/pick-context/route";
import { GET as responsiblePreview } from "@/app/api/v1/requests/responsible-preview/route";
import { pickCallContext } from "@/modules/requests/application/call-pickers";
import { previewResponsible } from "@/modules/requests/application/request-service";
import { createChat, sendMessage } from "@/modules/ai-chat/application/chat-service";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { resetConfigCache } from "@/shared/config/env";

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigCache(); });
async function listing(address: string, description?: string) {
  return db.externalListing.create({ data: { source: "cian", sourceMethod: "scraper", operation: "rent", priceUnit: "per_month", url: `https://cian.ru/synthetic/${randomUUID()}`, address, description } });
}
async function advertisement(propertyId: string) {
  return db.advertisement.create({ data: { propertyId, platformCode: "avito", status: "active", responsibleUserId: users.realtor2.userId, adText: "Скрытый рабочий текст", comment: "Скрытый комментарий" } });
}

it("external picker scopes empty queries, matching source/address and direct IDs, including for managers", async () => {
  const own = await listing("Доступное объявление"), foreign = await listing("Закрытое объявление"), unsaved = await listing("Несохранённое объявление");
  await db.searchBookmark.createMany({ data: [{ userId: users.realtor1.userId, listingId: own.id }, { userId: users.realtor2.userId, listingId: foreign.id }] });
  const cookie = await sessionCookieFor(users.realtor1);
  for (const query of ["", "&q=cian", `&id=${foreign.id}`, `&q=Закрытое`, `&id=${unsaved.id}`]) {
    const r = await pickContext(apiRequest("GET", `/api/v1/requests/pick-context?kind=external${query}`, { cookie }), routeParams({}));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(JSON.stringify(body)).not.toMatch(/Закрытое|Несохранённое/);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(query.includes("&id=") || query.includes("Закрытое") ? [] : [own.id]);
  }
  expect((await pickCallContext(users.realtor1, { kind: "external", id: own.id })).items.map(r => r.id)).toEqual([own.id]);
  expect((await pickCallContext(users.manager, { kind: "external" })).items).toEqual([]);
});

it("external scope permits own selections and visible collections, then revokes access when their scope changes", async () => {
  const client = await makeClient(users.realtor1), need = await makeNeed(users.realtor1, client.id);
  const selected = await listing("В своей потребности"), team = await listing("Командная подборка"), privateListing = await listing("Личная чужая подборка");
  await db.searchSelection.create({ data: { listingId: selected.id, needId: need.id, addedBy: users.realtor1.userId } });
  const collection = await db.propertyCollection.create({ data: { name: "Командная", ownerUserId: users.realtor2.userId, visibility: "team", items: { create: { externalListingId: team.id, addedBy: users.realtor2.userId } } } });
  await db.propertyCollection.create({ data: { name: "Чужая", ownerUserId: users.realtor2.userId, visibility: "private", items: { create: { externalListingId: privateListing.id, addedBy: users.realtor2.userId } } } });
  expect((await pickCallContext(users.realtor1, { kind: "external" })).items.map(r => r.id).sort()).toEqual([selected.id, team.id].sort());
  await db.client.update({ where: { id: client.id }, data: { responsibleUserId: users.realtor2.userId } });
  await db.propertyCollection.update({ where: { id: collection.id }, data: { archivedAt: new Date() } });
  expect((await pickCallContext(users.realtor1, { kind: "external" })).items).toEqual([]);
});

it("advertisement picker preserves the shared catalog, excludes archived properties and exposes only labels", async () => {
  const property = await makeProperty(users.realtor2, { addressText: "Общий каталог" }), archived = await makeProperty(users.realtor2, { addressText: "Архивный объект", status: "archived" });
  const ad = await advertisement(property.id), hidden = await advertisement(archived.id);
  const cookie = await sessionCookieFor(users.realtor1);
  const r = await pickContext(apiRequest("GET", `/api/v1/requests/pick-context?kind=advertisement&q=avito`, { cookie }), routeParams({}));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ items: [{ id: ad.id, propertyId: property.id, label: "avito · Общий каталог" }] });
  expect((await pickCallContext(users.realtor1, { kind: "advertisement", id: hidden.id })).items).toEqual([]);
});

it.each(["external", "advertisement"])("%s picker enforces 200 characters and 20 results even with an injected take", async kind => {
  if (kind === "external") {
    for (let i = 0; i < 23; i++) {
      const row = await listing(`Лимит ${i}`);
      await db.searchBookmark.create({ data: { userId: users.realtor1.userId, listingId: row.id } });
    }
  } else {
    const p = await makeProperty(users.realtor2);
    await db.advertisement.createMany({ data: Array.from({ length: 23 }, () => ({ propertyId: p.id, platformCode: "avito", status: "active" })) });
  }
  const cookie = await sessionCookieFor(users.realtor1);
  const result = await pickContext(apiRequest("GET", `/api/v1/requests/pick-context?kind=${kind}&take=999`, { cookie }), routeParams({}));
  expect((await result.json()).items).toHaveLength(20);
  const invalid = await pickContext(apiRequest("GET", `/api/v1/requests/pick-context?kind=${kind}&q=${"x".repeat(201)}`, { cookie }), routeParams({}));
  expect(invalid.status).toBe(400);
});

it("responsible preview returns 404 for missing/archived context, including direct API and both supplied IDs", async () => {
  const archived = await makeProperty(users.realtor2, { status: "archived" }), accessible = await makeProperty(users.realtor2);
  const archivedAd = await advertisement(archived.id), accessibleAd = await advertisement(accessible.id);
  const cookie = await sessionCookieFor(users.realtor1);
  for (const opts of [
    { propertyId: randomUUID() }, { advertisementId: randomUUID() },
    { propertyId: archived.id }, { advertisementId: archivedAd.id },
    { propertyId: archived.id, advertisementId: accessibleAd.id },
    { propertyId: accessible.id, advertisementId: archivedAd.id },
  ]) {
    await expect(previewResponsible(users.realtor1, opts)).rejects.toMatchObject({ status: 404 });
    const response = await responsiblePreview(apiRequest("GET", `/api/v1/requests/responsible-preview?${new URLSearchParams(Object.entries(opts).flatMap(([key, value]) => value ? [[key, value]] : []))}`, { cookie }), routeParams({}));
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(users.realtor2.displayName);
    expect(text).not.toContain(users.realtor2.userId);
  }
});

it("preview reveals only the assignment rule to another realtor; manager and self retain the calculated identity", async () => {
  const p = await makeProperty(users.realtor2), ad = await advertisement(p.id);
  const cookie = await sessionCookieFor(users.realtor1);
  for (const opts of [{ propertyId: p.id }, { advertisementId: ad.id }, { propertyId: p.id, advertisementId: ad.id }]) {
    const r = await responsiblePreview(apiRequest("GET", `/api/v1/requests/responsible-preview?${new URLSearchParams(Object.entries(opts).flatMap(([key, value]) => value ? [[key, value]] : []))}`, { cookie }), routeParams({}));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ responsible: { id: "", displayName: "Ответственный объекта" }, byPropertyRule: true });
  }
  for (const actor of [users.manager, users.realtor2]) {
    expect(await previewResponsible(actor, { advertisementId: ad.id })).toEqual({ responsible: { id: users.realtor2.userId, displayName: users.realtor2.displayName }, byPropertyRule: true });
  }
  const other = await makeProperty(users.realtor1);
  await expect(previewResponsible(users.realtor1, { propertyId: other.id, advertisementId: ad.id })).rejects.toMatchObject({ status: 400 });
});

it("both call context endpoints require authentication", async () => {
  for (const [route, url] of [[pickContext, "/api/v1/requests/pick-context?kind=external"], [responsiblePreview, "/api/v1/requests/responsible-preview"]] as const) {
    expect((await route(apiRequest("GET", url), routeParams({}))).status).toBe(401);
  }
});

it("find_listings sends sanitized descriptions to fake provider and excludes other users' saved listings", async () => {
  vi.stubEnv("AI_ENABLED", "true"); resetConfigCache();
  await db.aiSetting.create({ data: { aiEnabled: true, perJobLimit: 4 } });
  await seedAiTariffs(db);
  const own = await listing("ул. Тестовая, 1", "офис 80 м²; +7 (900) 123-45-67; seller@example.test; контакт Иван Петров");
  const boundary = await listing("ул. Тестовая, 2", "x".repeat(592) + " +7 (901) 765-43-21 boundary@example.test");
  const foreign = await listing("Недоступный адрес", "Секретный продавец hidden@example.test");
  await db.searchBookmark.createMany({ data: [own, boundary].map(row => ({ userId: users.realtor1.userId, listingId: row.id })).concat([{ userId: users.realtor2.userId, listingId: foreign.id }]) });
  const session = await createChat(users.realtor1, {});
  const fake = new FakeResponsesProvider(r => r.inputItems?.length === 2
    ? { functionCalls: [{ type: "function_call", call_id: "find", name: "find_listings", arguments: "{}" }] }
    : { text: "Готово" });
  await sendMessage(users.realtor1, session.id, { text: "найди офис" }, fake);
  expect(fake.requests).toHaveLength(2);
  const request = JSON.stringify(fake.requests[1]);
  expect(request).toContain(own.id);
  expect(request).toContain(boundary.id);
  expect(request).toContain("[PHONE]");
  const output = fake.requests[1]?.inputItems?.find(item => "output" in item);
  if (!output || !("output" in output)) throw new Error("Missing function output");
  const rows = JSON.parse(output.output).untrusted_data as { untrusted_data: string }[];
  const descriptions = rows.map(row => row.untrusted_data).join(" ");
  expect(descriptions).not.toMatch(/\+7|900|901|123-45|765-43|seller|boundary@|example|Иван|Петров/);
  expect(request).not.toMatch(/Недоступный|Секретный/);
  expect(request).not.toContain(foreign.id);
});
