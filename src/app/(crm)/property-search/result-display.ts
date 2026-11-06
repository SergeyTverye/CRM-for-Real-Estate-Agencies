import { DISPLAY_LABELS, displayLabel, EVIDENCE_LABELS, evidenceLabel } from "@/shared/codebook";
import { listingFields, listingText } from "@/modules/property-search/infrastructure/listing-fields";

export function resultAddress(snapshot: unknown, listing: unknown): string {
  return listingFields(snapshot).address ?? listingFields(listing).address ?? "Адрес не указан площадкой";
}
export function resultTitle(snapshot: unknown, listing: { description?: string | null }): string | null {
  const title = listingFields(snapshot).title ?? listingFields(listing).title;
  if (title) return title;
  const description = listingText(listing.description);
  return description && description.length > 180 ? `${description.slice(0, 180).replace(/\s+\S*$/u, "")}…` : description ?? "Заголовок не сохранён";
}
export function resultPriceUnit(snapshot: { operation?: string | null; priceUnit?: string | null } | null | undefined, listing: { operation?: string | null; priceUnit?: string | null }, requestedOperation?: string): string {
  if ((snapshot?.operation ?? requestedOperation ?? listing.operation) === "sale") return "за объект";
  // A saved snapshot with an empty unit must not inherit ExternalListing's legacy default total.
  const unit = snapshot ? snapshot.priceUnit : listing.priceUnit;
  return unit && !["total", "rub_total"].includes(unit) ? displayLabel("price_unit", unit) : "единица цены не указана";
}
export function translatedEvidence(text: string): string {
  return text.replace(/[a-z][a-z_0-9]*/giu, code => {
    for (const group of ["property_operation_type", "property_type", "price_unit", "criterion"]) {
      if (DISPLAY_LABELS[group]?.[code]) return evidenceLabel(group, code);
    }
    return EVIDENCE_LABELS[code] ?? ({ true: "да", false: "нет" } as Record<string, string>)[code] ?? code;
  });
}

export { evidenceLabel } from "@/shared/codebook";
