import { expect, it } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { PURPOSES, SOURCES, SearchFilters } from "@/modules/property-search/domain/types";
import { buildScraperQuery, classifyScraperErrors, scraperErrorReason } from "@/modules/property-search/infrastructure/source-filters";

const scraper = new RealEstateScraper({ transport: async () => { throw new Error("NETWORK_FORBIDDEN"); } });
const signal = new AbortController().signal;
for (const city of ["Новосибирск", "Москва"]) for (const source of SOURCES) for (const operation of ["sale", "rent"] as const) {
  it.each(PURPOSES)(`${city}/${source}/${operation}/%s`, async purpose => {
    const query = buildScraperQuery(SearchFilters.parse({ city, operation, priceUnit: operation === "rent" ? "rub_month" : "rub_total", purposes: [purpose] }), source, signal);
    const plan = await scraper.buildSearchLinks(query);
    if (source === "mirkvartir" && purpose === "production") {
      expect(plan.searches).toHaveLength(0);
      expect(plan.errors[0]).toMatchObject({ code: "NOT_APPLICABLE", types: ["industrial"] });
      expect(classifyScraperErrors(plan.errors)).toBe("unsupported_filter");
      expect(scraperErrorReason(plan.errors[0]!)).toContain("industrial");
      return;
    }
    expect(plan.errors).toEqual([]);
    expect(plan.searches).toHaveLength(1);
    expect(query).toMatchObject({ city, category: "commercial", deal: operation });
    const url = new URL(plan.searches[0]!.url), nsk = city === "Новосибирск";
    const geo = source === "cian" ? ["region", nsk ? "4897" : "1"] : source === "avito" ? ["locationId", nsk ? "641780" : "637640"]
      : source === "domclick" ? ["address", nsk ? "8dea00e3-9aab-4d8e-887c-ef2aaa546456" : "1d1463ae-c80f-4d19-9331-a1b68a85b553"]
        : source === "mirkvartir" ? ["locationIds", nsk ? "MK_Town|106136" : "MK_Region|77"] : null;
    if (geo) expect(url.searchParams.get(geo[0]!)).toBe(geo[1]);
    else expect(url.pathname).toContain(nsk ? "/novosibirsk/" : "/moskva/");
    const nativeType = { office: ["1", "472642", "office", "101", "OFFICE", "165972"], retail: ["2", "472644", "retail", "103", "RETAIL", "165971"], psn_universal: ["5", "472643", "free_purpose", "104", "FREE_PURPOSE", "165970"], free_purpose: ["5", "472643", "free_purpose", "104", "FREE_PURPOSE", "165970"], production: ["7", "472646", "manufacturing", "", "MANUFACTURING", "165973"], warehouse: ["3", "472645", "warehouse", "102", "WAREHOUSE", "165974"] }[purpose];
    const typeKeys = { cian: "office_type[0]", avito: "params[110799][0]", domclick: "offer_type", mirkvartir: "types", yandex: "commercialType", youla: "attributes[kommer_realty_tip_stroeniya][0]" };
    if (source !== "onrealt") expect(url.searchParams.get(typeKeys[source])).toBe(nativeType[["cian", "avito", "domclick", "mirkvartir", "yandex", "youla"].indexOf(source)]);
    if (source === "cian" || source === "domclick") expect(url.searchParams.get("deal_type")).toBe(operation);
    if (source === "avito") expect(url.searchParams.get("params[536]")).toBe(operation === "sale" ? "5545" : "5546");
    if (source === "mirkvartir") expect(url.hostname).toBe(`${operation === "sale" ? "cre" : "arendacre"}.mirkvartir.ru`);
    if (source === "yandex") expect(url.pathname).toContain(operation === "sale" ? "/kupit/" : "/snyat/");
    if (source === "onrealt") expect(url.pathname).toContain(operation === "sale" ? "/kypit-" : "/arenda-");
    if (source === "youla") expect(url.searchParams.get("attributes[tip_sdelki][0]")).toBe(operation === "sale" ? "10807" : "10806");
  });
}
it.each(SOURCES)("%s supports any use and OR uses without network", async source => {
  for (const purposes of [[], [...PURPOSES]]) {
    const plan = await scraper.buildSearchLinks(buildScraperQuery(SearchFilters.parse({ operation: "sale", purposes }), source, signal));
    expect(plan.searches.length).toBeGreaterThan(0);
    expect(plan.errors).toHaveLength(source === "mirkvartir" && purposes.length ? 1 : 0);
    if (source === "onrealt") expect(plan.searches).toHaveLength(5);
  }
});
it("preserves trusted overrides and leaves uncertain criteria local", () => {
  const query = buildScraperQuery(SearchFilters.parse({ operation: "sale", areaFrom: 10, priceFrom: "100", districts: ["Центральный"], floorMode: "first_floor_only", seller: "confirmed_owner_only" }), "avito", signal, { avito: { locationId: 123 } });
  expect(query.sourceOptions?.avito).toMatchObject({ locationId: 123, citySlug: "novosibirsk" });
  expect(query.areaMin).toBe(10);
  for (const key of ["priceMin", "districts", "floorMode", "owner"]) expect(query).not.toHaveProperty(key);
});
it("sanitizes reasons and correctly classifies parser failure", () => {
  expect(scraperErrorReason({ code: "UNSUPPORTED_FILTER", error: "city requires secret@example.test locationId" })).toBe("UNSUPPORTED_FILTER; фильтр: city");
  expect(scraperErrorReason({ code: "bad secret", error: "seller phone" })).toBe("SCRAPER_ERROR");
  expect(classifyScraperErrors([{ code: "PARSE_FAILED" }])).toBe("error");
});
