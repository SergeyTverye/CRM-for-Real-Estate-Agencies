import { describe, expect, it } from "vitest";
import { scoreMatch, type NeedCriteria, type PropertyFacts } from "@/modules/matching/domain/match-score";

const need: NeedCriteria = {
  operationType: "rent", propertyType: "commercial", propertySubtype: "retail", budgetMin: null, budgetMax: 100000,
  areaMin: 50, areaMax: 120, district: "Центр", roomsMin: null, roomsMax: null, floorMin: null, floorMax: null,
  landAreaMin: null, landAreaMax: null, buildingAreaMin: null, buildingAreaMax: null, powerRequirement: 15,
  parkingRequirement: true, tenantRequirement: null, commercialPurpose: null,
};
const prop: PropertyFacts = {
  operationType: "rent", propertyType: "commercial", propertySubtype: "retail", price: 90000, area: 80, district: "Центральный",
  roomsCount: null, floor: 1, landArea: null, buildingArea: null, powerKw: 20, parkingAvailable: true, hasTenant: false, commercialPurpose: "retail",
};

describe("детерминированный подбор", () => {
  it("полное совпадение — 100", () => {
    const r = scoreMatch(need, prop);
    expect(r.hardMismatch).toBe(false);
    expect(r.score).toBe(100);
  });
  it("цена вне бюджета снижает оценку и объясняется", () => {
    const r = scoreMatch(need, { ...prop, price: 150000 });
    expect(r.score).toBeLessThan(100);
    expect(r.criteria.find((c) => c.key === "budget")?.ok).toBe(false);
  });
  it("другая операция — жёсткое несовпадение", () => {
    expect(scoreMatch(need, { ...prop, operationType: "sale" }).hardMismatch).toBe(true);
    expect(scoreMatch({ ...need, operationType: "buy" }, { ...prop, operationType: "sale" }).hardMismatch).toBe(false);
  });
  it("неизвестные данные объекта не считаются совпадением", () => {
    const r = scoreMatch(need, { ...prop, powerKw: null });
    expect(r.criteria.find((c) => c.key === "power")?.ok).toBeNull();
  });
});
