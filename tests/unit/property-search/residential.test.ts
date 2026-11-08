import { describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import type RealEstateScraperNs from "real-estate-scrapper";
import cian from "../../fixtures/scraper/cian.json";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, SOURCES, type NormalizedListing } from "@/modules/property-search/domain/types";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { RESIDENTIAL_TYPES, buildScraperQueries, buildScraperQuery } from "@/modules/property-search/infrastructure/source-filters";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";

const HOUSING = [...RESIDENTIAL_TYPES] as string[];

const signal = new AbortController().signal;
const base = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["residential"] });
const listing = (input: Partial<NormalizedListing> = {}): NormalizedListing => ({
  ...normalizeListing(cian.results[0] as RealEstateScraper.Listing),
  purpose: null, title: null, description: "", city: "Москва", ...input,
});

describe("residential (Жилая) end-to-end, synthetic offline", () => {
  it.each(SOURCES)("fans residential-only %s out to one query per housing type", source => {
    const queries = buildScraperQueries(base, source, signal);
    expect(queries).toHaveLength(HOUSING.length);
    expect(queries.map(q => q.type).sort()).toEqual([...HOUSING].sort());
    for (const query of queries) {
      expect(query).toMatchObject({ city: "Москва", category: "residential", deal: "sale" });
      expect(query).not.toHaveProperty("types");
    }
  });
  it("rejects the legacy residential types array against the real package contract", () => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    const invalidQuery: unknown = { city: "Москва", category: "residential", types: ["residential"], deal: "sale" };
    expect(() => Reflect.apply(scraper.buildSearchUrls, scraper, [invalidQuery])).toThrowError(/types accepts commercial property types only/);
  });
  it.each(SOURCES)("every generated residential query reaches a supported or explicit unsupported plan for %s", async source => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    for (const query of buildScraperQueries(base, source, signal)) {
      const plan = await scraper.buildSearchLinks({ ...query, sources: [source] });
      expect(plan.searches.length + plan.errors.length).toBeGreaterThan(0);
      expect(plan.errors.every(error => ["UNSUPPORTED_FILTER", "NOT_APPLICABLE", "LOCATION_REQUIRED", "LOCATION_NOT_FOUND"].includes(error.code))).toBe(true);
    }
  });
  it.each(SOURCES)("builds real search links for %s without network and keeps partial coverage", async source => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    const searches: { source: string; types: string[]; url: string }[] = [];
    const errors: { source: string; code: string; error: string; types?: string[] }[] = [];
    for (const query of buildScraperQueries(base, source, signal)) {
      const plan = await scraper.buildSearchLinks({ ...query, signal: undefined, sources: [source] });
      searches.push(...plan.searches);
      errors.push(...plan.errors);
    }
    // youla/domclick/cian-suburban требуют native URL для части жилых типов:
    // проваленные ветви фиксируются, успешные сохраняются, подмена unsupported_filter запрещена.
    for (const entry of [...searches, ...errors]) expect(JSON.stringify(entry)).not.toMatch(/types accepts commercial property types only/);
    expect(searches.length + errors.length).toBeGreaterThan(0);
    if (searches.length) expect(errors.every(e => ["UNSUPPORTED_FILTER", "NOT_APPLICABLE", "LOCATION_REQUIRED"].includes(e.code))).toBe(true);
  });
  it("covers every city/operation/housing-type with supported link or genuine unsupported (real package)", async () => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    const GENUINE = ["UNSUPPORTED_FILTER", "NOT_APPLICABLE", "LOCATION_REQUIRED", "LOCATION_NOT_FOUND", "DISTRICT_RESOLUTION_REQUIRED"];
    for (const city of ["Новосибирск", "Москва"]) for (const source of SOURCES) for (const operation of ["sale", "rent"] as const) {
      const filters = SearchFilters.parse({ city, operation, priceUnit: operation === "rent" ? "rub_month" : "rub_total", purposes: ["residential"] });
      const queries = buildScraperQueries(filters, source, signal);
      expect(queries.map(q => q.type).sort()).toEqual([...HOUSING].sort());
      for (const query of queries) {
        expect(query).toMatchObject({ city, category: "residential", deal: operation });
        const plan = await scraper.buildSearchLinks({ ...query, signal: undefined, sources: [source] });
        expect(plan.searches.length).toBeLessThanOrEqual(1);
        expect(JSON.stringify([...plan.searches, ...plan.errors])).not.toMatch(/types accepts commercial property types only/);
        if (plan.searches.length === 1) {
          expect(plan.errors).toEqual([]);
          expect(plan.searches[0]!.url).toMatch(/^https?:\/\//u);
        } else {
          expect(plan.errors.length).toBeGreaterThan(0);
          for (const entry of plan.errors) expect(GENUINE).toContain(entry.code);
        }
      }
      // Mixed OR fanout: 1 commercial + all housing branches, legacy single keeps commercial.
      const mixed = SearchFilters.parse({ city, operation, priceUnit: operation === "rent" ? "rub_month" : "rub_total", purposes: ["office", "residential"] });
      const fanout = buildScraperQueries(mixed, source, signal);
      expect(fanout).toHaveLength(1 + HOUSING.length);
      expect(fanout[0]).toMatchObject({ category: "commercial", deal: operation });
      expect(buildScraperQuery(mixed, source, signal)).toMatchObject({ category: "commercial" });
    }
  });
  it("negative control: real buildSearchUrls rejects types:[residential] for every source", () => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    for (const source of SOURCES) {
      const invalidQuery: unknown = { city: "Москва", category: "residential", types: ["residential"], deal: "sale", sources: [source] };
      expect(() => Reflect.apply(scraper.buildSearchUrls, scraper, [invalidQuery])).toThrowError(/types accepts commercial property types only/);
    }
  });
  it.each(SOURCES)("keeps commercial-only %s on the commercial category", source => {
    const commercial = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["office"] });
    const queries = buildScraperQueries(commercial, source, signal);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ category: "commercial" });
    expect(queries[0]!.types).not.toContain("residential");
  });
  it("keeps empty purposes on legacy commercial routing", () => {
    const legacy = SearchFilters.parse({ city: "Москва", operation: "sale" });
    for (const source of SOURCES) {
      expect(buildScraperQueries(legacy, source, signal)[0]).toMatchObject({ category: "commercial" });
    }
  });
  it.each(SOURCES)("fans mixed purposes out to commercial plus all housing types for %s", source => {
    const mixed = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["office", "residential"] });
    const queries = buildScraperQueries(mixed, source, signal);
    expect(queries).toHaveLength(1 + HOUSING.length);
    expect(queries[0]).toMatchObject({ category: "commercial" });
    expect(queries.slice(1).map(q => q.category)).toEqual(HOUSING.map(() => "residential"));
    expect(queries.slice(1).map(q => q.type).sort()).toEqual([...HOUSING].sort());
    // Legacy single-query callers keep the commercial branch.
    expect(buildScraperQuery(mixed, source, signal)).toMatchObject({ category: "commercial" });
    expect(buildScraperQuery(base, source, signal)).toMatchObject({ category: "residential", type: "flat" });
  });
  it.each([
    "Продаётся квартира в квартале бизнес-класса",
    "ЖК «Паскаль» жилой комплекс комфорт-класса",
    "Студия 28 м²",
    "Таунхаус с участком",
    "Дом с участком",
    "Коттедж у леса",
    "Квартира-студия",
  ])("confirms residential positive: %s", text => {
    for (const input of [{ title: text }, { description: text }]) {
      const result = evaluateListing(listing(input), base);
      expect(result.verdict).toBe("confirmed");
      expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "purpose", state: "matched" }));
    }
  });
  it.each(["Офис 50 м²", "Склад в аренду", "Производство 200 м²", "Торговое помещение"])("rejects commercial wording with residential filter: %s", text => {
    const result = evaluateListing(listing({ title: text }), base);
    expect(result.verdict).toBe("rejected");
    expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "purpose", state: "contradicted" }));
  });
  it.each([
    "ЖК … коммерческие помещения на первом этаже",
    "Офисы в жилом комплексе",
    "ПСН в ЖК",
  ])("keeps mixed purpose honest (needs_review): %s", text => {
    expect(evaluateListing(listing({ title: text }), base).verdict).toBe("needs_review");
  });
  it.each(["Апартаменты", "Домклик", "ЖКХ", "Помещение 100 м²"])("never confirms unknown: %s", text => {
    const result = evaluateListing(listing({ title: text }), base);
    expect(result.verdict).toBe("needs_review");
    expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "purpose", state: "unknown" }));
  });
  it("matches structured residential category and contradicts structured commercial purpose", () => {
    const structured = evaluateListing(listing({ structuredFeatures: { category: "жилая" } }), base);
    expect(structured.criteria).toContainEqual({ criterion: "purpose", state: "matched", source: "structured", evidence: "category=жилая" });
    const commercial = evaluateListing(listing({ purpose: "office", purposeSource: "structured", title: "Квартира" }), base);
    expect(commercial.verdict).toBe("rejected");
  });
  it("still enforces strict numerics for residential matches", () => {
    const pricey = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["residential"], priceTo: "1000" });
    const result = evaluateListing(listing({ title: "Квартира" }), pricey);
    expect(result.verdict).toBe("rejected");
    expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "purpose", state: "matched" }));
  });
  it("normalizes residential category without inventing data", () => {
    const baseRaw = cian.results[0] as RealEstateScraper.Listing;
    const raw: RealEstateScraper.Listing = { ...baseRaw, propertyType: "retail", category: "residential" };
    const normalized = normalizeListing(raw);
    expect(normalized.purpose).toBe("retail");
    expect(normalized.structuredFeatures).toMatchObject({ category: "residential" });
    const residentialListing = listing({ purpose: normalized.purpose, purposeSource: "structured", structuredFeatures: normalized.structuredFeatures, title: "Квартира" });
    expect(evaluateListing(residentialListing, base).verdict).toBe("confirmed");
    const commercial = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["office"] });
    expect(evaluateListing(residentialListing, commercial).verdict).toBe("rejected");
  });
  it("preserves the commercial negative check when residential is not selected", () => {
    const commercial = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["office"] });
    expect(evaluateListing(listing({ title: "Квартира" }), commercial).verdict).toBe("rejected");
  });
  it("adapter fans mixed selections out to commercial plus housing scraper calls", async () => {
    const calls: RealEstateScraperNs.Query[] = [];
    const empty = (source: (typeof SOURCES)[number], query: RealEstateScraperNs.Query) => {
      calls.push(query);
      return Promise.resolve({ source, query, results: [], pages: [], errors: [], total: 0, timestamp: new Date().toISOString(), partial: false });
    };
    const factory = vi.fn(async () => ({ searchSite: empty, close: vi.fn(async () => {}) }));
    const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory });
    const mixed = { city: "Москва", operation: "sale", purposes: ["office", "residential"], sources: ["cian"] } as const;
    await adapter.search(mixed);
    expect(calls.map(q => q.category)).toEqual(["commercial", ...HOUSING.map(() => "residential")]);
    calls.length = 0;
    await adapter.search({ city: "Москва", operation: "sale", purposes: ["residential"], sources: ["cian"] });
    expect(calls.map(q => q.category)).toEqual(HOUSING.map(() => "residential"));
    expect(calls.map(q => q.type).sort()).toEqual([...HOUSING].sort());
    expect(calls.every(q => !("types" in q && q.types))).toBe(true);
  });
  it("adapter preserves successful housing variants when one branch is unsupported", async () => {
    const ok = (source: (typeof SOURCES)[number], query: RealEstateScraperNs.Query) => {
      if (query.type === "townhouse") throw Object.assign(new Error("youla: type=townhouse needs a native category filter"), { code: "UNSUPPORTED_FILTER" });
      return Promise.resolve({ source, query, results: [], pages: [{ source, page: 1, url: "https://example.invalid/", hasNext: false, nextUrl: null, total: 0, errors: [] }], errors: [], total: 0, timestamp: new Date().toISOString(), partial: false });
    };
    const factory = vi.fn(async () => ({ searchSite: ok, close: vi.fn(async () => {}) }));
    const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory });
    const result = await adapter.searchDetailed({ city: "Москва", operation: "sale", purposes: ["residential"], sources: ["yandex"] });
    expect(result.sources[0]!.status).toBe("partial");
    expect(result.sources[0]!.reason).toMatch(/townhouse/);
    expect(result.sources[0]!.status).not.toBe("unsupported_filter");
  });
});
