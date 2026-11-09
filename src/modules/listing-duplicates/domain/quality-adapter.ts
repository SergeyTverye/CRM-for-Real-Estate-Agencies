import type { NormalizedListing } from "../../property-search/domain/types";
import { compareListings, type DuplicateCandidate } from "./matching";

export function duplicateQualityGrouping(input: { id: string; listing: NormalizedListing }[]) {
  const candidates: DuplicateCandidate[] = input.map(({ id, listing: l }) => ({ id, source: l.source,
    sourceListingId: l.sourceListingId, sourceUnitId: l.sourceUnitId, city: l.city, address: l.address, area: l.area,
    floor: l.floor.number, floorKind: l.floor.kind, purposes: l.purpose ? [l.purpose] : [], operation: l.operation,
    price: l.price, priceUnit: l.priceUnit, features: l.structuredFeatures }));
  const pairs: { a: string; b: string; relation: "suspected" | "exact" }[] = [];
  for (let i = 0; i < candidates.length; i++) for (const b of candidates.slice(i + 1)) {
    const a = candidates[i]!;
    const exact = !!a.sourceListingId && a.source === b.source && a.sourceListingId === b.sourceListingId && (a.sourceUnitId ?? "") === (b.sourceUnitId ?? "");
    if (exact || compareListings(a, b).probable) pairs.push({ a: a.id, b: b.id, relation: exact ? "exact" : "suspected" });
  }
  return { pairs, retained: input.length };
}
