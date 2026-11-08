import { describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { buildScraperQueries, classifyScraperErrors, scraperErrorReason } from "@/modules/property-search/infrastructure/source-filters";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { locationState } from "@/modules/property-search/domain/geography";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { DateEnrichment } from "@/modules/property-search/infrastructure/date-enrichment";
import { sourceReason } from "@/app/(crm)/property-search/source-reason";
const signal = new AbortController().signal;
const filters = (location: "akademgorodok" | "novosibirsk-region" | "koltsovo" | "krasnoobsk" | "novosibirsk", kind: "flat" | "house" = "flat") => SearchFilters.parse({ operation: "rent", priceUnit: "rub_month", locations: [location], propertyKinds: [kind] });
const scraper = () => extendSourceParsers(new RealEstateScraper({ maxRetries: 0, transport: async () => { throw Error("REPLAY_NETWORK_FORBIDDEN"); } }), { maxCards: 0 });

describe("geo2 REPLAY — source geography contracts", () => {
  it.each(["novosibirsk", "koltsovo", "krasnoobsk"] as const)("builds Mir residential rent URLs for %s without unsupported", async location => {
    const client = scraper();
    for (const kind of ["flat", "house"] as const) for (const query of buildScraperQueries(filters(location, kind), "mirkvartir", signal)) {
      const url = new URL(client.parsers.mirkvartir.buildSearchUrl(query));
      expect(url.hostname).toBe(kind === "flat" ? "arenda.mirkvartir.ru" : "arendadoma.mirkvartir.ru");
      expect(decodeURIComponent(url.pathname)).toContain("Новосибирская+область/");
      if (location === "koltsovo") expect(decodeURIComponent(url.pathname)).toContain("Кольцово+рабочий+поселок");
      if (location === "krasnoobsk") expect(decodeURIComponent(url.pathname)).toContain("Новосибирский+район/Краснообск+рабочий+поселок");
    }
    await client.close();
  });
  it("uses the observed OnRealt group 3 / district 112 and no broken autocomplete", async () => {
    const client = scraper();
    for (const query of buildScraperQueries(filters("akademgorodok"), "onrealt", signal)) {
      expect(query.districts).toBeUndefined();
      const url = new URL(client.parsers.onrealt.buildSearchUrl(query));
      expect(JSON.parse(url.searchParams.get("location")!)).toEqual({ "3": ["112"] });
    }
    const q = buildScraperQueries({ ...filters("akademgorodok"), propertyKinds: undefined, purposes: ["office"] }, "onrealt", signal)[0]!;
    expect(JSON.parse(new URL(client.parsers.onrealt.buildSearchUrl({ ...q, type: "office", types: undefined })).searchParams.get("location")!)).toEqual({ "3": ["112"] });
    await client.close();
  });
  it("uses the Mir Soviet SEO scope for housing and commercial with no district lookup", async () => {
    const client = scraper();
    for (const f of [filters("akademgorodok"), { ...filters("akademgorodok"), propertyKinds: undefined, purposes: ["office" as const] }]) {
      const q = buildScraperQueries(f, "mirkvartir", signal)[0]!;
      expect(q.districts).toBeUndefined();
      expect(decodeURIComponent(new URL(client.parsers.mirkvartir.buildSearchUrl(q)).pathname)).toContain("/Новосибирск/Советский/");
    }
    await client.close();
  });
  it("keeps full OnRealt province/city/district evidence (not province as city)", async () => {
    const client = scraper();
    const html = `<div class="ad-item-container"><a url-item href="/novosibirsk/arenda-ofisa/123">Офис 50 м²</a><h3 title-item>Офис 50 м²</h3><span address-city>Новосибирская область, Новосибирск, Советский район</span><span address-string>, Морской проспект, 1</span><span class="price-data">50000 руб/мес.</span></div>`;
    const page = client.parsers.onrealt.parsePage(html, "https://onrealt.ru/novosibirskaya-oblast/arenda-ofisa", {});
    expect(page.results).toHaveLength(1);
    const item = page.results[0]!;
    expect(item).toMatchObject({ city: "Новосибирск", district: "Советский" });
    expect(locationState(item, filters("akademgorodok"))).toBe("matched");
    expect(locationState(item, filters("novosibirsk-region"))).toBe("matched");
    const officeFilters = { ...filters("akademgorodok"), propertyKinds: undefined, purposes: ["office" as const] };
    const out = normalizeListing({ ...item, source: "onrealt", images: item.images ?? [], priceText: "50000 руб/мес.", timestamp: new Date().toISOString() });
    expect(evaluateListing({ ...out, district: "Центральный", address: "Новосибирск, Центральный район" }, officeFilters).verdict).toBe("rejected");
    expect(evaluateListing({ ...out, district: null, address: "Новосибирск, улица Ленина, 1" }, officeFilters).verdict).toBe("needs_review");
    await client.close();
  });
  it("queries actual Youla house/flat routes after integration, regional scope uses finite towns", async () => {
    const client = scraper();
    for (const kind of ["house", "flat"] as const) {
      const q = buildScraperQueries(filters("novosibirsk", kind), "youla", signal);
      expect(q).toHaveLength(1);
      expect(client.parsers.youla.buildSearchUrl(q[0])).toContain(kind === "flat" ? "arenda-kvartiri" : "arenda-doma");
    }
    const region = buildScraperQueries(filters("novosibirsk-region", "house"), "youla", signal);
    expect(buildScraperQueries(filters("akademgorodok"), "youla", signal)[0]?.query).toBe("Академгородок");
    expect(region).toHaveLength(6);
    expect(region.map(q => q.city)).toEqual(["Новосибирск", "Бердск", "Обь", "Кольцово", "Краснообск", "Искитим"]);
    expect(region.every(q => !client.parsers.youla.buildSearchUrl(q).includes("novosibirskaya-oblast"))).toBe(true);
    await client.close();
  });
  it("shows a supported diagnostic instead of generic location errors", () => {
    expect(classifyScraperErrors([{ code: "UNSUPPORTED_LOCATION" }])).toBe("unsupported_filter");
    const reason = scraperErrorReason({ code: "LOCATION_NOT_FOUND" });
    expect(sourceReason(reason, "unsupported_filter")).toContain("Локация не поддерживается площадкой");
    expect(reason).toContain("Новосибирский район");
  });
  it("optional hung date enrichment releases the SERP within 3 seconds", async () => {
    vi.useFakeTimers();
    try {
      const reader = new DateEnrichment({ deadline: Date.now() + 20000, cache: new Map() });
      const result = reader.read("mirkvartir", { id: "geo2", url: "https://arendacre.mirkvartir.ru/123/" }, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBeNull();
      expect(reader.progress).toMatchObject({ failed: 1, requested: 1 });
    } finally { vi.useRealTimers(); }
  });
});
