import { z } from "zod";

export const SOURCES = ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"] as const;
export const PURPOSES = ["retail", "psn_universal", "office", "production", "warehouse", "free_purpose"] as const;
export const PRICE_UNITS = ["rub_total", "rub_month", "rub_year", "rub_m2_month", "rub_m2_year"] as const;
export type Source = typeof SOURCES[number];
export type Purpose = typeof PURPOSES[number];
export type PriceUnit = typeof PRICE_UNITS[number];
const money = z.string().regex(/^\d{1,15}(?:\.\d{1,2})?$/, "Цена — неотрицательная десятичная строка");
export const SearchFilters = z.object({
  city: z.string().trim().min(1).max(120).default("Новосибирск"),
  operation: z.enum(["sale", "rent"]),
  priceUnit: z.enum(PRICE_UNITS).optional(),
  purposes: z.array(z.enum(PURPOSES)).max(6).default([]),
  floorMode: z.enum(["first_floor_only", "exclude_basement_and_semi_basement", "any"]).default("any"),
  priceFrom: money.optional(), priceTo: money.optional(),
  areaFrom: z.number().finite().nonnegative().optional(), areaTo: z.number().finite().nonnegative().optional(),
  districts: z.array(z.string().trim().min(1).max(120)).max(150).default([]),
  seller: z.enum(["all", "confirmed_owner_only"]).default("all"),
  requiredFeatures: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  preferredFeatures: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  sources: z.array(z.enum(SOURCES)).max(7).default([...SOURCES]),
}).strict().superRefine((v, ctx) => {
  if (v.operation === "rent" && (!v.priceUnit || v.priceUnit === "rub_total")) ctx.addIssue({ code: "custom", path: ["priceUnit"], message: "Укажите единицу цены аренды" });
  if (v.operation === "sale" && v.priceUnit && v.priceUnit !== "rub_total") ctx.addIssue({ code: "custom", path: ["priceUnit"], message: "Продажа: полная цена в рублях" });
  if (v.priceFrom !== undefined && v.priceTo !== undefined && compareMoney(v.priceFrom, v.priceTo) > 0) ctx.addIssue({ code: "custom", path: ["priceTo"], message: "Цена от превышает цену до" });
  if (v.areaFrom !== undefined && v.areaTo !== undefined && v.areaFrom > v.areaTo) ctx.addIssue({ code: "custom", path: ["areaTo"], message: "Площадь от превышает площадь до" });
});
export type SearchFilters = z.infer<typeof SearchFilters>;
export const searchFiltersSchema = SearchFilters;
export function compareMoney(a: string, b: string): number {
  const cents = (s: string) => { const [whole = "0", part = ""] = s.split("."); return BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")); };
  const diff = cents(a) - cents(b); return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}
export type Floor = { kind: "above_ground" | "basement" | "semi_basement" | "unknown"; number: number | null; raw: string | null };
export type CriterionState = "matched" | "contradicted" | "unknown";
export interface CriterionEvaluation { criterion: string; state: CriterionState; source: "structured" | "rule" | "ai"; evidence: string; }
export interface OwnerVerification { source: string; method: string; checkedAt: string; verifiedBy?: string; }
export interface NormalizedListing {
  title?: string | null;
  purposeSource?: "structured" | "rule";
  source: Source; sourceListingId: string | null; sourceUnitId: string | null; url: string;
  purpose: Purpose | null; operation: "sale" | "rent" | null;
  price: string | null; priceUnit: PriceUnit | null; area: number | null; floor: Floor;
  city: string | null; address: string | null; district: string | null;
  seller: { type: "owner" | "agent" | "unknown"; ownerVerification?: OwnerVerification };
  description: string; images: string[]; fetchedAt: string;
  structuredFeatures: Record<string, boolean | number | string>;
  possibleDuplicateKeys: string[]; identityNeedsReview: boolean;
}
export interface ListingEvaluation {
  verdict: "confirmed" | "needs_review" | "rejected";
  criteria: CriterionEvaluation[]; preferences: CriterionEvaluation[]; score: number; aiPending: string[];
}
/** Only public, contact-redacted description and unresolved criteria; no CRM actor/client data. */
export interface DescriptionAnalyzer {
  analyze(input: { description: string; criteria: string[]; signal?: AbortSignal }): Promise<CriterionEvaluation[]>;
}
export type SourceStatus = "success" | "partial" | "blocked" | "timeout" | "unsupported_filter" | "error" | "disabled";
export interface SourceRun { source: Source; status: SourceStatus; resultCount: number; reason: string | null; }
export interface SearchResult { listings: { listing: NormalizedListing; evaluation: ListingEvaluation }[]; sources: SourceRun[]; }
