import RealEstateScraper from "real-estate-scrapper";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { POST as enqueueApi } from "@/app/api/v1/property-search/runs/route";
import { enqueueSearch, processSearchQueue, recoverSearchQueue } from "@/modules/property-search/application/search-queue";
import { getSearchRun } from "@/modules/property-search/application/search-service";
import { searchProgress } from "@/modules/property-search/application/progress-service";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { resetConfigCache } from "@/shared/config/env";
import { configureSearchAi } from "@/modules/property-search/application/dependencies";

function offlineOnRealt(purpose: "office" | "residential") {
  const title = purpose === "office" ? "Офис" : "Квартира";
  const slug = purpose === "office" ? "kypit-ofis" : "kypit-kvartiru";
  const html = `<html><body>${Array.from({ length: 12 }, (_, i) => `
    <div class="ad-item-container" data-id="${purpose === "office" ? 91000000 + i : 92000000 + i}">
      <a url-item href="https://onrealt.ru/novosibirsk/${slug}/${purpose === "office" ? 91000000 + i : 92000000 + i}">
        <h3 title-item>${title} ${i === 0 ? "145,1" : "42,75"} м²</h3>
      </a>
      <span class="price-data">${i === 1 ? "Цена по запросу" : "12 500 000 ₽"}</span>
      <span address-city>Новосибирск</span><span address-string>Синтетическая улица, ${i + 1}</span>
      <div class="info-container">Этаж: <span class="value">1 / 6</span></div>
      <div class="description">${title}. Продаётся. ${i === 2 ? "Парковки нет." : i === 3 ? "Сведения требуют проверки." : "Парковка."}</div>
    </div>`).join("")}</body></html>`;
  const transport = vi.fn<RealEstateScraper.Transport>(async request => ({ data: html, status: 200, url: request.url, headers: { "content-type": "text/html" } }));
  const close = vi.fn(async () => {});
  const factory = vi.fn(async () => {
    const client = extendSourceParsers(new RealEstateScraper({ transport, delay: 0, maxRetries: 0 }), { maxCards: 0 });
    return { searchSite: client.searchSite.bind(client), close };
  });
  return { scraper: new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, depth: { maxPages: 1, limit: 120 }, factory }), factory, transport, close };
}

let users: TestUsers;
const aiFactory = vi.fn(async () => { throw new Error("OPTIONAL_AI_MUST_NOT_BE_COMPOSED"); });
beforeEach(async () => {
  vi.stubEnv("AI_ENABLED", "true"); vi.stubEnv("SCRAPER_ENABLED", "true");
  vi.stubEnv("YANDEX_CLOUD_API_KEY", ""); vi.stubEnv("SCRAPER_DEMO_FIXTURES", "false");
  resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, scraperEnabled: true, enabledSources: ["onrealt"] } });
  aiFactory.mockClear(); configureSearchAi(aiFactory);
});
afterEach(() => { configureSearchAi(async () => null); vi.restoreAllMocks(); vi.unstubAllEnvs(); resetConfigCache(); });

