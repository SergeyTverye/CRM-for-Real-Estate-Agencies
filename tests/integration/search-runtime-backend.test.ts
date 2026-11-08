import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { resetConfigCache } from "@/shared/config/env";
import { searchSettings, scraperFor } from "@/modules/property-search/application/dependencies";
import { getAiSettings, updateAiSettings } from "@/modules/ai/application/settings-service";
import { GET as availability } from "@/app/api/v1/property-search/availability/route";
import { GET as credentialsGet, PUT as credentialsPut, DELETE as credentialsDelete } from "@/app/api/v1/settings/ai/credentials/route";
import type { AiSettingsInput } from "@/modules/ai/domain/settings";

let users: TestUsers;
const INITIAL_DEPLOYMENT_MODE = process.env.CRM_DEPLOYMENT_MODE ?? "server";
beforeEach(async () => {
  for (const key of ["AI_ENABLED", "SCRAPER_ENABLED", "YANDEX_WEB_SEARCH_ENABLED", "YANDEX_WEB_SEARCH_AUTO_FALLBACK"]) vi.stubEnv(key, "true");
  // Preserve actual backend mode: db proxy and ORIGIN fixture bind at import time.
  // Forcing "server" here would falsely switch a SQLite run to PG (TRUNCATE path).
  vi.stubEnv("CRM_DEPLOYMENT_MODE", INITIAL_DEPLOYMENT_MODE); vi.stubEnv("YANDEX_CLOUD_API_KEY", ""); vi.stubEnv("SCRAPER_DEMO_FIXTURES", "false");
  resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, scraperEnabled: true, enabledSources: ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"], monthlyBudgetRub: "1" } });
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigCache(); });
describe("search runtime composition and safe API", () => {
  it("honors saved changes immediately and preserves server kill-switch/budget", async () => {
    expect((await searchSettings()).enabled).toBe(true);
    const before = await getAiSettings(users.manager);
    const { id: _id, updatedBy: _by, updatedAt, ...fields } = before.setting; void _id; void _by;
    await updateAiSettings(users.manager, { ...fields, scraperEnabled: false, expectedUpdatedAt: updatedAt } as AiSettingsInput);
    expect((await searchSettings()).enabled).toBe(false);
    await db.aiSetting.updateMany({ data: { scraperEnabled: true } });
    expect((await searchSettings()).enabled).toBe(true);
    vi.stubEnv("AI_ENABLED", "false"); vi.stubEnv("SCRAPER_ENABLED", "false"); resetConfigCache();
    const capped = await getAiSettings(users.manager);
    expect(capped.effective.values).toMatchObject({ aiEnabled: false, scraperEnabled: false, monthlyBudgetRub: "1.000000" });
    const run = await scraperFor(await searchSettings()).search({ city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources: ["cian"] });
    expect(run.sources[0]?.status).toBe("disabled");
  });
  it("reports all seven routing flags and missing credentials truthfully without secrets", async () => {
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await availability(apiRequest("GET", "/api/v1/property-search/availability", { cookie }), routeParams({}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sources).toHaveLength(7); expect(body.sources.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
    expect(body.ai).toMatchObject({ enabled: true, available: false, configured: false, reason: "credentials_missing", message: "Требуется подключение Яндекс AI" });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|YANDEX_CLOUD|storage|secret/);
  });
  it("requires login for availability and denies realtor credential routes before storage access", async () => {
    expect((await availability(apiRequest("GET", "/api/v1/property-search/availability"), routeParams({}))).status).toBe(401);
    const cookie = await sessionCookieFor(users.realtor1);
    for (const [method, handler] of [["GET", credentialsGet], ["PUT", credentialsPut], ["DELETE", credentialsDelete]] as const) {
      expect((await handler(apiRequest(method, "/api/v1/settings/ai/credentials", { cookie, body: method === "PUT" ? {} : undefined }), routeParams({}))).status).toBe(403);
    }
  });
});
