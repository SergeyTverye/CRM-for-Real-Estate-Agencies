import { afterEach, describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { attachResidentialParsers } from "@/modules/property-search/infrastructure/residential-parsers";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters } from "@/modules/property-search/domain/types";

// Synthetic offers in the exact SSR envelope consumed by the real package parser.
// No recorded pages, personal data, network, browser, or provider calls.
const url = "https://www.cian.ru/cat.php?offer_type=flat&p=1";
const query: RealEstateScraper.Query = { category: "residential", type: "flat", deal: "sale", page: 1 };
const offer = (overrides: Record<string, unknown> = {}) => ({
  cianId: 101, fullUrl: "https://www.cian.ru/sale/flat/101/", category: "flatSale",
  dealType: "sale", totalArea: "52.5", roomsCount: 2, floorNumber: 4,
  bargainTerms: { priceRur: 9_500_000 }, formattedFullPrice: "9 500 000 ₽",
  geo: { address: [{ type: "location", name: "Москва", isFormingAddress: true }] },
  description: "Синтетический объект", photos: [], ...overrides,
});
function ssr(offers: Record<string, unknown>[], totalOffers = offers.length) {
  return `<html><body><script>window['legacy-commercial-serp-frontend'] = [].concat(${JSON.stringify([
    { key: "initialState", value: { results: { offers, totalOffers, paginationUrls: [] } } },
  ])});</script></body></html>`;
}
function client() {
  const transport = vi.fn<RealEstateScraper.Transport>(async () => { throw new Error("UNEXPECTED_NETWORK"); });
  const scraper = new RealEstateScraper({ maxRetries: 0, delay: 0, transport });
  attachResidentialParsers(scraper);
  return { scraper, transport };
}
afterEach(() => vi.useRealTimers());

