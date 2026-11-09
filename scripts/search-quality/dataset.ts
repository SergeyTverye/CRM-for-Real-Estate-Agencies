import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { SOURCES, PURPOSES, PRICE_UNITS, SearchFilters } from "../../src/modules/property-search/domain/types";
import { manualRows, duplicatePairs, queries } from "./annotations";

const root = process.cwd();
export const fixturePath = resolve(root, "tests/fixtures/search-quality/live-2026-11-05.json");
export const baselinePath = resolve(root, "tests/fixtures/search-quality/baseline.json");
export const reportPath = resolve(root, "docs/vkr/search-quality.md");
const nullableText = z.string().nullable();
const snapshotSchema = z.object({
  id: z.string(),
  provenance: z.object({ listingId: z.uuid(), snapshotId: z.uuid(), searchRunId: z.uuid(), fetchedAt: z.iso.datetime(), sourceMode: z.literal("LIVE"), originalDescriptionLength: z.number() }),
  publicationDate: z.iso.datetime().nullable(),
  input: z.object({
    source: z.enum([...SOURCES, "web_search"]), sourceListingId: nullableText, sourceUnitId: nullableText,
    url: z.url(), title: nullableText, purposeSource: z.enum(["rule", "structured"]).optional(),
    purpose: z.enum(PURPOSES).nullable(), operation: z.enum(["sale", "rent"]).nullable(),
    price: z.string().regex(/^\d+\.\d{2}$/u).nullable(), priceUnit: z.enum(PRICE_UNITS).nullable(),
    area: z.number().nonnegative().nullable(), floor: z.object({ kind: z.enum(["above_ground", "basement", "semi_basement", "unknown"]), number: z.number().nullable(), raw: nullableText }),
    city: nullableText, address: nullableText, district: nullableText, seller: z.object({ type: z.literal("unknown") }),
    description: z.string().max(300), images: z.array(z.string()).length(0), fetchedAt: z.iso.datetime(),
    structuredFeatures: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
    possibleDuplicateKeys: z.array(z.string()).length(0), identityNeedsReview: z.boolean(),
  }),
});
const datasetSchema = z.object({ version: z.literal(1), mode: z.literal("REPLAY"), sourceMode: z.literal("LIVE"), collectedOn: z.literal("2026-11-05"), sourceDatabase: z.literal("crm_demo"), sourceEvidence: z.string(), sourceEvidenceSha256: z.string(), populationUniqueUrls: z.number(), listings: z.array(snapshotSchema).min(40).max(50) });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Verdict = "confirmed" | "needs_review" | "rejected";

/** Only individually inspected facts override the observed structured snapshot. Null means unknown. */
const facts: Record<string, { floor?: string; area?: number; price?: string; priceUnit?: string; features?: Record<string, boolean | number | string>; priceCheck?: string }> = {
  L13: { area: 26.94 },
  L16: { price: "100.00", priceUnit: "rub_m2_month", priceCheck: "correct_rate_not_monthly_total" },
  L18: { features: { production_allowed: false, ceiling_m: 5 } },
  L19: { floor: "3", features: { separate_entrance: true, gates: true }, priceCheck: "450_per_m2_period_unknown" },
  L20: { features: { gates: true, ceiling_m: 10.5, crane_t: 5 } },
  L22: { priceCheck: "monthly_per_m2_rate_truncated", features: { gates: true } },
  L23: { floor: "2", features: { freight_lifts: 2 } },
  L24: { features: { wet_point: true } },
  L26: { features: { separate_entrance: true, legal_status: "residential" } },
  L27: { price: "9980000.00", priceUnit: "rub_total", priceCheck: "consistent_with_explicit_text" },
  L29: { features: { separate_entrance: true } },
  L30: { features: { separate_entrance: "planned_not_confirmed" } },
  L31: { features: { separate_entrance: true, first_line: true, power_kw: 150 } },
  L33: { floor: "цоколь" },
  L37: { features: { freight_lifts: true } },
  L48: { floor: "19" },
};

export function loadDataset() {
  const dataset = datasetSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));
  const verdicts: Record<string, Verdict> = { C: "confirmed", N: "needs_review", R: "rejected" };
  const listings = dataset.listings.map(snapshot => {
    const row = manualRows.find(r => r[0] === snapshot.id);
    if (!row) throw new Error(`Missing manual annotation: ${snapshot.id}`);
    const [, trueType, purposes, operation, expected, reason] = row;
    const fact = facts[snapshot.id];
    const groups = duplicatePairs.filter(p => (p.a === snapshot.id || p.b === snapshot.id) && p.expected === "suspected").map(p => p.group);
    // Web Search used its own source code in v2.4.1. Keep it in provenance.
    // the pure domain type only accepts platform codes (evaluation never uses this field).
    const source = snapshot.input.source === "web_search" ? new URL(snapshot.input.url).hostname.includes("cian") ? "cian" : new URL(snapshot.input.url).hostname.includes("avito") ? "avito" : "onrealt" : snapshot.input.source;
    return {
      ...snapshot, listing: { ...snapshot.input, source },
      truth: {
        trueType, purposes: purposes ? purposes.split(",") : [], operation,
        recordKind: ["L45", "L46", "L47"].includes(snapshot.id) ? "search_page" : "listing",
        price: { observed: snapshot.input.price, observedUnit: snapshot.input.priceUnit, explicitValue: fact?.price ?? null, explicitUnit: fact?.priceUnit ?? null, assessment: fact?.priceCheck ?? "amount_unverified_from_excerpt", unitAssessment: operation === "sale" && snapshot.input.priceUnit === "rub_total" ? "consistent_with_sale" : "unknown" },
        area: { observed: snapshot.input.area, value: fact?.area ?? snapshot.input.area, basis: fact?.area ? "description" : "snapshot_field_or_description" },
        floor: { raw: fact?.floor ?? snapshot.input.floor.raw, basis: fact?.floor ? "description_overrides_field" : "snapshot_field", contradicted: fact?.floor !== undefined },
        features: fact?.features ?? {}, publicationDateKnown: snapshot.publicationDate !== null,
        duplicateGroups: groups, reason,
      },
      expected: Object.fromEntries(queries.map((q, i) => [q.id, verdicts[expected[i]!]!])),
    };
  });
  if (new Set(listings.map(l => l.id)).size !== listings.length || manualRows.length !== listings.length) throw new Error("Duplicate IDs or unused annotations");
  return { ...dataset, listings, queries: queries.map(q => ({ ...q, filters: SearchFilters.parse(q.filters) })), duplicatePairs };
}

export function fingerprint() {
  return createHash("sha256").update(readFileSync(fixturePath)).update(readFileSync(resolve(root, "scripts/search-quality/annotations.ts"))).update(readFileSync(resolve(root, "scripts/search-quality/dataset.ts"))).digest("hex");
}
