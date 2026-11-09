import { describe, it, expect } from "vitest";
import { decodeParseResult, providerParseSchema } from "@/modules/ai/domain/provider-parse";
const flat = { city: "Новосибирск", operation: "sale", priceUnit: "rub_total", priceFrom: null, priceTo: "10000000",
  areaFrom: 50, areaTo: 100, floorMode: "any", seller: "all", purposes: ["office"], districts: [], requiredFeatures: [], preferredFeatures: [],
  sources: ["cian"], clarificationQuestion: null };
describe("flat provider parse contract", () => {
  it("uses only simple types, primitive arrays and nullable type arrays", () => {
    expect(JSON.stringify(providerParseSchema)).not.toMatch(/anyOf|oneOf|\$ref|format|minimum|default|enum/);
    expect(Object.values(providerParseSchema.properties).every((p) => !('properties' in p))).toBe(true);
  });
  it("maps null optional values to absent canonical fields, then validates business rules", () => {
    const r = decodeParseResult('```json\n' + JSON.stringify(flat) + '\n```');
    expect(r.filters).toMatchObject({ priceTo: "10000000", areaFrom: 50, operation: "sale" });
    expect(r.filters).not.toHaveProperty("priceFrom");
  });
  it("keeps clarification separate from operational filters", () => {
    expect(decodeParseResult(JSON.stringify({ ...flat, operation: null, clarificationQuestion: "Единица цены?" }))).toEqual({ filters: null, clarificationQuestion: "Единица цены?" });
  });
  it("defaults a rent unit from an explicit price, still rejecting other invalid input", () => {
    const normalized = decodeParseResult(JSON.stringify({ ...flat, operation: "rent", priceUnit: null }));
    expect(normalized.filters).toMatchObject({ operation: "rent", priceUnit: "rub_month", priceTo: "10000000" });
  });
  it.each([
    { ...flat, operation: "unknown" }, { ...flat, priceTo: 100 },
    { ...flat, areaFrom: -1 }, { ...flat, purposes: ["invented"] }, { ...flat, secret: "injection" },
  ])("does not weaken full canonical validation", (data) => {
    expect(() => decodeParseResult(JSON.stringify(data))).toThrow();
  });
});
