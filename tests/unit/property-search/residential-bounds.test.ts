import { describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { SearchFilters, SOURCES, type Source } from "@/modules/property-search/domain/types";
import { RealEstateScraperAdapter, type ScraperClient } from "@/modules/property-search/infrastructure/scraper-adapter";
import { buildScraperQueries, RESIDENTIAL_TYPES } from "@/modules/property-search/infrastructure/source-filters";
import { boundSourceQueries, resolveSourceDepth, SOURCE_LIMITS } from "@/modules/property-search/infrastructure/source-limits";

const timestamp = "2026-11-06T05:00:00.000Z";
function row(id: string, source: Source = "cian"): RealEstateScraper.Listing {
  return { id, source, url: `https://example.invalid/${id}`, title: id, category: "residential", deal: "sale",
    price: null, address: null, rooms: null, area: null, floor: null, images: [], description: null,
    phone: null, city: "Москва", district: null, timestamp };
}
function response(source: Source, query: RealEstateScraper.Query, results: RealEstateScraper.Listing[] = []): Awaited<ReturnType<ScraperClient["searchSite"]>> {
  return { source, query, results, total: results.length, timestamp, errors: [], partial: false,
    pages: [{ source, page: 1, types: query.type ? [query.type as RealEstateScraper.PropertyType] : undefined,
      total: results.length, hasNext: false, nextUrl: null, errors: [] }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const input = { city: "Москва", operation: "sale", purposes: ["residential"], sources: ["cian"] };
function harness(searchSite: ScraperClient["searchSite"], limit = 12, timeout = 2000) {
  const close = vi.fn(async () => {});
  const factory = vi.fn(async () => ({ searchSite, close }));
  return { close, factory, adapter: new RealEstateScraperAdapter({ enabled: true, browserEnabled: false,
    factory, depth: { limit, maxPages: 2 }, jobTimeoutMs: timeout }) };
}

describe("bounded residential fanout (synthetic, no network)", () => {
  it("retains the first completed branch when the second hangs past the real deadline", async () => {
    const first = deferred<Awaited<ReturnType<ScraperClient["searchSite"]>>>();
    const entered = deferred<RealEstateScraper.Query>();
    const second = deferred<RealEstateScraper.Query>();
    const tail = deferred<Awaited<ReturnType<ScraperClient["searchSite"]>>>();
    const calls: RealEstateScraper.Query[] = [];
    const { adapter, close } = harness(async (source, query = {}) => {
      calls.push(query);
      if (calls.length === 1) { entered.resolve(query); return first.promise; }
      second.resolve(query); return tail.promise;
    }, 12, 200);
    const pending = adapter.searchDetailed(input);
    first.resolve(response("cian", await entered.promise, [row("kept")]));
    const hanging = await second.promise;
    const result = await pending;
    expect(hanging.signal?.aborted).toBe(true);
    expect(result.sources[0]).toMatchObject({ status: "partial", resultCount: 1, incomplete: true, failureCode: "TIMEOUT", listingsFetched: 1 });
    expect(result.listings.map(item => item.listing.sourceListingId)).toEqual(["kept"]);
    expect(calls).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
    
    tail.resolve(response("cian", hanging, [row("late")]));
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(result.listings).toHaveLength(1);
  });

  it.each([false, true])("honors external abort with earlier success=%s", async success => {
    const controller = new AbortController();
    const entered = deferred<RealEstateScraper.Query>();
    const tail = deferred<Awaited<ReturnType<ScraperClient["searchSite"]>>>();
    const calls: RealEstateScraper.Query[] = [];
    const { adapter, close } = harness(async (source, query = {}) => {
      calls.push(query);
      if (success && calls.length === 1) return response(source, query, [row("kept")]);
      entered.resolve(query); return tail.promise;
    });
    const pending = adapter.searchDetailed(input, { signal: controller.signal });
    const hanging = await entered.promise;
    controller.abort();
    const result = await pending;
    expect(result.sources[0]).toMatchObject({ status: success ? "partial" : "cancelled", resultCount: success ? 1 : 0 });
    if (success) expect(result.sources[0]?.failureCode).toBe("ABORTED");
    expect(hanging.signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    tail.resolve(response("cian", hanging));
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(success ? 2 : 1);
  });

  it.each([1, 6, 13])("caps unique output at %s, deduplicates and still visits all housing types", async limit => {
    const calls: RealEstateScraper.Query[] = [];
    const { adapter } = harness(async (source, query = {}) => {
      calls.push(query);
      
      return response(source, query, [row("shared"), ...Array.from({ length: 20 }, (_, i) => row(`${query.type}-${i}`))]);
    }, limit);
    const result = await adapter.searchDetailed(input);
    expect(calls.map(query => query.type)).toEqual([...RESIDENTIAL_TYPES]);
    expect(calls.map(query => query.limit)).toEqual(RESIDENTIAL_TYPES.map((_, index) => Math.max(1, Math.floor(limit / 6) + (index < limit % 6 ? 1 : 0))));
    expect(result.listings).toHaveLength(limit);
    expect(new Set(result.listings.map(item => item.listing.sourceListingId)).size).toBe(limit);
    expect(result.sources[0]).toMatchObject({ resultCount: limit, limit, maxPages: 12, estimatedRequests: 12, incomplete: true });
    if (limit >= 6) expect(result.listings.some(item => item.listing.sourceListingId?.startsWith("cottage-"))).toBe(true);
  });

  it("isolates a failed housing branch and counts only unique valid rows", async () => {
    const { adapter } = harness(async (source, query = {}) => {
      if (query.type === "studio") throw { code: "UNSUPPORTED_FILTER" };
      return response(source, query, [row("same"), row("same"), { ...row("bad"), url: "file:///invalid" }]);
    });
    const result = await adapter.searchDetailed(input);
    expect(result.listings).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ status: "partial", resultCount: 1, incomplete: true });
  });

  it("shares the total allowance across commercial plus residential without dropping either category", async () => {
    const calls: RealEstateScraper.Query[] = [];
    const { adapter } = harness(async (source, query = {}) => {
      calls.push(query);
      return response(source, query, Array.from({ length: query.limit ?? 1 }, (_, index) => row(`${query.type ?? "commercial"}-${index}`)));
    }, 14);
    const result = await adapter.searchDetailed({ ...input, purposes: ["office", "retail", "residential"] });
    expect(calls).toHaveLength(7);
    expect(calls[0]).toMatchObject({ category: "commercial", types: ["office", "retail"], limit: 2 });
    expect(calls.slice(1).map(query => query.type)).toEqual([...RESIDENTIAL_TYPES]);
    expect(result.listings).toHaveLength(14);
    expect(result.sources[0]).toMatchObject({ resultCount: 14, maxPages: 14, estimatedRequests: 14 });
    expect(result.listings.slice(0, 7).map(item => item.listing.sourceListingId))
      .toEqual(["commercial-0", ...RESIDENTIAL_TYPES.map(type => `${type}-0`)]);
  });

  it("never creates a client for already cancelled or expired work", async () => {
    const { adapter, factory } = harness(async (source, query = {}) => response(source, query));
    const controller = new AbortController(); controller.abort();
    expect((await adapter.searchDetailed(input, { signal: controller.signal })).sources[0]?.status).toBe("cancelled");
    expect((await adapter.searchDetailed(input, { deadline: Date.now() - 1 })).sources[0]?.status).toBe("timeout");
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(SOURCES)("accounts for actual package commercial variants and mixed OR on %s", async source => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    for (const purposes of [[], ["office", "retail", "free_purpose"], ["office", "retail", "free_purpose", "residential"]]) {
      const filters = SearchFilters.parse({ city: "Москва", operation: "sale", purposes, sources: [source] });
      const depth = resolveSourceDepth(source, { maxPages: 2, limit: 14 });
      const queries = buildScraperQueries(filters, source, new AbortController().signal, undefined, depth);
      const bounded = boundSourceQueries(source, queries, depth);
      const plans = await Promise.all(queries.map(query => scraper.buildSearchLinks({ ...query, signal: undefined })));
      const variants = plans.reduce((n, plan) => n + plan.searches.length + plan.errors.length, 0);
      expect(bounded.maxPages).toBe(depth.maxPages * variants);
      expect(bounded.estimatedRequests).toBe(bounded.maxPages * SOURCE_LIMITS[source].requestsPerPage + SOURCE_LIMITS[source].setupRequests + (["onrealt", "mirkvartir"].includes(source) ? 3 : 0));
      const calls: RealEstateScraper.Query[] = [];
      const { adapter } = harness(async (s, query = {}) => { calls.push(query); return response(s, query); }, 14);
      await adapter.searchDetailed({ ...input, purposes, sources: [source] });
      expect(calls.map(({ limit: omitted, signal: ignored, ...query }) => { void omitted; void ignored; return query; }))
        .toEqual(bounded.queries.map(({ limit: omitted, signal: ignored, ...query }) => { void omitted; void ignored; return query; }));
      expect(calls.every(q => (q.limit ?? 0) >= 1 && (q.limit ?? 0) <= 14)).toBe(true);
    }
  });
});
