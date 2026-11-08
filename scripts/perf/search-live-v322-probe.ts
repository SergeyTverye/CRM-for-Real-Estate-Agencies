/**
 * BOUNDED LIVE probe for v3.2.2 (coordinator/trusted network only).
 *
 * No AI, no DB, no browser, no dotenv. One adapter job per (query x source),
 * depth maxPages=1/limit=5, per-job deadline 25s. Plain-HTTP factory transport
 * is wrapped to count requests (hard cap 40/source for the whole probe).
 * stdout: sanitized counts/codes only (no URLs, texts, contacts, bodies).
 * Combo duplicate stats are computed in-memory and reported as counts only.
 *
 *   npx tsx scripts/perf/search-live-v322-probe.ts > docs/vkr/live-search-v322-matrix.json
 */
import type RealEstateScraper from "real-estate-scrapper";
import {
  RealEstateScraperAdapter,
  defaultScraperFactory,
  type ScraperFactory,
} from "../../src/modules/property-search/infrastructure/scraper-adapter";
import {
  SOURCES,
  type NormalizedListing,
  type Source,
} from "../../src/modules/property-search/domain/types";
import { deduplicateListings } from "../../src/modules/property-search/infrastructure/normalization";

const PER_JOB_TIMEOUT_MS = 25_000;
const PROBE_BUDGET_PER_SOURCE = 40;
const QUERIES = [
  { id: "rent-office", filters: { city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["office"] } },
  { id: "sale-retail", filters: { city: "Новосибирск", operation: "sale", purposes: ["retail"] } },
  { id: "rent-warehouse", filters: { city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["warehouse"] } },
  { id: "sale-flat", filters: { city: "Новосибирск", operation: "sale", purposes: ["residential"] } },
] as const;

const counters = new Map<Source, number>();
function countingTransport(
  inner: RealEstateScraper.Transport | undefined,
  source: Source,
): RealEstateScraper.Transport | undefined {
  if (!inner) return undefined;
  return async request => {
    const used = (counters.get(source) ?? 0) + 1;
    if (used > PROBE_BUDGET_PER_SOURCE)
      throw Object.assign(new Error("PROBE_REQUEST_BUDGET"), { code: "PROBE_REQUEST_BUDGET" });
    counters.set(source, used);
    return inner(request);
  };
}

interface JobResult {
  query: string;
  source: Source;
  status: string;
  resultCount: number;
  confirmed: number;
  needsReview: number;
  rejected: number;
  pagesFetched: number;
  incomplete: boolean;
  failureCode: string | null;
  reason: string | null;
  requestCount: number;
  elapsedMs: number;
  fields: Record<string, number>;
}

