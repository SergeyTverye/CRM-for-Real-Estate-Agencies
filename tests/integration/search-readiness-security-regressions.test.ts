import publicFixture from "../fixtures/search-quality/price-change-v31-live.json";
import type { NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { GET as readinessGet } from "@/app/api/health/ready/route";
import { previewAnalysisQuery } from "@/modules/ai/application/listing-analysis-service";
import { YandexResponsesClient } from "@/modules/ai/infrastructure/yandex-responses-client";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs } from "@/modules/ai/infrastructure/prisma-repositories";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { resetConfigCache } from "@/shared/config/env";
import * as credentials from "@/modules/ai/application/credentials-service";
import { AiCredentialsService } from "@/modules/ai/application/credentials-service";
import type { CredentialStore } from "@/modules/desktop-backup/domain/settings";
import { getConfig } from "@/shared/config/env";
import { parseQuery, runSearch } from "@/modules/property-search/application/search-service";
import { searchAvailability } from "@/modules/property-search/application/availability";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { GET, PUT, DELETE } from "@/app/api/v1/settings/ai/credentials/route";
import * as aiComposition from "@/modules/ai/infrastructure/create-search-ai";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";

let users: TestUsers;
const url = "/api/v1/settings/ai/credentials";
const filters = SearchFilters.parse({ city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["office"] });
beforeEach(async () => {
  // Preserve the runner's selected database mode: this file runs on PG and SQLite.
  vi.stubEnv("AI_ENABLED", "true"); vi.stubEnv("YANDEX_CLOUD_API_KEY", "");
  vi.stubEnv("SCRAPER_DEMO_FIXTURES", "false"); vi.stubEnv("INSTANCE_ROLE", "active");
  resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, scraperEnabled: true, enabledSources: ["cian"] } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetConfigCache(); });
describe("credential readiness persistence and route guards (both backends)", () => {
  it("rejects missing-key parse before creating any run or paid reservation", async () => {
    // No real desktop store is composed, even on a Windows SQLite runner.
    vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(new AiCredentialsService(getConfig()));
    const before = { runs: await db.searchRun.count(), reservations: await db.aiBudgetReservation.count(), usage: await db.aiUsageLog.count() };
    expect((await searchAvailability()).ai).toMatchObject({ enabled: true, configured: false, available: false, reason: "credentials_missing" });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(parseQuery(users.realtor1, "Найти офис", filters)).rejects.toMatchObject({
        code: "AI_CREDENTIALS_MISSING", details: { settingsUrl: "/settings/ai" },
      });
      expect(await db.searchRun.count()).toBe(before.runs);
      expect(await db.aiBudgetReservation.count()).toBe(before.reservations);
      expect(await db.aiUsageLog.count()).toBe(before.usage);
    }
  });
  it.each([false, true])("completes scraper-only without confirmation or spend (store unavailable: %s)", async unavailable => {
    const store: CredentialStore = { protection: "windows-dpapi-current-user", available: !unavailable,
      get: vi.fn(async () => { throw new Error("synthetic unavailable store"); }),
      put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    const service = new AiCredentialsService(getConfig(), unavailable ? store : undefined);
    const resolve = vi.spyOn(service, "resolve");
    vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(service);
    const compose = vi.spyOn(aiComposition, "createSearchAi");
    const scraper = { search: vi.fn(async () => ({ listings: [], sources: [{ source: "cian" as const, status: "success" as const, resultCount: 0, reason: null }] })) };
    const run = await runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper });
    expect(run.status).toBe("success"); expect(scraper.search).toHaveBeenCalledOnce();
    expect(await db.searchRun.count()).toBe(1);
    expect(resolve).toHaveBeenCalledOnce(); expect(compose).not.toHaveBeenCalled();
    expect(await db.aiBudgetReservation.count()).toBe(0); expect(await db.aiUsageLog.count()).toBe(0);
  });
  it("requires confirmation for configured AI before persistence and still enforces budget after confirmation", async () => {
    vi.stubEnv("YANDEX_WEB_SEARCH_ENABLED", "true"); vi.stubEnv("YANDEX_WEB_SEARCH_AUTO_FALLBACK", "true");
    vi.stubEnv("YANDEX_AI_MAX_MONTHLY_COST_RUB", "0"); resetConfigCache();
    await db.aiSetting.updateMany({ data: { monthlyBudgetRub: "0", webSearchManualAllowed: true, webSearchAutoFallback: true } });
    await db.$transaction(async tx => { await seedAiTariffs(tx); });
    const store: CredentialStore = { protection: "windows-dpapi-current-user", available: true,
      get: vi.fn(async () => ({ apiKey: "synthetic-only-secret", folder: "synthetic-folder" })),
      put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(new AiCredentialsService(getConfig(), store));
    const provider = new FakeResponsesProvider(() => ({ text: '{"candidates":[]}', webSearchCalls: 1 }));
    // Keep the real persistent gate/ledger/tariffs; replace only provider transport.
    const createSearchAi = aiComposition.createSearchAi;
    vi.spyOn(aiComposition, "createSearchAi").mockImplementation((config, repositories) => createSearchAi(config, repositories, provider));
    const scraper = { search: vi.fn(async () => ({ listings: [], sources: [{ source: "cian" as const, status: "blocked" as const, resultCount: 0, reason: "synthetic failure" }] })) };
    await expect(runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper })).rejects.toMatchObject({ code: "PAID_CONFIRMATION_REQUIRED" });
    expect(await db.searchRun.count()).toBe(0); expect(scraper.search).not.toHaveBeenCalled();
    expect(await db.aiBudgetReservation.count()).toBe(0); expect(await db.aiUsageLog.count()).toBe(0);
    expect(provider.requests).toHaveLength(0); expect(store.get).toHaveBeenCalledTimes(1);
    const run = await runSearch(users.realtor1, { filters, sources: ["cian"], confirmedPaid: true }, { scraper });
    expect(run.webSearchUsed).toBe(false); expect(run.fallbackReason).toContain("Бюджет или лимит");
    expect(scraper.search).toHaveBeenCalledOnce(); expect(store.get).toHaveBeenCalledTimes(2);
    expect(provider.requests).toHaveLength(0);
    expect(await db.aiBudgetReservation.count()).toBe(0); expect(await db.aiUsageLog.count()).toBe(0);
  });
  it("blocks CSRF, standby mutations and non-manager credential access before storage", async () => {
    const store: CredentialStore = { protection: "windows-dpapi-current-user", available: true,
      get: vi.fn(async () => ({ apiKey: "synthetic-only-secret", folder: "synthetic-folder" })),
      put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    const factory = vi.spyOn(credentials, "aiCredentialsService").mockReturnValue(new AiCredentialsService(getConfig(), store));
    const cookie = await sessionCookieFor(users.manager);
    for (const [method, handler] of [["PUT", PUT], ["DELETE", DELETE]] as const) {
      for (const origin of [null, "https://cross-site.invalid"]) {
        const request = apiRequest(method, url, { cookie, body: {} });
        // Explicit deletion avoids relying on helper null-origin behavior.
        if (origin === null) request.headers.delete("origin"); else request.headers.set("origin", origin);
        const response = await handler(request, routeParams({}));
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("FORBIDDEN");
      }
    }
    vi.stubEnv("INSTANCE_ROLE", "standby"); resetConfigCache();
    for (const [method, handler] of [["PUT", PUT], ["DELETE", DELETE]] as const) {
      const response = await handler(apiRequest(method, url, { cookie, body: {} }), routeParams({}));
      expect(response.status).toBe(503); expect((await response.json()).error.code).toBe("INSTANCE_READ_ONLY");
    }
    vi.stubEnv("INSTANCE_ROLE", "active"); resetConfigCache();
    const realtorCookie = await sessionCookieFor(users.realtor1);
    for (const [method, handler] of [["GET", GET], ["PUT", PUT], ["DELETE", DELETE]] as const) {
      const response = await handler(apiRequest(method, url, { cookie: realtorCookie, body: method === "PUT" ? {} : undefined }), routeParams({}));
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).not.toMatch(/synthetic|apiKey|folder/);
    }
    expect(factory).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled(); expect(store.put).not.toHaveBeenCalled(); expect(store.delete).not.toHaveBeenCalled();
  });
});

