import { describe, expect, it, vi } from "vitest";
import { locationState, selectedLocations } from "@/modules/property-search/domain/geography";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { buildScraperQueries } from "@/modules/property-search/infrastructure/source-filters";
import { evaluateListing, analyzeUnresolved } from "@/modules/property-search/domain/evaluation";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
const signal = new AbortController().signal;
const filters = (locations: NonNullable<SearchFilters["locations"]>) => SearchFilters.parse({ operation: "sale", locations });
describe("v323 location evidence", () => {
  it.each(["Бердск", "Обь", "Кольцово", "Краснообск", "Искитим"])("rejects Novosibirsk address for %s", city => {
    expect(locationState({ city: "Новосибирск", address: "Новосибирск, улица Ленина, 1", district: null }, { city })).toBe("contradicted");
    expect(locationState({ city: "Новосибирск", address: `Новосибирская область, ${city}, улица Ленина, 1`, district: null }, { city })).toBe("matched");
  });
  it("rejects a namesake settlement in another region", () => {
    expect(locationState({ city: "Кольцово", address: "Тверская область, Кольцово", district: null }, filters(["koltsovo"]))).toBe("contradicted");
    expect(locationState({ city: "Москва", address: "Советский район", district: null }, filters(["akademgorodok"]))).toBe("contradicted");
  });
  it("does not mistake Ob river or street names for Ob city", () => {
    expect(locationState({ city: "Новосибирск", address: "Новосибирск, улица Обь, 1", district: null }, filters(["ob"]))).toBe("contradicted");
    expect(locationState({ city: null, address: "улица Ленина, 1", district: null }, filters(["berdsk"]))).toBe("unknown");
  });
  it("handles region, district and OR without treating vicinity description as address", () => {
    const listing = { city: "Бердск", address: "Бердск, улица Ленина, 1", district: null };
    expect(locationState(listing, filters(["novosibirsk-region"]))).toBe("matched");
    expect(locationState(listing, filters(["novosibirsk", "berdsk"]))).toBe("matched");
    expect(locationState(listing, filters(["akademgorodok"]))).toBe("contradicted");
    expect(locationState({ city: "Новосибирск", address: "Новосибирск, Советский район", district: null }, filters(["akademgorodok"]))).toBe("matched");
    expect(selectedLocations(filters(["suburbs"]))).toHaveLength(5);
  });
  it("plans separate settlement requests with no Novosibirsk URL fallback", () => {
    const queries = buildScraperQueries({ ...filters(["berdsk", "ob"]), purposes: ["office"] }, "onrealt", signal);
    expect(queries.map(q => q.sourceOptions?.onrealt?.citySlug)).toEqual(["berdsk", "ob"]);
    expect(queries.map(q => q.city)).toEqual(["Бердск", "Обь"]);
  });
  it("uses verified settlement paths and keeps residential area filters local", () => {
    const mir = buildScraperQueries({ ...filters(["krasnoobsk"]), purposes: ["office"] }, "mirkvartir", signal)[0]!;
    expect(decodeURIComponent(mir.sourceOptions!.mirkvartir!.url!)).toContain("Новосибирский+район/Краснообск+рабочий+поселок/");
    const onrealt = buildScraperQueries(filters(["koltsovo"]), "onrealt", signal)[0]!;
    expect(onrealt.sourceOptions?.onrealt?.citySlug).toBe("rabochij-poselok-koltcovo");
    const housing = buildScraperQueries({ ...filters(["berdsk"]), propertyKinds: ["flat"], areaFrom: 50 }, "mirkvartir", signal)[0]!;
    expect(housing.areaMin).toBeUndefined();
  });
  it("narrows housing queries to the selected type", () => {
    const queries = buildScraperQueries({ ...filters(["berdsk"]), propertyKinds: ["flat"] }, "onrealt", signal);
    expect(queries).toHaveLength(1); expect(queries[0]).toMatchObject({ type: "flat", category: "residential", city: "Бердск" });
  });
  it("separates apartments from residential flats and preserves nonresidential use", async () => {
    const listing = normalizeListing({ source: "onrealt", id: "1", url: "https://onrealt.ru/berdsk/1", city: "Бердск", address: "Бердск", title: "Апартаменты 50 м²", propertyType: null, category: null, deal: "sale", area: 50, price: 1000000, priceText: "1000000 руб", description: "", images: [], floor: 1, rooms: null, phone: null, sellerType: null, district: null, timestamp: new Date().toISOString() });
    expect(evaluateListing(listing, { ...filters(["berdsk"]), propertyKinds: ["apartments"] }).verdict).toBe("confirmed");
    expect(evaluateListing(listing, { ...filters(["berdsk"]), propertyKinds: ["flat"] }).verdict).toBe("rejected");
    expect(evaluateListing(listing, { ...filters(["berdsk"]), propertyKinds: ["non_residential"] }).verdict).toBe("confirmed");
    const unknownLocation = { ...listing, city: null, address: null };
    const evaluation = evaluateListing(unknownLocation, { ...filters(["berdsk"]), propertyKinds: ["apartments"] });
    const analyze = vi.fn(async () => []);
    expect((await analyzeUnresolved(unknownLocation, evaluation, { analyze })).verdict).toBe("needs_review");
    expect(analyze).not.toHaveBeenCalled();
  });
});