describe("non-empty installed queue persistence contract (both databases)", () => {
  it.each(["office", "residential"] as const)("API queue → real normalized %s batch → durable evaluations, no paid consent/key", async purpose => {
    const filters = SearchFilters.parse({ operation: "sale", purposes: [purpose], requiredFeatures: ["парковка"] });
    const body = { filters, sources: ["onrealt"], confirmedPaid: false, idempotencyKey: `real-batch-${purpose}` };
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await enqueueApi(apiRequest("POST", "/api/v1/property-search/runs", { cookie, body }), routeParams({}));
    expect(response.status).toBe(200);
    const run = await response.json() as { id: string; status: string };
    expect(run.status).toBe("queued");
    expect((await enqueueSearch(users.realtor1, body)).id).toBe(run.id);
    const offline = offlineOnRealt(purpose);
    expect(await processSearchQueue({ scraper: offline.scraper })).toBe(true);
    const persisted = await getSearchRun(users.realtor1, run.id);
    expect(persisted).toMatchObject({ status: "completed", lockedBy: null, webSearchUsed: false });
    expect(persisted.sources).toEqual([expect.objectContaining({ source: "onrealt", status: "success", resultCount: 12, acceptedCount: 11 })]);
    expect(persisted.results).toHaveLength(12);
    expect(await db.externalListing.count()).toBe(12);
    expect(await db.externalListingSnapshot.count({ where: { searchRunId: run.id } })).toBe(12);
    const first = persisted.results.find(r => r.listing.sourceListingId === (purpose === "office" ? "91000000" : "92000000"))!;
    expect(first.listing.areaM2?.toString()).toBe("145.1");
    expect(first.listing.priceRub?.toString()).toBe("12500000");
    expect(first.snapshot).toMatchObject({ area: 145.1, price: "12500000.00", publishedAt: null, datePrecision: "unknown" });
    expect(new Set(persisted.results.map(r => r.verdict))).toEqual(new Set(["confirmed", "needs_review", "rejected"]));
    const unknownPrice = persisted.results.find(r => r.listing.priceRub === null)!;
    expect(unknownPrice.snapshot).toMatchObject({ price: null });
    expect(offline.transport).toHaveBeenCalled(); expect(offline.close).toHaveBeenCalledTimes(1);
    expect(aiFactory).not.toHaveBeenCalled();
    expect(await db.aiUsageLog.count()).toBe(0); expect(await db.aiBudgetReservation.count()).toBe(0);
    await expect(getSearchRun(users.realtor2, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.searchRun.update({ where: { id: run.id }, data: { status: "running", lockedBy: "dead", heartbeatAt: new Date(0) } });
    expect(await recoverSearchQueue()).toBe(1);
    const resumed = offlineOnRealt(purpose);
    expect(await processSearchQueue({ scraper: resumed.scraper })).toBe(true);
    expect(resumed.factory).not.toHaveBeenCalled();
    expect(await db.externalListingSnapshot.count()).toBe(12);
    expect(await db.searchRunResult.count()).toBe(12);
    expect(await processSearchQueue({ scraper: resumed.scraper })).toBe(false);
  });

  it("rolls back a failed non-empty source batch and exposes only finite PERSIST diagnostics", async () => {
    const filters = SearchFilters.parse({ operation: "sale", purposes: ["office"] });
    const run = await enqueueSearch(users.realtor1, { filters, sources: ["onrealt"], idempotencyKey: "persist-failure-safe" });
    const offline = offlineOnRealt("office");
    const original = offline.scraper.searchDetailed.bind(offline.scraper);
    vi.spyOn(offline.scraper, "searchDetailed").mockImplementation(async (...args) => {
      const batch = await original(...args);
      expect(batch.listings).toHaveLength(12);
      batch.listings[1]!.listing.area = 10000000000;
      return batch;
    });
    await processSearchQueue({ scraper: offline.scraper });
    expect(await db.searchRunResult.count()).toBe(0); expect(await db.externalListing.count()).toBe(0);
    expect(await db.externalListingSnapshot.count()).toBe(0);
    const progress = await searchProgress(users.realtor1, run.id);
    expect(progress).toMatchObject({ status: "partial", progress: { phase: "partial", failureStage: "PERSIST" }, sources: [{ status: "error", resultCount: 0 }] });
    const diagnostics = progress.progress as Record<string, unknown>;
    expect(["WORKER_FAILURE", "DB_CONSTRAINT", "DB_INPUT_INVALID"]).toContain(diagnostics.failureCode);
    expect(Object.keys(diagnostics).sort()).toEqual(["dateDetails", "duplicateGrouping", "duplicateGroupingError", "failureCode", "failureStage", "phase"].sort());
    expect(aiFactory).not.toHaveBeenCalled();
  });

  it("never persists the returned real batch after the worker loses its lease", async () => {
    const filters = SearchFilters.parse({ operation: "sale", purposes: ["office"] });
    const run = await enqueueSearch(users.realtor1, { filters, sources: ["onrealt"], idempotencyKey: "real-batch-lease-fence" });
    const offline = offlineOnRealt("office"), original = offline.scraper.searchDetailed.bind(offline.scraper);
    vi.spyOn(offline.scraper, "searchDetailed").mockImplementation(async (...args) => {
      const batch = await original(...args);
      expect(batch.listings).toHaveLength(12);
      await db.searchRun.update({ where: { id: run.id }, data: { lockedBy: "replacement-worker" } });
      return batch;
    });
    await processSearchQueue({ scraper: offline.scraper });
    expect(await db.searchRunResult.count()).toBe(0); expect(await db.externalListingSnapshot.count()).toBe(0);
    expect(await db.searchRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "running", lockedBy: "replacement-worker" });
  });

  it("does not retain arbitrary exception fields in outer-worker progress", async () => {
    const filters = SearchFilters.parse({ operation: "sale", purposes: ["office"] });
    const run = await enqueueSearch(users.realtor1, { filters, sources: ["onrealt"], idempotencyKey: "safe-normalize-failure" });
    const offline = offlineOnRealt("office"), original = offline.scraper.searchDetailed.bind(offline.scraper);
    vi.spyOn(offline.scraper, "searchDetailed").mockImplementation(async (...args) => {
      const batch = await original(...args);
      vi.spyOn(db.externalListing, "findFirst").mockRejectedValueOnce(Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), { code: "SYNTHETIC_PRIVATE_CODE", sql: "SYNTHETIC_PRIVATE_SQL", stack: "SYNTHETIC_PRIVATE_STACK" }));
      return batch;
    });
    await processSearchQueue({ scraper: offline.scraper });
    const progress = await searchProgress(users.realtor1, run.id);
    expect(progress).toMatchObject({ status: "partial", progress: { failureStage: "NORMALIZE", failureCode: "WORKER_FAILURE" } });
    expect(JSON.stringify(progress)).not.toContain("SYNTHETIC_PRIVATE");
    expect(await db.searchRunResult.count()).toBe(0);
  });
});
