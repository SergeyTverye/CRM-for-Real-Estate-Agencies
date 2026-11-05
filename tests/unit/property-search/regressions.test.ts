import { describe, expect, it } from "vitest";
import { evaluateFeature } from "@/modules/property-search/domain/evaluation";
import { resolveDistrict } from "@/modules/property-search/domain/geography";
import { parsePriceUnit } from "@/modules/property-search/infrastructure/normalization";
import type { NormalizedListing } from "@/modules/property-search/domain/types";

describe("coordinator review regressions", () => {
  it.each(["Отдельный вход не планируется", "Отдельного входа нет", "Нет отдельного входа"])("explicit negative: %s", description => {
    const listing = { description, structuredFeatures: {} } as NormalizedListing;
    expect(evaluateFeature("отдельный вход", listing).state).toBe("contradicted");
  });
  it("keeps a possible installation unknown", () => {
    expect(evaluateFeature("отдельный вход", { description: "Можно оборудовать отдельный вход", structuredFeatures: {} } as NormalizedListing).state).toBe("unknown");
  });
  it.each(["1000 ₽/м²/мес.)", "1000 ₽/м²/месяц)", "1000 руб/м2/мес."])("punctuation after rent period: %s", text => {
    expect(parsePriceUnit(text, "rent")).toBe("rub_m2_month");
  });
  it.each(["Москва, р-н Тверской", "Москва, район Тверской", "Москва, Тверской р-н"])("district prefix/suffix: %s", address => {
    expect(resolveDistrict("Москва", null, address)).toBe("Тверской");
  });
  it("does not infer district from street names", () => {
    expect(resolveDistrict("Москва", null, "Москва, Тверская улица, 1")).toBeNull();
  });
});
