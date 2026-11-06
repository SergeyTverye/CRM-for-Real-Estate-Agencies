import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import baselineJson from "../../fixtures/search-quality/baseline.json";
import evidence from "../../../docs/vkr/live-ai-evidence.json";
import { loadDataset, fingerprint } from "../../../scripts/search-quality/dataset";
import { evaluateQuality, currentGrouping, renderReport, type QualityReport, type GroupingAdapter } from "../../../scripts/search-quality/evaluate";
import type { ListingEvaluation } from "../../../src/modules/property-search/domain/types";
import { evaluateListing } from "../../../src/modules/property-search/domain/evaluation";

const baseline = baselineJson as QualityReport;
const countedErrors = ["falseInclusions", "falseConfirmed", "falseExclusions", "exactVerdictErrors"] as const;

describe("LIVE 05.11.2026 → offline REPLAY search quality", () => {
  it("keeps L44's mixed development in review without trusting an unproven legacy office subtype", () => {
    const data = loadDataset();
    const item = data.listings.find(x => x.id === "L44")!;
    const filters = data.queries.find(x => x.id === "retail-rent")!.filters;
    expect(evaluateListing(item.listing, filters)).toMatchObject({ verdict: "needs_review", criteria: expect.arrayContaining([
      expect.objectContaining({ criterion: "purpose", state: "unknown" }),
    ]) });
    expect(evaluateListing({ ...item.listing, purposeSource: "structured" }, filters).verdict).toBe("rejected");
    expect(evaluateListing({ ...item.listing, description: "Офис в жилом доме с деловым центром." }, filters).verdict).toBe("rejected");
    const current = evaluateQuality();
    expect(current.totals.falseExclusions).toBe(0);
    expect(current.totals.falseInclusions).toBeLessThanOrEqual(9);
  });
  it("keeps the 46 live cards + 3 negative controls and manual labels fixed", () => {
    const data = loadDataset();
    expect(fingerprint()).toBe(baseline.fixtureFingerprint);
    expect(data.listings).toHaveLength(49);
    expect(data.listings.filter(x => x.truth.recordKind === "listing")).toHaveLength(46);
    expect(new Set(data.listings.map(x => x.input.url)).size).toBe(49);
    for (const x of data.listings) {
      expect(x.input.url).not.toMatch(/synthetic|example\./u);
      expect(evidence.runs.some(r => r.id === x.provenance.searchRunId)).toBe(true);
      expect(x.input.description.length).toBeLessThanOrEqual(300);
      expect(x.input.images).toEqual([]);
      expect(x.input.description).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/iu);
      expect(Object.keys(x.expected)).toHaveLength(4);
      expect(x.truth.reason.length).toBeGreaterThan(20);
    }
  });

  it("does not worsen inclusion/exclusion errors for any query or source", () => {
    const actual = evaluateQuality();
    expect(actual.fixtureFingerprint).toBe(baseline.fixtureFingerprint);
    expect(actual.totals.cases).toBe(196);
    for (const key of countedErrors) expect(actual.totals[key], key).toBeLessThanOrEqual(baseline.totals[key]);
    for (const dimension of ["perQuery", "perSource"] as const) {
      expect(Object.keys(actual[dimension])).toEqual(Object.keys(baseline[dimension]));
      for (const [id, previous] of Object.entries(baseline[dimension])) {
        const now = actual[dimension][id]!;
        expect(now.cases).toBe(previous.cases);
        expect(now.expectedIncluded).toBe(previous.expectedIncluded);
        expect(now.expectedRejected).toBe(previous.expectedRejected);
        for (const key of countedErrors) expect(now[key], `${dimension}/${id}/${key}`).toBeLessThanOrEqual(previous[key]);
      }
    }
    expect(actual.diagnostics.residentialPurposeRule.rejected).toBeGreaterThanOrEqual(baseline.diagnostics.residentialPurposeRule.rejected);
    expect(actual.diagnostics.floorNormalization.filter(x => !x.correct).length).toBeLessThanOrEqual(baseline.diagnostics.floorNormalization.filter(x => !x.correct).length);
    expect(actual.diagnostics.priceUnitNormalization.filter(x => x.actual !== x.expected).length).toBeLessThanOrEqual(baseline.diagnostics.priceUnitNormalization.filter(x => x.actual !== x.expected).length);
    expect(actual.diagnostics.features.filter(x => x.actual !== x.expected).length).toBeLessThanOrEqual(baseline.diagnostics.features.filter(x => x.actual !== x.expected).length);
  });

  it("never substitutes collection time for an unknown publication date", () => {
    const data = loadDataset();
    expect(data.listings.every(x => x.provenance.fetchedAt.startsWith("2026-11-05"))).toBe(true);
    expect(data.listings.every(x => x.publicationDate === null)).toBe(true);
    expect(evaluateQuality().dates).toEqual({ unknown: 49, total: 49, share: 1, knownPublicationDates: 0 });
  });

  it("keeps duplicate candidate precision/recall no worse on explicitly labelled pairs", () => {
    const actual = evaluateQuality().deduplication;
    expect(actual.annotatedPairs).toBe(5);
    expect(actual.unknownPairsExcluded).toBe(3);
    expect(actual.fp).toBeLessThanOrEqual(baseline.deduplication.fp);
    expect(actual.fn).toBeLessThanOrEqual(baseline.deduplication.fn);
    expect(actual.tp).toBeGreaterThanOrEqual(baseline.deduplication.tp);
    expect(actual.tn).toBeGreaterThanOrEqual(baseline.deduplication.tn);
    expect(actual.exactMergeAccuracy).toBeNull();
  });

  it("scores a future grouping adapter and excludes uncertain pairs", () => {
    const grouping: GroupingAdapter = input => ({ retained: input.length, pairs: [
      { a: "L04", b: "L22", relation: "suspected" },
      { a: "L06", b: "L21", relation: "suspected" },
      { a: "L15", b: "L27", relation: "suspected" },
      { a: "L09", b: "L20", relation: "exact" },
      { a: "L07", b: "L18", relation: "suspected" },
    ] });
    const m = evaluateQuality(grouping).deduplication;
    expect(m).toMatchObject({ tp: 3, fn: 0, fp: 1, tn: 1, precision: 0.75, recall: 1, unknownPairsExcluded: 3, unlabelledPredictions: 1 });
  });

  it("separates false inclusions and exclusions with known denominators", () => {
    const forced = (verdict: ListingEvaluation["verdict"]): ListingEvaluation => ({ verdict, criteria: [], preferences: [], score: 0, aiPending: [] });
    const rejected = evaluateQuality(currentGrouping, () => forced("rejected")).totals;
    const confirmed = evaluateQuality(currentGrouping, () => forced("confirmed")).totals;
    const review = evaluateQuality(currentGrouping, () => forced("needs_review")).totals;
    expect(rejected).toMatchObject({ falseInclusions: 0, falseExclusions: 46, expectedIncluded: 46, falseExclusionRate: 1 });
    expect(confirmed).toMatchObject({ falseInclusions: 150, falseConfirmed: 150, falseNeedsReview: 0, falseExclusions: 0, falseInclusionRate: 1 });
    expect(review).toMatchObject({ falseInclusions: 150, falseConfirmed: 0, falseNeedsReview: 150, falseExclusions: 0 });
  });

  it("runs deterministically without fetch and renders the frozen baseline separately", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network forbidden in REPLAY"); });
    try {
      const before = readFileSync("tests/fixtures/search-quality/baseline.json", "utf8");
      const first = evaluateQuality();
      expect(evaluateQuality()).toEqual(first);
      const markdown = renderReport(baseline, first);
      expect(markdown).toContain("## Базовая линия до v3.1");
      expect(markdown).toContain("## Текущий REPLAY");
      expect(markdown).toContain(baseline.codeFingerprint);
      expect(first).toMatchObject({ networkCalls: 0, aiCalls: 0 });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(readFileSync("tests/fixtures/search-quality/baseline.json", "utf8")).toBe(before);
    } finally { fetchSpy.mockRestore(); }
  });
});
