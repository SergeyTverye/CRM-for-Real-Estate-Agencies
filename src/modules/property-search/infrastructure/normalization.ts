import type RealEstateScraper from "real-estate-scrapper";
import { parseExternalUrl } from "@/shared/net/ssrf";
import { parseFloor, describedUndergroundFloor } from "../domain/floor";
import type { NormalizedListing, PriceUnit, Purpose } from "../domain/types";

import { listingFields } from "./listing-fields";
import { listingQuality, explicitPeriod } from "./listing-quality";
import { extractListingDates, type ListingDates } from "./listing-dates";

const purposeMap: Record<string, Purpose> = { retail: "retail", freePurpose: "free_purpose", office: "office", industrial: "production", warehouse: "warehouse", residential: "residential" };
function safeUrl(value: string): string | null { try { return parseExternalUrl(value).href; } catch { return null; } }
export function parsePriceUnit(text: string | null | undefined, operation: "sale" | "rent" | null): PriceUnit | null {
  if (operation === "sale") return "rub_total";
  if (!text || operation !== "rent") return null;
  const explicit = explicitPeriod(text);
  if (explicit) return explicit.unit;
  const perArea = /(?:м[²2]|кв\.?\s*м)/iu.test(text);
  if (/(?:месяц|мес\.?)(?=$|[^\p{L}\p{N}_])/iu.test(text)) return perArea ? "rub_m2_month" : "rub_month";
  if (/(?:год|года)(?=$|[^\p{L}\p{N}_])/iu.test(text)) return perArea ? "rub_m2_year" : "rub_year";
  return null;
}

