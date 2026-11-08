import { describe, expect, it } from "vitest";
import { PURPOSES } from "@/modules/property-search/domain/types";
import {
  PROVIDER_PURPOSE_ALLOWLIST,
  decodeParseResult,
  providerParseInstructions,
  providerParseSchema,
} from "@/modules/ai/domain/provider-parse";

const flatResidential = {
  city: "Новосибирск",
  operation: "sale",
  priceUnit: "rub_total",
  priceFrom: null,
  priceTo: "5000000",
  areaFrom: 30,
  areaTo: null,
  floorMode: "any",
  seller: "all",
  purposes: ["residential"],
  districts: [],
  requiredFeatures: [],
  preferredFeatures: [],
  sources: ["cian"],
  clarificationQuestion: null,
};

describe("residential provider parse compatibility", () => {
  it("advertises residential in the bounded provider allowlist", () => {
    expect(PROVIDER_PURPOSE_ALLOWLIST).toContain("residential");
    for (const purpose of PURPOSES) expect(PROVIDER_PURPOSE_ALLOWLIST).toContain(purpose);
    expect(providerParseInstructions).toContain("residential");
    // Provider dialect stays flat: no enums/refs that would leak Zod internals.
    expect(JSON.stringify(providerParseSchema)).not.toMatch(/anyOf|oneOf|\$ref|format|minimum|default|enum/);
  });

  it("decodes a flat residential result through the real canonical validation", () => {
    const result = decodeParseResult(JSON.stringify(flatResidential));
    expect(result.clarificationQuestion).toBeNull();
    expect(result.filters?.purposes).toEqual(["residential"]);
  });

  it("still rejects an invented purpose without weakening canonical validation", () => {
    expect(() => decodeParseResult(JSON.stringify({ ...flatResidential, purposes: ["invented"] }))).toThrow();
  });
});
