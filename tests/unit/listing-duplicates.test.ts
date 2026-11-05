import { describe, it, expect } from "vitest";
import { normalizeAddress, areaWithinTolerance, compareListings, groupCandidates, type DuplicateCandidate } from "@/modules/listing-duplicates/domain/matching";
import { evaluateQuality } from "../../scripts/search-quality/evaluate";
const base: DuplicateCandidate = { id: "a", source: "cian", city: "Новосибирск", address: "ул. Мира, д. 58", area: 100, floor: 1, purposes: ["office"], operation: "sale", price: "10000000", priceUnit: "rub_total" };
const second = (changes: Partial<DuplicateCandidate> = {}) => ({ ...base, id: "b", source: "yandex", ...changes });
describe("SR-07 нормализация и кандидаты", () => {
  it("сокращения, регистр, е/ё, дом/корпус/строение/помещение", () => {
    expect(normalizeAddress("г. Новосибирск, УЛ. Берёзовая, д. 12 к2, стр. 3, пом. 7", "Новосибирск"))
      .toEqual(normalizeAddress("улица березовая 12 корпус 2 строение 3 помещение 7", "Новосибирск"));
    expect(normalizeAddress("пр-т Карла Маркса 10")).toEqual(normalizeAddress("проспект Карла Маркса, дом 10"));
    expect(normalizeAddress("Ленина 21/1к4").house).toBe("21/1");
    expect(normalizeAddress("Ленина 21/1к4").corpus).toBe("4");
    expect(normalizeAddress("ул. Офицерская 10").street).toBe("офицерская");
    expect(normalizeAddress("ул. Профсоюзная 10").street).toBe("профсоюзная");
  });
  it.each([[20, 22, true], [100, 103, true], [100, 104, false], [null, 10, false], [0, 0, false], [NaN, 2, false]])("допуск %s / %s", (a, b, expected) => expect(areaWithinTolerance(a, b)).toBe(expected));
  it.each([{ floor: 2 }, { address: "Мира 58 помещение 8" }, { address: "Мира 59" }, { city: "Омск" }, { purposes: ["warehouse"] }])("не группирует конфликт %j", changes => {
    const a = { ...base, address: "Мира 58 помещение 7" };
    expect(compareListings(a, second(changes)).probable).toBe(false);
  });
  it("разные корпуса и строения исключают совпадение", () => {
    for (const part of ["корпус", "строение"]) expect(compareListings({ ...base, address: `Мира 58 ${part} 1` }, second({ address: `Мира 58 ${part} 2` })).probable).toBe(false);
  });
  it("адрес+площадь без этажа и помещения дают только низкий probable", () => {
    const pair = compareListings({ ...base, floor: null }, second({ floor: null }));
    expect(pair.probable).toBe(true); expect(pair.score).toBeLessThan(40);
    expect(pair.features.find(f => f.feature === "Этаж")?.state).toBe("unknown");
  });
  it("неизвестный дом требует точной площади, этажа, назначения и цены с единицей", () => {
    expect(compareListings(base, second({ address: "улица Мира" })).probable).toBe(true);
    expect(compareListings(base, second({ address: "улица Мира", floor: null })).probable).toBe(false);
    expect(compareListings(base, second({ address: "улица Мира", priceUnit: null })).probable).toBe(false);
  });
  it("транзитивная цепочка не склеивает разные помещения", () => {
    const groups = groupCandidates([{ ...base, address: "Мира 58 пом 1" }, second(), second({ id: "c", address: "Мира 58 пом 2" })]);
    expect(groups).toHaveLength(1); expect(groups[0]!.listingIds).not.toEqual(expect.arrayContaining(["a", "c"]));
    expect(groupCandidates([base, second()], () => true)).toHaveLength(0);
  });
  it("AT-07 эталон: все три пары без ложных и неразмеченных предсказаний", () => {
    expect(evaluateQuality().deduplication).toMatchObject({ tp: 3, fp: 0, fn: 0, tn: 2, precision: 1, recall: 1, unlabelledPredictions: 0, retained: 49 });
  });
});
