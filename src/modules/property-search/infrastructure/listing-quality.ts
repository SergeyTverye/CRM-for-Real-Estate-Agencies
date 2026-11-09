import { load } from "cheerio";
import type { NormalizedListing, PriceUnit } from "../domain/types";
import { parseRooms } from "../domain/housing";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string => typeof v === "string" ? v : "";
export function explicitPeriod(value: string): { unit: PriceUnit | null; daily: boolean } | null {
  const perArea = /(?:\/|за)\s*(?:м[²2]|кв\.?\s*м)|(?:м[²2]|кв\.?\s*м)\s*(?:\/|в\s+(?:месяц|год))/iu.test(value);
  if (/посуточн|(?:\/|за|в)\s*(?:сутки|суток|сут\.?|день)(?!\p{L})|^(?:daily|DAY|P1D|сутки)$/iu.test(value)) return { unit: null, daily: true };
  if (/(?:\/|за|в)\s*(?:месяц|мес\.?)(?!\p{L})|^(?:monthly|MONTH|P1M|месяц|мес\.?)$/iu.test(value)) return { unit: perArea ? "rub_m2_month" : "rub_month", daily: false };
  if (/(?:\/|за|в)\s*(?:год|года)(?!\p{L})|^(?:annually|yearly|YEAR|P1Y|год)$/iu.test(value)) return { unit: perArea ? "rub_m2_year" : "rub_year", daily: false };
  return null;
}
/** Known fields only. Never derive a period from the operation, route or requested filters. */
export function listingQuality(value: unknown) {
  const r = row(value), terms = row(r.bargainTerms), price = row(r.price), offers = row(r.offers);
  const spec = row(offers.priceSpecification);
  const title = text(r.title) || text(r.name) || text(r.headline);
  const description = text(r.description);
  const periodTexts = [r.priceText, r.formattedFullPrice, r.formattedShortPrice, r.paymentPeriod, r.pricePeriod, r.rentalPeriod, terms.paymentPeriod, price.period, spec.unitText, spec.billingDuration];
  const areaPrice = terms.priceType === "squareMeter" || spec.unitCode === "MTK";
  const period = periodTexts.map(v => explicitPeriod(text(v))).find(Boolean) ?? explicitPeriod([title, description].join("\n"));
  const unit = areaPrice && period?.unit === "rub_month" ? "rub_m2_month" : areaPrice && period?.unit === "rub_year" ? "rub_m2_year" : period?.unit;
  const category = [r.sourceCategoryRaw, r.category, r.residentialType, r.propertyType].map(text).join(" ");
  const apartments = r.isApartments === true || /апартамент|(?<!\p{L})apartments(?!\p{L})/iu.test([category, title, description].join("\n"));
  return { rooms: parseRooms(r.rooms ?? r.roomsCount ?? r.numberOfRooms, title), ...(period ? { priceUnit: unit ?? null, rentalPeriod: period.daily ? "day" : "long_term" } : {}), ...(apartments ? { apartments: true } : {}) };
}
/** Enrich existing saved snapshots too; unknown data stays unknown. Daily is a flag in JSON, no schema migration. */
export function enrichListingQuality<T extends NormalizedListing>(listing: T): T {
  const facts = listingQuality(listing), features = listing.structuredFeatures ?? {};
  return { ...listing, rooms: listing.rooms ?? facts.rooms,
    priceUnit: facts.rentalPeriod === "day" || features.rentalPeriod === "day" ? null : listing.priceUnit ?? facts.priceUnit ?? null,
    structuredFeatures: { ...features, ...(facts.apartments ? { apartments: true } : {}), ...(facts.rentalPeriod ? { rentalPeriod: facts.rentalPeriod } : {}) } };
}
/** Scope text to the matching source card. No page-wide period may leak into another listing. */
export function cardQuality(payload: unknown, listing: { id?: string | null; url: string }, selectors?: string) {
  if (typeof payload !== "string" || !selectors) return {};
  const $ = load(payload);
  let facts: ReturnType<typeof listingQuality> | undefined;
  $(selectors).each((_, el) => {
    if (facts) return;
    const card = $(el);
    const match = card.find("a[href]").addBack("a[href]").toArray().some(a => {
      try { const href = new URL($(a).attr("href")!, listing.url); return href.origin === new URL(listing.url).origin && href.pathname === new URL(listing.url).pathname; } catch { return false; }
    });
    if (!match) return;
    const price = card.find('[itemprop="price"], [class*="price"], [class*="Price"]').toArray().map(e => $(e).text()).join(" ");
    facts = listingQuality({ title: card.find('h2,h3,[itemprop="name"]').first().text(), description: card.clone().find("script,style").remove().end().text(), priceText: price });
  });
  return facts ?? {};
}