it.each(["reject","timeout"])("AI-03 official Yandex transport %s leaves manual search and readiness available",async failure=>{
  const fetcher=vi.fn<typeof fetch>(async (_url,init)=>{
    if(failure==="reject") throw new TypeError("synthetic offline");
    return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("synthetic timeout","AbortError")),{once:true}));
  });
  const provider=new YandexResponsesClient({apiKey:"synthetic-only-key",folder:"synthetic-folder",baseUrl:"https://ai.api.cloud.yandex.net/v1",timeoutMs:20},fetcher);
  await seedAiTariffs(db);
  const ai=aiComposition.createSearchAi(getConfig(),{ledger:new PrismaAiLedger(),settings:new PrismaAiSettings(),tariffs:new PrismaAiTariffs()},provider);
  await expect(previewAnalysisQuery(users.realtor1,{text:"Аренда офиса",currentFilters:filters},ai)).rejects.toMatchObject({code:"AI_CALL_FAILED",message:expect.stringContaining("Ручной поиск доступен")});
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![0]).toBe("https://ai.api.cloud.yandex.net/v1/responses");
  // Explicitly turn off optional AI: the same process must still accept manual search.
  vi.stubEnv("AI_ENABLED","false");resetConfigCache();
  const listing={...publicFixture.listing,operation:"rent",priceUnit:null} as NormalizedListing;
  const scraper={search:vi.fn(async()=>({listings:[{listing,evaluation:evaluateListing(listing,filters)}],sources:[{source:"onrealt" as const,status:"success" as const,resultCount:1,reason:null}]}))};
  const run=await runSearch(users.realtor1,{filters,sources:["onrealt"]},{scraper});
  expect(run.status).toBe("success");expect(await db.searchRunResult.count({where:{runId:run.id}})).toBe(1);
  expect(fetcher).toHaveBeenCalledOnce();
  vi.stubEnv("AI_ENABLED","true");resetConfigCache();
  const ready=await readinessGet();expect(ready.status).toBe(200);expect((await ready.json()).status).toBe("ok");
});
