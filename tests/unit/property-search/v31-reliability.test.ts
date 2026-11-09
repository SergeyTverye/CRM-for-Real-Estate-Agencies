import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { SOURCES, type Source } from "@/modules/property-search/domain/types";
import { extractListingDates, parseSourceDate } from "@/modules/property-search/infrastructure/listing-dates";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { detectAccessChallenge, resilientTransport, retryAfterMs } from "@/modules/property-search/infrastructure/source-response";
import { resolveSourceDepth, SOURCE_LIMITS } from "@/modules/property-search/infrastructure/source-limits";
import { defaultScraperFactory, RealEstateScraperAdapter, ScraperJobLimiter } from "@/modules/property-search/infrastructure/scraper-adapter";


vi.mock("@/modules/property-search/domain/evaluation", () => ({ evaluateListing: () => ({ verdict: "needs_review", criteria: [], preferences: [], score: 0, aiPending: [] }) }));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const fetchedAt = "2026-11-05T18:30:00.000Z"; 
const domains: Record<Source, string> = { cian: "www.cian.ru", avito: "www.avito.ru", domclick: "domclick.ru", yandex: "realty.yandex.ru", onrealt: "onrealt.ru", youla: "youla.ru", mirkvartir: "cre.mirkvartir.ru" };
function fixture(source: Source): RealEstateScraper.SearchResult { return JSON.parse(readFileSync(`tests/fixtures/scraper/${source}.json`, "utf8")); }

describe("SR-03 dates for all seven adapters", () => {
  it.each(SOURCES)("%s binds dates to listing identity and separates update/publication", source => {
    const url = `https://${domains[source]}/offer/101/`;
    const payload = { items: [{ id: 999, datePublished: "2020-01-01" }, { id: 101, url, datePublished: "вчера", dateModified: "сегодня в 01:15" }] };
    expect(extractListingDates(source, payload, { id: "101", url }, fetchedAt)).toEqual({ publishedAt: "2026-11-04T17:00:00.000Z", sourceUpdatedAt: "2026-11-05T18:15:00.000Z", dateSource: `${source}:structured:publication`, datePrecision: "day" });
    const updatedOnly = extractListingDates(source, { id: 101, updatedAt: "2026-11-05T12:00:00Z" }, { id: "101", url }, fetchedAt);
    expect(updatedOnly.publishedAt).toBeNull(); expect(updatedOnly.dateSource).toContain(":update");
    expect(extractListingDates(source, { timestamp: fetchedAt, id: 101 }, { id: "101", url }, fetchedAt)).toEqual({ publishedAt: null, sourceUpdatedAt: null, dateSource: "unknown", datePrecision: "unknown" });
    const raw = fixture(source).results[0]!;
    expect(normalizeListing({ ...raw, publishedAt: "2026-11-04T17:00:00.000Z", dateSource: `${source}:html_label:publication`, datePrecision: "day" } as RealEstateScraper.Listing, fetchedAt)).toMatchObject({ publishedAt: "2026-11-04T17:00:00.000Z", datePrecision: "day", dateSource: `${source}:html_label:publication` });
  });
  it.each(SOURCES)("%s parses labelled card dates without taking a neighbour's date", source => {
    const url = `https://${domains[source]}/101/`;
    const html = `<article><a href='/999/'>Other</a><time itemprop='datePublished'>сегодня</time></article><article><a href='/101/'>Listing</a><time>сегодня</time><time class='updated'>Обновлено вчера</time><time itemprop='datePublished'>Опубликовано 3 дня назад</time></article>`;
    expect(extractListingDates(source, html, { url }, fetchedAt)).toMatchObject({ publishedAt: "2026-11-02T17:00:00.000Z", sourceUpdatedAt: "2026-11-04T17:00:00.000Z", datePrecision: "day" });
  });
  it.each([
    ["сегодня", "2026-11-05T17:00:00.000Z", "day"], ["вчера в 23:00", "2026-11-05T16:00:00.000Z", "exact"],
    ["3 дня назад", "2026-11-02T17:00:00.000Z", "day"], ["05.11.2026", "2026-11-04T17:00:00.000Z", "day"],
    ["5 ноября 2026, 23:10", "2026-11-05T16:10:00.000Z", "exact"], ["2026-11-05T10:30:00", "2026-11-05T03:30:00.000Z", "exact"],
    ["2026-11-05T10:30:00+03:00", "2026-11-05T07:30:00.000Z", "exact"],
  ])("parses %s in source timezone", (value, at, precision) => expect(parseSourceDate(value, fetchedAt)).toEqual({ at, precision }));
  it.each(["2026-02-30", "2026-13-01", "2026-11-05T99:99:00", "вчера 25:00", "recent", "", null, 42])("rejects uncertain date %s", value => expect(parseSourceDate(value, fetchedAt)).toBeNull());
  it("rolls month and year back reproducibly", () => {
    expect(parseSourceDate("вчера", "2026-12-31T18:00:00Z")?.at).toBe("2026-12-30T17:00:00.000Z");
    expect(parseSourceDate("31 декабря", "2026-01-01T12:00:00Z")?.at).toBe("2025-12-30T17:00:00.000Z");
  });
  it("reads Cian concat and Domclick assigned SSR without executing scripts", () => {
    const url = "https://www.cian.ru/sale/commercial/101/";
    const html = `<script>window['legacy-commercial-serp-frontend'] = [].concat([{"key":"initialState","value":{"offers":[{"cianId":101,"creationDate":"2026-11-04","description":"undefined stays a string"}]}}]);throw new Error('DO_NOT_EXECUTE')</script>`;
    expect(extractListingDates("cian", html, { id: "101", url }, fetchedAt)).toMatchObject({ publishedAt: "2026-11-03T17:00:00.000Z" });
    const ssr = `<script>window.__SSR_STATE__={"absent":undefined,"items":[{"id":101,"publishedAt":"2026-11-04","description":"undefined"}]};</script>`;
    expect(extractListingDates("domclick", ssr, { id: "101", url: "https://domclick.ru/card/101/" }, fetchedAt)).toMatchObject({ publishedAt: "2026-11-03T17:00:00.000Z" });
  });
});

