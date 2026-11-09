import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { RealEstateScraperAdapter, type ScraperFactory } from "@/modules/property-search/infrastructure/scraper-adapter";
import { RESIDENTIAL_TYPES } from "@/modules/property-search/infrastructure/source-filters";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";

afterEach(() => vi.useRealTimers());
const input = { city: "Новосибирск", operation: "sale", purposes: ["residential"] };

describe("residential branch scheduling (offline replay)", () => {
  it("isolates concurrent page documents and enriches only cards inside the requested limit", async () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/scraper/onrealt.json", "utf8")) as RealEstateScraper.SearchResult;
    const client = new RealEstateScraper({ maxRetries: 0 });
    const parser = client.parsers.onrealt;
    parser.fetch = async url => ({ id: fixture.results[0]!.id,
      datePublished: url.endsWith("flat") ? "2026-11-01T00:00:00Z" : "2026-11-02T00:00:00Z" });
    parser.searchPage = async (query = {}) => {
      await parser.fetch(`https://onrealt.ru/replay/${query.type}`);
      
      await new Promise(resolve => setTimeout(resolve, query.type === "flat" ? 10 : 20));
      return { ...fixture.pages[0]!, results: [fixture.results[0]!, { ...fixture.results[0]!, id: "discarded" }] };
    };
    extendSourceParsers(client, { maxCards: 0 });
    const [flat, studio] = await Promise.all([
      parser.searchPage({ type: "flat", limit: 1 }), parser.searchPage({ type: "studio", limit: 1 }),
    ]);
    expect(flat.results[0]).toHaveProperty("publishedAt", "2026-11-01T00:00:00.000Z");
    expect(studio.results[0]).toHaveProperty("publishedAt", "2026-11-02T00:00:00.000Z");
    expect(flat.results[1]).not.toHaveProperty("publishedAt");
    expect(studio.results[1]).not.toHaveProperty("publishedAt");
    await client.close();
  });

  it.each(["mirkvartir", "onrealt"] as const)("covers all six %s branches with only two in flight, stable type priority and no detail GETs", async source => {
    vi.useFakeTimers();
    const fixture = JSON.parse(readFileSync(`tests/fixtures/scraper/${source}.json`, "utf8")) as RealEstateScraper.SearchResult;
    let active = 0, peak = 0;
    const calls: string[] = [];
    const factory: ScraperFactory = vi.fn(async config => {
      expect(config.dateDetailMaxCards).toBe(0);
      return { close: async () => {}, searchSite: async (_: RealEstateScraper.Source, query: RealEstateScraper.Query = {}) => {
        const kind = String(query.type);
        calls.push(kind); peak = Math.max(peak, ++active);
        
        await new Promise(resolve => setTimeout(resolve, kind === "flat" ? 200 : 100));
        active--;
        return { ...fixture, source, errors: [], partial: false,
          results: [{ ...fixture.results[0]!, id: kind, url: `https://${source}.ru/replay/${kind}` }],
          pages: [{ source, page: 1, types: [kind as RealEstateScraper.PropertyType], total: 1, hasNext: false, nextUrl: null, errors: [] }],
        };
      } };
    });
    const pending = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory,
      jobTimeoutMs: 1000, depth: { maxPages: 1, limit: 6 },
    }).searchDetailed({ ...input, sources: [source] });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(peak).toBe(2);
    expect(calls).toEqual([...RESIDENTIAL_TYPES]);
    expect(result.listings.map(row => row.listing.sourceListingId)).toEqual([...RESIDENTIAL_TYPES]);
    expect(result.sources[0]).toMatchObject({ status: "success", pagesFetched: 6, resultCount: 6 });
  });

  it("keeps completed branches at deadline, aborts hanging work and ignores late results", async () => {
    vi.useFakeTimers();
    const fixture = JSON.parse(readFileSync("tests/fixtures/scraper/onrealt.json", "utf8")) as RealEstateScraper.SearchResult;
    let finishLate!: (value: RealEstateScraper.SearchResult & { source: RealEstateScraper.Source }) => void;
    let hangingSignal: AbortSignal | undefined;
    const close = vi.fn(async () => {});
    const factory: ScraperFactory = async () => ({ close, searchSite: async (source, query = {}) => {
      if (query.type === "studio") {
        hangingSignal = query.signal;
        return new Promise(resolve => { finishLate = resolve; });
      }
      return { ...fixture, source, errors: [], results: [{ ...fixture.results[0]!, id: String(query.type), url: `https://onrealt.ru/replay/${query.type}` }] };
    } });
    const pending = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory,
      jobTimeoutMs: 500, depth: { maxPages: 1, limit: 6 },
    }).searchDetailed({ ...input, sources: ["onrealt"] });
    await vi.advanceTimersByTimeAsync(550);
    const result = await pending;
    expect(result.sources[0]).toMatchObject({ status: "partial", failureCode: "TIMEOUT", resultCount: 5 });
    expect(hangingSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    finishLate({ ...fixture, source: "onrealt" });
    await vi.advanceTimersByTimeAsync(1);
    expect(result.listings).toHaveLength(5);
  });
});
