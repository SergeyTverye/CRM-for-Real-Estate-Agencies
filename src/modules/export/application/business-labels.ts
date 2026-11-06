import { CODEBOOK, DISPLAY_LABELS, evidenceLabel, type CodebookName } from "@/shared/codebook";

/** Export must never fall back to an internal code for an unknown legacy value. */
export function businessLabel(book: CodebookName, value: unknown, fallback = "Не указано"): string {
  return (CODEBOOK[book] as Record<string, string>)[String(value ?? "")] ?? fallback;
}
export function exportDisplayLabel(group: string, value: unknown): string {
  return DISPLAY_LABELS[group]?.[String(value ?? "")] ?? "Не указано";
}
export function exportDateLabel(book: "listingDatePrecision" | "listingDateSource", value: unknown): string {
  const code = String(value ?? "unknown");
  // Older snapshots retain extraction provenance, e.g. cian:structured:publication.
  const normalized = book === "listingDateSource" && code.includes(":")
    ? code.endsWith(":publication") ? "site_published" : code.endsWith(":update") ? "site_updated" : "unknown"
    : code;
  return normalized === "unknown" ? "Дата неизвестна" : businessLabel(book, normalized, "Дата неизвестна");
}
export function exportCriterion(value: string): string {
  const label = evidenceLabel("criterion", value);
  return label === value && /^[a-z][a-z_\d]*$/iu.test(value) ? "Неуточнённое условие" : label;
}
