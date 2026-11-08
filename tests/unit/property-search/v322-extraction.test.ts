import { describe, expect, it } from "vitest";
import type RealEstateScraper from "real-estate-scrapper";
import { loadDataset } from "../../../scripts/search-quality/dataset";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, type NormalizedListing, type Source } from "@/modules/property-search/domain/types";
import { deduplicateListings, normalizeAddressKey } from "@/modules/property-search/infrastructure/normalization";
import { RealEstateScraperAdapter, type ScraperFactory } from "@/modules/property-search/infrastructure/scraper-adapter";

function card(overrides: Partial<NormalizedListing>): NormalizedListing {
  return {
    source: "onrealt", sourceListingId: "86529024", sourceUnitId: null,
    url: "https://onrealt.ru/novosibirsk/kypit-ofis/86529024",
    purpose: "office", purposeSource: "rule", operation: "sale",
    price: "51000000.00", priceUnit: "rub_total", area: 112.67,
    floor: { kind: "above_ground", number: 8, raw: "8" },
    city: "Новосибирск", address: "Красный проспект, 101/1", district: "Заельцовский",
    title: "Офис", seller: { type: "unknown" }, description: "",
    images: [], fetchedAt: "2026-11-05T22:14:06.520Z",
    structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: false,
    publishedAt: null, sourceUpdatedAt: null, dateSource: "unknown", datePrecision: "unknown",
    firstSeenAt: "2026-11-05T22:14:06.520Z", lastCheckedAt: null,
    ...overrides,
  };
}

describe("v3.2.2 catalogue pages are rejected, not review", () => {
  it("rejects L45–L47 controls on every corpus query", () => {
    const data = loadDataset();
    for (const id of ["L45", "L46", "L47"]) {
      const item = data.listings.find(x => x.id === id)!;
      for (const q of data.queries) {
        const result = evaluateListing(item.listing as NormalizedListing, q.filters);
        expect(result.verdict, `${id}/${q.id}`).toBe("rejected");
        expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "listing", state: "contradicted" }));
      }
    }
  });
  it("keeps incomplete real cards in review instead of rejecting them", () => {
    const filters = SearchFilters.parse({ city: "Новосибирск", operation: "sale", purposes: ["office"], areaFrom: 10, priceFrom: "1000" });
    for (const listing of [card({ price: null, priceUnit: null, area: null }), card({ title: null, price: null, area: null })]) {
      const result = evaluateListing(listing, filters);
      expect(result.verdict).toBe("needs_review");
      expect(result.criteria.some(c => c.criterion === "listing")).toBe(false);
    }
  });
});

describe("v3.2.2 address normalization flags suspected duplicates", () => {
  it("matches city prefixes and street abbreviations", () => {
    expect(normalizeAddressKey("Новосибирск, ул. Мира, 58", "Новосибирск")).toBe(normalizeAddressKey("улица Мира, 58", "Новосибирск"));
    expect(normalizeAddressKey("Новосибирск, ул. Петухова, 44/1", "Новосибирск")).toBe(normalizeAddressKey("улица Петухова, 44/1", "Новосибирск"));
  });
  it("flags D01/D02 exact and D03 street-only pairs without merging", () => {
    const pairs: Array<[string, string, number]> = [
      ["Новосибирск, ул. Мира, 58", "улица Мира, 58", 422.9],
      ["Новосибирск, ул. Петухова, 44/1", "улица Петухова, 44/1", 298],
      ["Новосибирск, ул. Ленина", "улица Ленина, 21/1к4", 41.6],
    ];
    for (const [a, b, area] of pairs) {
      const first = card({ source: "mirkvartir", sourceListingId: "a", url: "https://cre.mirkvartir.ru/a", address: a, area });
      const second = card({ source: "onrealt", sourceListingId: "b", url: "https://onrealt.ru/b", address: b, area });
      const [ra, rb] = deduplicateListings([first, second]);
      expect(ra, a).toBeDefined(); expect(rb, b).toBeDefined();
      expect(ra!.possibleDuplicateKeys).toHaveLength(1);
      expect(rb!.possibleDuplicateKeys).toHaveLength(1);
    }
    expect(deduplicateListings([
      card({ source: "mirkvartir", sourceListingId: "a", url: "https://cre.mirkvartir.ru/a", address: "Новосибирск, Сухарная ул., 35", area: 1000 }),
      card({ source: "onrealt", sourceListingId: "b", url: "https://onrealt.ru/b", address: "Большая улица, 310/4", area: 1000 }),
    ]).flatMap(l => l.possibleDuplicateKeys)).toHaveLength(0);
  });
  it("does not flag distinct known house numbers on the same street", () => {
    for (const address of ["улица Мира, 59", "улица Мира, 58/1", "улица Мира, 58 корпус 2"]) {
      const rows = deduplicateListings([
        card({ source: "mirkvartir", address: "улица Мира, 58", area: 100 }),
        card({ source: "onrealt", address, area: 100 }),
      ]);
      expect(rows.flatMap(l => l.possibleDuplicateKeys), address).toEqual([]);
    }
  });
  it("never flags the same source", () => {
    const listings = [card({ address: "улица Мира, 58", area: 100 }), card({ sourceListingId: "other", url: "https://onrealt.ru/other", address: "ул. Мира, 58", area: 100 })];
    expect(deduplicateListings(listings).flatMap(l => l.possibleDuplicateKeys)).toHaveLength(0);
  });
});

describe("v3.2.2 mixed source outcomes and cancellation", () => {
  function adapter(searchSite: (source: Source) => Promise<RealEstateScraper.SearchResult>) {
    const close = async () => {};
    const factory = (async () => ({ searchSite, close })) as unknown as ScraperFactory;
    return new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory });
  }
  const ok = (source: Source): RealEstateScraper.SearchResult & { source: Source } => ({
    query: {}, timestamp: new Date().toISOString(), total: 0, results: [], errors: [], partial: false, source,
    pages: [{ source, page: 1, total: 0, hasNext: false, nextUrl: null, errors: [] }],
  });
  it("keeps the working source when another needs a human action", async () => {
    const instance = adapter(async source => {
      if (source === "yandex") throw Object.assign(new Error("yandex:NEEDS_USER_ACTION"), { code: "NEEDS_USER_ACTION" });
      return ok(source);
    });
    const detailed = await instance.searchDetailed({ city: "Новосибирск", operation: "sale", sources: ["onrealt", "yandex"] });
    expect(Object.fromEntries(detailed.sources.map(s => [s.source, s.status]))).toEqual({ onrealt: "success", yandex: "needs_user_action" });
    const bridged = await instance.search({ city: "Новосибирск", operation: "sale", sources: ["onrealt", "yandex"] });
    expect(bridged.sources.find(s => s.source === "yandex")?.status).toBe("blocked");
  });
  it("reports cancellation instead of inventing results", async () => {
    const instance = adapter(async () => new Promise(() => {}));
    const controller = new AbortController();
    controller.abort();
    const result = await instance.searchDetailed({ city: "Новосибирск", operation: "sale", sources: ["onrealt"] }, { signal: controller.signal });
    expect(result.sources[0]?.status).toBe("cancelled");
    expect(result.listings).toHaveLength(0);
  });
});
