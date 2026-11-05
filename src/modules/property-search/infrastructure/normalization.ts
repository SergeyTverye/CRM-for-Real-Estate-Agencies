import type RealEstateScraper from "real-estate-scrapper";
import { parseExternalUrl } from "@/shared/net/ssrf";
import { parseFloor } from "../domain/floor";
import type { NormalizedListing, PriceUnit, Purpose } from "../domain/types";

import { listingFields } from "./listing-fields";

const purposeMap: Record<string, Purpose> = { retail: "retail", freePurpose: "free_purpose", office: "office", industrial: "production", warehouse: "warehouse" };
function safeUrl(value: string): string | null { try { return parseExternalUrl(value).href; } catch { return null; } }
export function parsePriceUnit(text: string | null | undefined, operation: "sale" | "rent" | null): PriceUnit | null {
  if (operation === "sale") return "rub_total";
  if (!text || operation !== "rent") return null;
  const perArea = /(?:м[²2]|кв\.?\s*м)/iu.test(text);
  if (/(?:месяц|мес\.?)(?=$|[^\p{L}\p{N}_])/iu.test(text)) return perArea ? "rub_m2_month" : "rub_month";
  if (/(?:год|года)(?=$|[^\p{L}\p{N}_])/iu.test(text)) return perArea ? "rub_m2_year" : "rub_year";
  return null;
}
/** Package 2.1.0 already expands Cian grouped listings into #part-N/parentId rows. */
export function normalizeListing(raw: RealEstateScraper.Listing, fetchedAt = new Date().toISOString()): NormalizedListing & { title: string | null } {
  const url = safeUrl(raw.url);
  if (!url) throw new Error("INVALID_LISTING_URL");
  const part = new URL(url).hash.match(/^#part-(\d+)$/u)?.[1] ?? null;
  const operation = raw.deal === "sale" || raw.deal === "rent" ? raw.deal : null;
  let floor = parseFloor(raw.floor);
  if (raw.floorType === "basement") floor = { kind: "basement", number: floor.number, raw: raw.floor === null ? "basement" : String(raw.floor) };
  if (raw.floorRange && raw.floorRange[0] !== raw.floorRange[1]) floor = { kind: "unknown", number: null, raw: raw.floorRange.join("–") };
  // Known package/API sign defects: an explicit basement description invalidates a positive floor.
  const basement = raw.description?.match(/(?:^|[.;\n])\s*(?:этаж\s*[:—-]?\s*)?(цоколь\S*|полуподвал\S*|подвал\S*)\s*(?:этаж|помещени\S*)?(?=[\s,.;]|$)/iu);
  if (basement) floor = parseFloor(basement[1]);
  const price = raw.price !== null && Number.isFinite(raw.price) && raw.price >= 0 && raw.price < 1e15 ? raw.price.toFixed(2) : null;
  return {
    source: raw.source, sourceListingId: raw.parentId ?? raw.id ?? null, sourceUnitId: part ?? (raw.parentId ? raw.id ?? null : null), url,
    purpose: purposeMap[raw.propertyType ?? ""] ?? null, operation,
    price, priceUnit: parsePriceUnit(raw.priceText, operation),
    area: raw.area !== null && Number.isFinite(raw.area) && raw.area >= 0 ? raw.area : null, floor,
    ...listingFields(raw),
    seller: { type: raw.sellerType === "owner" || raw.sellerType === "agent" ? raw.sellerType : "unknown" },
    description: raw.description ?? "", images: raw.images.map(safeUrl).filter((u): u is string => u !== null), fetchedAt,
    structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: !(raw.parentId ?? raw.id) || !!raw.parentId && !part && !raw.id,
  };
}
export function listingIdentity(listing: NormalizedListing): string | null {
  return listing.sourceListingId && !listing.identityNeedsReview ? JSON.stringify([listing.source, listing.sourceListingId, listing.sourceUnitId]) : null;
}
export function deduplicateListings(input: NormalizedListing[]): NormalizedListing[] {
  const exact = new Set<string>(); const results: NormalizedListing[] = [];
  for (const listing of input) { const key = listingIdentity(listing); if (key && exact.has(key)) continue; if (key) exact.add(key); results.push({ ...listing, possibleDuplicateKeys: [] }); }
  for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) {
    const a = results[i]!, b = results[j]!;
    const addressKey = (s: string) => s.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]/gu, "");
    if (a.source !== b.source && a.address && b.address && addressKey(a.address) === addressKey(b.address) && a.city && b.city && addressKey(a.city) === addressKey(b.city) && a.area !== null && a.area === b.area) {
      a.possibleDuplicateKeys.push(listingIdentity(b) ?? b.url); b.possibleDuplicateKeys.push(listingIdentity(a) ?? a.url);
    }
  }
  return results;
}