async function probe(queryId: string, filters: unknown, source: Source): Promise<{ job: JobResult; listings: NormalizedListing[] }> {
  const started = Date.now();
  const empty = (): { job: JobResult; listings: NormalizedListing[] } => ({
    job: {
      query: queryId, source, status: "error",
      resultCount: 0, confirmed: 0, needsReview: 0, rejected: 0,
      pagesFetched: 0, incomplete: true, failureCode: "PROBE_FAILED", reason: null,
      requestCount: counters.get(source) ?? 0, elapsedMs: Date.now() - started,
      fields: { price: 0, priceUnit: 0, area: 0, floor: 0, photo: 0, publishedAt: 0, district: 0 },
    },
    listings: [],
  });
  const factory: ScraperFactory = config =>
    defaultScraperFactory({ ...config, transport: countingTransport(config.transport, source) ?? config.transport });
  const adapter = new RealEstateScraperAdapter({
    enabled: true,
    browserEnabled: false,
    enabledSources: [source],
    jobTimeoutMs: PER_JOB_TIMEOUT_MS,
    maxConcurrentJobs: 1,
    depth: { maxPages: 1, limit: 5 },
    factory,
  });
  try {
    const result = await adapter.searchDetailed(
      { ...(filters as Record<string, unknown>), sources: [source] },
      { deadline: Date.now() + PER_JOB_TIMEOUT_MS },
    );
    const run = result.sources.find(r => r.source === source);
    let confirmed = 0, needsReview = 0, rejected = 0;
    const fields = { price: 0, priceUnit: 0, area: 0, floor: 0, photo: 0, publishedAt: 0, district: 0 };
    for (const item of result.listings) {
      if (item.evaluation.verdict === "confirmed") confirmed++;
      else if (item.evaluation.verdict === "needs_review") needsReview++;
      else rejected++;
      const l = item.listing;
      if (l.price !== null) fields.price++;
      if (l.priceUnit !== null) fields.priceUnit++;
      if (l.area !== null) fields.area++;
      if (l.floor.kind !== "unknown") fields.floor++;
      if (l.images.length > 0) fields.photo++;
      if (l.publishedAt !== null) fields.publishedAt++;
      if (l.district !== null) fields.district++;
    }
    return {
      listings: result.listings.map(i => i.listing),
      job: {
        query: queryId, source, status: run?.status ?? "error",
        resultCount: run?.resultCount ?? 0, confirmed, needsReview, rejected,
        pagesFetched: run?.pagesFetched ?? 0, incomplete: run?.incomplete ?? true,
        failureCode: run?.failureCode ?? null, reason: run?.reason ?? null,
        requestCount: counters.get(source) ?? 0, elapsedMs: Date.now() - started,
        fields,
      },
    };
  } catch {
    return empty();
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const jobs: JobResult[] = [];
  const kept = new Map<string, NormalizedListing[]>();
  for (const q of QUERIES) {
    const probed = await Promise.all(SOURCES.map(s => probe(q.id, q.filters, s)));
    for (const p of probed) {
      jobs.push(p.job);
      kept.set(`${q.id}:${p.job.source}`, p.listings);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const combos: Record<string, unknown> = {};
  for (const q of QUERIES) {
    const groups: Record<string, Source[]> = {
      pair_onrealt_yandex: ["onrealt", "yandex"],
      trio_plus_mirkvartir: ["onrealt", "yandex", "mirkvartir"],
      all7: [...SOURCES],
    };
    const entry: Record<string, unknown> = {};
    for (const [name, sources] of Object.entries(groups)) {
      const picked = jobs.filter(j => j.query === q.id && sources.includes(j.source));
      const combined = sources.flatMap(s => kept.get(`${q.id}:${s}`) ?? []);
      const deduped = deduplicateListings(combined);
      entry[name] = {
        sources,
        jobs: picked.map(j => ({ source: j.source, status: j.status, resultCount: j.resultCount })),
        totalResults: picked.reduce((n, j) => n + j.resultCount, 0),
        uniqueResults: deduped.length,
        exactDuplicatesRemoved: combined.length - deduped.length,
        suspectedPairs: deduped.filter(l => l.possibleDuplicateKeys.length > 0).length,
        partial: picked.some(j => j.incomplete),
        blocked: picked.filter(j => ["blocked", "needs_user_action"].includes(j.status)).map(j => j.source),
      };
    }
    combos[q.id] = entry;
  }
  process.stdout.write(JSON.stringify({
    mode: "LIVE", aiCalls: 0, browser: false,
    startedAt, finishedAt: new Date().toISOString(),
    depth: { maxPages: 1, limit: 5 }, perJobTimeoutMs: PER_JOB_TIMEOUT_MS,
    probeBudgetPerSource: PROBE_BUDGET_PER_SOURCE,
    requestCounts: Object.fromEntries(counters),
    jobs, combos,
  }, null, 2) + "\n");
}

const invoked = (process.argv[1] ?? "").replace(/\\/g, "/").includes("search-live-v322-probe");
if (invoked) main().catch(() => { if (!process.exitCode) process.exitCode = 1; });
