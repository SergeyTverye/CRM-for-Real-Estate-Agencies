import { DISPLAY_LABELS, displayLabel } from "@/shared/codebook";
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
const labels: Record<string, string> = {
  matched: "Совпадает", contradicted: "Противоречит", unknown: "Нет данных",
  structured: "Структурированные поля", rule: "Правило", ai: "ИИ",
  separate_entrance: "Отдельный вход", shop_window: "Витрина", showcase: "Витрина", first_line: "Первая линия",
  wet_point: "Мокрая точка", gates: "Ворота", power_kw: "Мощность, кВт", ceiling_m: "Высота потолков, м",
  owner_confirmed: "Собственник", price_unit: "Единица цены",
};
export function evidenceLabel(group: string, code: string): string {
  const power = code.match(/^power_from_(\d+)_kW$/iu);
  return power ? `Мощность от ${power[1]} кВт` : labels[code] ?? displayLabel(group, code);
}
export function translatedEvidence(text: string): string {
  return text.replace(/[a-z][a-z_0-9]*/giu, code => {
    for (const group of ["property_operation_type", "property_type", "price_unit", "criterion"]) {
      if (DISPLAY_LABELS[group]?.[code]) return evidenceLabel(group, code);
    }
    return labels[code] ?? ({ true: "да", false: "нет" } as Record<string, string>)[code] ?? code;
  });
}
