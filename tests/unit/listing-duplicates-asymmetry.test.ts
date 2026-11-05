import { describe, it, expect } from "vitest";
import { compareListings, type DuplicateCandidate } from "@/modules/listing-duplicates/domain/matching";

const base: DuplicateCandidate = { id: "a", source: "cian", city: "Новосибирск", address: "ул. Мира, д. 58", area: 100, floor: 1, purposes: ["office"], operation: "sale", price: "10000000", priceUnit: "rub_total" };
const other = (changes: Partial<DuplicateCandidate>) => ({ ...base, id: "b", source: "yandex", ...changes });

describe("SR-07: этаж/помещение указан только в одном объявлении", () => {
  it("этаж известен только у одного и цена далеко — не группирует", () => {
    expect(compareListings({ ...base, floor: null }, other({ price: "12000000" })).probable).toBe(false);
  });
  it("этаж известен только у одного, цена в пределах 5% — группа низкой уверенности", () => {
    const r = compareListings({ ...base, floor: null }, other({ price: "10300000" }));
    expect(r.probable).toBe(true);
    expect(r.score).toBe(35);
    expect(r.features.some(f => f.feature === "Этаж/помещение")).toBe(true);
  });
  it("помещение указано только у одного и цена другой единицы — не группирует", () => {
    expect(compareListings({ ...base, address: "ул. Мира, д. 58, помещение 3" }, other({ priceUnit: "rub_month" })).probable).toBe(false);
  });
  it("оба этажа известны и равны — обычная группа", () => {
    expect(compareListings(base, other({})).probable).toBe(true);
  });
  it("оба этажа известны и различаются — не группирует даже при равной цене", () => {
    expect(compareListings(base, other({ floor: 2 })).probable).toBe(false);
  });
});