describe("AT-04 REPLAY live evidence (not a fresh live test)", () => {
  it.each(SOURCES)("%s replays normalized property projection and technical errors", source => {
    const replay = JSON.parse(readFileSync(`tests/fixtures/scraper/v31/${source}/live.json`, "utf8"));
    expect(replay).toMatchObject({ mode: "REPLAY", capturedFrom: "LIVE", source });
    expect(replay.requests).toBeLessThanOrEqual(3);
    expect(["PASS", "PARTIAL", "BLOCKED"]).toContain(replay.status);
    expect(replay.normalized).toHaveLength(replay.resultCount);
    for (const row of replay.normalized) {
      expect(row).toMatchObject({ source, description: "", address: null, seller: { type: "unknown" } });
      expect(row).toHaveProperty("publishedAt"); expect(row).toHaveProperty("sourceUpdatedAt");
    }
    expect(JSON.stringify(replay)).not.toMatch(/(?:phone|password|cookie|authorization)"\s*:/iu);
    
    expect(normalizeListing(fixture(source).results[0]!, fetchedAt)).toMatchObject({ source, price: "15000000.00" });
  });
  it.each(SOURCES)("%s rejects CAPTCHA and unrecognized parser input offline", source => {
    const client = extendSourceParsers(new RealEstateScraper());
    const url = `https://${domains[source]}/`;
    expect(() => client.parsers[source].parsePage("<h1>Подтвердите, что вы человек</h1><div id='captcha'></div>", url, {})).toThrow("NEEDS_USER_ACTION");
    expect(() => client.parsers[source].parsePage("<html><h1>Changed markup</h1></html>", url, {})).toThrow();
  });
  it.each([ ["cian", "parse_failed"], ["avito", "blocked"], ["domclick", "blocked"], ["mirkvartir", "error"] ] as const)("%s replays observed LIVE failure classification", async (source, status) => {
    const replay = JSON.parse(readFileSync(`tests/fixtures/scraper/v31/${source}/live.json`, "utf8"));
    const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory: async () => ({ close: async () => {}, searchSite: async () => ({ ...fixture(source), source, results: [], pages: [], errors: replay.errors.map((e: object) => ({ ...e, source, error: "" })) }) }) });
    expect((await adapter.searchDetailed({ operation: "sale", sources: [source] })).sources[0]).toMatchObject({ status, resultCount: 0, incomplete: true });
  });
});

