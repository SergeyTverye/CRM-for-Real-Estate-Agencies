import { describe, expect, it } from "vitest";
import cian from "../../fixtures/scraper/cian.json";
import type RealEstateScraper from "real-estate-scrapper";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { parseFloor } from "@/modules/property-search/domain/floor";
import { analyzeUnresolved, evaluateFeature, evaluateListing } from "@/modules/property-search/domain/evaluation";
import { resolveDistrict } from "@/modules/property-search/domain/geography";
import { normalizeListing, deduplicateListings } from "@/modules/property-search/infrastructure/normalization";
import { decideFallback, type FallbackPolicy } from "@/modules/property-search/domain/fallback";

const listing = () => normalizeListing(cian.results[0] as RealEstateScraper.Listing);
describe("filters and evidence", () => {
  it("validates city, rental unit and inclusive intervals", () => {
    expect(SearchFilters.parse({ operation: "sale" }).city).toBe("Новосибирск");
    expect(SearchFilters.safeParse({ operation: "rent" }).success).toBe(false);
    expect(SearchFilters.safeParse({ operation: "sale", priceFrom: "2", priceTo: "1" }).success).toBe(false);
    expect(SearchFilters.safeParse({ operation: "sale", areaFrom: 2, areaTo: 1 }).success).toBe(false);
    const filters = SearchFilters.parse({ city: "Москва", operation: "sale", priceFrom: "15000000", priceTo: "15000000", areaFrom: 100, areaTo: 100, purposes: ["office", "retail"], districts: ["Арбат", "Тверской"] });
    expect(evaluateListing(listing(), filters).verdict).toBe("confirmed");
    expect(evaluateListing(listing(), { ...filters, areaFrom: 101 }).verdict).toBe("rejected");
  });
  it.each([["-1/6", "basement", -1], ["-1 / 6", "basement", -1], ["1/6", "above_ground", 1], ["цоколь", "semi_basement", null], ["полуподвал", "semi_basement", null], ["подвал", "basement", null], ["1–2", "unknown", null], ["антресоль", "unknown", null], ["11", "above_ground", 11]])("parses %s", (raw, kind, number) => {
    expect(parseFloor(raw)).toMatchObject({ kind, number });
  });
  it("checks floor modes and does not turn unknown into matched", () => {
    const f = SearchFilters.parse({ city: "Москва", operation: "sale", floorMode: "first_floor_only" });
    expect(evaluateListing({ ...listing(), floor: parseFloor("-1/6") }, f).verdict).toBe("rejected");
    expect(evaluateListing({ ...listing(), floor: parseFloor("1–2") }, f).verdict).toBe("needs_review");
    expect(evaluateListing({ ...listing(), floor: parseFloor(2) }, { ...f, floorMode: "exclude_basement_and_semi_basement" }).verdict).toBe("confirmed");
  });
  it("requires recorded owner check even for source owner badge", () => {
    const f = SearchFilters.parse({ city: "Москва", operation: "sale", seller: "confirmed_owner_only" });
    expect(evaluateListing(listing(), f).verdict).toBe("needs_review");
    const l = listing(); l.seller.ownerVerification = { method: "Звонок", source: "employee", verifiedBy: "employee-test", checkedAt: "2026-11-05T10:00:00Z" };
    expect(evaluateListing(l, f).verdict).toBe("confirmed");
    l.seller.type = "agent";
    expect(evaluateListing(l, f).verdict).toBe("rejected");
  });
  it.each(["Отдельный вход", "Витрина", "Первая линия", "Мощность 40 кВт", "Потолки 3 м", "Мокрая точка", "Ворота"])("recognizes %s", feature => {
    expect(evaluateFeature(feature, listing()).state).toBe("matched");
  });
  it.each([["Можно оборудовать отдельный вход", "unknown"], ["Планируется отдельный вход", "unknown"], ["Отдельный вход отсутствует", "contradicted"], ["Нет отдельного входа", "contradicted"], ["Без витрины", "contradicted"], ["Витрина не предусмотрена", "contradicted"]])("does not confirm %s", (description, state) => {
    const criterion = description.includes("итрин") ? "витрина" : "отдельный вход";
    expect(evaluateFeature(criterion, { ...listing(), description }).state).toBe(state);
  });
  it("structured precedes rules, mandatory AND, preference only scores", () => {
    const l = listing(); l.structuredFeatures.separate_entrance = false;
    expect(evaluateFeature("отдельный вход", l).source).toBe("structured");
    expect(evaluateFeature("Мощность 60 кВт", l).state).toBe("contradicted");
    const f = SearchFilters.parse({ city: "Москва", operation: "sale", requiredFeatures: ["витрина", "отдельный вход"] });
    expect(evaluateListing(l, f).verdict).toBe("rejected");
    expect(evaluateListing(l, { ...f, requiredFeatures: [], preferredFeatures: ["отдельный вход", "витрина"] })).toMatchObject({ verdict: "confirmed", score: 50 });
  });
  it("preserves decimal heights in evidence", () => {
    expect(evaluateFeature("потолки 3.5 м", { ...listing(), description: "Потолки 3.7 м." }).state).toBe("matched");
    expect(evaluateFeature("потолки 3,5 м", { ...listing(), description: "Потолки 3,2 м." }).state).toBe("contradicted");
  });
  it("uses geography, not street name or a description mention", () => {
    expect(resolveDistrict("Новосибирск", "Центральный", null)).toBe("Центральный");
    expect(resolveDistrict("Москва", null, "Москва, район Арбат, улица Примерная, 10")).toBe("Арбат");
    expect(resolveDistrict("Москва", null, "Москва, улица Арбат")).toBeNull();
    expect(resolveDistrict("Москва", null, "Москва, Тверской район")).toBe("Тверской");
    const f = SearchFilters.parse({ city: "Москва", operation: "sale", districts: ["Арбат"] });
    expect(evaluateListing({ ...listing(), district: null, address: "Москва", description: "Рядом район Арбат" }, f).verdict).toBe("needs_review");
  });
  it("queues only unresolved features for AI and redacts contacts", async () => {
    const l = { ...listing(), description: "Есть пандус. +7 (999) 123-45-67 agent@example.com" };
    const f = SearchFilters.parse({ city: "Москва", operation: "sale", requiredFeatures: ["пандус"] });
    const result = await analyzeUnresolved(l, evaluateListing(l, f), { analyze: async input => {
      expect(input.description).not.toContain("example.com"); expect(input.description).not.toContain("999");
      expect(input.criteria).toEqual(["пандус"]);
      return [{ criterion: "пандус", state: "matched", source: "ai", evidence: "Есть пандус" }];
    } });
    expect(result.verdict).toBe("confirmed");
    expect(result.criteria.at(-1)?.source).toBe("ai");
  });
  it("keeps grouped units distinct, exact duplicates collapse, cross-source only flag", () => {
    const a = listing(); const b = { ...a, source: "avito" as const };
    const results = deduplicateListings([a, a, b]);
    expect(results).toHaveLength(2); expect(results[0]?.possibleDuplicateKeys).toHaveLength(1);
    const raw = cian.results[0] as RealEstateScraper.Listing;
    const one = normalizeListing({ ...raw, parentId: "group", url: raw.url + "#part-1" });
    const two = normalizeListing({ ...raw, parentId: "group", url: raw.url + "#part-2" });
    expect(deduplicateListings([one, two, one])).toHaveLength(2);
    expect(one).toMatchObject({ sourceListingId: "group", sourceUnitId: "1" });
  });
  it("does not invent rental period", () => {
    const raw = cian.results[0] as RealEstateScraper.Listing;
    expect(normalizeListing({ ...raw, deal: "rent", priceText: "50000 ₽" }).priceUnit).toBeNull();
    expect(normalizeListing({ ...raw, deal: "rent", priceText: "500 ₽/м²/мес." }).priceUnit).toBe("rub_m2_month");
  });
});
describe("fallback", () => {
  const policy: FallbackPolicy = { aiEnabled: true, webSearchEnabled: true, autoFallback: true, manualAllowed: true, budgetAvailable: true, limitAvailable: true, alreadyAttempted: false };
  it("auto only on complete technical failure; not on empty success, partial, disabled or none", () => {
    const run = { source: "cian" as const, resultCount: 0, reason: null };
    expect(decideFallback([{ ...run, status: "blocked" }], policy).automatic).toBe(true);
    for (const status of ["success", "partial", "disabled"] as const) expect(decideFallback([{ ...run, status }], policy)).toMatchObject({ automatic: false, manual: true });
    expect(decideFallback([], policy).automatic).toBe(false);
  });
  it.each(["aiEnabled", "webSearchEnabled", "budgetAvailable", "limitAvailable"] as const)("honors %s", flag => {
    expect(decideFallback([], { ...policy, [flag]: false })).toMatchObject({ automatic: false, manual: false });
  });
  it("never repeats and requires separate auto permission", () => {
    expect(decideFallback([], { ...policy, alreadyAttempted: true }).manual).toBe(false);
    expect(decideFallback([{ source: "cian", status: "timeout", resultCount: 0, reason: null }], { ...policy, autoFallback: false })).toMatchObject({ automatic: false, manual: true });
  });
});
