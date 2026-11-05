import { beforeEach, describe, it, expect } from "vitest";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/v1/settings/ai/route";
import { GET as usageGet } from "@/app/api/v1/ai/usage/route";
import { GET as limitsGet } from "@/app/api/v1/ai/limits/route";
import { getAiSettings, getAiUsage } from "@/modules/ai/application/settings-service";
import { resetConfigCache } from "@/shared/config/env";
let users: TestUsers;
beforeEach(async () => { resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, perUserDailyLimit: 3 } }); });
describe("AI settings authorization", () => {
  it("denies realtor direct settings GET/PUT and usage URLs and application calls", async () => {
    const cookie = await sessionCookieFor(users.realtor1);
    expect((await settingsGet(apiRequest("GET", "/api/v1/settings/ai", { cookie }), routeParams({}))).status).toBe(403);
    expect((await settingsPut(apiRequest("PUT", "/api/v1/settings/ai", { cookie, body: {} }), routeParams({}))).status).toBe(403);
    expect((await usageGet(apiRequest("GET", "/api/v1/ai/usage", { cookie }), routeParams({}))).status).toBe(403);
    await expect(getAiSettings(users.realtor1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAiUsage(users.realtor1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("exposes only the authenticated employee's remaining quota, never the journal or another user's usage", async () => {
    await db.aiUsageLog.create({ data: { userId: users.realtor2.userId, model: "private-model", callType: "parse", status: "success", estimatedCostRub: "1" } });
    const cookie = await sessionCookieFor(users.realtor1);
    const res = await limitsGet(apiRequest("GET", `/api/v1/ai/limits?userId=${users.realtor2.userId}`, { cookie }), routeParams({}));
    expect(res.status).toBe(200);
    const body = await res.json(); expect(body.remaining.day).toBe(3);
    expect(JSON.stringify(body)).not.toMatch(/private-model|userId|items|actualCostRub/);
    const ownCookie = await sessionCookieFor(users.realtor2);
    const own = await limitsGet(apiRequest("GET", "/api/v1/ai/limits", { cookie: ownCookie }), routeParams({}));
    expect((await own.json()).remaining.day).toBe(2);
  });
  it("requires authentication, allows manager reads and rejects unsafe changes", async () => {
    expect((await limitsGet(apiRequest("GET", "/api/v1/ai/limits"), routeParams({}))).status).toBe(401);
    const cookie = await sessionCookieFor(users.manager);
    expect((await settingsGet(apiRequest("GET", "/api/v1/settings/ai", { cookie }), routeParams({}))).status).toBe(200);
    expect((await usageGet(apiRequest("GET", "/api/v1/ai/usage", { cookie }), routeParams({}))).status).toBe(200);
    expect((await settingsPut(apiRequest("PUT", "/api/v1/settings/ai", { cookie, body: {}, origin: "https://elsewhere.invalid" }), routeParams({}))).status).toBe(403);
  });
});
