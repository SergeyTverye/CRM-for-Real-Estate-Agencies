import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, sessionCookieFor, apiRequest, type TestUsers } from "../helpers/fixtures";
import { pickSearchNeeds } from "@/modules/property-search/queries/picker-queries";
import { GET } from "@/app/api/v1/property-search/pick-needs/route";
import { GET as limitsApi } from "@/app/api/v1/ai/limits/route";

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });

describe("property search need picker", () => {
  it("searches visible client names, filters by client, and returns prefill", async () => {
    const client = await makeClient(users.realtor1, { displayName: "Синтетический магазин" });
    const need = await makeNeed(users.realtor1, client.id, { district: "Советский", budgetMax: "9000000" });
    const other = await makeClient(users.realtor2, { displayName: "Закрытый клиент" });
    await makeNeed(users.realtor2, other.id);
    const result = await pickSearchNeeds(users.realtor1, { q: "магазин", clientId: client.id });
    expect(result.items.map(n => n.id)).toEqual([need.id]);
    expect(result.items[0]?.client?.displayName).toBe("Синтетический магазин");
    const prefill = await pickSearchNeeds(users.realtor1, { needId: need.id });
    expect(prefill.filters).toMatchObject({ districts: ["Советский"], priceTo: "9000000" });
    expect((await pickSearchNeeds(users.manager, {})).items).toHaveLength(2);
  });
  it("denies foreign need IDs and never returns foreign client names", async () => {
    const client = await makeClient(users.realtor2, { displayName: "Секретное название" });
    const need = await makeNeed(users.realtor2, client.id);
    expect((await pickSearchNeeds(users.realtor1, { q: "Секретное" })).items).toEqual([]);
    expect((await pickSearchNeeds(users.realtor1, { clientId: client.id })).items).toEqual([]);
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await GET(apiRequest("GET", `/api/v1/property-search/pick-needs?needId=${need.id}`, { cookie }), { params: Promise.resolve({}) });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Секретное название");
  });
  it("does not leak identity through a need assigned on another user's client", async () => {
    const client = await makeClient(users.realtor2, { displayName: "Скрытый владелец" });
    const need = await makeNeed(users.realtor2, client.id);
    await db.clientNeed.update({ where: { id: need.id }, data: { responsibleUserId: users.realtor1.userId } });
    const result = await pickSearchNeeds(users.realtor1, { needId: need.id });
    expect(result.items[0]?.client).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Скрытый владелец");
    expect((await pickSearchNeeds(users.realtor1, { q: "Скрытый владелец" })).items).toEqual([]);
    await db.client.update({ where: { id: client.id }, data: { responsibleUserId: users.realtor1.userId } });
    expect((await pickSearchNeeds(users.realtor1, { needId: need.id })).items[0]?.client?.id).toBe(client.id);
  });
  it("validates identifiers and query length", async () => {
    await expect(pickSearchNeeds(users.realtor1, { needId: "bad-id" })).rejects.toMatchObject({ status: 400 });
    await expect(pickSearchNeeds(users.realtor1, { q: "x".repeat(121) })).rejects.toMatchObject({ status: 400 });
  });
  it("shows an authenticated realtor remaining budget without settings or secrets", async () => {
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await limitsApi(apiRequest("GET", "/api/v1/ai/limits", { cookie }), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.remaining.monthlyBudgetRub).toMatch(/^\d+\.\d{6}$/);
    expect(body).not.toHaveProperty("setting");
    expect(body).not.toHaveProperty("apiKey");
  });
});
