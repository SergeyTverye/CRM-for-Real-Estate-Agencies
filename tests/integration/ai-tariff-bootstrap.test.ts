import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { getConfig, resetConfigCache } from "@/shared/config/env";
import { bootstrapAiTariffs } from "@/modules/ai/application/tariff-bootstrap";
import { PrismaAiTariffs } from "@/modules/ai/infrastructure/prisma-repositories";
import * as credentials from "@/modules/ai/application/credentials-service";
import * as composition from "@/modules/ai/infrastructure/create-search-ai";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { searchAvailability } from "@/modules/property-search/application/availability";
import { parseQuery, runSearch, manualWebSearch } from "@/modules/property-search/application/search-service";
import { SearchFilters } from "@/modules/property-search/domain/types";
import type { CredentialStore } from "@/modules/desktop-backup/domain/settings";
import { GET as availabilityGet } from "@/app/api/v1/property-search/availability/route";
import { POST as parsePost } from "@/app/api/v1/property-search/parse/route";

let users: TestUsers;
const model = "aliceai-llm-flash/latest";
const filters = SearchFilters.parse({ operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources: ["cian"] });
beforeEach(async () => {
  vi.stubEnv("AI_ENABLED", "true"); vi.stubEnv("SCRAPER_ENABLED", "true");
  vi.stubEnv("SCRAPER_DEMO_FIXTURES", "false"); vi.stubEnv("YANDEX_CLOUD_API_KEY", "");
  vi.stubEnv("YANDEX_AI_MAX_MONTHLY_COST_RUB", "1"); vi.stubEnv("INSTANCE_ROLE", "active");
  resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, model, webModel: model, monthlyBudgetRub: "1", scraperEnabled: true, enabledSources: ["cian"] } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetConfigCache(); });

