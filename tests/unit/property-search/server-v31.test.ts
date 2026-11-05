import { describe, expect, it } from "vitest";
import { convertPrice, pricePerM2 } from "@/modules/property-search/domain/prices";
import { freshnessBounds, freshnessState, freshnessSchema } from "@/modules/property-search/domain/freshness";
import { FILTER_CATALOG } from "@/modules/property-search/domain/filter-catalog";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing, evaluateFeature } from "@/modules/property-search/domain/evaluation";
import { escapeSpreadsheet, csvCell } from "@/modules/property-search/application/export-service";
import { resultOrder, SORTS } from "@/modules/property-search/queries/results-query";
const listing: NormalizedListing = { source: "cian", sourceListingId: "synthetic", sourceUnitId: null, url: "https://cian.ru/synthetic", purpose: "office", operation: "sale", price: "10000", priceUnit: "rub_total", area: 100, floor: { kind: "above_ground", number: 1, raw: "1" }, city: "Новосибирск", address: null, district: null, seller: { type: "owner" }, description: "Офис. Отдельного входа нет. Парковка будет оборудована. Мощность 50 кВт.", images: [], fetchedAt: "2026-11-05T10:00:00Z", structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: false };
describe("v3.1 server filters, prices, dates and export", () => {
  it("catalog has unique keys and typed feature inputs reject unknown fields and bad ranges", () => {
    expect(new Set(FILTER_CATALOG.map(f => f.key)).size).toBe(FILTER_CATALOG.length);
    expect(SearchFilters.safeParse({ operation: "sale", features: { power_kw: { min: 50, max: 10 } } }).success).toBe(false);
    expect(SearchFilters.safeParse({ operation: "sale", features: { invented: true } }).success).toBe(false);
  });
  it("supports OR purposes, numeric ranges, unknown and negative feature evidence", () => {
    const filters = SearchFilters.parse({ operation: "sale", purposes: ["retail", "office"], features: { power_kw: { min: 40, max: 60 }, parking: true } });
    const result = evaluateListing(listing, filters);
    expect(result.verdict).toBe("needs_review");
    expect(result.criteria.find(c => c.criterion === "features.power_kw")?.state).toBe("matched");
    expect(evaluateFeature("Отдельный вход", listing).state).toBe("contradicted");
    expect(evaluateListing(listing, SearchFilters.parse({ operation: "sale", features: { power_kw: { max: 40 } } })).verdict).toBe("rejected");
  });
  it("source owner badges are not employee verification", () => {
    const f = SearchFilters.parse({ operation: "sale", seller: "confirmed_owner_only" });
    expect(evaluateListing({ ...listing, seller: { type: "owner", ownerVerification: { source: "source", method: "badge", checkedAt: listing.fetchedAt } } }, f).verdict).toBe("needs_review");
  });
  it("converts compatible rent periods and m² with explicit calculation, never fills unknown area", () => {
    expect(convertPrice("12000", "rub_m2_year", "rub_month", 100)).toMatchObject({ amount: "100000.00", calculated: true });
    expect(convertPrice("1200000", "rub_year", "rub_m2_month", 100)?.amount).toBe("1000.00");
    expect(convertPrice("12000", "rub_year", "rub_month", null)?.amount).toBe("1000.00");
    expect(convertPrice("100", "rub_m2_month", "rub_month", null)).toBeNull();
    expect(convertPrice("100", "rub_total", "rub_month", 100)).toBeNull();
    expect(pricePerM2(null, "rub_total", 100)).toBeNull();
    expect(pricePerM2("1000", "rub_year", 100)).toMatchObject({ amount: "10.00", unit: "per_m2_year" });
  });
  it.each(["3", "7", "30", "90"] as const)("calendar %s days uses Novosibirsk midnight", period => {
    const f = freshnessSchema.parse({ mode: "published", period }), now = new Date("2026-11-05T18:00:00Z");
    const b = freshnessBounds(f, now);
    expect(b.to.toISOString()).toBe("2026-11-06T17:00:00.000Z");
    expect(+b.to - +b.from).toBe(Number(period) * 86400000);
    expect(freshnessState(b.from, f, now)).toBe("matched");
    expect(freshnessState(b.to, f, now)).toBe("contradicted");
    expect(freshnessState(null, { ...f, includeUnknown: true }, now)).toBe("unknown");
  });
  it("24h is sliding while custom dates are inclusive calendar days", () => {
    const now = new Date("2026-11-05T10:23:00Z");
    expect(freshnessBounds(freshnessSchema.parse({ mode: "first_seen", period: "24h" }), now).from.toISOString()).toBe("2026-11-04T10:23:00.000Z");
    const b = freshnessBounds(freshnessSchema.parse({ mode: "published", period: "custom", from: "2026-11-05", to: "2026-11-05" }));
    expect(b.from.toISOString()).toBe("2026-11-04T17:00:00.000Z"); expect(+b.to - +b.from).toBe(86400000);
  });
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1", "  =1"])("escapes formula %j", input => {
    expect(escapeSpreadsheet(input).startsWith("'")).toBe(true);
    expect(csvCell(input)).toContain("'");
  });
  it("retains quotes and uses id as tie breaker for every direction and sort", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    for (const sort of SORTS) for (const direction of ["asc", "desc"] as const) expect(resultOrder(sort, direction)).toMatch(/r\.id ASC$/u);
  });
});