describe("truthful residential parser attachment (synthetic real-package fixtures)", () => {
  it("corrects the real Cian SSR commercial hardcode using offer facts", () => {
    const payload = ssr([offer()]);
    const original = new RealEstateScraper({ maxRetries: 0 }).parsers.cian.parsePage(payload, url, query);
    expect(original.results[0]).toMatchObject({ category: "commercial", rooms: null });
    const { scraper, transport } = client();
    const page = scraper.parsers.cian.parsePage(payload, url, query);
    expect(page.results[0]).toMatchObject({ category: "residential", residentialType: "flat", propertyType: null,
      rooms: 2, area: 52.5, floor: 4, price: 9_500_000, deal: "sale", title: "Квартира" });
    expect(page).toMatchObject({ sourceTotal: 1, hasNext: false, nextUrl: null });
    expect(normalizeListing(page.results[0]!).structuredFeatures).toEqual({ category: "residential" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["flat", "studio", "room", "house", "cottage", "townhouse"] as const)("maps native %s without consulting requested type", kind => {
    const { scraper } = client();
    const item = scraper.parsers.cian.parsePage(ssr([offer({ category: `${kind}Rent`, dealType: undefined,
      fullUrl: `https://www.cian.ru/rent/${kind}/101/`, roomsCount: kind === "studio" ? 0 : 3 })]), url, query).results[0]!;
    expect(item).toMatchObject({ category: "residential", residentialType: kind, deal: "rent" });
  });

  it("uses the listing URL, never the search URL or requested category, as fallback evidence", () => {
    const { scraper } = client();
    const results = scraper.parsers.cian.parsePage(ssr([
      offer({ category: undefined, dealType: undefined }),
      offer({ cianId: 102, category: "unrecognized", dealType: undefined, fullUrl: "https://www.cian.ru/offer/102/?type=flat&deal=sale" }),
    ]), "https://www.cian.ru/sale/flat/999/", { ...query, query: "квартира студия" }).results;
    expect(results[0]).toMatchObject({ category: "residential", residentialType: "flat", deal: "sale" });
    expect(results[1]).toMatchObject({ category: null, propertyType: null, deal: null });
    expect(results[1]).not.toHaveProperty("residentialType");
  });

  it("keeps explicit office evidence commercial even under a misleading flat URL/query", () => {
    const { scraper } = client();
    const results = scraper.parsers.cian.parsePage(ssr([
      offer({ category: "commercialSale", officeType: "office", fullUrl: "https://www.cian.ru/sale/commercial/101/" }),
      offer({ cianId: 102, officeType: "office" }),
    ]), url, query).results;
    for (const item of results) {
      expect(item).toMatchObject({ category: "commercial", propertyType: "office" });
      expect(item).not.toHaveProperty("residentialType");
    }
  });

  it("preserves the commercial path including grouped units and pagination exactly", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
    const plain = new RealEstateScraper({ maxRetries: 0 });
    const { scraper } = client();
    const commercialQuery: RealEstateScraper.Query = { category: "commercial", type: "office", page: 1 };
    const payload = ssr([offer({ category: "commercialSale", officeType: "office",
      areaParts: [{ area: 40, floorFrom: 1, floorTo: 1, price: 100 }, { area: 70, floorFrom: 2, floorTo: 3, price: 200 }] })], 5);
    expect(scraper.parsers.cian.parsePage(payload, url, commercialQuery)).toEqual(plain.parsers.cian.parsePage(payload, url, commercialQuery));
    // Commercial listings returned by a residential query are not rewritten either.
    expect(scraper.parsers.cian.parsePage(payload, url, query)).toEqual(plain.parsers.cian.parsePage(payload, url, query));
  });

  it("retains actual numeric evidence and CRM rejects out-of-bound apartment values", () => {
    const { scraper } = client();
    const raw = scraper.parsers.cian.parsePage(ssr([offer()]), url, query).results[0]!;
    const normalized = normalizeListing(raw);
    const filters = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["residential"], priceTo: "9000000", areaTo: 50, floorMode: "first_floor_only" });
    const result = evaluateListing(normalized, filters);
    expect(normalized).toMatchObject({ price: "9500000.00", area: 52.5, floor: { number: 4 }, priceUnit: "rub_total" });
    expect(result.verdict).toBe("rejected");
    expect(result.criteria).toContainEqual(expect.objectContaining({ criterion: "purpose", state: "matched" }));
    expect(raw.rooms).toBe(2);
  });

  it("preserves explicit rental units and does not assume monthly rent", () => {
    const { scraper } = client();
    const parse = (fields: Record<string, unknown>) => scraper.parsers.cian.parsePage(ssr([offer({ category: "flatRent", dealType: "rent", ...fields })]), url, query).results[0]!;
    const yearly = parse({ formattedFullPrice: "120 000 ₽/м²/год", bargainTerms: { priceRur: 120000 } });
    expect(normalizeListing(yearly).priceUnit).toBe("rub_m2_year");
    const unknown = parse({ formattedFullPrice: undefined, bargainTerms: { priceRur: 120000 } });
    expect(normalizeListing(unknown).priceUnit).toBeNull();
    const absent = parse({ totalArea: "", floorNumber: null, roomsCount: "", bargainTerms: {}, formattedFullPrice: undefined });
    expect(absent).toMatchObject({ area: null, floor: null, rooms: null, price: null });
  });

  it.each(["youla", "avito", "domclick"] as const)("rejects unverified %s residential planning/page retrieval before transport", async source => {
    const { scraper, transport } = client();
    const nativeQuery = { ...query, sourceOptions: { [source]: { url: `https://${source === "avito" ? "www.avito.ru" : `${source}.ru`}/residential/` } } };
    expect(() => scraper.parsers[source].buildSearchUrl(nativeQuery)).toThrowError(/residential parser contract/);
    await expect(scraper.parsers[source].searchPage(nativeQuery)).rejects.toMatchObject({ code: "UNSUPPORTED_FILTER" });
    const result = await scraper.searchSite(source, nativeQuery);
    expect(result.results).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({ code: "UNSUPPORTED_FILTER" });
    expect(result.pages.every(page => page.errors.length > 0)).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["youla", "avito", "domclick"] as const)("passes commercial %s planning and all page arguments through", async source => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    const parser = scraper.parsers[source];
    const build = vi.spyOn(parser, "buildSearchUrl").mockReturnValue("https://example.invalid/commercial");
    const failure = Object.assign(new Error("blocked"), { code: "ACCESS_BLOCKED", status: 403 });
    const search = vi.spyOn(parser, "searchPage").mockRejectedValue(failure);
    attachResidentialParsers(scraper);
    const commercialQuery: RealEstateScraper.Query = { category: "commercial", type: "office" };
    expect(parser.buildSearchUrl(commercialQuery)).toBe("https://example.invalid/commercial");
    expect(build).toHaveBeenCalledWith(commercialQuery);
    await expect(Reflect.apply(parser.searchPage, parser, [commercialQuery, "https://example.invalid/page2"])).rejects.toBe(failure);
    expect(search).toHaveBeenCalledWith(commercialQuery, "https://example.invalid/page2");
  });

  it("preserves captcha, malformed SSR, nonempty missing offers, and explicit empty states", () => {
    const scraper = extendSourceParsers(new RealEstateScraper({ maxRetries: 0 }));
    expect(() => scraper.parsers.cian.parsePage("<h1>Подтвердите, что вы человек</h1>", url, query)).toThrowError("NEEDS_USER_ACTION");
    for (const payload of [ssr([], 5), ssr([{ cianId: 101 }]), "<script>broken state</script>"]) {
      expect(() => scraper.parsers.cian.parsePage(payload, url, query)).toThrow();
    }
    expect(scraper.parsers.cian.parsePage(ssr([], 0), url, query)).toMatchObject({ results: [], sourceTotal: 0, hasNext: false });
  });

  it.each(["RATE_LIMITED", "TIMEOUT", "ACCESS_BLOCKED", "PARSE_FAILED"])("never converts upstream %s into empty success", code => {
    const scraper = new RealEstateScraper({ maxRetries: 0 });
    const failure = Object.assign(new Error(code), { code });
    vi.spyOn(scraper.parsers.cian, "parsePage").mockImplementation(() => { throw failure; });
    attachResidentialParsers(scraper);
    expect(() => scraper.parsers.cian.parsePage(ssr([offer()]), url, query)).toThrow(failure);
  });

  describe("bounded mirkvartir residential route (pure URL/planning, no transport)", () => {
    const housing = (over: Record<string, unknown> = {}) => ({ city: "Новосибирск", category: "residential" as const, deal: "sale" as const, page: 1, ...over });
    it("keeps commercial planning byte-identical (locationIds contract)", () => {
      const plain = new RealEstateScraper({ maxRetries: 0 });
      const { scraper } = client();
      const commercial = { city: "Новосибирск", category: "commercial" as const, type: "office" as const, deal: "sale" as const, sourceOptions: { mirkvartir: { locationIds: "MK_Town|106136" } } };
      expect(scraper.parsers.mirkvartir.buildSearchUrl(commercial)).toBe(plain.parsers.mirkvartir.buildSearchUrl(commercial));
    });
    it("retains region+city for sale/rent/type/page, native URL wins", () => {
      const { scraper } = client();
      const sale = new URL(scraper.parsers.mirkvartir.buildSearchUrl(housing({ type: "flat", sourceOptions: { mirkvartir: { locationIds: "MK_Town|106136" } } })));
      expect(sale.hostname).toBe("www.mirkvartir.ru");
      expect(decodeURIComponent(sale.pathname)).toBe("/Новосибирская+область/Новосибирск/");
      const rent = new URL(scraper.parsers.mirkvartir.buildSearchUrl(housing({ type: "flat", deal: "rent" })));
      expect(rent.hostname).toBe("arenda.mirkvartir.ru");
      expect(decodeURIComponent(rent.pathname)).toBe("/Новосибирская+область/Новосибирск/");
      const room = new URL(scraper.parsers.mirkvartir.buildSearchUrl(housing({ type: "room" })));
      expect(decodeURIComponent(room.pathname)).toBe("/Новосибирская+область/Новосибирск/Комнаты/");
      expect(new URL(scraper.parsers.mirkvartir.buildSearchUrl(housing({ type: "flat", page: 2 }))).searchParams.get("p")).toBe("2");
      const native = "https://www.mirkvartir.ru/Новосибирская%2Bобласть/Новосибирск/";
      expect(decodeURIComponent(new URL(scraper.parsers.mirkvartir.buildSearchUrl(housing({ type: "flat", sourceOptions: { mirkvartir: { url: native } } }))).pathname)).toBe("/Новосибирская+область/Новосибирск/");
    });
    it("leaves Moscow alone and keeps unknown geo explicit", () => {
      const plain = new RealEstateScraper({ maxRetries: 0 });
      const { scraper } = client();
      const moscow = { city: "Москва", category: "residential" as const, type: "flat" as const, deal: "sale" as const };
      expect(scraper.parsers.mirkvartir.buildSearchUrl(moscow)).toBe(plain.parsers.mirkvartir.buildSearchUrl(moscow));
      expect(() => scraper.parsers.mirkvartir.buildSearchUrl(housing({ city: "Novosibirsk", type: "flat" }))).toThrow();
    });
  });
});