export function normalizeListing(raw: RealEstateScraper.Listing, fetchedAt = new Date().toISOString()): NormalizedListing & ListingDates & { title: string | null } {
  const url = safeUrl(raw.url);
  if (!url) throw new Error("INVALID_LISTING_URL");
  const part = new URL(url).hash.match(/^#part-(\d+)$/u)?.[1] ?? null;
  const operation = raw.deal === "daily" ? "rent" : raw.deal === "sale" || raw.deal === "rent" ? raw.deal : null;
  const quality = listingQuality(raw);
  let floor = parseFloor(raw.floor);
  if (raw.floorType === "basement") floor = { kind: "basement", number: floor.number, raw: raw.floor === null ? "basement" : String(raw.floor) };
  if (raw.floorRange && raw.floorRange[0] !== raw.floorRange[1]) floor = { kind: "unknown", number: null, raw: raw.floorRange.join("–") };
  
  const basement = raw.description?.match(/(?:^|[.;\n])\s*(?:этаж\s*[:—-]?\s*)?(цоколь\S*|полуподвал\S*|подвал\S*)\s*(?:этаж|помещени\S*)?(?=[\s,.;]|$)/iu);
  if (basement) floor = parseFloor(basement[1]);
  floor = describedUndergroundFloor(raw.description ?? "") ?? floor;
  const price = raw.price !== null && Number.isFinite(raw.price) && raw.price >= 0 && raw.price < 1e15 ? raw.price.toFixed(2) : null;
  const dates = extractListingDates(raw.source, raw, { id: raw.parentId ?? raw.id, url }, fetchedAt);
  const extended = raw as RealEstateScraper.Listing & Partial<ListingDates>;
  if ((dates.publishedAt || dates.sourceUpdatedAt) && extended.dateSource?.startsWith(`${raw.source}:`)) dates.dateSource = extended.dateSource;
  if ((dates.publishedAt || dates.sourceUpdatedAt) && ["day", "exact"].includes(extended.datePrecision ?? "")) dates.datePrecision = extended.datePrecision!;
  return {
    ...dates,
    source: raw.source, sourceListingId: raw.parentId ?? raw.id ?? null, sourceUnitId: part ?? (raw.parentId ? raw.id ?? null : null), url,
    purpose: purposeMap[raw.propertyType ?? ""] ?? null, operation,
    
    purposeSource: ["yandex", "onrealt"].includes(raw.source) ? "rule" : "structured",
    price, priceUnit: operation === "sale" ? "rub_total" : quality.priceUnit ?? parsePriceUnit(raw.priceText, operation),
    rooms: quality.rooms,
    area: raw.area !== null && Number.isFinite(raw.area) && raw.area >= 0 ? raw.area : null, floor,
    ...listingFields(raw),
    seller: { type: raw.sellerType === "owner" || raw.sellerType === "agent" ? raw.sellerType : "unknown" },
    description: raw.description ?? "", images: raw.images.map(safeUrl).filter((u): u is string => u !== null), fetchedAt,
    structuredFeatures: { ...(raw.category ? { category: raw.category } : {}), ...(quality.rentalPeriod ? { rentalPeriod: quality.rentalPeriod } : {}), ...(quality.apartments ? { apartments: true } : {}) }, possibleDuplicateKeys: [], identityNeedsReview: !(raw.parentId ?? raw.id) || !!raw.parentId && !part && !raw.id,
  };
}
export function listingIdentity(listing: NormalizedListing): string | null {
  return listing.sourceListingId && !listing.identityNeedsReview ? JSON.stringify([listing.source, listing.sourceListingId, listing.sourceUnitId]) : null;
}
const ABBR: Record<string, string> = {
  "ул": "улица", "пр": "проспект", "просп": "проспект", "пер": "переулок",
  "бул": "бульвар", "бульв": "бульвар", "ш": "шоссе", "пл": "площадь",
  "наб": "набережная",
};
const STREET_TYPE = new Set(["улица", "проспект", "переулок", "бульвар", "шоссе", "площадь", "набережная", "проезд", "тупик", "аллея"]);

function streetOnlyKey(address: string): string {
  return address
    .replace(/[,\s]+(\d[\p{L}\p{N}/\\.-]*(\s*(корп|корпус|стр|строение|литер)\.?[\s\p{L}\p{N}/\\.-]*)?)\s*$/giu, "")
    .replace(/[,\s]+$/u, "");
}
export function normalizeAddressKey(address: string, city: string | null): string {
  let value = address.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/пр-т/giu, "проспект").replace(/пр-д/giu, "проезд");
  if (city) {
    const cityKey = city.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]/gu, "");
    value = value.split(",").filter(part => part.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]/gu, "") !== cityKey).join(",");
  }
  const tokens = value.split(/[^\p{L}\p{N}]+/gu).filter(Boolean).map(t => ABBR[t] ?? t);
  const type = tokens.filter(t => STREET_TYPE.has(t));
  const rest = tokens.filter(t => !STREET_TYPE.has(t));
  return [...type, ...rest].join("");
}
export function deduplicateListings<T extends NormalizedListing>(input: T[]): T[] {
  const exact = new Set<string>(); const results: T[] = [];
  for (const listing of input) { const key = listingIdentity(listing); if (key && exact.has(key)) continue; if (key) exact.add(key); results.push({ ...listing, possibleDuplicateKeys: [] }); }
  const keyOf = (address: string, city: string | null) => normalizeAddressKey(address, city);
  const flag = (a: T, b: T) => { a.possibleDuplicateKeys.push(listingIdentity(b) ?? b.url); b.possibleDuplicateKeys.push(listingIdentity(a) ?? a.url); };
  for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) {
    const a = results[i]!, b = results[j]!;
    if (a.source === b.source || !a.address || !b.address || !a.city || !b.city || a.area === null || a.area !== b.area) continue;
    if (keyOf(a.city, null) !== keyOf(b.city, null)) continue;
    if (keyOf(a.address, a.city) === keyOf(b.address, b.city)) { flag(a, b); continue; }
    
    const streetA = keyOf(streetOnlyKey(a.address), a.city);
    const streetB = keyOf(streetOnlyKey(b.address), b.city);
    if (streetA && streetA === streetB && ((streetOnlyKey(a.address) !== a.address) !== (streetOnlyKey(b.address) !== b.address))) flag(a, b);
  }
  return results;
}