describe("SR-04 source budgets", () => {
  it.each(SOURCES)("%s clamps server configuration by hard and ENV ceilings", source => {
    vi.stubEnv(`SCRAPER_${source.toUpperCase()}_MAX_PAGES`, "1");
    vi.stubEnv(`SCRAPER_${source.toUpperCase()}_MAX_LISTINGS`, "12");
    expect(resolveSourceDepth(source, { maxPages: 999, limit: 999 })).toMatchObject({ maxPages: 1, limit: 12 });
    expect(resolveSourceDepth(source, {}, 5).estimatedRequests).toBe(5 * SOURCE_LIMITS[source].requestsPerPage + SOURCE_LIMITS[source].setupRequests + (["onrealt", "mirkvartir"].includes(source) ? 3 : 0));
  });
  it("cancels a queued source without waiting for another hanging job", async () => {
    const limiter = new ScraperJobLimiter(1), controller = new AbortController();
    let release!: () => void;
    const first = limiter.run(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const queued = limiter.run(async () => 1, { signal: controller.signal });
    const rejected = expect(queued).rejects.toEqual({ code: "ABORTED" });
    controller.abort(); await rejected; release(); await first;
    expect(await limiter.run(async () => 2)).toBe(2);
  });
  it("expires a queued job within its own deadline", async () => {
    const limiter = new ScraperJobLimiter(1);
    let release!: () => void;
    const first = limiter.run(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    await expect(limiter.run(async () => 1, { deadline: Date.now() + 5 })).rejects.toEqual({ code: "TIMEOUT" });
    release(); await first;
  });
  it("passes configured depth and marks a fully exhausted branch complete", async () => {
    const searchSite = vi.fn(async (source: Source) => {
      const f = fixture(source), page = f.pages[0]!;
      return { ...f, source, pages: [{ ...page, page: 1, hasNext: true, types: ["office" as const] }, { ...page, page: 2, hasNext: false, types: ["office" as const] }] };
    });
    const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, depth: { maxPages: 3, limit: 120 }, factory: async () => ({ close: async () => {}, searchSite }) });
    const result = await adapter.searchDetailed({ operation: "sale", sources: ["cian"] });
    expect(searchSite).toHaveBeenCalledWith("cian", expect.objectContaining({ maxPages: 3, limit: 120 }));
    expect(result.sources[0]).toMatchObject({ incomplete: false, pagesFetched: 2, maxPages: 3, limit: 120, reason: null });
  });
});

