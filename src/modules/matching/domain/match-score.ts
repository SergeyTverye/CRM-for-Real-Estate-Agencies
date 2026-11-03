/**
 * Детерминированный и объяснимый match score (ТЗ 37.19, FR-42): доля выполненных
 * применимых критериев потребности. Операция и тип недвижимости — обязательные фильтры.
 */

export const NEED_TO_PROPERTY_OPERATION: Record<string, string> = { buy: "sale", rent: "rent" };

export interface NeedCriteria {
  operationType: string;
  propertyType: string;
  propertySubtype: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  district: string | null;
  roomsMin: number | null;
  roomsMax: number | null;
  floorMin: number | null;
  floorMax: number | null;
  landAreaMin: number | null;
  landAreaMax: number | null;
  buildingAreaMin: number | null;
  buildingAreaMax: number | null;
  powerRequirement: number | null;
  parkingRequirement: boolean | null;
  tenantRequirement: boolean | null;
  commercialPurpose: string | null;
}

export interface PropertyFacts {
  operationType: string;
  propertyType: string;
  propertySubtype: string | null;
  price: number | null;
  area: number | null;
  district: string | null;
  roomsCount: number | null;
  floor: number | null;
  landArea: number | null;
  buildingArea: number | null;
  powerKw: number | null;
  parkingAvailable: boolean | null;
  hasTenant: boolean | null;
  commercialPurpose: string | null;
}

export interface CriterionResult {
  key: string;
  label: string;
  ok: boolean | null; // null — у объекта нет данных
}

function inRange(value: number | null, min: number | null, max: number | null): boolean | null {
  if (min === null && max === null) return true;
  if (value === null) return null;
  return (min === null || value >= min) && (max === null || value <= max);
}

export function scoreMatch(need: NeedCriteria, p: PropertyFacts): { score: number; criteria: CriterionResult[]; hardMismatch: boolean } {
  const criteria: CriterionResult[] = [];
  const expectedOp = NEED_TO_PROPERTY_OPERATION[need.operationType];
  const hardMismatch = (expectedOp !== undefined && p.operationType !== expectedOp) || p.propertyType !== need.propertyType;
  criteria.push({ key: "operation", label: "Операция", ok: expectedOp ? p.operationType === expectedOp : true });
  criteria.push({ key: "type", label: "Тип недвижимости", ok: p.propertyType === need.propertyType });
  if (need.propertySubtype) criteria.push({ key: "subtype", label: "Подтип", ok: p.propertySubtype === null ? null : p.propertySubtype === need.propertySubtype });
  if (need.budgetMin !== null || need.budgetMax !== null) criteria.push({ key: "budget", label: "Бюджет", ok: inRange(p.price, need.budgetMin, need.budgetMax) });
  if (need.areaMin !== null || need.areaMax !== null) criteria.push({ key: "area", label: "Площадь", ok: inRange(p.area, need.areaMin, need.areaMax) });
  if (need.district)
    criteria.push({ key: "district", label: "Район", ok: p.district === null ? null : p.district.toLowerCase().includes(need.district.toLowerCase()) });
  if (need.roomsMin !== null || need.roomsMax !== null) criteria.push({ key: "rooms", label: "Комнаты", ok: inRange(p.roomsCount, need.roomsMin, need.roomsMax) });
  if (need.floorMin !== null || need.floorMax !== null) criteria.push({ key: "floor", label: "Этаж", ok: inRange(p.floor, need.floorMin, need.floorMax) });
  if (need.landAreaMin !== null || need.landAreaMax !== null) criteria.push({ key: "land", label: "Площадь участка", ok: inRange(p.landArea, need.landAreaMin, need.landAreaMax) });
  if (need.buildingAreaMin !== null || need.buildingAreaMax !== null)
    criteria.push({ key: "building", label: "Площадь здания", ok: inRange(p.buildingArea, need.buildingAreaMin, need.buildingAreaMax) });
  if (need.powerRequirement !== null) criteria.push({ key: "power", label: "Электрическая мощность", ok: p.powerKw === null ? null : p.powerKw >= need.powerRequirement });
  if (need.parkingRequirement !== null)
    criteria.push({ key: "parking", label: "Парковка", ok: p.parkingAvailable === null ? null : p.parkingAvailable === need.parkingRequirement });
  if (need.tenantRequirement !== null) criteria.push({ key: "tenant", label: "Арендатор", ok: p.hasTenant === null ? null : p.hasTenant === need.tenantRequirement });
  if (need.commercialPurpose && need.commercialPurpose !== "any")
    criteria.push({ key: "purpose", label: "Назначение", ok: p.commercialPurpose === null ? null : p.commercialPurpose === need.commercialPurpose || p.commercialPurpose === "any" });
  const applicable = criteria.length;
  const ok = criteria.filter((c) => c.ok === true).length;
  return { score: Math.round((ok / applicable) * 100), criteria, hardMismatch };
}