function fakeTransport() {
  const store: CredentialStore = { available: true, protection: "windows-dpapi-current-user",
    get: vi.fn(async () => ({ apiKey: "synthetic-only", folder: "synthetic-folder" })),
    put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
  vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(new credentials.AiCredentialsService(getConfig(), store));
  const provider = new FakeResponsesProvider(() => ({ text: JSON.stringify({ filters, clarificationQuestion: null }) }));
  const create = composition.createSearchAi;
  vi.spyOn(composition, "createSearchAi").mockImplementation((config, repositories) => create(config, repositories, provider));
  return provider;
}

describe("initial tariff bootstrap (real persistence on PostgreSQL AND SQLite)", () => {
  it("fills an empty catalog once using official reference defaults", async () => {
    expect(await db.aiTariff.count()).toBe(0);
    await bootstrapAiTariffs();
    const before = await db.aiTariff.findMany({ orderBy: { id: "asc" } });
    expect(before).toHaveLength(6);
    await bootstrapAiTariffs();
    expect(await db.aiTariff.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await db.auditLog.count({ where: { action: "ai.tariff.seed" } })).toBe(2);
    expect(await new PrismaAiTariffs().findEffective(model, new Date("2026-11-06T00:00:00Z")))
      .toMatchObject({ inputMicrosPerMillion: 100000000n, outputMicrosPerMillion: 200000000n, webSearchMicrosPerCall: 915000n });
    expect(await db.aiUsageLog.count()).toBe(0);
  });

  it("never fills over partial, historical or future user versions, nor changes settings", async () => {
    for (const effectiveFrom of [new Date("2020-01-01Z"), new Date("2099-01-01Z")])
      await db.aiTariff.create({ data: { model, callType: "parse", unit: "input_million_tokens", priceRub: "123.456", effectiveFrom } });
    await db.aiTariff.create({ data: { model: "custom/latest", callType: "parse", unit: "web_search_call", priceRub: "7", effectiveFrom: new Date("2020-01-01Z") } });
    const before = await db.aiTariff.findMany({ orderBy: { id: "asc" } });
    const settings = await db.aiSetting.findMany();
    await bootstrapAiTariffs(); await bootstrapAiTariffs();
    expect(await db.aiTariff.findMany({ where: { model: { in: [model, "custom/latest"] } }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await db.aiSetting.findMany()).toEqual(settings);
    expect(await new PrismaAiTariffs().findEffective(model, new Date())).toBeNull();
  });

  it("permits a fake-provider parse through the real tariff/gate/ledger after local key configuration", async () => {
    const provider = fakeTransport();
    if (getConfig().CRM_DEPLOYMENT_MODE !== "desktop") await bootstrapAiTariffs();
    const result = await parseQuery(users.realtor1, "Найти офис в аренду", filters);
    expect(result.testingMode).toBe(true); expect(provider.requests).toHaveLength(1);
    expect(await db.aiTariff.count()).toBe(6);
    expect(await db.aiUsageLog.count({ where: { status: "success" } })).toBe(1);
    expect(await db.aiBudgetReservation.count({ where: { status: "settled" } })).toBe(1);
    const scraper = { search: vi.fn(async () => ({ listings: [], sources: [{ source: "cian" as const, status: "success" as const, resultCount: 0, reason: null }] })) };
    const before = await db.searchRun.count();
    await expect(runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper })).rejects.toMatchObject({ code: "PAID_CONFIRMATION_REQUIRED" });
    expect(await db.searchRun.count()).toBe(before); expect(scraper.search).not.toHaveBeenCalled();
    await db.aiSetting.updateMany({ data: { monthlyBudgetRub: "0" } });
    await expect(parseQuery(users.realtor1, "Найти офис", filters)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(provider.requests).toHaveLength(1); expect(await db.aiUsageLog.count()).toBe(1);
  });

  it.each(["custom/latest", model])("reports missing/incomplete current tariff for %s before a job, provider or reserve; allows scraper-only", async selected => {
    const provider = fakeTransport();
    if (selected === model) await db.aiTariff.create({ data: { model, callType: "parse", unit: "input_million_tokens", priceRub: "5", effectiveFrom: new Date("2020-01-01Z") } });
    await db.aiSetting.updateMany({ data: { model: selected, webModel: selected } });
    const availability = await searchAvailability();
    expect(availability.ai).toMatchObject({ configured: true, available: false, reason: "tariff_unavailable", settingsUrl: "/settings/ai" });
    expect(availability.ai.message).toContain("тариф");
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await availabilityGet(apiRequest("GET", "/api/v1/property-search/availability", { cookie }), routeParams({}));
    expect(response.status).toBe(200);
    expect((await response.json()).ai).toMatchObject({ available: false, reason: "tariff_unavailable" });
    const parseResponse = await parsePost(apiRequest("POST", "/api/v1/property-search/parse", { cookie, body: { text: "Найти офис", currentFilters: filters } }), routeParams({}));
    expect(parseResponse.status).toBe(409);
    expect((await parseResponse.json()).error).toMatchObject({ code: "AI_TARIFF_UNAVAILABLE", details: { settingsUrl: "/settings/ai" } });
    await expect(parseQuery(users.realtor1, "Найти офис", filters)).rejects.toMatchObject({ code: "AI_TARIFF_UNAVAILABLE", details: { settingsUrl: "/settings/ai" } });
    expect(await db.searchRun.count()).toBe(0);
    const scraper = { search: vi.fn(async () => ({ listings: [], sources: [{ source: "cian" as const, status: "success" as const, resultCount: 0, reason: null }] })) };
    expect((await runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper })).status).toBe("success");
    expect(provider.requests).toHaveLength(0); expect(await db.aiUsageLog.count()).toBe(0); expect(await db.aiBudgetReservation.count()).toBe(0);
    vi.stubEnv("YANDEX_WEB_SEARCH_ENABLED", "true"); resetConfigCache();
    await db.aiSetting.updateMany({ data: { webSearchManualAllowed: true } });
    const ownRun = await runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper });
    expect(ownRun.webSearchUsed).toBe(false);
    const sourcesBefore = await db.searchRunSource.count({ where: { runId: ownRun.id } });
    await expect(manualWebSearch(users.realtor1, ownRun.id)).rejects.toMatchObject({ code: "AI_TARIFF_UNAVAILABLE", details: { settingsUrl: "/settings/ai" } });
    expect((await db.searchRun.findUniqueOrThrow({ where: { id: ownRun.id } })).webSearchUsed).toBe(false);
    expect(await db.searchRunSource.count({ where: { runId: ownRun.id } })).toBe(sourcesBefore);
    expect(await db.searchRunSource.count({ where: { runId: ownRun.id, source: "web_search" } })).toBe(0);
    expect(provider.requests).toHaveLength(0); expect(await db.aiUsageLog.count()).toBe(0); expect(await db.aiBudgetReservation.count()).toBe(0);
  });

  it("reports missing key for explicit manual web before any web state change", async () => {
    if (getConfig().CRM_DEPLOYMENT_MODE !== "desktop") await bootstrapAiTariffs();
    vi.stubEnv("YANDEX_WEB_SEARCH_ENABLED", "true"); resetConfigCache();
    await db.aiSetting.updateMany({ data: { webSearchManualAllowed: true } });
    const scraper = { search: vi.fn(async () => ({ listings: [], sources: [{ source: "cian" as const, status: "success" as const, resultCount: 0, reason: null }] })) };
    const ownRun = await runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper });
    const sourcesBefore = await db.searchRunSource.count({ where: { runId: ownRun.id } });
    await expect(manualWebSearch(users.realtor1, ownRun.id)).rejects.toMatchObject({ code: "AI_CREDENTIALS_MISSING", details: { settingsUrl: "/settings/ai" } });
    expect((await db.searchRun.findUniqueOrThrow({ where: { id: ownRun.id } })).webSearchUsed).toBe(false);
    expect(await db.searchRunSource.count({ where: { runId: ownRun.id } })).toBe(sourcesBefore);
    expect(await db.aiUsageLog.count()).toBe(0); expect(await db.aiBudgetReservation.count()).toBe(0);
  });

  it("preserves credential-store-unavailable ahead of tariff readiness without using a real keystore", async () => {
    const store: CredentialStore = { available: false, protection: "windows-dpapi-current-user", get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(new credentials.AiCredentialsService(getConfig(), store));
    expect((await searchAvailability()).ai).toMatchObject({ configured: false, available: false, reason: "credential_store_unavailable" });
    expect(store.get).not.toHaveBeenCalled(); expect(await db.aiUsageLog.count()).toBe(0);
  });
});