describe("SR-05 HTTP resilience", () => {
  it("factory defaults to guarded transport and never enables package retries", async () => {
    const create = vi.spyOn(RealEstateScraper, "create");
    const client = await defaultScraperFactory({});
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ transport: expect.any(Function), maxRetries: 0 }));
    await client.close();
  });
  it.each(["cian", "avito", "yandex", "domclick"])("detects %s verification, ignores captcha library references", source => {
    const url = `https://${domains[source as Source]}/`;
    expect(detectAccessChallenge(url, "<title>Проверка безопасности</title>")).toBe(true);
    expect(detectAccessChallenge(url, '<script src="captcha-library.js"></script><h1>Офисы</h1>')).toBe(false);
  });
  it("reads both Retry-After forms, invalid values do not invite retry", () => {
    expect(retryAfterMs("30", 0)).toBe(30000); expect(retryAfterMs("Thu, 01 Jan 1970 00:00:30 GMT", 0)).toBe(30000);
    expect(retryAfterMs("nonsense")).toBeNull(); expect(retryAfterMs(undefined)).toBeNull(); expect(retryAfterMs("0")).toBe(1000);
    expect(retryAfterMs("-1")).toBeNull();
  });
  it("performs exactly one delayed retry within deadline", async () => {
    vi.useFakeTimers();
    const base = vi.fn().mockResolvedValueOnce({ data: "", status: 429, headers: { "retry-after": "2" } }).mockResolvedValue({ data: "ok", status: 200 });
    const transport = resilientTransport(base, "avito", Date.now() + 10000);
    const promise = transport({ url: "https://www.avito.ru/", method: "GET", headers: {}, timeout: 10000 });
    await vi.advanceTimersByTimeAsync(1999); expect(base).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(await promise).toMatchObject({ status: 200 }); expect(base).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 439, 429])("does not retry blocked HTTP %s or subsequent branches", async status => {
    const base = vi.fn(async () => ({ data: "", status, headers: { "retry-after": "120" } }));
    const transport = resilientTransport(base, "avito", Date.now() + 1000);
    const request = { url: "https://www.avito.ru/", method: "GET", headers: {}, timeout: 1000 };
    await expect(transport(request)).rejects.toMatchObject({ code: status === 429 ? "RATE_LIMITED" : "ACCESS_BLOCKED" });
    await expect(transport(request)).rejects.toBeDefined(); expect(base).toHaveBeenCalledOnce();
  });
  it("cancels an active HTTP request and preserves another source", async () => {
    const controller = new AbortController();
    const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory: async () => ({ close: async () => {}, searchSite: async (source, query) => {
      if (source === "onrealt") return { ...fixture(source), source };
      return new Promise((_, reject) => { query?.signal?.addEventListener("abort", () => reject({ code: "ABORTED" }), { once: true }); setTimeout(() => controller.abort(), 5); });
    } }) });
    const result = await adapter.searchDetailed({ operation: "sale", sources: ["onrealt", "cian"] }, { signal: controller.signal });
    expect(result.sources.map(s => s.status)).toEqual(["success", "cancelled"]); expect(result.listings).toHaveLength(1);
  });
  it("preserves a successful page when a later page is aborted", async () => {
    const client = extendSourceParsers(new RealEstateScraper());
    client.searchPages = async function* () {
      const f = fixture("cian");
      yield { ...f.pages[0]!, source: "cian", page: 1, results: f.results, total: 1, errors: [], hasNext: true, nextUrl: "https://www.cian.ru/?p=2" };
      throw Object.assign(new Error("abort"), { code: "ABORTED" });
    };
    const result = await client.searchSite("cian", {});
    expect(result.results).toHaveLength(1); expect(result.partial).toBe(true); expect(result.errors[0]).toMatchObject({ code: "ABORTED", page: 2 });
  });
  it("restores semantic rate limit and CAPTCHA errors through package fetch wrapping", async () => {
    for (const [data, status, expected] of [["", 429, "RATE_LIMITED"], ["<title>Проверка безопасности</title>", 200, "NEEDS_USER_ACTION"]] as const) {
      const base = vi.fn(async () => ({ data, status }));
      const client = extendSourceParsers(new RealEstateScraper({ maxRetries: 0, transport: resilientTransport(base, "cian", Date.now() + 1000) }));
      await expect(client.parsers.cian.fetch("https://www.cian.ru/")).rejects.toMatchObject({ code: expected });
      expect(base).toHaveBeenCalledOnce();
    }
    expect(detectAccessChallenge("https://domclick.ru/", { captcha: true })).toBe(true);
  });
});
