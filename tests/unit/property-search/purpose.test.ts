import { describe, expect, it, vi } from "vitest";
import type RealEstateScraper from "real-estate-scrapper";
import cian from "../../fixtures/scraper/cian.json";
import { analyzeUnresolved, evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";

const filters = SearchFilters.parse({ city: "Москва", operation: "sale", purposes: ["office"] });
const listing = (input: Partial<NormalizedListing> = {}): NormalizedListing => ({
  ...normalizeListing(cian.results[0] as RealEstateScraper.Listing), purpose: null, title: null, description: "", ...input,
});

describe("non-residential purpose requirement", () => {
  
  it.each([
    "Квартира в квартале бизнес-класса…",
    "ЖК … жилой комплекс комфорт-класса…",
    "Квартира в квартале бизнес-класса «Собрание» у Заельцовского бора.",
    "ЖК «Паскаль»  жилой комплекс комфорт-класса в Октябрьском районе Новосибирска.",
    "ЖК «Ньютон»  современный комплекс комфорт-класса. В продаже квартиры от 24 до 71 м².",
    "Продаётся квартира в квартале бизнес-класса",
    "Студия 28 м²", "Апартаменты-жильё", "Комнаты в продаже",
    "Таунхаус", "Дом с участком", "Коттедж", "Квартира-студия",
  ])("rejects residential wording: %s", text => {
    for (const input of [{ title: text }, { description: text }]) {
      const result = evaluateListing(listing(input), filters);
      expect(result.verdict).toBe("rejected");
      expect(result.criteria).toContainEqual({ criterion: "purpose", state: "contradicted", source: "rule", evidence: text });
      expect(result.aiPending).not.toContain("purpose");
    }
  });
  it.each([
    "ЖК … коммерческие помещения на первом этаже", "Офисы в жилом комплексе",
    "ЖК: торговое помещение", "ПСН в ЖК", "Склад в доме", "Производство в жилом комплексе",
    "Помещение свободного назначения в ЖК", "Нежилое помещение в доме", "Коммерческое помещение в ЖК",
    "Домклик", "ЖКХ", "Апартаменты", "Помещение 100 м²",
  ])("keeps mixed/ambiguous wording unresolved: %s", title => {
    expect(evaluateListing(listing({ title }), filters)).toMatchObject({ verdict: "needs_review" });
  });
  it("checks commercial signals across both title and description", () => {
    expect(evaluateListing(listing({ title: "ЖК у парка", description: "Офисы на первом этаже" }), filters).verdict).toBe("needs_review");
  });
  it.each(["residential", "жилая", "Жилая недвижимость"])("rejects structured category %s even with commercial wording", category => {
    const result = evaluateListing(listing({ description: "Офис в ЖК", structuredFeatures: { category } }), filters);
    expect(result.verdict).toBe("rejected");
    expect(result.criteria).toContainEqual({ criterion: "purpose", state: "contradicted", source: "structured", evidence: `category=${category}` });
  });
  it("preserves the scraper category for deterministic evaluation", () => {
    const normalized = normalizeListing({ ...cian.results[0], category: "residential", propertyType: null } as RealEstateScraper.Listing);
    expect(evaluateListing(normalized, filters).verdict).toBe("rejected");
  });
  it("gives a known commercial purpose priority over descriptive residential words", () => {
    expect(evaluateListing(listing({ purpose: "office", description: "В жилом комплексе" }), filters).verdict).toBe("confirmed");
  });
  it("does not treat the generic scraper's title inference as a structured purpose", () => {
    const item = listing({ source: "yandex", purpose: "office", purposeSource: "rule", description: "Квартира в квартале бизнес-класса «Собрание» у Заельцовского бора." });
    expect(evaluateListing(item, filters).verdict).toBe("rejected");
    expect(evaluateListing({ ...item, title: "Офис" }, filters).verdict).toBe("confirmed");
  });
  it("enforces non-residential scope even without a selected subtype", () => {
    expect(evaluateListing(listing({ title: "Квартира" }), { ...filters, purposes: [] }).verdict).toBe("rejected");
  });
  it("does not let AI override a deterministic contradiction", async () => {
    const item = listing({ title: "Квартира", city: null });
    const analyzer = { analyze: vi.fn(async () => [{ criterion: "purpose", state: "matched" as const, evidence: "Квартира", source: "ai" as const }]) };
    expect((await analyzeUnresolved(item, evaluateListing(item, filters), analyzer)).verdict).toBe("rejected");
  });
});
